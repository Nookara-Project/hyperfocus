'use strict';
const fs = require('fs');
const path = require('path');

const nke = import('./nke1.mjs');
const argon2 = () => import('hash-wasm');

function create({ api, file, safeStorage, baseUrl, getToken }) {
  let me = null, info = null, keys = null;
  const bundles = new Map();
  const BUNDLE_MS = 5 * 60 * 1000;

  const load = () => {
    try {
      const buf = fs.readFileSync(file);
      return JSON.parse(safeStorage.decryptString(buf));
    } catch { return null; }
  };
  const save = secret => {
    try {
      if (!safeStorage.isEncryptionAvailable()) return;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, safeStorage.encryptString(JSON.stringify({ uid: me.id, secret })), { mode: 0o600 });
    } catch (e) { console.error('[dm-keys] saving', e.message); }
  };
  const hold = async secret => {
    const N = await nke;
    keys = { kid: secret.kid, enc_pub: secret.enc_pub, sig_pub: secret.sig_pub, encPriv: await N.importEncPriv(secret.enc_priv), sigPriv: await N.importSigPriv(secret.sig_priv), secret };
  };

  let startedFor = null, started = null;
  const ready = () => {
    const t = getToken();
    if (startedFor !== t) { startedFor = t; started = init(); }
    return started;
  };
  async function init() {
    keys = null; bundles.clear();
    info = await api('/im/keys/me').catch(() => null);
    if (!info) return status();
    me = { id: String(info.user_id), username: info.username };
    const saved = load();
    if (saved && saved.uid === me.id && info.has && saved.secret.kid === info.kid) await hold(saved.secret);
    return status();
  }
  const status = () => {
    if (!info) return { state: 'loading' };
    if (keys) return { state: 'ready' };
    if (!info.has) return { state: 'none' };
    return { state: 'locked', type: info.passcode?.type || 'pin', passcodeLocked: !!info.passcode?.locked, triesLeft: info.passcode?.tries_left };
  };
  const unlockWith = async (kind, auth, wrap) => {
    const N = await nke;
    const blob = await api('/im/keys/unlock', { method: 'POST', body: { kind, auth } });
    const secret = await N.openBlob(blob, wrap);
    await hold(secret);
    save(secret);
    return status();
  };
  async function unlockPasscode(value) {
    const N = await nke;
    const p = info?.passcode;
    if (!p) throw new Error('No PIN or password is set up for this account.');
    const { argon2id } = await argon2();
    const out = await argon2id({ password: String(value), salt: N.unb64(p.salt), parallelism: p.params.p, iterations: p.params.t, memorySize: p.params.m, hashLength: 64, outputType: 'binary' });
    const s = await N.stretched(out);
    try { return await unlockWith('passcode', s.auth, s.wrap); }
    catch (e) { info = await api('/im/keys/me').catch(() => info); throw e; }
  }
  async function unlockRecovery(code) {
    const N = await nke;
    if (!info?.recovery) throw new Error('No recovery code is set up for this account.');
    const s = await N.stretchRecovery(code, info.recovery.salt);
    return unlockWith('recovery', s.auth, s.wrap);
  }
  async function startLink() {
    const N = await nke;
    const k = await N.newLinkKey();
    const kid = await N.kidOf(k.enc_pub);
    const r = await api('/im/keys/link', { method: 'POST', body: { enc_pub: k.enc_pub, label: 'Hyperfocus' } });
    const code = await N.linkCode(k.enc_pub);
    if (code !== r.code) throw new Error("That code doesn't match this PC's key. Don't approve it.");
    const wait = (async () => {
      for (let i = 0; i < 300; i++) {
        await new Promise(ok => setTimeout(ok, 2000));
        const s = await api(`/im/keys/link/${encodeURIComponent(code)}`).catch(() => null);
        if (s?.state === 'denied') throw new Error('That was denied on your other device.');
        if (s?.state === 'approved' && s.sealed) {
          const secret = await N.unsealJson(s.sealed, k.enc_priv, kid);
          await hold(secret);
          save(secret);
          return status();
        }
      }
      throw new Error('That code expired. Start again.');
    })();
    return { code, wait };
  }

  async function bundleFor(username, fresh = false) {
    const N = await nke;
    const key = String(username).toLowerCase();
    const hit = bundles.get(key);
    if (hit && !fresh && Date.now() - hit.at < BUNDLE_MS) return hit.b;
    const b = await api(`/im/keys/user/${encodeURIComponent(username)}`);
    const doc = b.clients || { seq: 0, list: [] };
    if (doc.list?.length && !(await N.verifyClients(b.user_id, b.kid, doc, b.clients_sig, b.sig_pub))) throw new Error("That person's key list isn't signed properly, so nothing was sent.");
    bundles.set(key, { at: Date.now(), b });
    return b;
  }
  const active = b => [{ kid: b.kid, enc_pub: b.enc_pub }, ...((b.clients?.list || []).filter(c => !c.revoked_at).map(c => ({ kid: c.kid, enc_pub: c.enc_pub })))];
  async function seal(to, text, { fresh = false } = {}) {
    await ready();
    if (!keys) throw Object.assign(new Error('Unlock your DMs first.'), { code: 'e2ee_locked' });
    const N = await nke;
    const peer = await bundleFor(to, fresh), mine = await bundleFor(me.username, fresh);
    return N.encryptMessage({ t: text }, { from: me.id, to: peer.user_id, recipients: [...active(peer), ...active(mine)], signer: { kid: keys.kid, sigPriv: keys.sigPriv } });
  }
  const forget = username => bundles.delete(String(username).toLowerCase());

  const LINK_LINE = /^https?:\/\/\S+#nke=\S+$/;
  async function open(m) {
    if (!m?.enc) return m;
    await ready().catch(() => {});
    if (!keys) return { ...m, body: '[Encrypted. Unlock your DMs to read this.]', locked: true };
    try {
      const N = await nke;
      const k = await N.messageKey(m.enc, keys.kid, keys.encPriv);
      if (!k) return { ...m, body: "[This PC can't open this message.]" };
      const p = await N.openWithKey(m.enc, k, { from: m.from_id, to: m.to_id });
      const lines = String(p.t ?? '').split('\n');
      const files = lines.filter(l => LINK_LINE.test(l.trim())).length;
      const text = lines.filter(l => !LINK_LINE.test(l.trim())).join('\n').trimEnd();
      return { ...m, body: [text, files ? `[${files === 1 ? 'An encrypted file' : `${files} encrypted files`}: open this chat in Ember to see ${files === 1 ? 'it' : 'them'}]` : ''].filter(Boolean).join('\n'), reply: m.reply ? { ...m.reply, body: p.r?.s ?? m.reply.body } : m.reply };
    } catch { return { ...m, body: "[This PC can't open this message.]" }; }
  }
  async function sealedFileLine(bytes, name, mime) {
    const N = await nke;
    const f = await N.encryptFile(bytes);
    const form = new FormData();
    form.append('file', new Blob([f.data], { type: 'application/octet-stream' }), 'file.bin');
    const r = await fetch(`${baseUrl}/chat/media/temp`, { method: 'POST', headers: { Authorization: `Bearer ${getToken()}` }, body: form });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.attachment?.url) throw new Error(j.message || j.error || "That file didn't upload.");
    return N.fileLink(j.attachment.url, { key: f.key, iv: f.iv, name, mime });
  }
  return { ready, status, unlockPasscode, unlockRecovery, startLink, seal, open, forget, sealedFileLine };
}
module.exports = { create };
