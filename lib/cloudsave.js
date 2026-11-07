'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const crypto = require('crypto');
const { execFile } = require('child_process');

const STORE = 'hyperfocus-saves';
const CHUNK = 3 * 1024 * 1024;
const MAX_RAW = 60 * 1024 * 1024;
const KEEP_BACKUPS = 5;
const SKIP_FILES = new Set(['lock', 'log', 'log.old', 'lockfile']);

const IS_MAC = process.platform === 'darwin';
const sid = id => (IS_MAC ? `${id}-mac` : id);

const home = os.homedir();
const env = (k, fb) => process.env[k] || fb;
const ROOTS = () => ({
  '%APPDATA%': env('APPDATA', path.join(home, 'AppData', 'Roaming')),
  '%LOCALAPPDATA%': env('LOCALAPPDATA', path.join(home, 'AppData', 'Local')),
  '%USERPROFILE%': home,
});
const ALLOWED = () => [
  ROOTS()['%APPDATA%'], ROOTS()['%LOCALAPPDATA%'], path.join(home, 'AppData', 'LocalLow'),
  path.join(home, 'Documents'), path.join(home, 'Saved Games'), path.join(home, 'My Games'),
];
const DENY_FIRST = new Set(['microsoft', 'packages', 'temp', 'hyperfocus', 'google', 'mozilla', 'discord', 'npm',
  'programs', 'd3dscache', 'nvidia', 'nvidia corporation', 'steam', 'windows', 'bravesoftware', 'opera software', 'claude']);

const MAC_BASES = ['Library/Application Support', 'Library/Preferences', 'Documents'];
const MAC_DENY_FIRST = new Set(['firefox', 'safari', 'addressbook', 'calendars', 'cloudstorage', 'mobile documents', 'icloud', 'keychains',
  'knowledge', 'dock', 'callhistorydb', 'syncservices', 'adobe', 'chromium', 'microsoft edge', 'brave-browser', 'code', 'slack', 'zoom.us', 'spotify']);
const DOMAIN_RE = /^[A-Za-z0-9][A-Za-z0-9 _.'&()+,!-]{0,150}$/;
const UNITY_PART_RE = /^[A-Za-z0-9][A-Za-z0-9 _.'&()+,!-]{0,63}$/;
function resolveMacSpec(spec, installDir) {
  const raw = String(spec || '').trim().replace(/[\\]/g, '/');
  if (!raw || raw.length > 260 || raw.includes('..')) return null;
  if (/^\{install\}\/?/i.test(raw)) {
    if (!installDir) return null;
    const rel = raw.replace(/^\{install\}\/?/i, '');
    if (!rel) return null;
    const abs = path.resolve(installDir, rel);
    if (!abs.startsWith(path.resolve(installDir) + path.sep)) return null;
    return { spec: String(spec).trim(), kind: 'fs', abs, install: true, rel };
  }
  const m = /^~\/(Library\/Application Support|Library\/Preferences|Documents)\/(.+)$/.exec(raw);
  if (!m || !MAC_BASES.includes(m[1])) return null;
  const base = path.resolve(home, m[1]);
  const abs = path.resolve(base, m[2]);
  if (!abs.startsWith(base + path.sep)) return null;
  const first = path.relative(base, abs).split(path.sep)[0].toLowerCase();
  if (!first || DENY_FIRST.has(first) || MAC_DENY_FIRST.has(first) || /^com\.apple\./.test(first) || first === 'apple') return null;
  if (m[1] === 'Library/Preferences' && /^[^/]+\.plist$/i.test(m[2])) {
    const domain = m[2].replace(/\.plist$/i, '');
    return DOMAIN_RE.test(domain) ? { spec: String(spec).trim(), kind: 'plist', domain, abs } : null;
  }
  return { spec: String(spec).trim(), kind: 'fs', abs };
}
function winToMac(spec) {
  const raw = String(spec || '').trim().replace(/\//g, '\\');
  if (!raw || raw.length > 260 || raw.includes('..')) return null;
  let m;
  if (/^\{install\}\\?/i.test(raw)) return raw.replace(/\\/g, '/');
  if ((m = /^HKCU\\Software\\([^\\]+)\\([^\\]+)$/i.exec(raw.replace(/^HKEY_CURRENT_USER/i, 'HKCU').replace(/\\+$/, '')))) {
    if (/^(microsoft|classes|policies|wow6432node|windows)$/i.test(m[1]) || !UNITY_PART_RE.test(m[1]) || !UNITY_PART_RE.test(m[2])) return null;
    return `~/Library/Preferences/unity.${m[1]}.${m[2]}.plist`;
  }
  if ((m = /^%(?:APPDATA|LOCALAPPDATA)%\\(.+)$/i.exec(raw))) return `~/Library/Application Support/${m[1].replace(/\\/g, '/')}`;
  if ((m = /^%USERPROFILE%\\AppData\\(?:Roaming|Local|LocalLow)\\(.+)$/i.exec(raw))) return `~/Library/Application Support/${m[1].replace(/\\/g, '/')}`;
  if ((m = /^%USERPROFILE%\\Documents\\(.+)$/i.exec(raw))) return `~/Documents/${m[1].replace(/\\/g, '/')}`;
  return null;
}
const isMacSpec = s => /^\s*~[\\/]/.test(String(s || ''));

function resolveSpec(spec, installDir) {
  if (IS_MAC) return resolveMacSpec(spec, installDir);
  const raw = String(spec || '').trim().replace(/\//g, '\\');
  if (!raw || raw.length > 260 || raw.includes('..')) return null;
  const reg = /^(HKCU|HKEY_CURRENT_USER)\\Software\\([^\\]+)\\(.+)$/i.exec(raw);
  if (reg) {
    if (/^(microsoft|classes|policies|wow6432node|windows)$/i.test(reg[2])) return null;
    return { spec: raw, kind: 'reg', key: `HKCU\\Software\\${reg[2]}\\${reg[3].replace(/\\+$/, '')}` };
  }
  let abs;
  if (/^\{install\}\\?/i.test(raw)) {
    if (!installDir) return null;
    const rel = raw.replace(/^\{install\}\\?/i, '');
    if (!rel) return null;
    abs = path.resolve(installDir, rel);
    if (!abs.toLowerCase().startsWith(path.resolve(installDir).toLowerCase() + path.sep)) return null;
    return { spec: raw, kind: 'fs', abs, install: true, rel };
  }
  const m = /^(%APPDATA%|%LOCALAPPDATA%|%USERPROFILE%)\\(.+)$/i.exec(raw);
  if (!m) return null;
  abs = path.resolve(ROOTS()[m[1].toUpperCase()], m[2]);
  const low = abs.toLowerCase();
  const base = ALLOWED().find(r => low.startsWith(path.resolve(r).toLowerCase() + path.sep));
  if (!base) return null;
  const first = path.relative(base, abs).split(path.sep)[0].toLowerCase();
  if (!first || DENY_FIRST.has(first)) return null;
  return { spec: raw, kind: 'fs', abs };
}
function specsFor(app, installDir) {
  let list = (Array.isArray(app?.saveData) ? app.saveData : app?.saveData ? [app.saveData] : []).slice(0, 10);
  if (IS_MAC && !list.some(isMacSpec)) list = [...new Set(list.map(winToMac).filter(Boolean))];
  return list.map(s => resolveSpec(s, installDir)).filter(Boolean);
}

function run(cmd, args, opts) {
  return new Promise((resolve, reject) => execFile(cmd, args, { windowsHide: true, timeout: 30000, ...opts }, (e, out, err) => e ? reject(new Error(String(err || e.message).trim())) : resolve(out)));
}

async function walk(dir, rel = '', out = [], budget = { n: 0 }) {
  let ents;
  try { ents = await fsp.readdir(path.join(dir, rel), { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const r = rel ? path.join(rel, e.name) : e.name;
    if (e.isDirectory()) await walk(dir, r, out, budget);
    else if (e.isFile() && !SKIP_FILES.has(e.name.toLowerCase())) {
      const data = await fsp.readFile(path.join(dir, r));
      budget.n += data.length;
      if (budget.n > MAX_RAW) throw Object.assign(new Error('That save is too big for the cloud (over 60 MB).'), { code: 'too_big' });
      out.push({ rel: r.split(path.sep).join('/'), data });
    }
  }
  return out;
}

// everything the game saved, right now
async function snapshot(specs) {
  const items = [];
  const budget = { n: 0 };
  for (const s of specs) {
    if (s.kind === 'plist') {
      let text = null;
      try { text = await run('defaults', ['export', s.domain, '-'], { maxBuffer: 64 * 1024 * 1024 }); } catch {}
      if (text && /<plist[^>]*>\s*<dict\s*(?:\/>|>\s*<\/dict>)\s*<\/plist>/.test(text)) text = null;
      items.push({ spec: s.spec, type: text ? 'plist' : 'missing', text });
      continue;
    }
    if (s.kind === 'reg') {
      const tmp = path.join(os.tmpdir(), `hf-reg-${process.pid}-${crypto.randomBytes(4).toString('hex')}.reg`);
      let text = null;
      try { await run('reg.exe', ['export', s.key, tmp, '/y']); text = (await fsp.readFile(tmp)).toString('utf16le').replace(/^﻿/, ''); } catch {}
      await fsp.rm(tmp, { force: true }).catch(() => {});
      items.push({ spec: s.spec, type: text ? 'reg' : 'missing', text });
      continue;
    }
    let st = null;
    try { st = await fsp.stat(s.abs); } catch {}
    if (!st) items.push({ spec: s.spec, type: 'missing' });
    else if (st.isDirectory()) items.push({ spec: s.spec, type: 'dir', files: await walk(s.abs, '', [], budget) });
    else {
      const data = await fsp.readFile(s.abs);
      budget.n += data.length;
      items.push({ spec: s.spec, type: 'file', files: [{ rel: '', data }] });
    }
  }
  const h = crypto.createHash('sha256');
  let size = 0, empty = true;
  for (const it of items) {
    h.update(`${it.spec}\0${it.type}\0`);
    if (it.type === 'reg' || it.type === 'plist') { h.update(it.text); size += it.text.length; empty = false; }
    for (const f of (it.files || []).slice().sort((a, b) => a.rel < b.rel ? -1 : 1)) {
      h.update(`${f.rel}\0`); h.update(crypto.createHash('sha256').update(f.data).digest()); size += f.data.length; empty = false;
    }
  }
  return { items, hash: empty ? '' : h.digest('hex'), size, empty };
}

const pack = snap => zlib.gzipSync(Buffer.from(JSON.stringify({
  v: 1, items: snap.items.map(it => ({ spec: it.spec, type: it.type, text: it.text, files: it.files?.map(f => ({ rel: f.rel, b64: f.data.toString('base64') })) })),
}))).toString('base64');
function unpack(b64) {
  const j = JSON.parse(zlib.gunzipSync(Buffer.from(b64, 'base64')).toString());
  if (j?.v !== 1 || !Array.isArray(j.items)) throw new Error('That cloud save is damaged.');
  return j.items.map(it => ({ ...it, files: it.files?.map(f => ({ rel: String(f.rel || ''), data: Buffer.from(f.b64 || '', 'base64') })) }));
}

async function restore(specs, items) {
  for (const s of specs) {
    const it = items.find(x => x.spec === s.spec);
    if (!it) continue;
    if (s.kind === 'plist') {
      await run('defaults', ['delete', s.domain]).catch(() => {});
      if (it.type === 'plist' && it.text) {
        const tmp = path.join(os.tmpdir(), `hf-plist-${process.pid}-${crypto.randomBytes(4).toString('hex')}.plist`);
        await fsp.writeFile(tmp, String(it.text));
        try { await run('defaults', ['import', s.domain, tmp]); } finally { await fsp.rm(tmp, { force: true }).catch(() => {}); }
      }
      continue;
    }
    if (s.kind === 'reg') {
      await run('reg.exe', ['delete', s.key, '/f']).catch(() => {});
      if (it.type === 'reg' && it.text) {
        const tmp = path.join(os.tmpdir(), `hf-reg-${process.pid}-${crypto.randomBytes(4).toString('hex')}.reg`);
        await fsp.writeFile(tmp, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(it.text, 'utf16le')]));
        try { await run('reg.exe', ['import', tmp]); } finally { await fsp.rm(tmp, { force: true }).catch(() => {}); }
      }
      continue;
    }
    if (it.type === 'dir') {
      await fsp.rm(s.abs, { recursive: true, force: true });
      await fsp.mkdir(s.abs, { recursive: true });
      for (const f of it.files || []) {
        const dest = path.resolve(s.abs, f.rel);
        if (!dest.toLowerCase().startsWith(path.resolve(s.abs).toLowerCase() + path.sep)) continue;
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await fsp.writeFile(dest, f.data);
      }
    } else if (it.type === 'file') {
      await fsp.mkdir(path.dirname(s.abs), { recursive: true });
      await fsp.writeFile(s.abs, it.files?.[0]?.data || Buffer.alloc(0));
    } else if (it.type === 'missing') {
      await fsp.rm(s.abs, { recursive: true, force: true });
    }
  }
}

class CloudSaves {
  constructor({ velora, dataDir, deviceId }) {
    this.velora = velora;
    this.dataDir = dataDir;
    this.deviceId = deviceId;
    this.deviceName = os.hostname();
    this.file = path.join(dataDir, 'cloud-saves.json');
    try { this.state = JSON.parse(fs.readFileSync(this.file, 'utf8')) || {}; } catch { this.state = {}; }
  }
  save() { try { fs.writeFileSync(this.file, JSON.stringify(this.state, null, 1)); } catch {} }
  st(id) { return this.state[id] || (this.state[id] = {}); }

  api(p, opts) { return this.velora.api(p, opts); }
  async meta(id) {
    try { return JSON.parse((await this.api(`/storage/${STORE}/${encodeURIComponent(`meta-${sid(id)}`)}`)).value); }
    catch (e) { if (e.status === 404) return null; throw e; }
  }
  async download(id, meta) {
    let b64 = '';
    for (let n = 0; n < meta.chunks; n++) {
      b64 += (await this.api(`/storage/${STORE}/${encodeURIComponent(`data-${sid(id)}-${n}`)}`, { timeout: 120000 })).value;
    }
    if (crypto.createHash('sha256').update(b64).digest('hex') !== meta.packHash) throw new Error('The cloud save came down damaged - try again.');
    return unpack(b64);
  }
  async upload(id, snap, oldMeta) {
    const b64 = pack(snap);
    const chunks = Math.max(1, Math.ceil(b64.length / CHUNK));
    for (let n = 0; n < chunks; n++) {
      await this.api(`/storage/${STORE}/${encodeURIComponent(`data-${sid(id)}-${n}`)}`, { method: 'PUT', body: { value: b64.slice(n * CHUNK, (n + 1) * CHUNK) }, timeout: 120000 });
    }
    const at = Date.now();
    const entry = { at, device: this.deviceId, deviceName: this.deviceName, hash: snap.hash, size: snap.size };
    const meta = {
      v: 1, hash: snap.hash, packHash: crypto.createHash('sha256').update(b64).digest('hex'), at, device: this.deviceId, deviceName: this.deviceName,
      size: snap.size, packed: b64.length, chunks, log: [entry, ...(oldMeta?.log || [])].slice(0, 30),
    };
    await this.api(`/storage/${STORE}/${encodeURIComponent(`meta-${sid(id)}`)}`, { method: 'PUT', body: { value: JSON.stringify(meta) } });
    for (let n = chunks; n < (oldMeta?.chunks || 0); n++) {
      await this.api(`/storage/${STORE}/${encodeURIComponent(`data-${sid(id)}-${n}`)}`, { method: 'DELETE' }).catch(() => {});
    }
    Object.assign(this.st(id), { syncHash: snap.hash, syncAt: at });
    this.save();
    return meta;
  }
  async backupLocal(id, snap, why) {
    if (!snap || snap.empty) return null;
    const dir = path.join(this.dataDir, 'save-backups', id.replace(/[^a-z0-9._-]/gi, '_'));
    await fsp.mkdir(dir, { recursive: true });
    const f = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${why}.hfsave`);
    await fsp.writeFile(f, pack(snap));
    const all = (await fsp.readdir(dir)).filter(x => x.endsWith('.hfsave')).sort();
    for (const old of all.slice(0, Math.max(0, all.length - KEEP_BACKUPS))) await fsp.rm(path.join(dir, old), { force: true }).catch(() => {});
    return f;
  }
  async restoreFromCloud(id, specs, meta, localSnap) {
    const items = await this.download(id, meta);
    await this.backupLocal(id, localSnap, 'before-cloud');
    await restore(specs, items);
    Object.assign(this.st(id), { syncHash: meta.hash, syncAt: meta.at });
    this.save();
  }
}

module.exports = { CloudSaves, specsFor, resolveSpec, snapshot, restore, unpack, winToMac };
