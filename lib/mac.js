'use strict';
const { execFile } = require('child_process');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');

const run = (cmd, args) => new Promise((resolve, reject) =>
  execFile(cmd, args, { timeout: 10 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 }, (e, out, err) => (e ? reject(new Error(String(err || e.message).trim() || e.message)) : resolve(String(out)))));

async function extract(file, dir) {
  await fsp.mkdir(dir, { recursive: true });
  if (/\.dmg(\.part)?$/i.test(file)) return extractDmg(file, dir);
  await run('/usr/bin/ditto', ['-x', '-k', file, dir]);
}
async function extractDmg(file, dir) {
  const mnt = await fsp.mkdtemp(path.join(os.tmpdir(), 'hf-dmg-'));
  try {
    await run('/usr/bin/hdiutil', ['attach', '-nobrowse', '-readonly', '-noverify', '-noautoopen', '-mountpoint', mnt, file]);
    for (const e of await fsp.readdir(mnt)) {
      if (e.startsWith('.') || e === 'Applications') continue;
      await run('/usr/bin/ditto', [path.join(mnt, e), path.join(dir, e)]);
    }
  } finally {
    await run('/usr/bin/hdiutil', ['detach', '-force', mnt]).catch(() => {});
    await fsp.rm(mnt, { recursive: true, force: true }).catch(() => {});
  }
}

const stripQuarantine = dir => run('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', dir]).catch(() => {});

async function ensureSigned(app) {
  if (process.arch !== 'arm64' || !/\.app$/i.test(app)) return;
  try { await run('/usr/bin/codesign', ['--verify', '--deep', app]); } catch {
    await run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app]).catch(() => {});
  }
}

async function makeExecutable(file) {
  try { if ((await fsp.stat(file)).isFile()) await fsp.chmod(file, 0o755); } catch {  }
}

async function appExecutable(app) {
  const plist = path.join(app, 'Contents', 'Info.plist');
  let name = '';
  try { name = (await run('/usr/bin/plutil', ['-extract', 'CFBundleExecutable', 'raw', '-o', '-', plist])).trim(); } catch {  }
  if (!name) {
    try { const m = /<key>CFBundleExecutable<\/key>\s*<string>([^<]+)<\/string>/.exec(await fsp.readFile(plist, 'utf8')); if (m) name = m[1].trim(); } catch {  }
  }
  const dir = path.join(app, 'Contents', 'MacOS');
  let bin = path.join(dir, name || path.basename(app, '.app'));
  if (!fs.existsSync(bin)) {
    const first = (await fsp.readdir(dir).catch(() => [])).find(f => !f.startsWith('.'));
    if (first) bin = path.join(dir, first);
  }
  return bin;
}

function bundleOf(exePath) {
  const b = path.resolve(exePath, '..', '..', '..');
  return /\.app$/i.test(b) ? b : null;
}

async function replaceBundle(zip, bundle) {
  const parent = path.dirname(bundle);
  if (/\/AppTranslocation\//.test(bundle)) throw new Error("Hyperfocus is running from a download folder - move it to Applications first");
  await fsp.access(parent, fs.constants.W_OK);
  await fsp.access(bundle, fs.constants.W_OK);
  const stage = path.join(parent, `.hf-update-${process.pid}`);
  const old = `${bundle}.hf-old`;
  await fsp.rm(stage, { recursive: true, force: true });
  try {
    await extract(zip, stage);
    const next = (await fsp.readdir(stage)).find(n => /\.app$/i.test(n));
    if (!next) throw new Error('The update has no app in it.');
    const fresh = path.join(stage, next);
    await stripQuarantine(fresh);
    await fsp.rm(old, { recursive: true, force: true });
    await fsp.rename(bundle, old);
    try { await fsp.rename(fresh, bundle); } catch (e) { await fsp.rename(old, bundle).catch(() => {}); throw e; }
    return old;
  } finally {
    await fsp.rm(stage, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { run, extract, stripQuarantine, ensureSigned, makeExecutable, appExecutable, bundleOf, replaceBundle };
