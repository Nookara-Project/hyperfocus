'use strict';

const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, safeStorage, dialog, screen, globalShortcut, desktopCapturer, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const crypto = require('crypto');
const http = require('http');
const { spawn } = require('child_process');
const extractZip = require('extract-zip');
const { Velora, WANTED_SCOPES } = require('./lib/velora');
const { CloudSaves, specsFor, snapshot: saveSnapshot } = require('./lib/cloudsave');
const { Playtime } = require('./lib/playtime');
const { LibrarySync } = require('./lib/library-sync');
const win32 = require('./lib/win32');
const { DiscordPresence } = require('./lib/discord-presence');
const { MediaControls } = require('./lib/media');
const { XInput } = require('./lib/xinput');
const { IS_MAC } = require('./lib/platform');
const mac = IS_MAC ? require('./lib/mac') : null;

const APP_NAME = 'Hyperfocus';
const MANIFEST_URL = 'https://ikelene.net/launcher/manifest.php';
const MANIFEST_BASE = 'https://ikelene.net/launcher/';
const VELORA = 'https://nookara.cc';
const VELORA_SCOPES = WANTED_SCOPES;
const VELORA_APP_ID = 'app_5f2c8e17b3a94d06c1e7';
const ACCOUNT_CENTER = 'https://nookara.cc/me';
const REFRESH_MS = 10 * 60 * 1000;
const DISCORD_CLIENT_ID = '1547788920559763456';
const DISCORD_INSTALL_URL = 'https://ikelene.net/launcher/';
const DISCORD_BADGE_URL = 'https://ikelene.net/launcher/assets/icon.png?v=pixelh1';
const BRIDGE_PORT = 47833;
const COMMUNITY_API = 'https://ikelene.net/launcher/community/api.php';

if (process.platform === 'win32') app.setAppUserModelId('net.ikelene.hyperfocus');
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling');
if (process.env.HF_PROFILE) app.setPath('userData', process.env.HF_PROFILE);
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  console.log(`[hyperfocus] already running (profile ${app.getPath('userData')}) - focusing that window instead`);
  app.quit();
}

const DATA = app.getPath('userData');
const FILES = {
  settings: path.join(DATA, 'settings.json'),
  installed: path.join(DATA, 'installed.json'),
  manifest: path.join(DATA, 'manifest-cache.json'),
  token: path.join(DATA, 'session.bin'),
  gameTokens: path.join(DATA, 'game-logins.bin'),
  playtime: path.join(DATA, 'playtime.json'),
  librarySync: path.join(DATA, 'library-sync.json'),
  shots: path.join(DATA, 'screenshot-links.json'),
  betas: path.join(DATA, 'betas-cache.json'),
  installedBetas: path.join(DATA, 'installed-betas.json'),
};

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const chrome = (y = 17) => (IS_MAC ? { titleBarStyle: 'hidden', trafficLightPosition: { x: 16, y } } : { frame: false });
const overFullscreen = w => { if (IS_MAC && w && !w.isDestroyed()) try { w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true }); } catch {  } };

const DEFAULT_SETTINGS = {
  autoLaunch: true,
  closeAction: 'tray',
  onLaunch: 'tray',
  speedLimit: 0,
  videoBackgrounds: true,
  animations: true,
  musicVolume: 0.4,
  musicMuted: false,
  installRoot: IS_MAC ? path.join(os.homedir(), 'Library', 'Application Support', APP_NAME, 'Games') : path.join(process.env.LOCALAPPDATA || app.getPath('appData'), APP_NAME, 'Apps'),
  lastApp: null,
  mediaMode: {},
  cachedAccount: null,
  overlayEnabled: true,
  overlayHotkey: 'Shift+Tab',
  notifySounds: true,
  friendOnlinePopups: false,
  discordRichPresence: true,
  pinned: [],
  voiceHud: true,
  voiceUsers: {},
  cloudSavesOff: [],
  betaChoice: {},
  betaChannel: false,
  devMode: false,
  devBridgeNoGame: false,
  voiceInput: '',
  voiceOutput: '',
  screenshotHotkey: 'F11',
  screenshotRoot: path.join(app.getPath('pictures'), APP_NAME),
  community: [],
  library: [],
  dropsSeen: 0,
  newGamesPopup: true,
  cursorTrail: true,
  bridgeOrigins: {},
  gameLogins: {},
  settingsVersion: 7,
};
const SETTING_KEYS = ['autoLaunch', 'closeAction', 'onLaunch', 'speedLimit', 'videoBackgrounds', 'animations',
  'musicVolume', 'musicMuted', 'installRoot', 'lastApp', 'mediaMode', 'overlayEnabled', 'overlayHotkey', 'notifySounds', 'friendOnlinePopups', 'discordRichPresence', 'pinned', 'voiceHud',
  'screenshotHotkey', 'screenshotRoot', 'cursorTrail', 'bridgeOrigins', 'voiceUsers', 'devMode', 'devBridgeNoGame', 'betaChannel', 'cloudSavesOff', 'betaChoice',
  'dropsSeen', 'newGamesPopup'];

const firstRun = !fs.existsSync(FILES.settings);
let settings = Object.assign({}, DEFAULT_SETTINGS, readJson(FILES.settings, {}));
let installed = readJson(FILES.installed, {});
let installedBetas = readJson(FILES.installedBetas, {});
let betas = (o => (o && typeof o === 'object' && !Array.isArray(o) ? o : {}))(readJson(FILES.betas, {}).betas);
let manifest = readJson(FILES.manifest, null);
let offline = false;
let manifestError = null;
let account = settings.cachedAccount || null;
const jobs = new Map();
const running = new Map();
const runBeta = new Set();
let win = null;
let tray = null;
let quitting = false;

const saveSettings = () => writeJson(FILES.settings, settings);
const saveInstalled = () => writeJson(FILES.installed, installed);
const saveInstalledBetas = () => writeJson(FILES.installedBetas, installedBetas);
const savedVersion = Number(readJson(FILES.settings, {}).settingsVersion) || 0;
if (savedVersion < 4) {
  if (savedVersion < 3) {
    if (savedVersion < 2) Object.assign(settings, { closeAction: 'tray', onLaunch: 'tray' });
    Object.assign(settings, { autoLaunch: true });
  }
  if (!settings.screenshotHotkey || settings.screenshotHotkey === 'F12') settings.screenshotHotkey = 'F11';
  settings.settingsVersion = 4;
  try { saveSettings(); } catch {}
}
if (savedVersion < 5) {
  settings.friendOnlinePopups = false;
  settings.settingsVersion = 5;
  try { saveSettings(); } catch {}
}
if (savedVersion < 6) {
  const ids = (manifest?.apps || []).filter(a => a && !a.community && typeof a.id === 'string').map(a => a.id);
  settings.library = firstRun ? [] : [...new Set([...(Array.isArray(settings.library) ? settings.library : []), ...ids])];
  if (!firstRun && !manifest) settings.libraryMigrate = true;
  settings.settingsVersion = 6;
  try { saveSettings(); } catch {}
}
if (savedVersion < 7) {
  const has = id => !!installed[id] || !!installedBetas[id];
  let partial = [];
  try {
    const dl = path.join(settings.installRoot, '.downloads');
    if (fs.existsSync(dl)) partial = fs.readdirSync(dl).filter(f => /\.part$/i.test(f)).map(f => f.split('@')[0]);
  } catch {  }
  const halfDone = id => partial.includes(String(id).replace(/[^a-z0-9._-]+/gi, '_'));
  const knownIds = [...(Array.isArray(settings.library) ? settings.library : []), ...(manifest?.apps || []).filter(a => a && !a.community).map(a => a.id),
    ...Object.keys(installed), ...Object.keys(installedBetas)].filter(id => typeof id === 'string' && !/^c-/.test(id));
  settings.library = [...new Set(knownIds)].filter(id => has(id) || halfDone(id));
  const before = (Array.isArray(settings.community) ? settings.community : []).filter(id => typeof id === 'string');
  const picked = id => !!(settings.betaChoice && typeof settings.betaChoice === 'object' && settings.betaChoice[id]);
  const betaOnly = new Set(Array.isArray(settings.betaOnly) ? settings.betaOnly : []);
  for (const id of knownIds) if (!has(id) && !halfDone(id) && picked(id)) betaOnly.add(id);
  settings.community = before.filter(id => has(`c-${id}`) || halfDone(`c-${id}`) || picked(`c-${id}`));
  for (const id of settings.community) if (!has(`c-${id}`) && !halfDone(`c-${id}`)) betaOnly.add(`c-${id}`);
  settings.betaOnly = [...betaOnly];
  const dropped = before.filter(id => !settings.community.includes(id));
  if (dropped.length) {
    settings.libraryPruneRemote = [...new Set([...(settings.libraryPruneRemote || []), ...dropped])];
    settings.pinned = (Array.isArray(settings.pinned) ? settings.pinned : []).filter(x => !dropped.some(id => x === `c-${id}`));
  }
  delete settings.libraryMigrate;
  settings.settingsVersion = 7;
  try { saveSettings(); } catch {}
}
if (!Array.isArray(settings.library)) settings.library = [];
const startHidden = process.argv.includes('--hidden') || (() => {
  try { return !!app.getLoginItemSettings().wasOpenedAtLogin; } catch { return false; }
})();
delete settings.hardwareAcceleration;

const velora = new Velora(() => loadToken());
velora.useDmKeys({ file: path.join(DATA, 'dm-keys.bin'), safeStorage, getToken: () => loadToken() });
velora.hello = { version: app.getVersion(), caps: [] };
const playtime = new Playtime({ file: FILES.playtime, velora, readJson, writeJson, onChange: () => pushSoon() });
const librarySync = new LibrarySync({
  file: FILES.librarySync, velora, readJson, writeJson,
  user: () => (offlineMode || !loadToken() ? '' : account?.username || ''),
  ids: () => {
    if (offlineMode || !everOnline || !manifest) return null;
    return [
      ...(Array.isArray(settings.library) ? settings.library : []),
      ...Object.keys(installed), ...Object.keys(installedBetas),
      ...(Array.isArray(settings.community) ? settings.community : []).filter(id => /^[a-z0-9]{8}$/.test(String(id))).map(id => `c-${id}`),
      ...(manifest.apps || []).filter(a => a && a.owned === true).map(a => a.id),
    ];
  },
});
let currentGame = null;
const xinput = new XInput();
const extraPads = new Map();
let consoleMode = false, consoleSaved = null;
const discordPresence = new DiscordPresence(DISCORD_CLIENT_ID);

function cmpVer(a, b) {
  const pa = String(a || '0').replace(/^v/i, '').split(/[.\-+_]/);
  const pb = String(b || '0').replace(/^v/i, '').split(/[.\-+_]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '0', y = pb[i] ?? '0';
    if (/^\d+$/.test(x) && /^\d+$/.test(y)) {
      const d = Number(x) - Number(y);
      if (d) return d > 0 ? 1 : -1;
    } else if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}
const safeName = s => String(s).replace(/[^a-z0-9._-]+/gi, '_');
function cacheBust(url, tag) {
  if (!tag) return url;
  try { const u = new URL(url); u.searchParams.set('hfv', String(tag).slice(0, 12)); return u.href; } catch { return url; }
}
const expandEnv = s => String(s || '').replace(/%([^%]+)%/g, (m, k) => process.env[k] ?? m);

function updateDiscordPresence() {
  discordPresence.setEnabled(settings.discordRichPresence !== false);
  if (settings.discordRichPresence === false || quitting) return;
  const activeId = currentGame && running.has(currentGame) ? currentGame
    : settings.devMode && settings.devBridgeNoGame && devPresenceId ? devPresenceId : null;
  if (activeId) {
    const game = findApp(activeId) || { id: activeId, name: activeId === '__dev__' ? 'Hyperfocus (developer test)' : activeId };
    const session = playtime.sessions?.[activeId];
    const icon = game.discordAsset || (/^https:\/\//i.test(game.icon || '') ? game.icon : 'hyperfocus');
    const ov = presenceOverrides.get(activeId) || {};
    const gameName = game.name || activeId;
    const customApp = !!(ov.clientId || game.discordAppId);
    const listLine = customApp ? {} : ov.state ? { state: gameName, statusDisplayType: 1 } : { statusDisplayType: 2 };
    discordPresence.setActivity({
      details: ov.state || gameName,
      ...listLine,
      largeImageKey: icon,
      largeImageText: game.name || activeId,
      ...(icon !== 'hyperfocus' ? { smallImageKey: DISCORD_BADGE_URL, smallImageText: 'via HYPERFOCUS' } : {}),
      startTimestamp: session?.start ? new Date(session.start) : new Date(),
      buttons: [{ label: 'Install HYPERFOCUS', url: DISCORD_INSTALL_URL }],
      instance: false,
    }, ov.clientId || game.discordAppId);
    return;
  }
  const launcherOpen = !!win && !win.isDestroyed() && (win.isVisible() || win.isMinimized());
  if (!launcherOpen) return discordPresence.setActivity(null);
  discordPresence.setActivity({
    largeImageKey: 'hyperfocus',
    largeImageText: 'Hyperfocus',
    buttons: [{ label: 'Install HYPERFOCUS', url: DISCORD_INSTALL_URL }],
    instance: false,
  });
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', d => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

function openExternalSafe(url) {
  try {
    const u = new URL(url);
    if (['http:', 'https:', 'mailto:'].includes(u.protocol)) shell.openExternal(u.href);
  } catch {}
}

function send(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send('hf:' + channel, data);
}
function sendAll(channel, data) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('hf:' + channel, data);
}
function toast(msg, kind = 'info') { send('toast', { msg, kind }); }

const URL_KEYS = new Set(['icon', 'logo', 'background', 'video', 'trailer', 'trailerPoster', 'image', 'url', 'music', 'installLink']);
const isAssetRef = s => /^(https?:|data:|\/|\.\.?\/)/i.test(s) || /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)(\?.*)?$/i.test(s) || (s.includes('/') && !/\s/.test(s));
function resolveUrls(node, base) {
  if (Array.isArray(node)) { node.forEach(n => resolveUrls(n, base)); return; }
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === 'string' && URL_KEYS.has(k) && v.trim()) {
      if (k === 'logo' && !isAssetRef(v.trim())) continue;
      try { node[k] = new URL(v.trim(), base).href; } catch {}
    } else if (v && typeof v === 'object') resolveUrls(v, base);
  }
}
function normalizeApp(a) {
  a.type = /^game$/i.test(String(a.type || '').trim()) ? 'Game' : 'App';
  const d = a.download && typeof a.download === 'object' ? a.download : {};
  if ('installLink' in a) d.url = typeof a.installLink === 'string' ? a.installLink.trim() : '';
  if (a.installType) d.type = String(a.installType).toLowerCase();
  if (d.type === 'exe') d.type = 'file';
  a.download = d;
  if (a.exeLocation) a.exe = String(a.exeLocation);
  a.external = a.external === true || a.external === 'true';
  a.stage = a.stage === 'early' || a.stage === 'soon' ? a.stage : '';
  a.releaseDate = a.stage === 'soon' && /^\d{4}-\d{2}-\d{2}$/.test(String(a.releaseDate || '')) ? String(a.releaseDate) : '';
  return IS_MAC ? pickMacBuild(a) : a;
}
function pickMacBuild(a) {
  if (a.macPicked) return a;
  a.macPicked = true;
  if (a.external && !a.mac) return a;
  let m = a.mac && typeof a.mac === 'object' ? a.mac : null;
  if (m && process.arch === 'x64' && m.x64?.download?.url) m = { ...m, ...m.x64 };
  const md = m?.download && typeof m.download === 'object' ? { ...m.download } : {};
  const type = String(md.type || m?.installType || '').toLowerCase();
  if (type === 'installer') delete md.url;
  md.type = type === 'exe' ? 'file' : type === 'installer' ? '' : type || (/\.(zip|dmg)$/i.test(String(md.url || '').split(/[?#]/)[0]) ? 'zip' : '');
  if (!md.type) delete md.type;
  a.download = md;
  a.exe = m?.exe ? String(m.exe) : '';
  a.args = Array.isArray(m?.args) ? m.args.map(String) : [];
  a.winonly = !m && a.stage !== 'soon';
  return a;
}
function normalizeManifest(m) {
  if (!m || typeof m !== 'object') throw new Error('Manifest is not a JSON object');
  resolveUrls(m, MANIFEST_BASE);
  m.launcher = m.launcher && typeof m.launcher === 'object' ? m.launcher : {};
  m.apps = (Array.isArray(m.apps) ? m.apps : [])
    .filter(a => a && typeof a.id === 'string' && a.id.trim() && !a.hidden)
    .map(normalizeApp);
  return m;
}
const verbOf = a => (a?.type === 'Game' ? 'play' : 'launch');
function stripJsonc(s) {
  let out = '', inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      out += c;
      if (c === '\\' && i + 1 < s.length) out += s[++i];
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2);
      out += (end < 0 ? s.slice(i) : s.slice(i, end + 2)).replace(/[^\n]/g, ' ');
      i = end < 0 ? s.length : end + 1;
      continue;
    }
    if (c === '}' || c === ']') {
      const t = out.trimEnd();
      if (t.endsWith(',')) out = t.slice(0, -1) + out.slice(t.length);
    }
    out += c;
  }
  return out;
}
async function explainAppsJson() {
  let res;
  try {
    res = await fetch(`${MANIFEST_BASE}apps.json?t=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
  } catch { return null; }
  if (!res.ok) return null;
  try {
    const raw = await res.text();
    JSON.parse(stripJsonc(raw));
    return 'apps.json has an error';
  } catch (e) {
    const m = /line (\d+) column (\d+)/.exec(e.message || '');
    return m ? `apps.json has a typo near line ${m[1]}, column ${m[2]}` : `apps.json has a typo (${e.message})`;
  }
}

let lastRefresh = 0;
let jsonBroken = false, lastBrokenMsg = '';
let everOnline = false;
let serverDown = false;
let offlineMode = false;
let manifestChecked = false;
let installId = null;
function getInstallId() {
  if (installId) return installId;
  const f = path.join(DATA, 'install-id');
  try { installId = fs.readFileSync(f, 'utf8').trim(); } catch {}
  if (!/^[a-f0-9]{32}$/.test(installId || '')) {
    installId = crypto.randomBytes(16).toString('hex');
    try { fs.writeFileSync(f, installId); } catch {}
  }
  return installId;
}
async function refreshManifest() {
  lastRefresh = Date.now();
  if (offlineMode) return;
  try {
    const token = loadToken();
    const res = await fetch(`${MANIFEST_URL}?t=${Date.now()}`, {
      cache: 'no-store', signal: AbortSignal.timeout(15000),
      headers: { 'X-HF-Install': getInstallId(), 'X-HF-Version': app.getVersion(), ...(token ? { 'X-Velora-Token': token } : {}) },
    });
    const body = await res.json().catch(() => null);
    if (body?.error && /apps\.json/.test(body.error)) {
      const why = await explainAppsJson();
      if (why === null) throw new Error("the game list isn't there right now");
      jsonBroken = true;
      offline = true;
      manifestError = why;
      manifestChecked = true;
      if (manifestError !== lastBrokenMsg) { lastBrokenMsg = manifestError; toast(`${manifestError} - showing the last version that worked.`, 'err'); }
      push();
      return;
    }
    if (!res.ok || !body || body.error) throw new Error(body?.error || `HTTP ${res.status}`);
    body.apps = [...(Array.isArray(body.apps) ? body.apps : []).filter(a => !a?.community), ...await communityApps()];
    manifest = normalizeManifest(body);
    writeJson(FILES.manifest, manifest);
    if (settings.libraryMigrate) {
      settings.library = [...new Set([...settings.library, ...manifest.apps.filter(a => !a.community).map(a => a.id)])];
      delete settings.libraryMigrate;
      saveSettings();
    }
    pruneRemoteLibrary();
    announceUpdates();
    if (pendingProtocol) openFromProtocol(pendingProtocol.id, pendingProtocol.launch);
    offline = false;
    jsonBroken = false;
    lastBrokenMsg = '';
    manifestError = null;
    everOnline = true;
    serverDown = false;
    checkAccess();
  } catch (e) {
    offline = true;
    jsonBroken = false;
    manifestError = e?.message || String(e);
    serverDown = !everOnline;
  }
  manifestChecked = true;
  push();
  refreshAchievements();
  if (!offline) refreshBetas();
  if (!offline) syncLibraryMaybe();
}
const findApp = id => (manifest?.apps || []).find(a => a.id === id);

function offlineManifest() {
  const cached = readJson(FILES.manifest, null);
  const known = new Map((cached?.apps || []).map(a => [a.id, a]));
  const apps = Object.entries(installed)
    .filter(([, inst]) => inst?.dir && fs.existsSync(inst.dir))
    .map(([id, inst]) => {
      const a = known.get(id) || {};
      return {
        id, name: a.name || inst.name || id, type: a.type || inst.appType || 'App',
        icon: a.icon || '', logo: a.logo || '', background: a.background || '', banners: Array.isArray(a.banners) ? a.banners : [],
        exe: inst.exe || a.exe || '', args: a.args, version: inst.version || '', download: {},
        stage: a.stage ?? inst.stage ?? '', releaseDate: a.releaseDate ?? inst.releaseDate ?? '',
        community: !!a.community, communityId: a.communityId, author: a.author,
        ...(Number(a.price) > 0 ? { price: a.price, owned: a.owned, buyUrl: a.buyUrl } : {}),
      };
    });
  return { launcher: {}, apps };
}
async function setOfflineMode(on) {
  if (on === offlineMode) return snapshot();
  if (on) {
    offlineMode = true;
    offline = true;
    velora.stop();
    voiceCmd({ op: 'leave' }).catch(() => {});
    manifest = offlineManifest();
  } else {
    offlineMode = false;
    manifest = readJson(FILES.manifest, null);
    await refreshManifest();
    if (!serverDown) validateSession().then(push);
  }
  updateDiscordPresence();
  push();
  return snapshot();
}

const isOwner = () => account?.rank === 'owner';
let communityCache = (manifest?.apps || []).filter(a => a?.community);
let communityFresh = false;
async function communityApps() {
  const ids = (settings.community || []).filter(id => /^[a-z0-9]{8}$/.test(id));
  if (!ids.length) return [];
  const token = loadToken();
  try {
    const res = await fetch(`${COMMUNITY_API}?a=manifest&ids=${ids.join(',')}&t=${Date.now()}`, {
      cache: 'no-store', signal: AbortSignal.timeout(12000), headers: token ? { 'X-Velora-Token': token } : {},
    });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j?.ok) throw new Error(j?.error || `HTTP ${res.status}`);
    communityCache = (j.apps || []).map(a => ({ ...a, community: true }));
    communityFresh = true;
    const gone = (Array.isArray(j.removed) ? j.removed : []).filter(r => ids.includes(String(r?.id || '')));
    if (gone.length) setTimeout(() => gone.forEach(r => retireCommunityGame(String(r.id), String(r.reason || ''))), 0);
  } catch (e) {
    communityFresh = false;
    console.log(`[hyperfocus] community games: ${e.message}`);
  }
  return communityCache.filter(a => ids.includes(a.communityId));
}
function communityPost(action, body) {
  const token = loadToken();
  if (!token) return Promise.resolve(null);
  return fetch(`${COMMUNITY_API}?a=${action}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Velora-Token': token },
    body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
  }).catch(() => null);
}
async function addCommunityGame(id) {
  showWin();
  if (!settings.community.includes(id)) {
    let sent = false;
    const refused = await storeApi('library', { id, op: 'add' }).then(() => { sent = true; return null; }, e => (e.status === 409 ? e : null)).catch(() => null);
    if (refused) { toast(refused.message, 'err'); send('storePage', `c-${id}`); return; }
    settings.community = [...settings.community, id];
    saveSettings();
    if (sent) libForget('c', id); else libQueue('c', id, 'add');
  } else libQueue('c', id, 'add');
  await refreshManifest();
  const a = findApp(`c-${id}`);
  if (!a) return toast("Couldn't add that game - it may not be approved yet.", 'err');
  send('selectApp', a.id);
  toast(`${a.name || 'It'} is in your library now!`, 'ok');
}
function pruneRemoteLibrary() {
  const ids = Array.isArray(settings.libraryPruneRemote) ? settings.libraryPruneRemote : null;
  if (!ids || offlineMode || !loadToken()) return;
  delete settings.libraryPruneRemote;
  saveSettings();
  for (const id of ids) if (/^[a-z0-9]{8}$/.test(String(id)) && !settings.community.includes(id)) libQueue('c', id, 'remove');
}

const LIB_ID = { c: /^[a-z0-9]{8}$/, o: /^(?!c-)[A-Za-z0-9._-]{1,64}$/ };
let libBusy = false, libAgain = false, libTimer = null, libRetry = null, libLastAt = 0, libLastUser = '';
const libSkip = new Set();
const libAcct = () => (loadToken() && account?.username ? String(account.username).toLowerCase() : '');
const libOps = () => (Array.isArray(settings.libOps) ? settings.libOps.filter(o => o && typeof o === 'object') : []);
function libQueue(k, id, op) {
  id = String(id || '');
  const u = libAcct();
  if (!u || !LIB_ID[k]?.test(id)) return;
  settings.libOps = [...libOps().filter(o => !(o.u === u && o.k === k && o.id === id)), { u, k, id, op, t: Date.now() }].slice(-400);
  saveSettings();
  clearTimeout(libTimer);
  libTimer = setTimeout(syncLibrary, 1500);
}
function libForget(k, id) {
  const u = libAcct();
  if (u && libOps().some(o => o.u === u && o.k === k && o.id === id)) { settings.libOps = libOps().filter(o => !(o.u === u && o.k === k && o.id === id)); saveSettings(); }
}
function syncLibraryMaybe() {
  const u = libAcct();
  if (!u || offlineMode || offline) return;
  if (u === libLastUser && Date.now() - libLastAt < 60000) return;
  syncLibrary();
}
function libDropOk(k, id) {
  const appId = k === 'c' ? `c-${id}` : id;
  if (settings.betaChoice?.[appId] || jobs.has(appId) || jobs.has(appId + BETA)) return false;
  return !(k === 'c' && (installed[appId] || installedBetas[appId]));
}
async function syncLibrary() {
  clearTimeout(libTimer); libTimer = null;
  if (libBusy) { libAgain = true; return; }
  const user = libAcct();
  if (!user || offlineMode) return;
  libBusy = true; libLastAt = Date.now(); libLastUser = user;
  let failed = false;
  try {
    for (;;) {
      const mine = libOps().filter(o => o.u === user).slice(0, 200);
      if (!mine.length) break;
      await storeApi('library', { ops: mine.map(({ k, id, op, t }) => ({ k, id, op, t })) });
      settings.libOps = libOps().filter(o => !mine.includes(o));
      saveSettings();
    }
    const j = await storeApi('library');
    const ids = (a, k) => (Array.isArray(a) ? a : []).map(String).filter(id => LIB_ID[k].test(id));
    const S = { c: new Set(ids(j.community, 'c')), o: new Set(ids(j.official, 'o')) };
    const R = { c: new Set(ids(j.removed?.community, 'c')), o: new Set(ids(j.removed?.official, 'o')) };
    const first = settings.libSync?.user !== user;
    const pend = new Set(libOps().filter(o => o.u === user).map(o => `${o.k}:${o.id}`));
    const up = [], added = new Set();
    let changed = false, changedC = false;
    for (const k of ['c', 'o']) {
      const list = (Array.isArray(k === 'c' ? settings.community : settings.library) ? (k === 'c' ? settings.community : settings.library) : []).filter(id => typeof id === 'string');
      const have = new Set(list);
      let next = list.slice();
      for (const id of S[k]) if (!have.has(id) && !pend.has(`${k}:${id}`)) { next.push(id); added.add(k === 'c' ? `c-${id}` : id); }
      for (const id of list) {
        if (S[k].has(id) || pend.has(`${k}:${id}`) || !LIB_ID[k].test(id)) continue;
        if (!first && R[k].has(id)) {
          if (!libDropOk(k, id)) continue;
          const appId = k === 'c' ? `c-${id}` : id;
          next = next.filter(x => x !== id);
          if (!installed[appId] && !installedBetas[appId]) settings.pinned = (settings.pinned || []).filter(x => x !== appId);
        } else if (!libSkip.has(`${k}:${id}`)) up.push({ k, id, op: 'add', t: Date.now() });
      }
      if (next.length !== list.length || next.some((x, i) => x !== list[i])) {
        if (k === 'c') { settings.community = next; changedC = true; } else settings.library = next;
        changed = true;
      }
    }
    if (added.size) settings.betaOnly = (settings.betaOnly || []).filter(x => !added.has(x));
    if (up.length) {
      try {
        const r = await storeApi('library', { ops: up });
        for (const x of Array.isArray(r.rejected) ? r.rejected : []) libSkip.add(String(x));
      } catch (e) {
        failed = true;
        settings.libOps = [...libOps(), ...up.map(o => ({ ...o, u: user }))].slice(-400);
      }
    }
    settings.libSync = { user, at: Date.now() };
    saveSettings();
    if (changed) push();
    if (changedC) refreshManifest();
  } catch (e) {
    failed = true;
    console.log(`[hyperfocus] library sync: ${e.message}`);
  } finally {
    libBusy = false;
    if (failed && libOps().some(o => o.u === user)) { clearTimeout(libRetry); libRetry = setTimeout(syncLibrary, 2 * 60 * 1000); }
    if (libAgain) { libAgain = false; setTimeout(syncLibrary, 0); }
  }
}
const ACCESS_WAIT = 60 * 1000;
let accessTimer = null;
function accessProblems() {
  const out = new Map();
  const apps = manifest?.apps || [];
  const officialSeen = apps.some(a => !a.community);
  for (const id of new Set([...Object.keys(installed), ...settings.library])) {
    if (typeof id !== 'string' || isBetaKey(id)) continue;
    const community = /^c-/.test(id);
    const a = findApp(id);
    if (!a) { if (!community && officialSeen) out.set(id, 'gone'); continue; }
    if (a.external || !installed[id]) continue;
    if (community && !communityFresh) continue;
    if (a.owned === null) continue;
    if (Number(a.price) > 0 && a.owned === false) out.set(id, 'unowned');
    else if (a.stage !== 'soon' && !a.download?.url && !a.winonly) out.set(id, 'unavailable');
  }
  return out;
}
function checkAccess() {
  if (offlineMode || offline || !account || !loadToken() || !manifest) return;
  if (manifest.viewerUnknown) return;
  const now = Date.now();
  const seen = accessProblems();
  const pend = { ...(settings.accessPending && typeof settings.accessPending === 'object' ? settings.accessPending : {}) };
  let changed = false;
  for (const id of Object.keys(pend)) if (seen.get(id) !== pend[id]?.reason) { delete pend[id]; changed = true; }
  const act = [];
  for (const [id, reason] of seen) {
    if (!pend[id]) { pend[id] = { reason, since: now }; changed = true; }
    else if (now - Number(pend[id].since || now) >= ACCESS_WAIT) act.push([id, reason]);
  }
  settings.accessPending = pend;
  if (changed) saveSettings();
  for (const [id, reason] of act) loseAccess(id, reason);
  if (Object.keys(pend).length && !accessTimer) accessTimer = setTimeout(() => { accessTimer = null; refreshManifest(); }, ACCESS_WAIT + 5000);
}
const losing = new Set();
async function loseAccess(id, reason) {
  if (losing.has(id) || running.has(id) || jobs.has(id) || jobs.has(id + BETA)) return;
  losing.add(id);
  const a = findApp(id);
  const name = a?.name || installed[id]?.name || id;
  const wasHere = !!installed[id];
  try {
    if (/^c-/.test(id)) await removeCommunityGame(id);
    else {
      if (installed[id]) await uninstallApp(id);
      if (reason === 'gone') {
        if (installedBetas[id]) await uninstallApp(id + BETA);
        if (settings.betaChoice?.[id]) { settings.betaChoice = { ...settings.betaChoice }; delete settings.betaChoice[id]; }
      }
      settings.library = settings.library.filter(x => x !== id);
      libQueue('o', id, 'remove');
      settings.pinned = (settings.pinned || []).filter(x => x !== id);
    }
    const pend = { ...(settings.accessPending || {}) };
    delete pend[id];
    settings.accessPending = pend;
    settings.betaOnly = (settings.betaOnly || []).filter(x => x !== id);
    saveSettings();
    push();
    const where = wasHere ? 'removed from this PC' : 'taken out of your library';
    notify({
      kind: 'launcher', icon: 'xcircle', title: name, image: a?.icon || 'icon', sound: 'warning', duration: 12000,
      body: reason === 'unowned' ? `You don't own ${name} anymore, so it was ${where}.` : `${name} isn't available anymore, so it was ${where}.`,
    });
  } catch (e) {
    console.log(`[hyperfocus] couldn't remove ${id} (${reason}): ${e.message}`);
  } finally { losing.delete(id); }
}

const retiring = new Set();
async function retireCommunityGame(id, reason) {
  const appId = `c-${id}`;
  if (!(settings.community || []).includes(id) || retiring.has(id)) return;
  if (running.has(appId)) return;
  retiring.add(id);
  const name = installed[appId]?.name || findApp(appId)?.name || 'A community game';
  const icon = findApp(appId)?.icon || '';
  try {
    await removeCommunityGame(appId);
    notify({ kind: 'launcher', icon: 'xcircle', title: name, body: `was removed from your library. ${reason}`.trim(), image: icon || 'icon', sound: 'warning', duration: 12000 });
  } catch (e) {
    console.log(`[hyperfocus] couldn't remove community game ${id}: ${e.message}`);
  } finally { retiring.delete(id); }
}
async function removeCommunityGame(appId) {
  const a = findApp(appId);
  const id = a?.communityId || String(appId).replace(/^c-/, '');
  if (running.has(appId)) throw new Error('Close it first.');
  if (installed[appId]) await uninstallApp(appId);
  settings.community = (settings.community || []).filter(x => x !== id);
  settings.pinned = (settings.pinned || []).filter(x => x !== appId);
  if (installedBetas[appId]) await uninstallApp(appId + BETA);
  if (settings.betaChoice?.[appId]) { settings.betaChoice = { ...settings.betaChoice }; delete settings.betaChoice[appId]; }
  saveSettings();
  libQueue('c', id, 'remove');
  communityCache = communityCache.filter(x => x.communityId !== id);
  if (manifest) { manifest.apps = manifest.apps.filter(x => x.id !== appId); writeJson(FILES.manifest, manifest); }
  push();
}

async function storeApi(action, body) {
  if (offlineMode) throw new Error("The store isn't available in Offline Mode.");
  const token = loadToken();
  if (!token) throw new Error('Sign in with Nookara first.');
  const post = body !== undefined;
  const res = await fetch(`${COMMUNITY_API}?a=${action}&t=${Date.now()}`, {
    method: post ? 'POST' : 'GET', cache: 'no-store', signal: AbortSignal.timeout(15000),
    headers: { 'X-Velora-Token': token, ...(post ? { 'Content-Type': 'application/json' } : {}) },
    body: post ? JSON.stringify(body) : undefined,
  }).catch(() => { throw new Error("Couldn't reach the Hyperfocus store."); });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.ok) throw Object.assign(new Error(j?.error || `The store said no (HTTP ${res.status}).`), { status: res.status });
  return j;
}
async function storeFeed() {
  const j = await storeApi('store');
  const games = (Array.isArray(j.games) ? j.games : []).filter(g => g && typeof g.id === 'string');
  resolveUrls(games, MANIFEST_BASE);
  return { games, categories: (Array.isArray(j.categories) ? j.categories : []).filter(c => c && Array.isArray(c.ids)) };
}
async function libraryAdd(appId) {
  appId = String(appId || '');
  const m = /^c-([a-z0-9]{8})$/i.exec(appId);
  if (m) {
    const id = m[1].toLowerCase();
    await storeApi('library', { id, op: 'add' });
    if (!settings.community.includes(id)) { settings.community = [...settings.community, id]; saveSettings(); }
    await refreshManifest();
    const a = findApp(`c-${id}`);
    if (!a) throw new Error("Couldn't add that game - it may not be approved yet.");
    return { id: a.id, name: a.name || a.id };
  }
  const a = findApp(appId);
  if (!a || a.community) throw new Error("That game isn't in Hyperfocus right now.");
  if (a.stage === 'soon' && !(a.owned === true && a.download?.url)) throw new Error(`${a.name || appId} is coming soon - add it to your wishlist instead.`);
  if (!settings.library.includes(a.id)) settings.library = [...settings.library, a.id];
  libQueue('o', a.id, 'add');
  settings.betaOnly = (settings.betaOnly || []).filter(x => x !== a.id);
  saveSettings();
  push();
  return { id: a.id, name: a.name || a.id };
}
async function libraryRemove(appId) {
  appId = String(appId || '');
  const a = findApp(appId);
  if (a?.community || /^c-[a-z0-9]{8}$/.test(appId)) return removeCommunityGame(appId);
  if (running.has(appId)) throw new Error('Close it first.');
  if (jobs.has(appId) || jobs.has(appId + BETA)) throw new Error('Cancel its download first.');
  if (installed[appId]) await uninstallApp(appId);
  if (installedBetas[appId]) await uninstallApp(appId + BETA);
  settings.library = settings.library.filter(x => x !== appId);
  libQueue('o', appId, 'remove');
  settings.pinned = (settings.pinned || []).filter(x => x !== appId);
  if (settings.betaChoice?.[appId]) { settings.betaChoice = { ...settings.betaChoice }; delete settings.betaChoice[appId]; }
  saveSettings();
  push();
}

const needsBuying = a => Number(a?.price) > 0 && a.owned === false;

const BETA = '#beta';
const isBetaKey = k => String(k).endsWith(BETA);
const baseOf = k => (isBetaKey(k) ? String(k).slice(0, -BETA.length) : String(k));
const instOf = k => (isBetaKey(k) ? installedBetas[baseOf(k)] : installed[k]);
const runningKey = k => running.has(baseOf(k)) && runBeta.has(baseOf(k)) === isBetaKey(k);
const saveInst = k => (isBetaKey(k) ? saveInstalledBetas() : saveInstalled());
function chosenBeta(appId) {
  const bid = settings.betaChoice?.[appId];
  return bid ? (betas[appId] || []).find(b => b.id === bid && b.member) || null : null;
}
function betaApp(appId) {
  const a = findApp(appId), b = chosenBeta(appId);
  if (!a || !b) return null;
  let bm = IS_MAC ? (b.mac && typeof b.mac === 'object' ? b.mac : {}) : null;
  if (bm && process.arch === 'x64' && bm.x64?.download?.url) Object.assign(bm = { ...bm }, bm.x64);
  const bd = IS_MAC ? bm.download : b.download;
  const dl = bd && bd.url ? bd : null;
  const kind = IS_MAC ? String(bm.kind || bd?.type || b.kind || '').toLowerCase() : String(b.kind).toLowerCase();
  return {
    ...a, id: appId + BETA, realId: appId, beta: b, external: false,
    version: String(b.version ?? ''), exe: IS_MAC ? String(bm.exe || '') : b.exeLocation || '',
    ...(IS_MAC ? { args: Array.isArray(bm.args) ? bm.args.map(String) : [], winonly: !b.mac } : {}),
    download: dl ? { url: dl.url, sha256: dl.sha256, size: dl.size, type: kind === 'zip' || (IS_MAC && /\.(zip|dmg)$/i.test(String(dl.url).split(/[?#]/)[0])) ? 'zip' : 'file' } : {},
    ...(b.locked === 'buy' ? { price: a.price, owned: false } : { price: 0, owned: true }),
  };
}
function statusOf(a) {
  const job = jobs.get(a.id);
  if (job) return job.phase;
  if (runningKey(a.id)) return 'running';
  if (needsBuying(a)) return 'buy';
  if (a.external) return a.download?.url ? 'external' : 'unavailable';
  let inst = instOf(a.id);
  if (inst && a.beta && inst.betaId !== a.beta.id) inst = null;
  if (IS_MAC && inst && inst.platform !== 'mac') inst = null;
  if (!inst || !inst.dir || !fs.existsSync(inst.dir)) {
    if (a.download?.url) return 'install';
    if (a.winonly) return 'winonly';
    return a.stage === 'soon' && !a.beta ? 'soon' : 'unavailable';
  }
  const want = a.download?.sha256, have = inst.sha256;
  if (a.version && inst.version && cmpVer(a.version, inst.version) > 0) return 'update';
  if (want && have && String(want).toLowerCase() !== String(have).toLowerCase()) {
    return a.version && inst.version && cmpVer(a.version, inst.version) === 0 ? 'repair' : 'update';
  }
  return 'ready';
}

async function betaApi(action, body) {
  const token = loadToken();
  const res = await fetch(`${COMMUNITY_API}?a=${action}&t=${Date.now()}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Velora-Token': token } : {}) },
    body: JSON.stringify(body || {}), signal: AbortSignal.timeout(12000),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.ok) throw new Error(j?.error || `HTTP ${res.status}`);
  return j;
}
function needBetaLogin() {
  if (offlineMode) throw new Error("Betas aren't available in Offline Mode.");
  if (!account || !loadToken()) throw new Error('Log in with Nookara first.');
}
function saveBetas() { try { writeJson(FILES.betas, { at: Date.now(), betas }); } catch {} }
function mergeBeta(b) {
  if (!b?.id || !b.appId) return;
  const list = betas[b.appId] || [];
  betas = { ...betas, [b.appId]: list.some(x => x.id === b.id) ? list.map(x => (x.id === b.id ? b : x)) : [...list, b] };
  saveBetas();
  push();
}
let betasInflight = null, betasAgain = false;
function refreshBetas() {
  if (betasInflight) { betasAgain = true; return betasInflight; }
  betasInflight = (async () => {
    if (offlineMode) return;
    const apps = (manifest?.apps || []).map(a => a.id);
    if (!apps.length) return;
    const have = [...new Set([...Object.values(settings.betaChoice || {}), ...Object.values(installedBetas).map(r => r?.betaId)].filter(Boolean))];
    const signedIn = !!account && !!loadToken();
    let j;
    try { j = await betaApi('betas', { apps, have }); }
    catch (e) { console.log(`[hyperfocus] betas: ${e.message}`); return; }
    betas = j.betas && typeof j.betas === 'object' && !Array.isArray(j.betas) ? j.betas : {};
    saveBetas();
    push();
    if (signedIn && account && loadToken() && Array.isArray(j.revoked)) for (const r of j.revoked) await betaRevoked(r).catch(e => console.log(`[hyperfocus] beta ended: ${e.message}`));
  })().catch(e => console.log(`[hyperfocus] betas: ${e.message}`)).finally(() => {
    betasInflight = null;
    if (betasAgain) { betasAgain = false; refreshBetas(); }
  });
  return betasInflight;
}
async function stopBetaJob(appId) {
  const k = appId + BETA;
  if (!jobs.has(k)) return;
  await cancelJob(k);
  for (let i = 0; i < 30 && jobs.has(k); i++) await sleep(100);
  if (jobs.has(k)) throw new Error('Wait for the beta download to stop, then try again.');
}
async function dropBeta(appId, betaId) {
  if (settings.betaChoice?.[appId] === betaId) {
    settings.betaChoice = { ...settings.betaChoice };
    delete settings.betaChoice[appId];
    saveSettings();
  }
  if (installedBetas[appId]?.betaId === betaId) {
    if (runBeta.has(appId) && running.has(appId)) throw new Error('Close the beta first.');
    await stopBetaJob(appId);
    await uninstallApp(appId + BETA);
  }
  push();
}
async function betaRevoked(r) {
  const appId = String(r?.appId || ''), betaId = String(r?.id || '');
  if (!appId || !betaId) return;
  const chosen = settings.betaChoice?.[appId] === betaId, there = installedBetas[appId]?.betaId === betaId;
  if (!chosen && !there) return;
  if (runBeta.has(appId) && running.has(appId)) return;
  const a = findApp(appId);
  const game = a?.name || installedBetas[appId]?.name || 'the game';
  await dropBeta(appId, betaId);
  if ((settings.betaOnly || []).includes(appId) && !installed[appId] && !jobs.has(appId)) {
    settings.betaOnly = settings.betaOnly.filter(x => x !== appId);
    saveSettings();
    if (/^c-/.test(appId)) await removeCommunityGame(appId).catch(() => {});
    else { if (settings.library.includes(appId)) libQueue('o', appId, 'remove'); settings.library = settings.library.filter(x => x !== appId); saveSettings(); push(); }
  }
  const releaseHere = a && ['ready', 'update', 'repair', 'running'].includes(statusOf(a));
  notify({
    kind: 'launcher', icon: 'xcircle', title: r.reason === 'deleted' ? 'Beta ended' : 'Removed from a beta', image: a?.icon || 'icon', sound: 'warning', duration: 12000,
    body: `${r.reason === 'deleted' ? `${r.name} for ${game} has ended.` : `You were removed from ${r.name} for ${game}.`}${releaseHere ? '' : ' Install the release to keep playing.'}`,
    action: a ? { type: 'app', id: appId } : undefined,
  });
}
async function joinBeta(id) {
  needBetaLogin();
  const j = await betaApi('beta-join', { beta: id });
  mergeBeta(j.beta);
  refreshBetas();
  return j.beta;
}
async function leaveBeta(id) {
  needBetaLogin();
  const appId = Object.keys(betas).find(k => betas[k].some(b => b.id === id));
  if (appId && runBeta.has(appId) && running.has(appId) && (installedBetas[appId]?.betaId === id || settings.betaChoice?.[appId] === id)) throw new Error('Close the beta first.');
  await betaApi('beta-leave', { beta: id });
  if (appId) {
    await dropBeta(appId, id);
    betas = { ...betas, [appId]: betas[appId].flatMap(b => (b.id !== id ? [b] : b.public ? [{ ...b, member: false, via: null, download: null }] : [])) };
    saveBetas();
    push();
  }
  refreshBetas();
}
async function chooseBeta(appId, betaId) {
  if (betaId && !(betas[appId] || []).some(b => b.id === betaId && b.member)) throw new Error("You're not in that beta.");
  const rec = installedBetas[appId], job = jobs.get(appId + BETA);
  if ((rec && rec.betaId !== betaId) || (job && job.betaId !== betaId)) {
    if (runBeta.has(appId) && running.has(appId)) throw new Error('Close the beta first.');
    await stopBetaJob(appId);
    if (installedBetas[appId] && installedBetas[appId].betaId !== betaId) await uninstallApp(appId + BETA);
  }
  const next = { ...(settings.betaChoice || {}) };
  if (betaId) next[appId] = betaId; else delete next[appId];
  settings.betaChoice = next;
  saveSettings();
  push();
  if (betaId) refreshBetas();
}
async function redeemCode(code) {
  needBetaLogin();
  code = String(code || '').trim().slice(0, 40);
  if (!code) throw new Error('Type a code first.');
  const flat = code.toUpperCase().replace(/[\s-]+/g, '');
  let j;
  try { j = await betaApi('redeem', { code }); }
  catch (e) {
    if (flat.length === 8 && /unknown|action|not found|HTTP 404/i.test(e.message)) j = { ...(await betaApi('beta-redeem', { code })), kind: 'beta' };
    else throw e;
  }
  const ap = j.app || {};
  const kind = j.kind === 'key' ? 'key' : 'beta';
  if (kind === 'key') return redeemedKey(ap);
  const b = j.beta;
  const appId = String(b?.appId || ap.id || '');
  if (!b?.id || !appId) throw new Error("That code didn't give a beta.");
  const isCommunity = ap.community || /^c-/.test(appId);
  const cid = String(ap.communityId || appId.replace(/^c-/, ''));
  const inLib = isCommunity ? (settings.community || []).includes(cid) : settings.library.includes(appId) || !!installed[appId];
  if (!inLib && !(settings.betaOnly || []).includes(appId)) { settings.betaOnly = [...(settings.betaOnly || []), appId]; saveSettings(); }
  if (!findApp(appId) && isCommunity && /^[a-z0-9]{8}$/.test(cid)) await addCommunityGame(cid);
  mergeBeta(b);
  const other = installedBetas[appId] && installedBetas[appId].betaId !== b.id;
  if (!other) await chooseBeta(appId, b.id); else refreshBetas();
  showWin();
  if (findApp(appId)) send('selectApp', appId);
  return { kind, beta: b, app: { id: appId, name: ap.name || findApp(appId)?.name || '' }, chosen: !other };
}
async function redeemedKey(ap) {
  const appId = String(ap.id || '');
  if (!appId) throw new Error("That code didn't give a game.");
  const cid = String(ap.communityId || appId.replace(/^c-/, ''));
  if (ap.community || /^c-/.test(appId)) {
    if (/^[a-z0-9]{8}$/.test(cid) && !settings.community.includes(cid)) settings.community = [...settings.community, cid];
  } else if (!settings.library.includes(appId)) { settings.library = [...settings.library, appId]; libQueue('o', appId, 'add'); }
  settings.betaOnly = (settings.betaOnly || []).filter(x => x !== appId);
  saveSettings();
  await refreshManifest();
  showWin();
  const a = findApp(appId);
  if (a) send('selectApp', a.id);
  return { kind: 'key', app: { id: appId, name: a?.name || ap.name || appId } };
}

function cmpLauncher(a, b) {
  const [ma, ...pa] = String(a || '0').replace(/^v/i, '').split('-');
  const [mb, ...pb] = String(b || '0').replace(/^v/i, '').split('-');
  const d = cmpVer(ma, mb);
  if (d) return d;
  if (!pa.length || !pb.length) return pa.length ? -1 : pb.length ? 1 : 0;
  return cmpVer(pa.join('-'), pb.join('-'));
}
const isBetaBuild = () => /-/.test(app.getVersion());
function launcherTarget() {
  let L = manifest?.launcher;
  if (!L) return null;
  if (IS_MAC) {
    const mb = x => (x?.mac && typeof x.mac === 'object' && x.mac.download?.url ? { ...x, download: x.mac.download } : { ...x, download: null });
    L = { ...mb(L), beta: L.beta ? mb(L.beta) : L.beta };
  }
  const B = L.beta;
  if (settings.betaChannel && B?.version && B.download?.url && cmpLauncher(B.version, L.version) > 0) return { ...B, beta: true, minVersion: L.minVersion };
  return L.version && L.download?.url ? { ...L, beta: false } : null;
}
function launcherUpdateInfo() {
  const T = launcherTarget();
  if (!app.isPackaged || !T) return null;
  const d = cmpLauncher(T.version, app.getVersion());
  const leftBeta = !T.beta && isBetaBuild() && !settings.betaChannel && d !== 0;
  const releaseOverBeta = !T.beta && isBetaBuild() && !!settings.betaChannel && d > 0;
  const toRelease = leftBeta;
  if (d <= 0 && !toRelease) return null;
  return {
    version: String(T.version),
    notes: T.notes || '',
    beta: T.beta,
    toRelease,
    releaseOverBeta,
    required: !toRelease && !!(T.minVersion && cmpLauncher(T.minVersion, app.getVersion()) > 0),
  };
}

const announced = new Set();
function announceUpdates() {
  const lu = launcherUpdateInfo();
  if (lu && !announced.has(`launcher@${lu.version}`)) {
    announced.add(`launcher@${lu.version}`);
    notify({ kind: 'launcher', icon: 'update', title: 'Hyperfocus update', body: `Hyperfocus v${lu.version} is available!`, image: 'icon', sound: 'warning', action: { type: 'launcher' } });
  }
}

const needsRelogin = () => !!account && (Number(account.granted ?? account.scopes ?? 0) & VELORA_SCOPES) !== VELORA_SCOPES;
const adminDisabled = bits => !!account && (Number(account.disabled || 0) & bits) !== 0;
function socialView() {
  return {
    loggedIn: !!account, needsRelogin: needsRelogin(), connected: velora.connected, unread: velora.unread,
    requests: velora.requests || 0,
    friends: velora.friendList(), me: account ? { username: account.username, pfp: account.pfp, color: account.color } : null,
    chatDisabled: adminDisabled(128), chatReadDisabled: adminDisabled(64), voiceDisabled: adminDisabled(16384), groupsDisabled: adminDisabled(2048),
  };
}

const jobView = j => ({ phase: j.phase, received: j.received, total: j.total, speed: j.speed });
function snapshot() {
  const apps = manifest?.apps || [];
  return {
    version: app.getVersion(),
    betaBuild: isBetaBuild(),
    manifest: manifestChecked || offlineMode ? manifest : null, manifestChecked,
    offline, jsonBroken, manifestError, settings, installed, installedBetas,
    account: offlineMode ? null : account, serverDown, offlineMode,
    status: Object.fromEntries([...apps.map(a => [a.id, statusOf(a)]), ...apps.map(a => betaApp(a.id)).filter(Boolean).map(b => [b.id, statusOf(b)])]),
    jobs: Object.fromEntries([...jobs].map(([id, j]) => [id, jobView(j)])),
    running: [...running.keys()],
    runningBeta: [...runBeta].filter(id => running.has(id)),
    betas,
    currentGame,
    playtime: playtime.view(),
    social: { connected: velora.connected, unread: velora.unread, needsRelogin: needsRelogin() },
    launcherUpdate: launcherUpdateInfo(),
    pads: padList(),
    consoleMode,
    achievements: achUnlocked,
    cloud: cloudStatus,
  };
}
function push() {
  sendAll('state', snapshot());
  try { librarySync.soon(); } catch {  }
  if (win && !win.isDestroyed()) {
    const active = [...jobs.values()].filter(j => j.phase === 'downloading' && j.total);
    if (active.length) {
      const got = active.reduce((s, j) => s + j.received, 0), tot = active.reduce((s, j) => s + j.total, 0);
      win.setProgressBar(Math.min(1, got / tot));
    } else win.setProgressBar(-1);
  }
}
let pushTimer = null;
function pushSoon() {
  if (pushTimer) return;
  pushTimer = setTimeout(() => { pushTimer = null; push(); }, 150);
}

const GATE_FILE_PATHS = { 'ikelene.net': ['/launcher/files/', '/launcher/community/files/'], 'www.ikelene.net': ['/launcher/files/', '/launcher/community/files/'],
  'nookara.cc': ['/community/files/'], 'www.nookara.cc': ['/community/files/'] };
function gateAuth(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !(GATE_FILE_PATHS[u.hostname] || []).some(p => u.pathname.startsWith(p))) return {};
    const token = loadToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch { return {}; }
}
async function gateRefusal(res) {
  const j = await res.json().catch(() => null);
  if (!res.redirected && j && typeof j.error === 'string' && j.error) return `${j.error} (the download is refused, HTTP ${res.status})`;
  if (res.redirected && res.status === 403) return 'The download link expired - try again.';
  return `Download failed (HTTP ${res.status})`;
}
// opts.auth = this is a game download (installApp): send the token to the gate. Launcher self-updates never do.
async function download(url, dest, job, opts = {}) {
  let start = 0;
  try { start = (await fsp.stat(dest)).size; } catch {}
  const ctrl = new AbortController();
  job.abort = () => ctrl.abort();
  const res = await fetch(url, { headers: { ...(start > 0 ? { Range: `bytes=${start}-` } : {}), ...(opts.auth ? gateAuth(url) : {}) }, signal: ctrl.signal });
  if (res.status === 416) { job.received = job.total = start; return; }
  if (!res.ok) throw new Error(opts.auth && [401, 403, 503].includes(res.status) ? await gateRefusal(res) : `Download failed (HTTP ${res.status})`);
  const resumed = res.status === 206 && start > 0;
  if (!resumed) start = 0;
  const len = Number(res.headers.get('content-length')) || 0;
  job.total = len ? start + len : (job.total || 0);
  job.received = start;

  const out = fs.createWriteStream(dest, { flags: resumed ? 'a' : 'w' });
  const reader = res.body.getReader();
  let tick = Date.now(), tickBytes = job.received;
  let budgetStart = Date.now(), budgetBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!out.write(value)) await new Promise(r => out.once('drain', r));
      job.received += value.length;

      const limit = Number(settings.speedLimit) || 0;
      if (limit > 0) {
        budgetBytes += value.length;
        const ahead = (budgetBytes / limit) * 1000 - (Date.now() - budgetStart);
        if (ahead > 0) await sleep(ahead);
        if (Date.now() - budgetStart > 2000) { budgetStart = Date.now(); budgetBytes = 0; }
      }
      const now = Date.now();
      if (now - tick >= 500) {
        const inst = ((job.received - tickBytes) * 1000) / (now - tick);
        job.speed = job.speed ? job.speed * 0.6 + inst * 0.4 : inst;
        tick = now;
        tickBytes = job.received;
      }
      pushSoon();
    }
  } finally {
    await new Promise(r => out.end(r));
  }
  if (!job.total) job.total = job.received;
}

async function flattenSingleDir(dir) {
  const ents = await fsp.readdir(dir, { withFileTypes: true });
  if (ents.length !== 1 || !ents[0].isDirectory()) return;
  if (IS_MAC && /\.app$/i.test(ents[0].name)) return;
  const inner = path.join(dir, `.hf-flatten-${Date.now()}`);
  await fsp.rename(path.join(dir, ents[0].name), inner);
  for (const e of await fsp.readdir(inner)) await fsp.rename(path.join(inner, e), path.join(dir, e));
  await fsp.rmdir(inner);
}

function resolveExe(dir, rel) {
  const direct = path.join(dir, rel);
  if (fs.existsSync(direct)) return direct;
  try {
    const subs = fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory());
    if (subs.length === 1) {
      const inner = path.join(dir, subs[0].name, rel);
      if (fs.existsSync(inner)) return inner;
    }
  } catch {}
  return direct;
}

function startWait(exe, args, cwd, env) {
  const argStr = (args || []).map(a => (/\s/.test(String(a)) ? `"${a}"` : String(a))).join(' ');
  const dir = cwd ? `/D "${cwd}" ` : '';
  return spawn('cmd.exe', ['/d', '/s', '/c', `"start "" ${dir}/wait "${exe}" ${argStr}"`], { windowsVerbatimArguments: true, windowsHide: true, stdio: 'ignore', ...(env ? { env: { ...process.env, ...env } } : {}) });
}
const SCOPE_INFO = [
  [1, 'See your profile', 'your username, picture and public profile'],
  [2, 'See private profile details', 'like your email address'],
  [4, 'Sign you in to other apps', ''],
  [8, 'Change your account settings', ''],
  [16, 'Read its saved data', 'what it stored in your Nookara storage'],
  [32, 'Save data to your account', 'uses your Nookara storage'],
  [64, 'Read your messages', ''],
  [128, 'Send messages as you', ''],
  [256, 'See your friends', ''],
  [512, 'Add and remove friends', ''],
  [1024, 'Spend your Nookara credits', 'payments still ask you first'],
  [2048, 'Chat as you', ''],
  [4096, 'Upload pictures and media', ''],
  [8192, 'See your Nookara credits', 'your balance'],
  [16384, 'Join voice chats and call people', ''],
];
const scopeList = bits => SCOPE_INFO.filter(([b]) => (bits & b) === b);

function loadGameTokens() {
  try {
    const buf = fs.readFileSync(FILES.gameTokens);
    const txt = buf.subarray(0, 6).toString() === 'plain:' ? buf.subarray(6).toString() : safeStorage.decryptString(buf);
    return JSON.parse(txt) || {};
  } catch { return {}; }
}
function saveGameTokens(map) {
  try {
    const txt = JSON.stringify(map);
    fs.writeFileSync(FILES.gameTokens, safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(txt) : Buffer.from('plain:' + txt));
  } catch (e) { console.warn('game logins not saved:', e.message); }
}
function rememberGameLogin(id, rec) {
  const next = { ...(settings.gameLogins || {}) };
  if (rec) next[id] = { ...rec, at: Date.now() }; else delete next[id];
  settings.gameLogins = next;
  if (!rec) { const map = loadGameTokens(); if (map[id]) { delete map[id]; saveGameTokens(map); } }
  saveSettings();
  push();
}
async function veloraTokenUser(token) {
  try {
    const r = await fetch(`${VELORA}/auth/validate`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(10000) });
    const j = await r.json().catch(() => ({}));
    return r.ok && j.valid !== false && j.user ? j.user : null;
  } catch { return null; }
}
const permAsks = new Map();
let permFlow = null;
function askGamePerms(a, project, scopes, extra) {
  const reqId = crypto.randomBytes(6).toString('hex');
  showWin();
  send('gamePerms', {
    reqId, id: a.id, name: a.name || a.id, icon: a.icon || '', project,
    community: !!a.community, author: a.community ? String(a.author || '') : '',
    perms: scopeList(scopes).map(([bit, name, note]) => ({ bit, name, note, extra: (extra & bit) === bit })),
  });
  return new Promise(resolve => permAsks.set(reqId, resolve));
}
async function approveOnVelora(reqId, project, scopes) {
  const flow = { cancelled: false, reqId };
  permFlow = flow;
  try {
    const c = await velora.api('/auth/child-token/approval', { method: 'POST', body: { project, scopes } }).catch(() => null);
    if (!c || !c.code) return { error: "Couldn't reach Nookara right now." };
    await shell.openExternal(`${VELORA}/login?code=${encodeURIComponent(c.code)}`);
    const until = Date.now() + 5 * 60 * 1000;
    while (!flow.cancelled && Date.now() < until) {
      await sleep(1500);
      if (flow.cancelled) break;
      try {
        const j = await velora.api('/auth/child-token/approval/status', { method: 'POST', body: { code: c.code }, timeout: 10000 });
        if (j.ready && j.token) return { token: j.token };
      } catch (e) { if (/invalid_or_expired_code/.test(e.message)) break; }
    }
    return { error: flow.cancelled ? 'cancelled' : 'expired' };
  } finally { if (permFlow === flow) permFlow = null; }
}

// apps.json "veloraToken": { "project": "Nookara Badge Arcade", "scopes": 1 } - the game gets its OWN
// Nookara login in HF_VELORA_TOKEN, never the launcher's token: a child of ours (only scopes we have),
// or - if it wants more than our login was given - one you approve for it on Nookara (asked first).
// Community games (a.community, veloraToken from the community site) always ask first - every permission, not
// only the ones our login lacks - and the answer is remembered per game + project + scopes + Nookara account in
// settings.gameLogins (scopes change = asked again; Game settings can forget it). "Play without it" = no token at
// all for them (they sign in by themselves).
// Returns the env, null (the game signs in by itself) or false (you cancelled: don't start it).
async function gameLoginEnv(a) {
  const want = a && a.veloraToken;
  if (!want || typeof want !== 'object' || !loadToken() || offline) return null;
  const project = String(want.project || a.name || a.id).slice(0, 100);
  const scopes = ((Math.floor(Number(want.scopes)) || 1) & (2 ** 21 - 1)) || 1;
  const granted = Number(account?.granted ?? account?.scopes ?? 0);
  const extra = scopes & ~granted;
  let justAsked = false;
  if (a.community) {
    const me = String(account?.username || '');
    const c = settings.gameLogins?.[a.id];
    const same = c && Number(c.scopes) === scopes && c.project === project && c.user === me;
    if (same && !c.allow) return null;
    if (!same) {
      const choice = await askGamePerms(a, project, scopes, extra);
      if (choice === 'cancel') return false;
      rememberGameLogin(a.id, { scopes, project, allow: choice === 'allow', user: me });
      if (choice !== 'allow') return null;
      justAsked = true;
    }
  }
  if (extra) {
    const saved = loadGameTokens()[a.id];
    if (saved?.token && (Number(saved.scopes) & scopes) === scopes) {
      const u = await veloraTokenUser(saved.token);
      if (u && u.username === account?.username) return { HF_VELORA_TOKEN: saved.token, HF_VELORA_USER: String(u.username || '') };
    }
    const choice = justAsked ? 'allow' : await askGamePerms(a, project, scopes, extra);
    if (choice === 'cancel') return false;
    if (a.community && choice !== 'allow') {
      rememberGameLogin(a.id, { scopes, project, allow: false, user: String(account?.username || '') });
      return null;
    }
    if (choice === 'allow') {
      const r = await approveOnVelora(null, project, scopes);
      send('gamePermsState', { id: a.id, state: r.token ? 'done' : r.error === 'cancelled' ? 'cancelled' : 'failed', error: r.error || null });
      if (r.token) {
        const u = await veloraTokenUser(r.token);
        const map = loadGameTokens(); map[a.id] = { token: r.token, scopes, project, username: u?.username || '', at: Date.now() }; saveGameTokens(map);
        return { HF_VELORA_TOKEN: r.token, HF_VELORA_USER: String(u?.username || '') };
      }
      if (r.error === 'cancelled') return false;
      toast(`Nookara didn't approve ${a.name || a.id} - starting it with the permissions it already has.`, 'err');
    }
  }
  try {
    const r = await velora.api('/auth/child-token', { method: 'POST', body: { project, scopes } });
    return r && r.token ? { HF_VELORA_TOKEN: r.token, HF_VELORA_USER: String(r.username || '') } : null;
  } catch (e) {
    console.warn(`child token for ${a.id} failed: ${e.message}`);
    return null;
  }
}
async function startMac(exe, args, cwd, env) {
  const bin = /\.app$/i.test(exe) ? await mac.appExecutable(exe) : exe;
  if (!fs.existsSync(bin)) throw new Error(`Can't find the program inside ${path.basename(exe)}.`);
  await mac.makeExecutable(bin);
  return spawn(bin, args || [], { cwd, detached: true, stdio: 'ignore', env: { ...process.env, ...(env || {}) } });
}
function runInstaller(exe, args) {
  return new Promise((resolve, reject) => {
    const c = startWait(exe, args);
    c.once('error', reject);
    c.once('exit', resolve);
  });
}

async function placeFiles(a, file, hash, root) {
  const d = a.download;
  const type = String(d.type || ((IS_MAC ? /\.(zip|dmg)\.part$/i : /\.zip\.part$/i).test(file) ? 'zip' : 'file')).toLowerCase();
  const prev = instOf(a.id);
  const rel = installed[baseOf(a.id)];
  const betaRoot = isBetaKey(a.id) && rel?.dir && rel.type !== 'installer' ? path.dirname(rel.dir) : null;
  const dir = prev?.dir && prev.type !== 'installer' ? prev.dir
    : path.join(root || betaRoot || settings.installRoot, isBetaKey(a.id) ? `${safeName(baseOf(a.id))}-beta` : safeName(a.id));
  const record = { version: a.version ? String(a.version) : '', sha256: hash, type, installedAt: Date.now(), exe: a.exe || '', name: a.name || a.id, appType: a.type === 'Game' ? 'Game' : 'App', ...(IS_MAC ? { platform: 'mac' } : {}) };
  if (a.stage && !isBetaKey(a.id)) Object.assign(record, { stage: a.stage, releaseDate: a.releaseDate || '' });

  if (IS_MAC && type === 'installer') throw new Error('Setup programs only run on Windows.');
  if (type === 'installer') {
    const exe = file.replace(/\.part$/i, '');
    await fsp.rm(exe, { force: true });
    await fsp.rename(file, exe);
    const code = await runInstaller(exe, d.args);
    await fsp.rm(exe, { force: true }).catch(() => {});
    if (code !== 0) throw new Error(`The installer exited with code ${code}.`);
    const target = expandEnv(a.exe);
    return { ...record, dir: target && path.isAbsolute(target) ? path.dirname(target) : dir };
  }

  const staging = dir + '.hf-new', old = dir + '.hf-old';
  await fsp.rm(staging, { recursive: true, force: true });
  await fsp.mkdir(staging, { recursive: true });
  if (type === 'zip') {
    if (IS_MAC) await mac.extract(file, path.resolve(staging));
    else await extractZip(file, { dir: path.resolve(staging) });
    await flattenSingleDir(staging);
  } else {
    const fromUrl = decodeURIComponent(path.posix.basename(new URL(d.url).pathname));
    const name = safeName(d.filename || fromUrl || 'app.exe');
    await fsp.copyFile(file, path.join(staging, name));
    if (!record.exe) record.exe = name;
  }
  for (const s of specsFor(a, dir).filter(x => x.install)) {
    if (!fs.existsSync(s.abs)) continue;
    const dest = path.join(staging, s.rel);
    await fsp.rm(dest, { recursive: true, force: true });
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.cp(s.abs, dest, { recursive: true });
  }
  if (IS_MAC) {
    await mac.stripQuarantine(staging);
    const exeRel = record.exe && !path.isAbsolute(record.exe) ? resolveExe(staging, record.exe) : '';
    if (exeRel && fs.existsSync(exeRel)) {
      if (/\.app$/i.test(exeRel)) { await mac.ensureSigned(exeRel); await mac.makeExecutable(await mac.appExecutable(exeRel)); } else await mac.makeExecutable(exeRel);
    }
  }
  await fsp.rm(old, { recursive: true, force: true });
  if (fs.existsSync(dir)) await fsp.rename(dir, old);
  await fsp.rename(staging, dir);
  await fsp.rm(old, { recursive: true, force: true }).catch(() => {});
  return { ...record, dir };
}

async function installApp(id, root = '') {
  const beta = isBetaKey(id);
  const a = beta ? betaApp(baseOf(id)) : findApp(id);
  if (!a) throw new Error(beta ? "That beta isn't available anymore." : "That app isn't in the launcher anymore.");
  if (needsBuying(a)) throw new Error(`Buy ${a.name || id} first - it opens in your browser.`);
  if (a.winonly) throw new Error(`${a.name || id} only comes for Windows - there's no Mac version yet.`);
  const d = a.download || {};
  if (!d.url) throw new Error(beta ? `${a.beta.name} has no build yet.` : a.stage === 'soon' ? `${a.name || id} isn't out yet.` : 'This app has no download yet.');
  if (runningKey(id)) throw new Error('Close the app before updating it.');
  const existing = jobs.get(id);
  if (existing && existing.phase !== 'paused') return;

  const dlDir = path.join(settings.installRoot, '.downloads');
  await fsp.mkdir(dlDir, { recursive: true });
  const ext = path.extname(new URL(d.url).pathname) || (d.type === 'zip' ? '.zip' : '.bin');
  const tag = safeName(String(d.sha256 || a.version || 'latest').slice(0, 16));
  const part = path.join(dlDir, `${safeName(id)}@${tag}${ext}.part`);
  for (const f of await fsp.readdir(dlDir)) {
    if (f.startsWith(safeName(id) + '@') && path.join(dlDir, f) !== part) await fsp.rm(path.join(dlDir, f), { force: true }).catch(() => {});
  }

  const job = existing || { id, received: 0, total: Number(d.size) || 0, speed: 0 };
  if (beta) job.betaId = a.beta.id;
  if (root) job.root = await checkInstallRoot(root);
  Object.assign(job, { phase: 'downloading', paused: false, cancelled: false, speed: 0, part });
  jobs.set(id, job);
  if (!beta) {
    let changed = false;
    if (!/^c-/.test(id) && !a.community && !settings.library.includes(id)) { settings.library = [...settings.library, id]; libQueue('o', id, 'add'); changed = true; }
    if ((settings.betaOnly || []).includes(id)) { settings.betaOnly = settings.betaOnly.filter(x => x !== id); changed = true; }
    if (changed) saveSettings();
  }
  push();

  try {
    await download(cacheBust(d.url, d.sha256 || a.version), part, job, { auth: true });
  } catch (e) {
    if (job.paused) { job.phase = 'paused'; job.speed = 0; push(); return; }
    jobs.delete(id);
    if (job.cancelled) { await fsp.rm(part, { force: true }).catch(() => {}); push(); return; }
    push();
    notifyIfAway(a, `Download failed: ${e.message}`);
    throw e;
  }

  try {
    job.phase = 'verifying'; job.speed = 0; push();
    const hash = await sha256File(part);
    if (d.sha256 && hash.toLowerCase() !== String(d.sha256).toLowerCase()) {
      await fsp.rm(part, { force: true });
      throw new Error('Checksum mismatch - the download got corrupted. Try again!');
    }
    job.phase = 'installing'; push();
    const rec = await placeFiles(a, part, hash, job.root);
    if (beta) installedBetas[a.realId] = { ...rec, betaId: a.beta.id, betaName: a.beta.name, lastPlayed: installedBetas[a.realId]?.lastPlayed };
    else installed[id] = rec;
    saveInst(id);
    await fsp.rm(part, { force: true }).catch(() => {});
    notify({ kind: 'launcher', title: beta ? `${a.name || a.realId} - ${a.beta.name}` : a.name || id, body: `Finished installing - ready to ${verbOf(a)}!`, image: a.icon, sound: 'warning', action: { type: 'app', id: baseOf(id) } });
  } catch (e) {
    notifyIfAway(a, `Install failed: ${e.message}`);
    throw e;
  } finally {
    jobs.delete(id);
    push();
  }
}
function notifyIfAway(a, body) {
  if (win && !win.isDestroyed() && win.isFocused()) return;
  notify({ kind: 'launcher', icon: /fail/i.test(body) ? 'xcircle' : undefined, title: a.beta ? `${a.name || a.realId} - ${a.beta.name}` : a.name || a.id, body, image: a.icon, sound: 'warning', action: { type: 'app', id: baseOf(a.id) } });
}

function pauseJob(id) {
  const j = jobs.get(id);
  if (j && j.phase === 'downloading') { j.paused = true; j.abort?.(); }
}
async function cancelJob(id) {
  const j = jobs.get(id);
  if (!j) return;
  if (j.phase === 'paused') {
    jobs.delete(id);
    if (j.part) await fsp.rm(j.part, { force: true }).catch(() => {});
    push();
  } else if (j.phase === 'downloading') {
    j.cancelled = true;
    j.abort?.();
  }
}

// ── launching ────────────────────────────────────────────────────────────────
async function launchApp(key) {
  const beta = isBetaKey(key), id = baseOf(key);
  if (!offlineMode && (!account || !loadToken())) throw new Error('Sign in with Nookara to play.');
  const extApp = findApp(id);
  if (!beta && extApp?.external) { if (extApp.download?.url) openExternalSafe(extApp.download.url); return; }
  const inst = instOf(key);
  if (!inst) throw new Error("This app isn't installed.");
  if (running.has(id)) throw new Error(runBeta.has(id) === beta ? "It's already running!" : `Close the ${runBeta.has(id) ? 'beta' : 'release'} first - you can't run both at once.`);
  await Promise.race([refreshManifest().then(() => (beta ? betasInflight : null)), sleep(6000)]);
  const a = beta ? betaApp(id) : findApp(id);
  if (beta && !a && !offline) throw new Error("You're not in that beta anymore.");
  if (needsBuying(a)) throw new Error(`You need to buy ${a.name || id} before you can ${verbOf(a)} it.`);
  const gate = a && !offline ? statusOf(a) : null;
  if (gate === 'update' || gate === 'repair') throw new Error(`${gate === 'repair' ? 'A repair' : 'An update'} is required before you can ${verbOf(a)} it.`);

  const exeRel = expandEnv((a && a.exe) || inst.exe || '');
  if (!exeRel) throw new Error(beta ? 'This beta has no program to start - ask its developer to pick one.' : 'No "exeLocation" is set for this app in apps.json.');
  const exe = path.isAbsolute(exeRel) ? exeRel : resolveExe(inst.dir, exeRel);
  if (!fs.existsSync(exe)) throw new Error(`Can't find ${exeRel} in the install folder - check "exeLocation" or try Repair files.`);
  const args = ((a && a.args) || []).map(String);
  const ext = path.extname(exe).toLowerCase();
  if (IS_MAC && ['.exe', '.cmd', '.bat'].includes(ext)) throw new Error("That's a Windows program - this game has no Mac build.");
  const macRun = IS_MAC && (ext === '.app' || (() => { try { const st = fs.statSync(exe); return st.isFile() && (st.mode & 0o111) !== 0; } catch { return false; } })());
  if (a && !beta && !(await cloudBeforeLaunch(a, inst))) return;
  if (running.has(id)) return;

  let child = null;
  if (ext === '.exe' || ext === '.cmd' || ext === '.bat' || macRun) {
    const env = await gameLoginEnv(extApp || a);
    if (env === false) return;
    if (running.has(id)) return;
    child = macRun ? await startMac(exe, args, path.dirname(exe), env) : startWait(exe, args, path.dirname(exe), env);
  } else {
    const err = await shell.openPath(exe);
    if (err) throw new Error(err);
  }
  if (child) {
    running.set(id, child);
    if (beta) runBeta.add(id); else runBeta.delete(id);
    currentGame = id;
    if (a?.community) communityPost('play', { id: a.communityId });
    playtime.start(id);
    velora.setActivity(activityFor(id));
    updateDiscordPresence();
    updateHotkey();
    updateVoiceHud();
    if (hotkeyReg) {
      notify({
        kind: 'overlay', title: `${String(hotkeyReg).split('+').join(' + ')} to open overlay`, image: a?.icon,
      });
    }
    const ended = () => {
      if (!running.has(id)) return;
      running.delete(id);
      runBeta.delete(id);
      playtime.stop(id);
      presenceOverrides.delete(id);
      inviteState.delete(id);
      pendingJoins.delete(id);
      sendInviteState();
      if (!running.size) media.stop();
      if (installed[id]) { installed[id].lastPlayed = Date.now(); saveInstalled(); }
      if (beta && installedBetas[id]) { installedBetas[id].lastPlayed = Date.now(); saveInstalledBetas(); }
      if (currentGame === id) currentGame = [...running.keys()].pop() || null;
      velora.setActivity(currentGame ? activityFor(currentGame) : null);
      updateHotkey();
      updateVoiceHud();
      updateDiscordPresence();
      push();
    };
    child.once('error', e => { ended(); toast(`Couldn't start it: ${e.message}`, 'err'); });
    child.once('exit', () => {
      ended();
      if (a && !beta) setTimeout(() => cloudAfterExit(id), 2500);
      if (beta) setTimeout(() => refreshBetas(), 1500);
      if (settings.onLaunch !== 'keep' && running.size === 0) bringToFront();
    });
    child.unref();
  }
  inst.lastPlayed = Date.now();
  saveInst(key);
  push();
  if (settings.onLaunch === 'minimize') minimizeWin();
  else if (settings.onLaunch === 'tray') hideWin();
}

async function checkInstallRoot(root) {
  const dir = path.resolve(String(root));
  if (!path.isAbsolute(String(root))) throw new Error('Pick a folder for the game.');
  const low = dir.toLowerCase();
  const banned = [process.env.WINDIR, process.env.SystemRoot, path.dirname(app.getPath('exe')),
    ...(IS_MAC ? ['/System', '/usr', '/bin', '/sbin', '/etc', '/private', mac.bundleOf(app.getPath('exe'))] : [])].filter(Boolean).map(p => path.resolve(p).toLowerCase());
  if (banned.some(b => low === b || low.startsWith(b + path.sep))) throw new Error("Games can't go in that folder - pick another one.");
  await fsp.mkdir(dir, { recursive: true });
  const probe = path.join(dir, `.hf-write-test-${process.pid}`);
  try { await fsp.writeFile(probe, ''); await fsp.rm(probe, { force: true }); } catch { throw new Error("Hyperfocus can't write to that folder - pick another one."); }
  return dir;
}
async function installWhere(id, root) {
  const a = findApp(id);
  const base = path.resolve(String(root || settings.installRoot));
  let free = null;
  try {
    let p = base;
    while (!fs.existsSync(p) && path.dirname(p) !== p) p = path.dirname(p);
    const st = await fsp.statfs(p);
    free = Number(st.bavail) * Number(st.bsize);
  } catch {}
  return { root: base, dir: path.join(base, safeName(a?.id || id)), free, size: Number(a?.download?.size) || 0, defaultRoot: settings.installRoot };
}

let cloud = null;
const cloudSaves = () => cloud || (cloud = new CloudSaves({ velora, dataDir: DATA, deviceId: getInstallId() }));
const cloudStatus = {};
function setCloud(id, s) { cloudStatus[id] = { ...s, updated: Date.now() }; push(); }
const cloudOff = id => (settings.cloudSavesOff || []).includes(id);
function cloudOn(a, inst = installed[a?.id]) {
  return !!a && !!inst && !offlineMode && !!account && !!loadToken() && !cloudOff(a.id) && specsFor(a, inst.dir).length > 0;
}
function cloudBase(a) {
  const inst = installed[a.id];
  if (!specsFor(a, inst?.dir || os.tmpdir()).length) return { state: 'unsupported' };
  if (cloudOff(a.id)) return { state: 'off' };
  if (!inst) return { state: 'notInstalled' };
  if (offlineMode || !account) return { state: 'loggedOut' };
  return null;
}
const cloudErr = e => e?.code === 'storage_limit_exceeded' || /storage is full/i.test(e?.message || '')
  ? 'Your Nookara storage is full.' : e?.code === 'too_big' ? e.message : (e?.message || 'Something went wrong.');
const cloudAsks = new Map();
function askCloudConflict(a, local, meta) {
  const reqId = crypto.randomBytes(6).toString('hex');
  const st = cloudSaves().st(a.id);
  showWin();
  send('cloudConflict', {
    reqId, id: a.id, name: a.name || a.id, icon: a.icon || '',
    local: { playedAt: installed[a.id]?.lastPlayed || null, size: local.size, empty: local.empty, syncAt: st.syncAt || null },
    cloud: { at: meta.at, deviceName: meta.deviceName, size: meta.size, sameDevice: meta.device === getInstallId() },
  });
  return new Promise(resolve => cloudAsks.set(reqId, resolve));
}
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Couldn't reach the save cloud.")), ms))]);

const cloudBusy = new Set();
async function cloudBeforeLaunch(a, inst) {
  if (!cloudOn(a, inst)) return true;
  if (cloudBusy.has(a.id)) return false;
  cloudBusy.add(a.id);
  try { return await cloudBeforeLaunchInner(a, inst); } finally { cloudBusy.delete(a.id); }
}
async function cloudBeforeLaunchInner(a, inst) {
  const id = a.id, cs = cloudSaves(), specs = specsFor(a, inst.dir);
  setCloud(id, { state: 'checking' });
  let meta, local;
  try { [meta, local] = await Promise.all([withTimeout(cs.meta(id), 10000), saveSnapshot(specs)]); }
  catch (e) { setCloud(id, { state: 'error', error: cloudErr(e) }); return true; }
  const st = cs.st(id);
  if (!meta) { setCloud(id, { state: local.empty ? 'empty' : 'local' }); return true; }
  if (meta.hash === local.hash) {
    Object.assign(st, { syncHash: meta.hash, syncAt: meta.at }); cs.save();
    setCloud(id, { state: 'synced', at: meta.at, deviceName: meta.deviceName });
    return true;
  }
  if (local.empty || (st.syncHash && st.syncHash === local.hash)) {
    setCloud(id, { state: 'downloading' });
    try { await cs.restoreFromCloud(id, specs, meta, local); }
    catch (e) { setCloud(id, { state: 'error', error: cloudErr(e) }); throw new Error(`Couldn't load your cloud save: ${cloudErr(e)}`); }
    setCloud(id, { state: 'synced', at: meta.at, deviceName: meta.deviceName });
    toast(`Loaded your cloud save${meta.device !== getInstallId() ? ` from ${meta.deviceName}` : ''}.`, 'ok');
    return true;
  }
  if (st.syncHash && meta.hash === st.syncHash) { setCloud(id, { state: 'localNewer' }); return true; }
  setCloud(id, { state: 'conflict', at: meta.at, deviceName: meta.deviceName });
  const choice = await askCloudConflict(a, local, meta);
  if (choice === 'cloud') {
    setCloud(id, { state: 'downloading' });
    try { await cs.restoreFromCloud(id, specs, meta, local); }
    catch (e) { setCloud(id, { state: 'error', error: cloudErr(e) }); throw new Error(`Couldn't load your cloud save: ${cloudErr(e)}`); }
    setCloud(id, { state: 'synced', at: meta.at, deviceName: meta.deviceName });
    return true;
  }
  if (choice === 'local') {
    setCloud(id, { state: 'uploading' });
    try { await cs.backupLocal(id, local, 'kept-local'); const m = await cs.upload(id, local, meta); setCloud(id, { state: 'synced', at: m.at, deviceName: m.deviceName }); }
    catch (e) { setCloud(id, { state: 'error', error: cloudErr(e) }); }
    return true;
  }
  setCloud(id, { state: 'conflict', at: meta.at, deviceName: meta.deviceName });
  return false;
}
async function cloudAfterExit(id) {
  const a = findApp(id), inst = installed[id];
  if (!cloudOn(a, inst) || running.has(id)) return;
  const cs = cloudSaves(), specs = specsFor(a, inst.dir);
  try {
    const local = await saveSnapshot(specs);
    const st = cs.st(id);
    st.playedAt = Date.now(); cs.save();
    if (local.empty || local.hash === st.syncHash) { if (!local.empty) setCloud(id, { state: 'synced', at: st.syncAt }); return; }
    setCloud(id, { state: 'uploading' });
    const meta = await cs.meta(id);
    if (meta && meta.hash !== local.hash && st.syncHash && meta.hash !== st.syncHash) {
      setCloud(id, { state: 'conflict', at: meta.at, deviceName: meta.deviceName });
      const choice = await askCloudConflict(a, local, meta);
      if (choice === 'cloud') { await cs.restoreFromCloud(id, specs, meta, local); setCloud(id, { state: 'synced', at: meta.at, deviceName: meta.deviceName }); return; }
      if (choice !== 'local') return;
      await cs.backupLocal(id, local, 'kept-local');
    }
    const m = await cs.upload(id, local, meta);
    setCloud(id, { state: 'synced', at: m.at, deviceName: m.deviceName });
  } catch (e) { setCloud(id, { state: 'error', error: cloudErr(e) }); }
}
const cloudChecked = {};
async function cloudCheck(id, force) {
  const a = findApp(id);
  if (!a) return null;
  const base = cloudBase(a);
  if (base) { cloudStatus[id] = base; return base; }
  if (running.has(id)) return cloudStatus[id] || { state: 'playing' };
  if (!force && Date.now() - (cloudChecked[id] || 0) < 60000 && cloudStatus[id]) return cloudStatus[id];
  cloudChecked[id] = Date.now();
  const cs = cloudSaves(), inst = installed[id], specs = specsFor(a, inst.dir);
  try {
    const [meta, local] = await Promise.all([withTimeout(cs.meta(id), 10000), saveSnapshot(specs)]);
    const st = cs.st(id);
    if (!meta) {
      if (local.empty) setCloud(id, { state: 'empty' });
      else if (force) { setCloud(id, { state: 'uploading' }); const m = await cs.upload(id, local, null); setCloud(id, { state: 'synced', at: m.at, deviceName: m.deviceName }); }
      else setCloud(id, { state: 'local' });
    } else if (meta.hash === local.hash) {
      Object.assign(st, { syncHash: meta.hash, syncAt: meta.at }); cs.save();
      setCloud(id, { state: 'synced', at: meta.at, deviceName: meta.deviceName });
    } else if (local.empty || (st.syncHash && st.syncHash === local.hash)) {
      setCloud(id, { state: 'cloudNewer', at: meta.at, deviceName: meta.deviceName });
    } else if (st.syncHash && meta.hash === st.syncHash) {
      setCloud(id, { state: 'uploading' });
      const m = await cs.upload(id, local, meta);
      setCloud(id, { state: 'synced', at: m.at, deviceName: m.deviceName });
    } else setCloud(id, { state: 'conflict', at: meta.at, deviceName: meta.deviceName });
  } catch (e) { setCloud(id, { state: 'error', error: cloudErr(e) }); }
  return cloudStatus[id];
}

async function uninstallApp(id) {
  const inst = instOf(id);
  if (!inst) return;
  if (runningKey(id)) throw new Error('Close the app first.');
  if (jobs.has(id)) throw new Error('Wait for the download to finish (or cancel it) first.');
  const a = isBetaKey(id) ? null : findApp(id);
  if (inst.type === 'installer') {
    if (a?.uninstall) await runInstaller(expandEnv(a.uninstall), a.uninstallArgs || []);
    else toast('This one used its own installer - remove it from Windows Settings > Apps too.', 'info');
  } else {
    const inFolder = specsFor(a, inst.dir).filter(x => x.install);
    if (inFolder.length) {
      const snap = await saveSnapshot(inFolder).catch(() => null);
      await cloudSaves().backupLocal(id, snap, 'uninstall').catch(() => {});
      if (snap && !snap.empty && cloudOn(a) && snap.hash !== cloudSaves().st(id).syncHash) await cloudSaves().upload(id, snap, await cloudSaves().meta(id).catch(() => null)).catch(() => {});
    }
    const dir = path.resolve(inst.dir);
    const root = path.parse(dir).root;
    if (dir === root || dir === path.resolve(settings.installRoot) || dir.length < root.length + 3) {
      throw new Error(`Refusing to delete ${dir}`);
    }
    await fsp.rm(dir, { recursive: true, force: true });
  }
  if (isBetaKey(id)) delete installedBetas[baseOf(id)]; else delete installed[id];
  saveInst(id);
  push();
}

async function updateLauncher() {
  const L = launcherTarget();
  if (!L?.download?.url) throw new Error('No launcher download in the manifest.');
  if (IS_MAC) return updateLauncherMac(L);
  const dest = path.join(os.tmpdir(), `Hyperfocus-Setup-${safeName(L.version || 'latest')}.exe`);
  const job = { id: '__launcher__', phase: 'downloading', received: 0, total: Number(L.download.size) || 0, speed: 0 };
  jobs.set(job.id, job);
  push();
  try {
    await fsp.rm(dest, { force: true });
    await download(cacheBust(L.download.url, L.download.sha256 || L.version), dest, job);
    if (L.download.sha256) {
      const h = await sha256File(dest);
      if (h.toLowerCase() !== String(L.download.sha256).toLowerCase()) throw new Error('The launcher update failed its checksum.');
    }
  } finally {
    jobs.delete(job.id);
    push();
  }
  spawn(dest, [], { detached: true, stdio: 'ignore' }).unref();
  quitting = true;
  setTimeout(() => app.quit(), 300);
}
async function updateLauncherMac(L) {
  const bundle = mac.bundleOf(app.getPath('exe'));
  const byHand = why => { openExternalSafe(DISCORD_INSTALL_URL); throw new Error(`${why} The download page is open - drag the new Hyperfocus into Applications yourself.`); };
  if (!bundle) return byHand("Hyperfocus can't update itself from here.");
  const dest = path.join(os.tmpdir(), `Hyperfocus-mac-${safeName(L.version || 'latest')}.zip`);
  const job = { id: '__launcher__', phase: 'downloading', received: 0, total: Number(L.download.size) || 0, speed: 0 };
  jobs.set(job.id, job);
  push();
  try {
    await fsp.rm(dest, { force: true });
    await download(cacheBust(L.download.url, L.download.sha256 || L.version), dest, job);
    if (L.download.sha256) {
      const h = await sha256File(dest);
      if (h.toLowerCase() !== String(L.download.sha256).toLowerCase()) throw new Error('The launcher update failed its checksum.');
    }
  } finally {
    jobs.delete(job.id);
    push();
  }
  let old;
  try { old = await mac.replaceBundle(dest, bundle); } catch (e) { await fsp.rm(dest, { force: true }).catch(() => {}); return byHand(`Couldn't replace ${path.basename(bundle)} (${e.message}).`); }
  await fsp.rm(dest, { force: true }).catch(() => {});
  spawn('/bin/sh', ['-c', 'while kill -0 "$1" 2>/dev/null; do sleep 0.3; done; open -n "$2"; rm -rf "$3"', 'sh', String(process.pid), bundle, old], { detached: true, stdio: 'ignore' }).unref();
  quitting = true;
  setTimeout(() => app.quit(), 300);
}

function saveToken(token) {
  if (!token) { try { fs.unlinkSync(FILES.token); } catch {} return; }
  const buf = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(token) : Buffer.from('plain:' + token);
  fs.writeFileSync(FILES.token, buf);
}
function loadToken() {
  try {
    const buf = fs.readFileSync(FILES.token);
    if (buf.subarray(0, 6).toString() === 'plain:') return buf.subarray(6).toString();
    return safeStorage.decryptString(buf);
  } catch { return null; }
}
function setAccount(acc) {
  account = acc;
  settings.cachedAccount = acc;
  saveSettings();
}
async function validateSession() {
  if (offlineMode) return;
  const token = loadToken();
  if (!token) { if (account) setAccount(null); return; }
  try {
    const res = await fetch(`${VELORA}/auth/validate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(12000),
    });
    const j = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403 || j.valid === false) {
      saveToken(null);
      setAccount(null);
      velora.stop();
      refreshManifest();
      if (j.tos_required) toast("Nookara has new terms - log in again after accepting them at nookara.cc", 'info');
      return;
    }
    if (j.valid && j.user) {
      const wasOwner = isOwner();
      setAccount({
        id: j.user.id, username: j.user.username, pfp: j.user.pfp_url || '', color: j.user.color || '', scopes: Number(j.user.scopes) || 0,
        granted: Number(j.user.granted_scopes ?? j.user.scopes) || 0, disabled: Number(j.user.disabled_scopes) || 0,
        rank: String(j.user.rank || 'free').toLowerCase(),
      });
      if (isOwner() !== wasOwner) refreshManifest();
      startSocial();
    }
  } catch {
    if (account) startSocial();
  }
}
function startSocial() {
  if (!account || !loadToken()) return;
  velora.start(account.scopes);
  playtime.sync();
  refreshAchievements();
}

let achUnlocked = {};
const ACH_PENDING_FILE = path.join(DATA, 'pending-achievements.json');
let achPending = [];
try { achPending = JSON.parse(fs.readFileSync(ACH_PENDING_FILE, 'utf8')) || []; } catch {}
const saveAchPending = () => { try { fs.writeFileSync(ACH_PENDING_FILE, JSON.stringify(achPending)); } catch {} };
const achSilent = new Set();
const veloraUnreachable = e => offlineMode || !e?.status || e.status >= 500;
function localAchievement(game, id) {
  const a = findApp(game);
  const d = a?.achievements && typeof a.achievements === 'object' ? a.achievements[id] : null;
  return { id, name: d?.name || 'Achievement', description: d?.description || '', icon: d?.icon || '', rarity: d?.rarity === 'rare' ? 'rare' : 'common', hidden: !!d?.hidden, game, gameName: a?.name || game, gameIcon: a?.icon || '' };
}
function queueAch(op, game, id) {
  const i = achPending.findIndex(p => p.id === id);
  if (i >= 0 && achPending[i].op !== op) achPending.splice(i, 1);
  else if (i < 0) achPending.push({ op, id, game, at: Date.now() });
  saveAchPending();
}
let achFlushing = null;
function flushPendingAch() {
  if (achFlushing || !achPending.length || offlineMode || !account || !loadToken()) return achFlushing || Promise.resolve();
  achFlushing = (async () => {
    while (achPending.length) {
      const p = achPending[0];
      try {
        if (p.op === 'grant') achSilent.add(p.id);
        await velora.api(`/achievements/${encodeURIComponent(p.id)}/${p.op}`, { method: 'POST', body: { game: p.game } });
      } catch (e) {
        if (veloraUnreachable(e)) { achSilent.delete(p.id); break; }
      }
      achPending.shift();
      saveAchPending();
      setTimeout(() => achSilent.delete(p.id), 15000);
    }
  })().finally(() => { achFlushing = null; });
  return achFlushing;
}
setInterval(() => flushPendingAch(), 60000);
let achFetchedAt = 0;
async function refreshAchievements(force) {
  if (!account || !loadToken() || (!force && Date.now() - achFetchedAt < 60000)) return;
  achFetchedAt = Date.now();
  try {
    await flushPendingAch();
    const j = await velora.api('/achievements');
    const next = {};
    for (const [id, a] of Object.entries(j.achievements || {})) if (a.unlocked) next[id] = a.unlockedAt || Date.now();
    for (const p of achPending) if (p.op === 'grant') next[p.id] = next[p.id] || p.at; else delete next[p.id];
    achUnlocked = next;
    push();
  } catch {}
}
const ACH_W = 560, ACH_H = 380;
let achWin = null, achReady = null;
function ensureAchWin() {
  if (achWin && !achWin.isDestroyed()) return achWin;
  achWin = new BrowserWindow({
    width: ACH_W, height: ACH_H, frame: false, transparent: true, resizable: false, movable: false, focusable: false,
    skipTaskbar: true, alwaysOnTop: true, show: false, hasShadow: false, backgroundColor: '#00000000', webPreferences: webPrefs(),
  });
  achWin.setAlwaysOnTop(true, 'screen-saver');
  overFullscreen(achWin);
  achWin.setIgnoreMouseEvents(true);
  lockNavigation(achWin);
  achReady = new Promise(r => achWin.webContents.once('did-finish-load', r));
  achWin.loadFile(page('achievement.html'));
  achWin.on('closed', () => { achWin = null; });
  return achWin;
}
async function showAchievement(a) {
  const w = ensureAchWin();
  await achReady;
  if (w.isDestroyed()) return;
  if (!w.isVisible()) {
    const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    w.setBounds({ x: Math.round(wa.x + (wa.width - ACH_W) / 2), y: wa.y + wa.height - ACH_H - 20, width: ACH_W, height: ACH_H });
    w.showInactive();
  }
  w.moveTop();
  w.webContents.send('hf:achievement', { ...a, soundOn: settings.notifySounds !== false });
}

let lastMailPopup = null;
let bonfireSeen = { at: 0, open: false };
async function bonfireOpen() {
  if (Date.now() - bonfireSeen.at < 5000) return bonfireSeen.open;
  let open = false;
  try { open = !!(await velora.api('/chat/open', { timeout: 3000 })).open; } catch { open = false; }
  bonfireSeen = { at: Date.now(), open };
  return open;
}
function callLinePlain(body, caller) {
  const m = /^\[Voice call\] (.+)$/.exec(String(body || '').trim());
  if (!m) return null;
  const what = m[1].trim();
  if (/^missed (a )?call$/i.test(what)) return `You missed a call from ${caller}`;
  if (/^started a call$/i.test(what)) return 'started a call';
  const ended = /^call ended(?: - (.+))?$/i.exec(what);
  return ended ? (ended[1] ? `Call ended - ${ended[1]}` : 'Call ended') : what;
}
async function onImPush(msg) {
  const from = msg.system ? 'System' : msg.from || 'Someone';
  const raw = String(msg.body || '');
  const join = from !== 'System' && JOIN_RE.exec(raw);
  if (join) {
    const g = findApp(join[1]);
    notify({
      kind: 'invite', title: from, image: msg.pfp || velora.friends.get(from)?.pfp || '', presence: presenceOf(from), sound: 'message', duration: 15000,
      body: `invited you to play ${g?.name || 'a game'} - click to join!`, highlight: g?.name, action: { type: 'join', app: join[1], code: join[2] || '', from },
    });
    return;
  }
  if (/^\[Voice call\] started a call$/i.test(raw.trim())) return;
  if (await bonfireOpen()) return;
  const body = callLinePlain(raw, from) || raw.replace(/\s*hyperfocus:\/\/voice\/\S+/gi, '').trim();
  lastMailPopup = { id: msg.id, until: Date.now() + 9000 };
  notify({
    kind: 'mail', title: from, image: msg.pfp || velora.friends.get(from)?.pfp || '', presence: presenceOf(from), sound: 'message', duration: 9000,
    body, action: { type: 'mail', id: msg.id },
  });
}
const presenceOverrides = new Map();
const media = new MediaControls();
media.on('update', s => { if (overlayWin && !overlayWin.isDestroyed()) overlayWin.webContents.send('hf:media', s); });
function logBridge(line) {
  const file = path.join(DATA, 'bridge.log');
  try { if (fs.statSync(file).size > 256 * 1024) fs.renameSync(file, `${file}.old`); } catch {}
  fs.appendFile(file, `${new Date().toISOString()} ${line}\n`, () => {});
}
const askingOrigins = new Set();
function askBridgeOrigin(site) {
  if (askingOrigins.has(site)) return;
  askingOrigins.add(site);
  const host = site.replace(/^https?:\/\//, '');
  notify({ kind: 'launcher', title: 'Hyperfocus blocks', body: `${host} wants to use the Hyperfocus blocks - answer the popup`, image: 'icon', sound: 'warning' });
  dialog.showMessageBox({
    type: 'question', buttons: ['Allow', 'Block'], defaultId: 0, cancelId: 1, noLink: true, title: 'Hyperfocus',
    message: `${host} wants to use the Hyperfocus blocks`,
    detail: "It'll be able to see your Nookara username, picture, colour and rank, turn friend invites on for the game you're playing, and open your friends list.\n\nOnly allow sites you make games with (like the PenguinMod or TurboWarp editor). You can change this later in settings > game blocks.",
  }).then(({ response }) => {
    settings.bridgeOrigins = { ...(settings.bridgeOrigins || {}), [site]: response === 0 };
    saveSettings();
    push();
    logBridge(`${site} ${response === 0 ? 'allowed' : 'blocked'} by the user`);
  }).catch(() => {}).finally(() => askingOrigins.delete(site));
}

const inviteState = new Map();
const pendingJoins = new Map();
let joinSeq = 0;
const JOIN_TTL = 30 * 60 * 1000;
const APP_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;
const INVITE_CODE_RE = /^[A-Za-z0-9_-]{1,64}$/;
const JOIN_RE = /hyperfocus:\/\/join\/([A-Za-z0-9._-]{1,64})(?:\/([A-Za-z0-9_-]{1,64}))?/i;
function invitableGame() {
  const devBridgeNoGame = settings.devMode && settings.devBridgeNoGame;
  const candidates = [...new Set([currentGame, ...running.keys(), ...(devBridgeNoGame ? inviteState.keys() : [])])];
  const id = candidates.find(x => x && (running.has(x) || devBridgeNoGame) && inviteState.get(x)?.enabled);
  if (!id) return null;
  const a = findApp(id);
  return { id, name: a?.name || id, icon: a?.icon || '', code: inviteState.get(id).code || '' };
}
function sendInviteState() { sendAll('gameInvite', invitableGame()); }
async function sendGameInvite(to) {
  const g = invitableGame();
  if (!g) throw new Error("The game you're playing isn't taking invites right now.");
  if (!account) throw new Error('Log in with Nookara first.');
  await velora.sendMail(to, '', `🎮 ${account.username} invited you to play ${g.name}! hyperfocus://join/${g.id}${g.code ? `/${g.code}` : ''}`);
}
async function joinGame(appId, code, from, kind = 'invite') {
  appId = String(appId || '');
  code = String(code || '');
  kind = kind === 'join' ? 'join' : 'invite';
  if (!APP_ID_RE.test(appId) || (code && !INVITE_CODE_RE.test(code))) throw new Error("That invite link doesn't look right.");
  if (!manifest) await refreshManifest();
  let a = findApp(appId);
  if (!a && /^c-[a-z0-9]{8}$/.test(appId)) { await addCommunityGame(appId.slice(2)); a = findApp(appId); }
  if (!a) { showWin(); toast("You don't have that game in your Hyperfocus library.", 'err'); return; }
  from = String(from || '').slice(0, 64);
  pendingJoins.set(appId, { code, from, seq: ++joinSeq, at: Date.now(), kind });
  if (running.has(appId)) {
    notify({ kind: 'invite', title: a.name || appId, image: a.icon, body: `Joining ${from ? `${from}'s` : 'the'} game...` });
    return;
  }
  showWin();
  send('selectApp', appId);
  const st = statusOf(a);
  const releaseReady = st === 'ready';
  const ba = installedBetas[appId] ? betaApp(appId) : null;
  const betaSt = ba ? statusOf(ba) : null;
  const betaReady = betaSt === 'ready';
  if (releaseReady && betaReady) {
    const rv = String(installed[appId]?.version || a.version || '').trim(), bv = String(installedBetas[appId]?.version || ba.version || '').trim();
    const choice = await askJoinWhich(a, ba, kind, from, rv && rv !== '0' ? `Release v${rv}` : 'Release', `${ba.beta.name}${bv && bv !== '0' ? ` v${bv}` : ''}`);
    if (choice === 'cancel') return;
    if (running.has(appId)) return;
    await launchApp(choice === 'beta' ? appId + BETA : appId);
  } else if (releaseReady) await launchApp(appId);
  else if (betaReady) await launchApp(appId + BETA);
  else if (betaSt === 'update' || betaSt === 'repair') toast(`${a.name || appId} (${ba.beta.name}) needs ${betaSt === 'repair' ? 'a repair' : 'an update'} first - the ${kind} waits 30 minutes for you.`);
  else toast(`${a.name || appId} needs ${st === 'buy' ? 'buying' : st === 'install' ? 'installing' : st === 'update' ? 'an update' : st === 'repair' ? 'a repair' : st === 'soon' ? 'its release' : 'a moment'} first - the ${kind} waits 30 minutes for you.`);
}
const joinAsks = new Map();
function askJoinWhich(a, ba, kind, from, releaseLabel, betaLabel) {
  for (const [rid, r] of joinAsks) { joinAsks.delete(rid); r('cancel'); }
  const reqId = crypto.randomBytes(6).toString('hex');
  showWin();
  send('joinWhich', { reqId, id: a.id, name: a.name || a.id, icon: a.icon || '', kind, from, releaseLabel, betaLabel });
  return new Promise(resolve => joinAsks.set(reqId, resolve));
}
async function joinFriend(name) {
  name = String(name || '').trim();
  if (!account) throw new Error('Log in with Nookara first.');
  const f = [...velora.friends.values()].find(x => x.username.toLowerCase() === name.toLowerCase());
  let act = f?.activity?.joinable && f.activity.joinCode ? f.activity : null;
  if (!act && name) {
    const p = await velora.getPublic(`/hyperfocus/profile/${encodeURIComponent(name)}`).catch(() => null);
    if (p?.playing?.joinable && p.playing.joinCode) act = { appId: p.playing.id, name: p.playing.name, joinable: true, joinCode: p.playing.joinCode };
  }
  const who = f?.username || name;
  if (!act) throw new Error(`${who} isn't in a game you can join right now.`);
  const appId = String(act.appId || ''), code = String(act.joinCode || '');
  if (!APP_ID_RE.test(appId) || !INVITE_CODE_RE.test(code)) throw new Error("Their game's join code doesn't look right.");
  const a = findApp(appId);
  const mine = !!a && (a.community ? (settings.community || []).includes(a.communityId) : settings.library.includes(appId) || !!installed[appId] || !!installedBetas[appId]);
  if (!mine) {
    pendingJoins.set(appId, { code, from: who, seq: ++joinSeq, at: Date.now(), kind: 'join' });
    showWin();
    send(a ? 'selectApp' : 'storePage', appId);
    toast(`${who} is playing ${a?.name || act.name || 'a game'} - you need it to join. Get it, then press Play within 30 minutes to join them.`);
    return { needsGame: true };
  }
  await joinGame(appId, code, who, 'join');
  return { joined: true };
}
function startGameBridge() {
  const server = http.createServer(async (req, res) => {
    const reply = (code, obj) => {
      if (!(req.method === 'GET' && /\/(status|invite)(\?|$)/.test(req.url || ''))) {
        logBridge(`${req.method} ${req.url} -> ${code}${obj?.error ? ` ${obj.error}` : ''} (origin: ${req.headers.origin || 'none'})`);
      }
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(req.headers.host || '')) return reply(403, { ok: false, error: 'forbidden' });
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const url = new URL(req.url, `http://127.0.0.1:${BRIDGE_PORT}`);

    if (req.method === 'GET' && url.pathname === '/hyperfocus/status') {
      return reply(200, { ok: true, hyperfocus: true, version: app.getVersion(), running: [...running.keys()], currentGame, devNoGame: !!(settings.devMode && settings.devBridgeNoGame) });
    }

    const p = url.pathname;
    const achPath = p === '/hyperfocus/achievements' || p === '/hyperfocus/achievements/grant' || p === '/hyperfocus/achievements/revoke';
    if (p === '/hyperfocus/user' || p === '/hyperfocus/friends/open' || p.startsWith('/hyperfocus/invite') || achPath || p === '/hyperfocus/notify') {
      const origin = String(req.headers.origin || '');
      if (/^https?:\/\//i.test(origin) && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
        let site;
        try { site = new URL(origin).origin.toLowerCase(); } catch { return reply(403, { ok: false, error: 'forbidden' }); }
        const verdict = settings.bridgeOrigins?.[site];
        if (verdict !== true) {
          if (verdict === undefined) askBridgeOrigin(site);
          return reply(403, verdict === false
            ? { ok: false, error: 'site_blocked', hint: 'unblock it in Hyperfocus: settings > game blocks' }
            : { ok: false, error: 'needs_permission', hint: 'click Allow in the Hyperfocus popup, then try again' });
        }
      }
      let msg = {};
      if (req.method === 'POST') {
        let raw = '';
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > 4096) return reply(413, { ok: false, error: 'too_big' });
        }
        try { msg = JSON.parse(raw || '{}') || {}; } catch { return reply(400, { ok: false, error: 'bad_json' }); }
      }
      let id = String(msg.game || url.searchParams.get('game') || '') || (running.size === 1 ? [...running.keys()][0] : currentGame);
      if (/^[a-z0-9]{8}$/.test(id) && !running.has(id) && (running.has(`c-${id}`) || findApp(`c-${id}`))) id = `c-${id}`;
      if (p.startsWith('/hyperfocus/invite') && (!id || (!running.has(id) && !(settings.devMode && settings.devBridgeNoGame)))) {
        return reply(409, { ok: false, error: 'not_running', hint: settings.devMode && settings.devBridgeNoGame
          ? 'set this game\'s Hyperfocus ID in the extension first'
          : 'launch the game from Hyperfocus' });
      }
      if (p === '/hyperfocus/notify') {
        if (req.method !== 'POST') return reply(405, { ok: false, error: 'post_only' });
        let game = String(msg.game || '') || (running.size === 1 ? [...running.keys()][0] : running.has(currentGame) ? currentGame : '');
        if (/^[a-z0-9]{8}$/.test(game) && !running.has(game) && (running.has(`c-${game}`) || findApp(`c-${game}`))) game = `c-${game}`;
        if (!running.has(game) && !(settings.devMode && settings.devBridgeNoGame)) return reply(409, { ok: false, error: 'not_running', hint: 'launch the game from Hyperfocus' });
        const now = Date.now();
        if (now - (bridgeNotifyAt.get(game) || 0) < 1500) return reply(429, { ok: false, error: 'too_fast', hint: 'one notification every 1.5 seconds' });
        bridgeNotifyAt.set(game, now);
        const g = findApp(game) || findApp(`c-${game}`);
        const title = String(msg.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) || g?.name || 'Hyperfocus';
        const body = String(msg.text ?? msg.body ?? '').replace(/\s+/g, ' ').trim().slice(0, 240);
        notify({ kind: 'game', title, body, image: g?.icon || 'icon', sound: 'warning', action: g ? { type: 'app', id: g.id } : undefined });
        return reply(200, { ok: true, game });
      }
      if (achPath) {
        let game = String(msg.game || url.searchParams.get('game') || '') || (running.size === 1 ? [...running.keys()][0] : running.has(currentGame) ? currentGame : '');
        if (/^[a-z0-9]{8}$/.test(game) && !findApp(game) && findApp(`c-${game}`)) game = `c-${game}`;
        if (!game) return reply(400, { ok: false, error: 'no_game', hint: "set the game's ID with \"this game's Hyperfocus ID is [ID]\"" });
        if (!running.has(game) && !(settings.devMode && settings.devBridgeNoGame)) {
          return reply(409, { ok: false, error: 'not_running', hint: 'launch the game from Hyperfocus (or turn on settings > developer > allow connections when no game is open)' });
        }
        if (!account) return reply(401, { ok: false, error: 'not_logged_in', hint: 'log in to Nookara in Hyperfocus' });
        const ach = String(msg.achievement || msg.id || '').trim();
        const op = req.method === 'GET' ? 'get' : p.endsWith('/grant') ? 'grant' : 'revoke';
        if (op !== 'get' && !/^[A-Za-z0-9_.-]{1,64}$/.test(ach)) return reply(400, { ok: false, error: 'bad_achievement_id' });
        try {
          if (offlineMode) throw Object.assign(new Error('offline'), { status: 0 });
          if (op === 'get') {
            const j = await velora.api(`/achievements?game=${encodeURIComponent(game)}`);
            const list = j.achievements || {};
            for (const q of achPending) if (list[q.id]) Object.assign(list[q.id], q.op === 'grant' ? { unlocked: true, unlockedAt: q.at } : { unlocked: false, unlockedAt: null });
            return reply(200, { ok: true, game, achievements: list });
          }
          const j = await velora.api(`/achievements/${encodeURIComponent(ach)}/${op}`, { method: 'POST', body: { game } });
          return reply(200, { ok: true, game, ...j });
        } catch (e) {
          if (!veloraUnreachable(e)) return reply(e.status || 502, { ok: false, error: e.code || 'velora_error', hint: e.message });
          const defs = findApp(game)?.achievements;
          if (op === 'get') {
            const out = {};
            for (const [id, d] of Object.entries(defs && typeof defs === 'object' ? defs : {})) {
              const at = achUnlocked[id] || null, masked = d.hidden && !at;
              out[id] = { name: masked ? 'Hidden Achievement' : d.name, description: masked ? 'Earn this to view it!' : d.description || '', icon: masked ? '' : d.icon || '', rarity: d.rarity === 'rare' ? 'rare' : 'common', hidden: !!d.hidden, game, unlocked: !!at, unlockedAt: at };
            }
            return reply(200, { ok: true, game, offline: true, achievements: out });
          }
          if (defs && typeof defs === 'object' && !defs[ach]) return reply(404, { ok: false, error: 'achievement_not_found' });
          if (op === 'grant') {
            if (achUnlocked[ach]) return reply(200, { ok: true, game, offline: true, new: false });
            const full = { ...localAchievement(game, ach), unlockedAt: Date.now() };
            queueAch('grant', game, ach);
            achUnlocked = { ...achUnlocked, [ach]: full.unlockedAt };
            push();
            showAchievement(full);
            return reply(200, { ok: true, game, offline: true, queued: true, new: true, achievement: full });
          }
          queueAch('revoke', game, ach);
          const next = { ...achUnlocked }; delete next[ach]; achUnlocked = next;
          push();
          return reply(200, { ok: true, game, offline: true, queued: true, revoked: true });
        }
      }
      if (req.method === 'GET' && p === '/hyperfocus/user') {
        return reply(200, { ok: true, loggedIn: !!account, username: account?.username || '', pfp: account?.pfp || '', color: account?.color || '', rank: account?.rank || '' });
      }
      if (req.method === 'GET' && p === '/hyperfocus/invite') {
        const inv = pendingJoins.get(id);
        if (inv && Date.now() - inv.at > JOIN_TTL) pendingJoins.delete(id);
        const cur = pendingJoins.get(id);
        return reply(200, { ok: true, invite: cur ? { code: cur.code, from: cur.from, seq: cur.seq, kind: cur.kind || 'invite' } : null, invites: inviteState.get(id) || { enabled: false, code: '', joinable: false } });
      }
      if (req.method !== 'POST') return reply(405, { ok: false, error: 'use_post' });
      if (p === '/hyperfocus/invite/clear') { pendingJoins.delete(id); return reply(200, { ok: true }); }
      if (p === '/hyperfocus/invites') {
        const cur = { enabled: false, code: '', joinable: false, ...(inviteState.get(id) || {}) };
        if ('enabled' in msg) cur.enabled = !!msg.enabled;
        if ('joinable' in msg) cur.joinable = !!msg.joinable;
        if ('code' in msg) {
          const code = String(msg.code ?? '').trim();
          if (code && !INVITE_CODE_RE.test(code)) return reply(400, { ok: false, error: 'bad_code', hint: 'letters, numbers, - and _ only (up to 64)' });
          cur.code = code;
        }
        inviteState.set(id, cur);
        sendInviteState();
        if (id === currentGame && running.has(id)) velora.setActivity(activityFor(id));
        return reply(200, { ok: true, invites: cur });
      }
      if (p === '/hyperfocus/friends/open') { openPanel('friends', '', { overGame: true }); return reply(200, { ok: true }); }
      return reply(404, { ok: false, error: 'not_found' });
    }
    if (req.method !== 'POST' || !url.pathname.startsWith('/hyperfocus/presence')) return reply(404, { ok: false, error: 'not_found' });

    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 4096) return reply(413, { ok: false, error: 'too_big' });
    }
    let msg;
    try { msg = JSON.parse(body || '{}'); } catch { return reply(400, { ok: false, error: 'bad_json' }); }

    let id = msg.game ? String(msg.game) : running.size === 1 ? [...running.keys()][0] : currentGame;
    if (/^[a-z0-9]{8}$/.test(id) && !running.has(id) && (running.has(`c-${id}`) || findApp(`c-${id}`))) id = `c-${id}`;
    const devNoGame = settings.devMode && settings.devBridgeNoGame && !(id && running.has(id));
    if (devNoGame) { id = String(msg.game || '__dev__').slice(0, 64); devPresenceId = id; }
    else if (!id || !running.has(id)) return reply(409, { ok: false, error: 'not_running', hint: 'launch the game from Hyperfocus' });

    if (url.pathname === '/hyperfocus/presence/reset') {
      presenceOverrides.delete(id);
      if (devNoGame) devPresenceId = null;
    } else {
      const ov = { ...(presenceOverrides.get(id) || {}) };
      if ('state' in msg) ov.state = String(msg.state ?? '').slice(0, 128);
      if ('status' in msg) ov.status = String(msg.status ?? '').replace(/\s+/g, ' ').trim().slice(0, 128);
      if ('appId' in msg) {
        const appId = String(msg.appId ?? '').trim();
        if (appId && !/^\d{15,22}$/.test(appId)) return reply(400, { ok: false, error: 'bad_app_id' });
        ov.clientId = appId || undefined;
      }
      presenceOverrides.set(id, ov);
    }
    updateDiscordPresence();
    if (id === currentGame) velora.setActivity(activityFor(id));
    return reply(200, { ok: true, game: id, presence: presenceOverrides.get(id) || null });
  });
  server.on('error', e => console.log(`[hyperfocus] game bridge unavailable on port ${BRIDGE_PORT}: ${e.code}`));
  server.listen(BRIDGE_PORT, '127.0.0.1');
}

function activityFor(id) {
  const a = findApp(id) || { id, name: id };
  return {
    appId: id, name: a.name || id, icon: /^https:\/\//i.test(a.icon || '') ? a.icon : '', type: a.type === 'Game' ? 'Game' : 'App',
    state: presenceOverrides.get(id)?.status || '',
    ...(inviteState.get(id)?.joinable && inviteState.get(id)?.code ? { joinable: true, joinCode: inviteState.get(id).code } : {}),
  };
}

let pendingProtocol = null;
let devPresenceId = null;
const bridgeNotifyAt = new Map();
function protocolTarget(argv) {
  const url = (argv || []).find(a => /^hyperfocus:\/\//i.test(String(a)));
  const m = url && /^hyperfocus:\/\/play\/([^/?#]+)/i.exec(url);
  return m ? decodeURIComponent(m[1]) : null;
}
function protocolVoice(argv) {
  const url = (argv || []).find(a => /^hyperfocus:\/\/voice\//i.test(String(a)));
  const m = url && /^hyperfocus:\/\/voice\/([A-Za-z0-9_-]{1,64})/i.exec(url);
  return m ? m[1] : null;
}
function protocolAdd(argv) {
  const url = (argv || []).find(a => /^hyperfocus:\/\/add\//i.test(String(a)));
  const m = url && /^hyperfocus:\/\/add\/([a-z0-9]{8})/i.exec(url);
  return m ? m[1].toLowerCase() : null;
}
function protocolJoin(argv) {
  const url = (argv || []).find(a => /^hyperfocus:\/\/join\//i.test(String(a)));
  const m = url && JOIN_RE.exec(url);
  return m ? { app: m[1], code: m[2] || '' } : null;
}
function protocolBeta(argv) {
  const url = (argv || []).find(a => /^hyperfocus:\/\/beta\//i.test(String(a)));
  const m = url && /^hyperfocus:\/\/beta\/([A-Za-z0-9-]{4,24})/i.exec(url);
  return m ? m[1] : null;
}
const PROTOCOL_VERBS = new Set(['play', 'voice', 'add', 'join', 'beta']);
function protocolSelect(argv) {
  const url = (argv || []).find(a => /^hyperfocus:\/\//i.test(String(a)));
  const m = url && /^hyperfocus:\/\/([^/?#]+)\/?(?:[?#].*)?$/i.exec(url);
  if (!m) return null;
  const id = decodeURIComponent(m[1]);
  return PROTOCOL_VERBS.has(id.toLowerCase()) ? null : id;
}
function handleProtocolArgs(argv) {
  openFromProtocol(protocolTarget(argv), true);
  openFromProtocol(protocolSelect(argv), false);
  const join = protocolJoin(argv);
  if (join) joinGame(join.app, join.code, '').catch(e => toast(e.message, 'err'));
  const add = protocolAdd(argv);
  if (add) addCommunityGame(add).catch(e => toast(e.message, 'err'));
  const room = protocolVoice(argv);
  if (room) { showWin(); voiceCmd({ op: 'join', room }).catch(e => toast(e.message, 'err')); }
  const betaCode = protocolBeta(argv);
  if (betaCode) {
    showWin();
    redeemCode(betaCode).then(r => toast(r.kind === 'key' ? `${r.app.name} is in your library!` : `You're in the ${r.beta.name} beta${r.app.name ? ` for ${r.app.name}` : ''}!`, 'ok')).catch(e => toast(e.message, 'err'));
  }
}
function openFromProtocol(id, launch = true) {
  if (!id) return;
  if (!manifest) { pendingProtocol = { id, launch }; return; }
  pendingProtocol = null;
  showWin();
  const lower = String(id).toLowerCase();
  const a = findApp(id) || (manifest.apps || []).find(x => [lower, `c-${lower}`].includes(String(x.id).toLowerCase()));
  if (!a) { toast(`"${id}" isn't in your Hyperfocus library.`, 'err'); return; }
  id = a.id;
  send('selectApp', id);
  if (!launch) return;
  const st = statusOf(a);
  if (st === 'ready' || st === 'external') launchApp(id).catch(e => toast(e.message, 'err'));
  else if (st === 'buy') toast(`${a.name || id} costs ${a.price} credits - hit Buy to get it!`);
  else if (st === 'soon') toast(`${a.name || id} isn't out yet - it's coming soon!`);
  else if (st === 'winonly') toast(`${a.name || id} only comes for Windows - there's no Mac version yet.`);
  else if (st === 'install' || st === 'update' || st === 'repair') toast(`${a.name || id} needs ${st === 'install' ? 'installing' : st === 'repair' ? 'a repair' : 'an update'} first - hit the button!`);
}

function presenceOf(name) {
  const key = String(name || '').toLowerCase();
  const f = velora.friends.get(name) || [...velora.friends.values()].find(x => x.username.toLowerCase() === key);
  if (!f) return null;
  return f.activity ? 'playing' : f.online ? 'online' : 'offline';
}

function wireVelora() {
  velora.on('change', () => { pushSoon(); sendAll('social', socialView()); });
  velora.on('friend_online', f => {
    if (!settings.friendOnlinePopups) return;
    notify({ kind: 'friend', title: f.username, body: 'is now online', image: f.pfp, presence: f.activity ? 'playing' : 'online', sound: 'friend', action: { type: 'messages' } });
  });
  velora.on('friend_activity', f => notify({
    kind: 'friendplay', title: f.username, image: f.pfp, presence: 'playing', sound: 'friend', action: { type: 'messages' },
    body: `${f.activity.type === 'Game' ? 'started playing' : 'launched'} ${f.activity.name}`, highlight: f.activity.name,
  }));
  velora.on('im', ({ message, mine }) => {
    sendAll('im', { message });
    if (!mine) onImPush(message).catch(() => {});
  });
  velora.on('im_edited', d => sendAll('imEdited', d));
  velora.on('im_reactions', d => sendAll('imReactions', d));
  velora.on('scope_error', e => sendAll('imError', e.text));
  velora.on('dm_typing', d => sendAll('typing', d));
  velora.on('achievement', a => {
    const seen = achSilent.has(a.id);
    achUnlocked = { ...achUnlocked, [a.id]: achUnlocked[a.id] || a.unlockedAt || Date.now() };
    push();
    if (!seen) showAchievement(a);
  });
  velora.on('achievement_revoked', id => { const next = { ...achUnlocked }; delete next[id]; achUnlocked = next; push(); });
  velora.on('group_message', async m => {
    sendAll('groupMessage', m);
    if (m.system || !m.user || m.user.toLowerCase() === String(account?.username || '').toLowerCase()) return;
    if (await bonfireOpen()) return;
    notify({
      kind: 'mail', kicker: m.group || 'group chat', title: m.user, image: userInfo(m.user).pfp, presence: presenceOf(m.user), sound: 'message', duration: 9000,
      body: String(m.body || '').replace(/\s*hyperfocus:\/\/voice\/\S+/gi, '').trim(), action: { type: 'messages' },
    });
  });
  velora.on('group_update', g => sendAll('groupUpdate', { group: g }));
  velora.on('group_removed', room => sendAll('groupUpdate', { removed: room }));
  velora.on('restrictions', r => {
    if (account) setAccount({ ...account, disabled: r.disabled, scopes: r.scopes });
    sendAll('social', socialView());
    push();
  });
  velora.on('voice_call', async c => {
    if (await bonfireOpen()) return;
    notify({
      kind: 'call', title: c.from, body: /^bfc_/.test(c.room) ? 'is calling you' : /^bf_/.test(c.room) ? 'is calling you into a Bonfire voice channel' : 'is calling you into voice chat', image: userInfo(c.from).pfp, presence: presenceOf(c.from),
      sound: 'call', soundLoop: true, sticky: true, duration: 30000, tag: `call-${c.callId}`,
      buttons: [
        { label: 'answer', action: { type: 'callAnswer', callId: c.callId, accept: true } },
        { label: 'hang up', danger: true, action: { type: 'callAnswer', callId: c.callId, accept: false } },
      ],
    });
  });
  velora.on('voice_call_accepted', c => { voiceCmd({ op: 'join', room: c.room, fromCall: true }).catch(e => toast(e.message, 'err')); });
  velora.on('voice_call_ended', c => notifyDismiss(`call-${c.callId}`));
  velora.on('store_changed', () => refreshManifest());
  velora.on('friend_request', ({ from }) => notify({
    kind: 'friendreq', title: from, body: 'sent you a friend request', image: userInfo(from).pfp, presence: presenceOf(from), sound: 'friend', action: { type: 'profile', name: from },
  }));
  velora.on('friend_accepted', ({ by }) => notify({
    kind: 'friend', kicker: 'new friend', icon: 'userPlus', title: by, body: 'accepted your friend request', image: userInfo(by).pfp,
    presence: presenceOf(by) || 'online', sound: 'friend', action: { type: 'profile', name: by },
  }));
  velora.on('auth_error', () => validateSession().then(push));
}

let loginFlow = null;
function loginInbox(flow) {
  const secret = `/${crypto.randomBytes(24).toString('hex')}`;
  const page = `<!doctype html><meta charset="utf-8"><title>Hyperfocus</title><body style="margin:0;display:grid;place-items:center;height:100vh;background:#0e0e10;color:#e7e7ea;font:15px system-ui,sans-serif"><p id="m">Signing in to Hyperfocus...</p><script>
const h=new URLSearchParams(location.hash.slice(1));history.replaceState(null,'',location.pathname);
fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:h.get('nookara_code'),grant:h.get('nookara_grant')})})
.then(r=>{document.getElementById('m').textContent=r.ok?"You're signed in. You can close this tab and go back to Hyperfocus.":"That didn't work. Go back to Hyperfocus and try again."})
.catch(()=>{document.getElementById('m').textContent="That didn't work. Go back to Hyperfocus and try again."});
</script>`;
  const server = http.createServer((req, res) => {
    if (req.url !== secret) { res.writeHead(404); res.end(); return; }
    if (req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); res.end(page); return; }
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
    let body = '';
    req.on('data', d => { if (body.length < 2048) body += d; });
    req.on('end', async () => {
      let ok = false;
      try {
        const { code, grant } = JSON.parse(body);
        if (code && code === flow.code && grant) {
          const x = await fetch(`${VELORA}/auth/ext-code/exchange`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, grant }), signal: AbortSignal.timeout(12000) });
          const j = await x.json();
          if (x.ok && j.token) { flow.token = j.token; ok = true; }
        }
      } catch {}
      res.writeHead(ok ? 200 : 400); res.end();
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', () => reject(new Error("Couldn't start the sign-in on this computer.")));
    server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}${secret}`, close: () => setTimeout(() => server.close(), 3000).unref?.() }));
  });
}
async function loginStart() {
  if (loginFlow) loginFlow.cancelled = true;
  const flow = { cancelled: false };
  loginFlow = flow;
  const inbox = await loginInbox(flow);
  const res = await fetch(`${VELORA}/auth/ext-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: VELORA_APP_ID, redirect_uri: inbox.url }),
    signal: AbortSignal.timeout(12000),
  }).catch(() => null);
  if (!res || !res.ok) { inbox.close(); throw new Error("Couldn't reach Nookara right now."); }
  const { code } = await res.json();
  flow.code = code;
  const url = `${VELORA}/login?code=${encodeURIComponent(code)}`;
  flow.url = url;
  await shell.openExternal(url);

  (async () => {
    const until = Date.now() + 5 * 60 * 1000;
    while (!flow.cancelled && Date.now() < until) {
      await sleep(1500);
      if (flow.cancelled) { inbox.close(); return; }
      try {
        if (flow.token) {
          inbox.close();
          saveToken(flow.token);
          velora.stop();
          await validateSession();
          refreshManifest();
          push();
          send('login', { state: 'done' });
          loginFlow = null;
          showWin();
          return;
        }
        const s = await fetch(`${VELORA}/auth/ext-code/status?code=${encodeURIComponent(code)}`, { signal: AbortSignal.timeout(10000) });
        if (s.status === 404 && !flow.token) break;
        const j = await s.json();
        send('login', { state: 'waiting', alive: j.alive !== false });
      } catch {}
    }
    inbox.close();
    if (!flow.cancelled) send('login', { state: 'expired' });
    if (loginFlow === flow) loginFlow = null;
  })();
  return { url };
}

async function resolveMusic(url) {
  if (!url) return [];
  let u;
  try { u = new URL(url); } catch { return []; }
  if (!/^https?:$/.test(u.protocol)) return [];
  if (!u.pathname.toLowerCase().endsWith('.json')) return [u.href];
  const res = await fetch(u.href, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  const list = await res.json();
  const arr = Array.isArray(list) ? list : Array.isArray(list?.tracks) ? list.tracks : [];
  return arr
    .map(t => (typeof t === 'string' ? t : t?.url))
    .filter(Boolean)
    .map(t => { try { return new URL(t, u.href).href; } catch { return null; } })
    .filter(Boolean);
}

const fades = new WeakMap();
function fadeWindow(w, to, ms = 180) {
  return new Promise(resolve => {
    if (!w || w.isDestroyed()) return resolve();
    const prev = fades.get(w);
    if (prev) { clearInterval(prev.timer); prev.done(); }
    const from = w.getOpacity(), t0 = Date.now();
    const state = { done: resolve };
    state.timer = setInterval(() => {
      if (w.isDestroyed()) { clearInterval(state.timer); fades.delete(w); return resolve(); }
      const t = Math.min(1, (Date.now() - t0) / ms);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      w.setOpacity(from + (to - from) * e);
      if (t >= 1) { clearInterval(state.timer); fades.delete(w); resolve(); }
    }, 8);
    fades.set(w, state);
  });
}
const fade = (to, ms) => fadeWindow(win, to, ms);
async function fadeIn() {
  send('fx', 'in');
  send('visible', true);
  await fade(1, 220);
}
async function minimizeWin() {
  if (!win || win.isMinimized()) return;
  send('fx', 'out');
  await fade(0, 170);
  win.minimize();
  send('visible', false);
  updateDiscordPresence();
}
async function hideWin() {
  if (!win || !win.isVisible()) return;
  send('fx', 'out');
  await fade(0, 170);
  win.hide();
  send('visible', false);
  updateDiscordPresence();
}
function showWin() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  else if (!win.isVisible()) { win.setOpacity(0); win.show(); fadeIn(); }
  else if (win.getOpacity() < 1) fadeIn();
  win.focus();
  updateDiscordPresence();
}
function bringToFront() {
  if (!win || win.isDestroyed()) return;
  showWin();
  win.setAlwaysOnTop(true, 'screen-saver');
  win.moveTop();
  win32.forceForeground(win.getNativeWindowHandle());
  if (IS_MAC) app.focus({ steal: true });
  win.focus();
  setTimeout(() => { if (win && !win.isDestroyed()) win.setAlwaysOnTop(false); }, 400);
}

function padList() {
  return [...xinput.list().map(p => ({ name: p.name, xinput: true })), ...[...extraPads.values()].map(name => ({ name }))];
}
const padsStartedAt = Date.now();
function padPopup(name, connected) {
  if (Date.now() - padsStartedAt < 3000) return;
  notify({
    kind: connected ? 'controller' : 'controllerOff', title: name || 'Controller',
    body: connected ? 'connected' : 'disconnected', image: 'controller', sound: connected ? 'padOn' : 'padOff',
  });
}
function onGuide() {
  if (overlayShown) return hideOverlay();
  if (running.size) return showOverlay({ force: true });
  bringToFront();
}
function wirePads() {
  xinput.on('connect', p => { padPopup(p.name, true); push(); });
  xinput.on('disconnect', p => { padPopup(p.name, false); push(); });
  xinput.on('guide', onGuide);
  xinput.start();
}
function padSeen({ key, name, connected }) {
  key = String(key || '').slice(0, 200);
  if (!key) return;
  if (connected && !extraPads.has(key)) { extraPads.set(key, String(name || 'Controller').slice(0, 80)); padPopup(extraPads.get(key), true); }
  else if (!connected && extraPads.has(key)) { const n = extraPads.get(key); extraPads.delete(key); padPopup(n, false); }
  push();
}

function setConsoleMode(on) {
  on = !!on;
  if (!win || win.isDestroyed() || on === consoleMode) return consoleMode;
  if (on) {
    consoleSaved = win.getBounds();
    showWin();
    win.setResizable(true);
    win.setBounds(screen.getDisplayMatching(consoleSaved).bounds);
    win.setResizable(false);
  } else {
    win.setResizable(true);
    win.setBounds(consoleSaved || { width: 1280, height: 740 });
    win.setResizable(false);
    if (!consoleSaved) win.center();
  }
  consoleMode = on;
  push();
  return on;
}

function closeGame(id) {
  id = id || currentGame;
  const child = running.get(id);
  if (!child) throw new Error("That isn't running.");
  if (overlayShown) hideOverlay({ refocus: false });
  if (IS_MAC) {
    const sig = sg => { try { process.kill(-child.pid, sg); } catch { try { child.kill(sg); } catch {} } };
    sig('SIGTERM');
    setTimeout(() => { if (running.get(id) === child) sig('SIGKILL'); }, 5000);
    return true;
  }
  const k = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  k.on('error', () => { try { child.kill(); } catch {} });
  return true;
}
async function quitApp() {
  send('fx', 'out');
  if (win && win.isVisible() && !win.isMinimized()) await fade(0, 170);
  quitting = true;
  discordPresence.disconnect();
  app.quit();
}
async function requestClose(force) {
  if (settings.closeAction === 'tray') { await hideWin(); return { hidden: true }; }
  const busy = [...jobs.values()].some(j => j.phase !== 'paused');
  if (busy && !force) return { confirm: true };
  await quitApp();
  return { quit: true };
}

const webPrefs = () => ({ preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, spellcheck: false });
const page = name => path.join(__dirname, 'renderer', name);
function lockNavigation(w) {
  w.webContents.setWindowOpenHandler(({ url }) => { openExternalSafe(url); return { action: 'deny' }; });
  w.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); openExternalSafe(url); } });
}

const NOTIF_W = 380, NOTIF_H = 560;
let notifWin = null, notifReady = null, notifSeq = 0, lastNotifyAt = 0;
function ensureNotifWin() {
  if (notifWin && !notifWin.isDestroyed()) return notifWin;
  notifWin = new BrowserWindow({
    width: NOTIF_W, height: NOTIF_H, frame: false, transparent: true, resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, focusable: false,
    alwaysOnTop: true, show: false, hasShadow: false, backgroundColor: '#00000000', webPreferences: webPrefs(),
  });
  notifWin.setAlwaysOnTop(true, 'screen-saver');
  overFullscreen(notifWin);
  notifWin.setIgnoreMouseEvents(true, { forward: true });
  lockNavigation(notifWin);
  notifReady = new Promise(r => notifWin.webContents.once('did-finish-load', r));
  notifWin.loadFile(page('notify.html'));
  notifWin.on('closed', () => { notifWin = null; });
  return notifWin;
}
async function notify(n) {
  const w = ensureNotifWin();
  await notifReady;
  if (w.isDestroyed()) return;
  lastNotifyAt = Date.now();
  if (!w.isVisible()) {
    const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    w.setBounds({ x: wa.x + wa.width - NOTIF_W - 12, y: wa.y + wa.height - NOTIF_H - 12, width: NOTIF_W, height: NOTIF_H });
    w.showInactive();
  }
  w.moveTop();
  w.webContents.send('hf:notify', { id: ++notifSeq, soundOn: settings.notifySounds !== false, ...n });
}
function notifyDismiss(tag) {
  if (notifWin && !notifWin.isDestroyed()) notifWin.webContents.send('hf:notifyDismiss', String(tag));
}
function onVoiceCallEvent(ev) {
  const who = String(ev?.to || ev?.by || 'They');
  const text = {
    accepted: 'answered - they\'re joining your room', declined: 'declined your call', 'no answer': "didn't answer",
    offline: "isn't online right now", unavailable: "can't take voice calls right now", not_in_voice: 'join a voice room first, then call',
    cancelled: 'call cancelled', invalid_target: "can't be called", too_many_calls: 'too many calls at once',
    not_allowed: "can't be called into this room", not_a_member: "isn't in that Bonfire server", channel_full: 'that voice channel is full',
  }[ev?.result] || String(ev?.result || '');
  if (!text || ev?.result === 'ringing') return;
  notify({ kind: 'voice', title: who, body: text, image: userInfo(who).pfp, sound: ev.result === 'accepted' ? 'voiceJoin' : undefined });
}
function onNotifAction(action) {
  if (!action) return;
  if (action.type === 'mail') { if (overlayShown) showOverlay({ mailId: action.id }); else openMessages(action.id); }
  else if (action.type === 'messages') openMessages();
  else if (action.type === 'profile') openPanel('friends', String(action.name || ''));
  else if (action.type === 'voice') openPanel('voice');
  else if (action.type === 'join') joinGame(action.app, action.code, action.from).catch(e => toast(e.message, 'err'));
  else if (action.type === 'screenshot') { showWin(); send('selectApp', action.id); send('openShot', String(action.file || '')); }
  else if (action.type === 'app') { showWin(); send('selectApp', action.id); }
  else if (action.type === 'callAnswer') velora.answerCall(action.callId, action.accept);
  else showWin();
}

let overlayWin = null, overlayReady = null, overlayShown = false, overlayShownAt = 0, hotkeyReg = null;
let gameHwnd = null;
function ensureOverlayWin() {
  if (overlayWin && !overlayWin.isDestroyed()) return overlayWin;
  overlayWin = new BrowserWindow({
    frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false,
    fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, show: false, hasShadow: false,
    backgroundColor: '#00000000', webPreferences: webPrefs(),
  });
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overFullscreen(overlayWin);
  lockNavigation(overlayWin);
  overlayReady = new Promise(r => overlayWin.webContents.once('did-finish-load', r));
  overlayWin.loadFile(page('overlay.html'));
  overlayWin.on('blur', () => { if (overlayShown && Date.now() - overlayShownAt > 400) hideOverlay({ refocus: false }); });
  overlayWin.on('closed', () => { overlayWin = null; overlayShown = false; });
  return overlayWin;
}
async function showOverlay({ mailId, force = false } = {}) {
  if (!running.size) return;
  const w = ensureOverlayWin();
  await overlayReady;
  let openMail = mailId ?? null;
  if (openMail == null && lastMailPopup && lastMailPopup.until > Date.now()) openMail = lastMailPopup.id;
  lastMailPopup = null;
  w.webContents.send('hf:overlay', { open: true, mailId: openMail, hotkey: hotkeyReg || settings.overlayHotkey });
  if (overlayShown) { w.focus(); return; }
  gameHwnd = win32.foregroundWindow();
  overlayShown = true;
  overlayShownAt = Date.now();
  media.start();
  updateVoiceHud();
  w.setBounds(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds);
  w.setOpacity(0);
  w.show();
  if (force) win32.forceForeground(w.getNativeWindowHandle());
  w.focus();
  await fadeWindow(w, 1, 160);
}
async function hideOverlay({ refocus = true } = {}) {
  if (!overlayShown || !overlayWin) return;
  overlayShown = false;
  updateVoiceHud();
  await fadeWindow(overlayWin, 0, 130);
  if (!overlayWin || overlayShown) return;
  overlayWin.hide();
  if (refocus) win32.focusWindow(gameHwnd);
  gameHwnd = null;
}
const toggleOverlay = () => (overlayShown ? hideOverlay() : showOverlay());
const hotkeyWarned = new Set();
function hotkeyWarn(key, msg) {
  if (hotkeyWarned.has(key)) return;
  hotkeyWarned.add(key);
  notify({ kind: 'launcher', icon: 'xcircle', title: 'Hotkey unavailable', body: msg, image: 'icon' });
}
function updateHotkey(force) {
  const want = running.size > 0 && settings.overlayEnabled !== false;
  const key = String(settings.overlayHotkey || 'Shift+Tab');
  if (hotkeyReg && (!want || force || hotkeyReg !== key)) { globalShortcut.unregister(hotkeyReg); hotkeyReg = null; }
  if (want && !hotkeyReg) {
    try {
      if (globalShortcut.register(key, toggleOverlay)) hotkeyReg = key;
      else hotkeyWarn(key, `Couldn't grab ${key} for the overlay - another app is using it. Pick another key in settings.`);
    } catch { hotkeyWarn(key, `"${key}" isn't a valid overlay hotkey.`); }
  }
  if (!want && overlayShown) hideOverlay();
  updateShotHotkey(force);
}

let shotKeyReg = null, shotBusy = false;
let shotLinks = readJson(FILES.shots, {});
const thumbCache = new Map();
function updateShotHotkey(force) {
  const key = String(settings.screenshotHotkey || 'F11');
  const want = running.size > 0 && key !== 'off';
  if (shotKeyReg && (!want || force || shotKeyReg !== key)) { globalShortcut.unregister(shotKeyReg); shotKeyReg = null; }
  if (!want || shotKeyReg) return;
  if (key === hotkeyReg) return hotkeyWarn(`shot:${key}`, `${key} is already the overlay key - pick a different screenshot key.`);
  try {
    if (globalShortcut.register(key, () => takeScreenshot().catch(e => notify({ kind: 'screenshot', icon: 'xcircle', title: 'Screenshot failed', body: e.message, image: 'icon' })))) shotKeyReg = key;
    else hotkeyWarn(`shot:${key}`, `Couldn't grab ${key} for screenshots - another app is using it. Pick another key in settings.`);
  } catch { hotkeyWarn(`shot:${key}`, `"${key}" isn't a valid screenshot key.`); }
}
const shotRoot = () => settings.screenshotRoot || DEFAULT_SETTINGS.screenshotRoot;
const folderName = s => String(s || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/[. ]+$/, '').trim().slice(0, 80) || 'Game';
const shotDir = id => path.join(shotRoot(), folderName(findApp(id)?.name || id));
function shotStamp(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}
function shotPath(file) {
  const f = path.resolve(String(file || ''));
  const root = path.resolve(shotRoot());
  if (!f.toLowerCase().startsWith(root.toLowerCase() + path.sep) || !/\.(png|jpe?g)$/i.test(f)) throw new Error("That's not a Hyperfocus screenshot.");
  return f;
}
async function takeScreenshot() {
  const id = currentGame && running.has(currentGame) ? currentGame : [...running.keys()].pop();
  if (!id || shotBusy) return;
  shotBusy = true;
  const ours = [hudWin, notifWin, overlayWin].filter(w => w && !w.isDestroyed() && w.isVisible());
  try {
    const rect = win32.windowRect(win32.foregroundWindow());
    let img, dip = null, display;
    try {
      ours.forEach(w => w.setOpacity(0));
      await sleep(80);
      try { if (rect) dip = screen.screenToDipRect(null, rect); } catch {}
      display = dip ? screen.getDisplayMatching(dip) : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      const sf = display.scaleFactor || 1;
      const sources = await desktopCapturer.getSources({
        types: ['screen'], thumbnailSize: { width: Math.round(display.bounds.width * sf), height: Math.round(display.bounds.height * sf) },
      });
      img = (sources.find(s => String(s.display_id) === String(display.id)) || sources[0])?.thumbnail;
    } finally {
      ours.forEach(w => { if (!w.isDestroyed()) w.setOpacity(1); });
    }
    if (!img || img.isEmpty()) throw new Error("Windows didn't hand over the screen.");
    if (dip) {
      const full = img.getSize();
      const k = full.width / display.bounds.width;
      const x = Math.max(0, Math.round((dip.x - display.bounds.x) * k));
      const y = Math.max(0, Math.round((dip.y - display.bounds.y) * k));
      const r = Math.min(full.width, Math.round((dip.x + dip.width - display.bounds.x) * k));
      const b = Math.min(full.height, Math.round((dip.y + dip.height - display.bounds.y) * k));
      if (r - x > 64 && b - y > 64 && (r - x) * (b - y) < full.width * full.height * 0.97) img = img.crop({ x, y, width: r - x, height: b - y });
    }
    const a = findApp(id);
    const base = `${folderName(a?.name || id)} ${shotStamp()}`;
    const dir = shotDir(id);
    await fsp.mkdir(dir, { recursive: true });
    let file = path.join(dir, `${base}.png`);
    for (let n = 2; fs.existsSync(file); n++) file = path.join(dir, `${base} (${n}).png`);
    await fsp.writeFile(file, img.toPNG());
    notify({
      kind: 'screenshot', title: a?.name || id, body: 'Screenshot saved - click to view', image: a?.icon, sound: 'camera',
      preview: 'data:image/jpeg;base64,' + img.resize({ width: 340, quality: 'good' }).toJPEG(80).toString('base64'),
      action: { type: 'screenshot', id, file },
    });
    send('shots', { id, file });
  } finally {
    shotBusy = false;
  }
}
async function listShots(id) {
  const dir = shotDir(String(id));
  let names = [];
  try { names = await fsp.readdir(dir); } catch { return []; }
  const out = [];
  for (const name of names) {
    if (!/\.(png|jpe?g)$/i.test(name)) continue;
    const file = path.join(dir, name);
    try {
      const st = await fsp.stat(file);
      if (st.isFile()) out.push({ file, name, time: st.mtimeMs, url: shotLinks[file] || null });
    } catch {}
  }
  return out.sort((x, y) => y.time - x.time);
}
async function shotThumb(file) {
  file = shotPath(file);
  const key = `${file}|${(await fsp.stat(file)).mtimeMs}`;
  if (thumbCache.has(key)) return thumbCache.get(key);
  let img;
  try { img = await nativeImage.createThumbnailFromPath(file, { width: 320, height: 180 }); } catch { img = nativeImage.createFromPath(file).resize({ width: 320 }); }
  const url = 'data:image/jpeg;base64,' + img.toJPEG(80).toString('base64');
  thumbCache.set(key, url);
  return url;
}
function shotView(file) {
  const img = nativeImage.createFromPath(shotPath(file));
  if (img.isEmpty()) throw new Error("Couldn't open that screenshot.");
  const big = img.getSize().width > 1600 ? img.resize({ width: 1600, quality: 'good' }) : img;
  return 'data:image/jpeg;base64,' + big.toJPEG(90).toString('base64');
}
async function uploadShot(file) {
  file = shotPath(file);
  if (!shotLinks[file]) {
    if (!account) throw new Error('Log in with Nookara to upload screenshots.');
    let buf = await fsp.readFile(file);
    let mime = /\.png$/i.test(file) ? 'image/png' : 'image/jpeg';
    if (buf.length > 8 * 1024 * 1024) { buf = nativeImage.createFromBuffer(buf).toJPEG(92); mime = 'image/jpeg'; }
    const { url } = await velora.uploadMedia(`data:${mime};base64,${buf.toString('base64')}`);
    shotLinks[file] = url;
    writeJson(FILES.shots, shotLinks);
  }
  clipboard.writeText(shotLinks[file]);
  return shotLinks[file];
}

let voiceWin = null, voiceReady = null;
let voiceState = { status: 'idle', room: null, users: [], muted: false, deafened: false, error: '' };
const userCache = new Map();
function ensureVoiceWin() {
  if (voiceWin && !voiceWin.isDestroyed()) return voiceWin;
  voiceWin = new BrowserWindow({ show: false, width: 320, height: 200, skipTaskbar: true, webPreferences: { ...webPrefs(), backgroundThrottling: false } });
  lockNavigation(voiceWin);
  voiceReady = new Promise(r => voiceWin.webContents.once('did-finish-load', r));
  voiceWin.loadFile(page('voice.html'));
  voiceWin.on('closed', () => { voiceWin = null; voiceState = { ...voiceState, status: 'idle', room: null, users: [] }; sendVoice(); });
  return voiceWin;
}
function randomRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  return Array.from(crypto.randomBytes(10), b => chars[b % chars.length]).join('');
}
function remember(key, u) {
  const info = { pfp: u.pfp || u.pfp_url || '', color: u.color || '' };
  userCache.set(key, info);
  return info;
}
function userInfo(name, onFound) {
  const key = String(name || '').toLowerCase();
  if (userCache.has(key)) return userCache.get(key);
  if (account && account.username.toLowerCase() === key) return remember(key, account);
  const friend = [...velora.friends.values()].find(f => f.username.toLowerCase() === key);
  if (friend) return remember(key, friend);
  userCache.set(key, { pfp: '', color: '' });
  velora.lookupUser(name)
    .then(u => { if (u) { remember(key, u); onFound?.(); } })
    .catch(() => {});
  return userCache.get(key);
}
const voiceView = () => ({
  ...voiceState,
  users: (voiceState.users || []).map(u => {
    const p = settings.voiceUsers?.[String(u.name || '').toLowerCase()] || {};
    return { ...u, ...userInfo(u.name, sendVoice), volume: Number(p.v ?? 1), mutedByMe: p.m === true };
  }),
  ringing: (voiceState.ringing || []).map(name => ({ name, ...userInfo(name, sendVoice) })),
  devices: { input: settings.voiceInput || '', output: settings.voiceOutput || '' },
});
function sendVoicePrefs() {
  if (voiceWin && !voiceWin.isDestroyed()) voiceWin.webContents.send('hf:voiceCmd', { op: 'prefs', prefs: settings.voiceUsers || {} });
}

async function peopleProfile(name) {
  name = String(name || '').trim();
  if (!name) throw new Error('Type a username.');
  const user = await velora.lookupUser(name);
  if (!user) throw new Error(`No Nookara user called "${name}".`);
  const loggedIn = !!account && !!loadToken();
  const me = !!account && account.username.toLowerCase() === user.username.toLowerCase();
  const canFriend = loggedIn && !me && !needsRelogin();
  const [hyperfocus, status] = await Promise.all([
    velora.hyperfocusProfile(user.username).catch(() => null),
    canFriend ? velora.friendStatus(user.username).catch(() => 'none') : Promise.resolve(null),
  ]);
  let requestId = null;
  if (status === 'pending_incoming') {
    const r = await velora.friendRequests().catch(() => null);
    requestId = r?.incoming?.find(x => String(x.from_username).toLowerCase() === user.username.toLowerCase())?.id ?? null;
  }
  remember(user.username.toLowerCase(), user);
  const { id, ...publicUser } = user;
  return { user: publicUser, hyperfocus, friendStatus: status, requestId, me, loggedIn, needsRelogin: needsRelogin() };
}
async function profilePage(name) {
  name = String(name || '').trim();
  if (!name) throw new Error('Type a username.');
  const user = await velora.getPublic(`/account/lookup/${encodeURIComponent(name)}`);
  if (!user) return { notFound: true, name };
  const loggedIn = !!account && !!loadToken();
  const me = !!account && account.username.toLowerCase() === String(user.username).toLowerCase();
  const canFriend = loggedIn && !me && !needsRelogin();
  const uenc = encodeURIComponent(user.username);
  const [hyperfocus, badges, status] = await Promise.all([
    velora.getPublic(`/hyperfocus/profile/${uenc}`).catch(() => null),
    velora.getPublic(`/badges/user/${uenc}`).catch(() => null),
    canFriend ? velora.friendStatus(user.username).catch(() => 'none') : Promise.resolve(null),
  ]);
  let requestId = null;
  if (status === 'pending_incoming') {
    const r = await velora.friendRequests().catch(() => null);
    requestId = r?.incoming?.find(x => String(x.from_username).toLowerCase() === user.username.toLowerCase())?.id ?? null;
  }
  remember(user.username.toLowerCase(), user);
  const { id, ...publicUser } = user;
  return {
    user: publicUser, hyperfocus, badges: Array.isArray(badges?.badges) ? badges.badges : null,
    friendStatus: status, requestId, me, loggedIn, needsRelogin: needsRelogin(),
  };
}
function sendVoice() { sendAll('voice', voiceView()); }
async function voiceCmd(cmd) {
  const op = cmd?.op;
  if (op === 'create' || op === 'join') {
    if (!account) throw new Error('Log in with Nookara to use voice chat.');
    const room = op === 'create' ? randomRoomId() : String(cmd.room || '').trim().slice(0, 64);
    if (cmd.fromCall ? !room : !/^[A-Za-z0-9_-]{1,64}$/.test(room)) throw new Error("That room ID doesn't look right.");
    if (adminDisabled(16384)) throw new Error('Voice chat was disabled for your account by an administrator.');
    const w = ensureVoiceWin();
    await voiceReady;
    w.webContents.send('hf:voiceCmd', { op: 'join', room, name: account.username, ring: String(cmd.ring || '').slice(0, 64) });
    sendVoicePrefs();
    w.webContents.send('hf:voiceCmd', { op: 'devices', input: settings.voiceInput || '', output: settings.voiceOutput || '' });
    return { room };
  }
  if (op === 'devices') {
    settings.voiceInput = String(cmd.input || '').slice(0, 200);
    settings.voiceOutput = String(cmd.output || '').slice(0, 200);
    saveSettings();
    if (voiceWin && !voiceWin.isDestroyed()) voiceWin.webContents.send('hf:voiceCmd', { op: 'devices', input: settings.voiceInput, output: settings.voiceOutput });
    sendVoice();
    return null;
  }
  if (op === 'callUser') {
    const to = String(cmd.to || '').trim();
    if (!to) throw new Error('Who do you want to call?');
    if (voiceState.status === 'connected' && voiceState.room) {
      voiceWin.webContents.send('hf:voiceCmd', { op: 'call', to });
    } else {
      if (!account) throw new Error('Log in with Nookara to use voice chat.');
      if (adminDisabled(16384)) throw new Error('Voice chat was disabled for your account by an administrator.');
      let d;
      try { d = await velora.api('/chat/calls', { method: 'POST', body: { to } }); }
      catch (e) { throw new Error({ dms_friends_only: 'They only take calls and messages from friends.', user_not_found: 'No Nookara user with that name.' }[e.code] || e.message); }
      if (!d?.room) throw new Error("Couldn't start the call.");
      if (voiceState.room === d.room && voiceState.status !== 'idle') voiceWin.webContents.send('hf:voiceCmd', { op: 'call', to });
      else await voiceCmd({ op: 'join', room: d.room, fromCall: true, ring: to });
    }
    openPanel('voice');
    return null;
  }
  if (op === 'userVolume' || op === 'userMute') {
    const key = String(cmd.name || '').toLowerCase().slice(0, 64);
    if (!key) return null;
    const cur = { v: 1, m: false, ...(settings.voiceUsers?.[key] || {}) };
    if (op === 'userVolume') cur.v = Math.min(2, Math.max(0.5, Number(cmd.volume) || 1));
    else cur.m = typeof cmd.muted === 'boolean' ? cmd.muted : !cur.m;
    settings.voiceUsers = { ...(settings.voiceUsers || {}), [key]: cur };
    saveSettings();
    sendVoicePrefs();
    sendVoice();
    return null;
  }
  if (voiceWin && !voiceWin.isDestroyed()) voiceWin.webContents.send('hf:voiceCmd', cmd);
  return null;
}
async function voiceInvite(to, room) {
  room = room || voiceState.room;
  if (!room) throw new Error("You're not in a voice room.");
  await velora.sendMail(to, '', `🎙 ${account?.username || 'Someone'} invited you to a voice chat! hyperfocus://voice/${room}`);
}

const HUD_W = 260, HUD_H = 420;
let hudWin = null, hudReady = null, hudShown = false;
function ensureHudWin() {
  if (hudWin && !hudWin.isDestroyed()) return hudWin;
  hudWin = new BrowserWindow({
    width: HUD_W, height: HUD_H, frame: false, transparent: true, resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, focusable: false,
    alwaysOnTop: true, show: false, hasShadow: false, backgroundColor: '#00000000', webPreferences: webPrefs(),
  });
  hudWin.setAlwaysOnTop(true, 'screen-saver');
  overFullscreen(hudWin);
  hudWin.setIgnoreMouseEvents(true);
  lockNavigation(hudWin);
  hudReady = new Promise(r => hudWin.webContents.once('did-finish-load', r));
  hudWin.loadFile(page('voicehud.html'));
  hudWin.on('closed', () => { hudWin = null; hudShown = false; });
  return hudWin;
}
async function updateVoiceHud() {
  const want = settings.voiceHud !== false && voiceState.status === 'connected' && !!voiceState.room && running.size > 0 && !overlayShown;
  if (want === hudShown) return;
  hudShown = want;
  if (!want) { if (hudWin && !hudWin.isDestroyed()) hudWin.hide(); return; }
  const w = ensureHudWin();
  await hudReady;
  if (!hudShown || w.isDestroyed()) return;
  const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  w.setBounds({ x: wa.x + 16, y: wa.y + 16, width: HUD_W, height: HUD_H });
  w.showInactive();
  w.moveTop();
}

let msgWin = null;
function openMessages(mailId, chatWith) {
  if (overlayShown) hideOverlay({ refocus: false });
  if (msgWin && !msgWin.isDestroyed()) {
    if (msgWin.isMinimized()) msgWin.restore();
    msgWin.show();
    msgWin.focus();
    if (mailId) msgWin.webContents.send('hf:openMail', mailId);
    if (chatWith) msgWin.webContents.send('hf:openChat', chatWith);
    return;
  }
  const w = msgWin = new BrowserWindow({
    width: 940, height: 640, ...chrome(11), transparent: true, resizable: false, maximizable: false, fullscreenable: false,
    show: false, title: 'Hyperfocus Messages', icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#00000000', webPreferences: webPrefs(),
  });
  lockNavigation(w);
  const query = {};
  if (mailId) query.mail = String(mailId);
  if (chatWith) query.chat = String(chatWith);
  w.loadFile(page('messages.html'), Object.keys(query).length ? { query } : undefined);
  w.once('ready-to-show', () => { w.setOpacity(0); w.show(); fadeWindow(w, 1, 200); });
  w.on('minimize', () => w.setOpacity(0));
  w.on('restore', () => fadeWindow(w, 1, 200));
  w.on('closed', () => { if (msgWin === w) msgWin = null; });
}

const PANELS = {
  friends: { file: 'friends.html', width: 900, height: 620, title: 'Hyperfocus Friends' },
  voice: { file: 'voicepanel.html', width: 380, height: 560, title: 'Hyperfocus Voice Chat' },
};
const panelWins = {};
function overGame(w) {
  if (!w || w.isDestroyed()) return;
  w.setAlwaysOnTop(true, 'screen-saver');
  w.show();
  w.moveTop();
  w.focus();
  w.once('blur', () => { if (!w.isDestroyed()) w.setAlwaysOnTop(false); });
}
function openPanel(kind, arg, opts = {}) {
  const p = PANELS[kind];
  if (!p) throw new Error('Unknown window.');
  if (overlayShown) hideOverlay({ refocus: false });
  const open = panelWins[kind];
  if (open && !open.isDestroyed()) {
    if (open.isMinimized()) open.restore();
    open.show();
    open.focus();
    if (kind === 'friends' && arg) open.webContents.send('hf:openProfile', arg);
    if (opts.overGame) overGame(open);
    return;
  }
  const w = panelWins[kind] = new BrowserWindow({
    width: p.width, height: p.height, ...chrome(11), transparent: true, resizable: false, maximizable: false, fullscreenable: false,
    show: false, title: p.title, icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#00000000', webPreferences: webPrefs(),
  });
  lockNavigation(w);
  w.loadFile(page(p.file), kind === 'friends' && arg ? { query: { profile: arg } } : undefined);
  w.once('ready-to-show', () => { w.setOpacity(0); w.show(); fadeWindow(w, 1, 200); });
  w.on('minimize', () => w.setOpacity(0));
  w.on('restore', () => fadeWindow(w, 1, 200));
  if (opts.overGame) w.once('ready-to-show', () => overGame(w));
  w.on('closed', () => { if (panelWins[kind] === w) panelWins[kind] = null; });
}

let voiceSeen = null;
function voiceSound(name) {
  if (settings.notifySounds === false || !voiceWin || voiceWin.isDestroyed()) return;
  voiceWin.webContents.send('hf:voiceCmd', { op: 'sound', name });
}
function onVoiceState(s) {
  const users = Array.isArray(s.users) ? s.users : [];
  if (s.status !== 'connected' || !s.room) {
    if (voiceSeen) voiceSound('leave');
    voiceSeen = null;
    return;
  }
  if (!voiceSeen) {
    if (!users.some(u => u.me)) return;
    voiceSeen = new Set(users.map(u => u.id));
    voiceSound('start');
    return;
  }
  const now = new Set(users.map(u => u.id));
  for (const u of users) {
    if (u.me || voiceSeen.has(u.id)) continue;
    notify({
      kind: 'voice', title: u.name, body: 'joined your voice chat', image: userInfo(u.name, sendVoice).pfp,
      presence: presenceOf(u.name) === 'playing' ? 'playing' : 'online', sound: 'voiceJoin', action: { type: 'voice' },
    });
  }
  if ([...voiceSeen].some(id => !now.has(id))) voiceSound('leave');
  voiceSeen = now;
}

let dragging = null;
function dragStop() {
  if (!dragging) return;
  clearInterval(dragging.timer);
  dragging = null;
}
function dragStart(e) {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w || w.isDestroyed() || w.isMinimized()) return;
  dragStop();
  const cur = screen.getCursorScreenPoint();
  const b = w.getBounds();
  const off = { x: cur.x - b.x, y: cur.y - b.y };
  const size = { width: b.width, height: b.height };
  let last = null;
  dragging = {
    w,
    timer: setInterval(() => {
      if (!dragging || dragging.w.isDestroyed()) return dragStop();
      if (win32.leftButtonDown() === false) return dragStop();
      const p = screen.getCursorScreenPoint();
      const x = Math.round(p.x - off.x), y = Math.round(p.y - off.y);
      if (last && last.x === x && last.y === y) return;
      last = { x, y };
      dragging.w.setBounds({ x, y, ...size });
    }, 8),
  };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 740,
    minWidth: 1100,
    minHeight: 640,
    ...chrome(),
    transparent: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: APP_NAME,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.setMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => {
    updateDiscordPresence();
    if (startHidden) {
      send('visible', false);
      return;
    }
    win.setOpacity(0);
    win.show();
    fadeIn();
  });
  win.on('minimize', () => { win.setOpacity(0); send('visible', false); });
  win.on('restore', () => fadeIn());
  win.on('focus', () => { if (Date.now() - lastRefresh > 30000) refreshManifest(); else syncLibraryMaybe(); });
  win.on('close', e => {
    if (quitting) return;
    e.preventDefault();
    requestClose(false).then(r => { if (r?.confirm) { showWin(); send('confirmClose'); } });
  });
  win.webContents.setWindowOpenHandler(({ url }) => { openExternalSafe(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:')) { e.preventDefault(); openExternalSafe(url); }
  });
}

function syncLoginItem() {
  if (!app.isPackaged) return;
  try { app.setLoginItemSettings({ openAtLogin: settings.autoLaunch !== false, args: ['--hidden'], ...(IS_MAC ? { openAsHidden: true } : {}) }); } catch {}
}

function makeTray() {
  const trayImg = nativeImage.createFromPath(path.join(__dirname, 'assets', IS_MAC ? 'trayTemplate.png' : 'tray.png'));
  if (IS_MAC) trayImg.setTemplateImage(true);
  tray = new Tray(trayImg);
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Open ${APP_NAME}`, click: showWin },
    { label: 'Messages', click: () => openMessages() },
    { label: 'Friends', click: () => openPanel('friends') },
    { label: 'Voice Chat', click: () => openPanel('voice') },
    { type: 'separator' },
    { label: 'Quit', click: () => quitApp() },
  ]));
  tray.on('click', showWin);
}

function handleE(channel, fn) {
  ipcMain.handle(channel, async (e, ...args) => {
    if (!e.senderFrame || !e.senderFrame.url.startsWith('file:')) return { ok: false, error: 'forbidden' };
    try { return { ok: true, value: await fn(e, ...args) }; }
    catch (err) { return { ok: false, error: err?.message || String(err) }; }
  });
}
const handle = (channel, fn) => handleE(channel, (_e, ...args) => fn(...args));
function setSettings(patch) {
  if (!patch || typeof patch !== 'object') return settings;
  for (const k of SETTING_KEYS) if (k in patch) settings[k] = patch[k];
  settings.speedLimit = Math.max(0, Number(settings.speedLimit) || 0);
  const vu = settings.voiceUsers;
  settings.voiceUsers = vu && typeof vu === 'object' && !Array.isArray(vu)
    ? Object.fromEntries(Object.entries(vu).filter(([k, v]) => k && v && typeof v === 'object')
      .map(([k, v]) => [String(k).toLowerCase().slice(0, 64), { v: Math.min(2, Math.max(0.5, Number(v.v) || 1)), m: v.m === true }]))
    : {};
  const bo = settings.bridgeOrigins;
  settings.bridgeOrigins = bo && typeof bo === 'object' && !Array.isArray(bo)
    ? Object.fromEntries(Object.entries(bo).filter(([k, v]) => /^https?:\/\/[^/\s]+$/i.test(k) && typeof v === 'boolean'))
    : {};
  const bc = settings.betaChoice;
  settings.betaChoice = bc && typeof bc === 'object' && !Array.isArray(bc)
    ? Object.fromEntries(Object.entries(bc).filter(([k, v]) => k && typeof v === 'string' && v).map(([k, v]) => [String(k).slice(0, 64), v.slice(0, 40)]))
    : {};
  settings.dropsSeen = Math.max(0, Math.floor(Number(settings.dropsSeen) || 0));
  settings.newGamesPopup = settings.newGamesPopup !== false;
  settings.musicVolume = Math.min(1, Math.max(0, Number(settings.musicVolume)));
  if (!Number.isFinite(settings.musicVolume)) settings.musicVolume = DEFAULT_SETTINGS.musicVolume;
  saveSettings();
  if ('devMode' in patch || 'devBridgeNoGame' in patch) sendInviteState();
  if ('autoLaunch' in patch) syncLoginItem();
  if ('overlayHotkey' in patch || 'overlayEnabled' in patch || 'screenshotHotkey' in patch) updateHotkey(true);
  if ('discordRichPresence' in patch) updateDiscordPresence();
  if ('voiceHud' in patch) updateVoiceHud();
  if ('betaChoice' in patch) refreshBetas();
  push();
  return settings;
}

function registerIpc() {
  handle('state:get', () => snapshot());
  handle('state:refresh', async () => { await refreshManifest(); return snapshot(); });
  handle('offline:set', on => setOfflineMode(!!on));
  handle('cloud:check', (id, force) => cloudCheck(String(id), !!force));
  handle('gameperms:resolve', (reqId, choice) => { const r = permAsks.get(String(reqId)); permAsks.delete(String(reqId)); if (r) r(['allow', 'limited'].includes(choice) ? choice : 'cancel'); });
  handle('gameperms:cancel', () => { if (permFlow) permFlow.cancelled = true; });
  handle('gamelogin:forget', id => { rememberGameLogin(String(id), null); return true; });
  handle('gameperms:reopen', () => {  });
  handle('join:resolve', (reqId, choice) => { const r = joinAsks.get(String(reqId)); joinAsks.delete(String(reqId)); if (r) r(['release', 'beta'].includes(choice) ? choice : 'cancel'); });
  handle('cloud:resolve', (reqId, choice) => { const r = cloudAsks.get(String(reqId)); cloudAsks.delete(String(reqId)); if (r) r(['local', 'cloud'].includes(choice) ? choice : 'cancel'); });
  handle('cloud:toggle', (id, on) => {
    id = String(id);
    const off = new Set(settings.cloudSavesOff || []);
    if (on) off.delete(id); else off.add(id);
    setSettings({ cloudSavesOff: [...off] });
    delete cloudStatus[id]; cloudChecked[id] = 0;
    return cloudCheck(id, false);
  });
  handle('cloud:open', id => { const a = findApp(String(id)); const s = specsFor(a, installed[String(id)]?.dir).find(x => x.kind === 'fs'); if (s) shell.openPath(fs.existsSync(s.abs) ? s.abs : path.dirname(s.abs)); });
  handle('cloud:backups', id => { const d = path.join(DATA, 'save-backups', String(id).replace(/[^a-z0-9._-]/gi, '_')); fs.mkdirSync(d, { recursive: true }); shell.openPath(d); });
  handle('app:install', (id, root) => installApp(String(id), root ? String(root) : ''));
  handle('install:where', (id, root) => installWhere(String(id), root ? String(root) : ''));
  handle('install:pick', async current => {
    const r = await dialog.showOpenDialog(win, { title: 'Choose where to install it', defaultPath: current || settings.installRoot, properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  handle('app:pause', id => pauseJob(String(id)));
  handle('app:cancel', id => cancelJob(String(id)));
  handle('app:launch', id => launchApp(String(id)));
  handle('app:uninstall', id => uninstallApp(String(id)));
  handle('app:folder', id => { const i = instOf(String(id)); if (i?.dir) shell.openPath(i.dir); });
  const betaId = v => { v = String(v || ''); if (!/^[A-Za-z0-9_-]{1,40}$/.test(v)) throw new Error('That beta ID looks wrong.'); return v; };
  handle('beta:refresh', async () => { await refreshBetas(); return true; });
  handle('beta:join', id => joinBeta(betaId(id)));
  handle('beta:leave', id => leaveBeta(betaId(id)));
  handle('beta:redeem', code => redeemCode(code));
  handle('code:redeem', code => redeemCode(code));
  handle('beta:choose', (appId, id) => chooseBeta(String(appId), id ? betaId(id) : null));
  handle('beta:install', appId => installApp(String(appId) + BETA));
  handle('beta:launch', appId => launchApp(String(appId) + BETA));
  handle('beta:uninstall', appId => uninstallApp(String(appId) + BETA));
  handle('settings:set', patch => setSettings(patch));
  handle('settings:pickFolder', async kind => {
    const shots = kind === 'shots';
    const r = await dialog.showOpenDialog(win, {
      title: shots ? 'Choose where screenshots get saved' : 'Choose where apps get installed',
      defaultPath: shots ? shotRoot() : settings.installRoot, properties: ['openDirectory', 'createDirectory'],
    });
    return r.canceled ? null : r.filePaths[0];
  });
  handle('auth:login', () => loginStart());
  handle('auth:reopen', () => { if (loginFlow?.url) shell.openExternal(loginFlow.url); });
  handle('auth:cancel', () => { if (loginFlow) loginFlow.cancelled = true; loginFlow = null; });
  handle('auth:logout', async () => {
    const token = loadToken();
    if (token) fetch(`${VELORA}/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    saveToken(null);
    setAccount(null);
    velora.stop();
    playtime.resetTotals();
    betas = Object.fromEntries(Object.entries(betas).map(([k, l]) => [k, l.filter(b => b.public).map(b => ({ ...b, member: false, via: null, download: null }))])); saveBetas();
    voiceCmd({ op: 'leave' }).catch(() => {});
    refreshManifest();
    push();
  });
  handle('auth:center', () => shell.openExternal(ACCOUNT_CENTER));
  handle('launcher:show', () => showWin());
  handle('social:get', () => socialView());
  handle('im:conversations', () => velora.conversations());
  handle('im:thread', (name, before) => velora.imThread(String(name || ''), before ? Number(before) : null));
  handle('im:read', name => velora.imMarkRead(String(name || '')));
  handle('im:send', (to, message) => velora.imSend(String(to || ''), String(message || '')));
  handle('dm:status', () => velora.dms.ready().then(() => velora.dms.status()));
  handle('dm:unlock', v => velora.dms.unlockPasscode(String(v || '')));
  handle('dm:recovery', v => velora.dms.unlockRecovery(String(v || '')));
  handle('dm:link', async () => { const l = await velora.dms.startLink(); l.wait.then(s => sendAll('dmUnlocked', s)).catch(e => sendAll('imError', e.message)); return { code: l.code }; });
  handle('dm:file', (dataUrl, name, mime) => {
    const m = /^data:[^,]*;base64,(.+)$/.exec(String(dataUrl || ''));
    if (!m) throw new Error("That file couldn't be read.");
    return velora.dms.sealedFileLine(Buffer.from(m[1], 'base64'), String(name || 'file'), String(mime || 'application/octet-stream'));
  });
  handle('im:find', id => velora.recentIm.get(Number(id)) || null);
  handle('groups:list', () => velora.groups());
  handle('groups:messages', room => velora.groupMessages(String(room || '')));
  handle('groups:send', (room, message) => velora.groupSend(String(room || ''), String(message || '')));
  handle('groups:create', (name, members) => velora.groupCreate(String(name || ''), Array.isArray(members) ? members.map(String) : []));
  handle('groups:add', (room, name) => velora.groupAdd(String(room || ''), String(name || '')));
  handle('groups:remove', (room, name) => velora.groupRemove(String(room || ''), String(name || '')));
  handle('groups:rename', (room, name) => velora.groupRename(String(room || ''), String(name || '')));
  handle('groups:delete', room => velora.groupDelete(String(room || '')));
  handle('messages:open', id => openMessages(id));
  handle('overlay:hide', () => hideOverlay());
  handle('app:close', id => closeGame(id ? String(id) : null));
  handle('console:set', on => setConsoleMode(on));
  handle('pad:seen', info => padSeen(info || {}));
  handle('pad:guide', () => onGuide());
  handle('chat:typing', (to, typing) => velora.sendTyping(to, typing));
  handle('media:upload', dataUrl => velora.uploadMedia(dataUrl));
  handle('voice:cmd', cmd => voiceCmd(cmd));
  handle('voice:get', () => voiceView());
  handle('voice:state', s => { if (s && typeof s === 'object') { voiceState = s; onVoiceState(s); sendVoice(); updateVoiceHud(); } });
  handle('voice:levels', lv => { if (hudShown && hudWin && !hudWin.isDestroyed()) hudWin.webContents.send('hf:voiceLevels', lv); });
  handle('voice:invite', (to, room) => voiceInvite(String(to || ''), room ? String(room) : null));
  handleE('voice:token', e => (voiceWin && !voiceWin.isDestroyed() && e.sender === voiceWin.webContents ? loadToken() : null));
  handle('voice:callEvent', ev => onVoiceCallEvent(ev));
  handle('ach:stats', async game => {
    const res = await fetch(`${VELORA}/hyperfocus/achievements/stats/${encodeURIComponent(String(game || ''))}`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Nookara error ${res.status}`);
    return res.json();
  });
  handle('owner:stats', async () => {
    const token = loadToken();
    if (!token) throw new Error('Log in with Nookara first.');
    const res = await fetch(`https://ikelene.net/launcher/stats.php?t=${Date.now()}`, { headers: { 'X-Velora-Token': token }, signal: AbortSignal.timeout(15000) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok) throw new Error(j.error === 'owner_only' ? 'Only owners can see the dashboard.' : `Couldn't load the stats (${j.error || res.status}).`);
    return j;
  });
  handle('ach:done', () => { if (achWin && !achWin.isDestroyed()) achWin.hide(); });
  handle('dev:tool', async (name, arg) => {
    if (name === 'copy') { clipboard.writeText(String(arg || '')); return true; }
    if (!settings.devMode) throw new Error('Turn on Developer Mode first.');
    if (name === 'bridgeLog') { const f = path.join(DATA, 'bridge.log'); if (!fs.existsSync(f)) fs.writeFileSync(f, ''); return shell.openPath(f); }
    if (name === 'dataFolder') return shell.openPath(DATA);
    if (name === 'devtools') { win?.webContents.openDevTools({ mode: 'detach' }); return true; }
    if (name === 'refresh') { achFetchedAt = 0; await refreshManifest(); return true; }
    if (name === 'testAchievement') {
      const g = findApp(currentGame) || (manifest?.apps || [])[0] || {};
      showAchievement({ id: 'dev-test', name: 'Test Achievement', description: 'This is what a common achievement looks like.', rarity: 'common', gameName: g.name || 'Hyperfocus', gameIcon: g.icon || '' });
      showAchievement({ id: 'dev-test-rare', name: 'Rare Test Achievement', description: 'Rare ones glow and sparkle!', rarity: 'rare', gameName: g.name || 'Hyperfocus', gameIcon: g.icon || '' });
      return true;
    }
    throw new Error('Unknown tool.');
  });
  handle('people:profile', name => peopleProfile(name));
  handle('people:page', name => profilePage(name));
  handle('people:show', name => openPanel('friends', String(name || '')));
  handle('panel:open', (kind, arg) => openPanel(String(kind || ''), arg ? String(arg) : ''));
  handle('community:remove', id => removeCommunityGame(String(id || '')));
  const storeId = v => { v = String(v || ''); if (!/^[A-Za-z0-9_.-]{1,64}$/.test(v)) throw new Error('That game ID looks wrong.'); return v; };
  handle('store:get', () => storeFeed());
  handle('store:like', (id, on) => storeApi('like', { id: storeId(id), ...(typeof on === 'boolean' ? { on } : {}) }).then(j => ({ likes: j.likes, liked: j.liked })));
  handle('store:wishlist', (id, on, notify) => storeApi('wishlist', { id: storeId(id), on: !!on, ...(['email', 'ember', 'both'].includes(notify) ? { notify } : {}) })
    .then(j => ({ wishlisted: j.wishlisted, notify: j.notify, wishlists: j.wishlists })));
  handle('store:drops', () => storeApi('drops').then(j => (Array.isArray(j.drops) ? j.drops : [])));
  handle('library:add', id => libraryAdd(id));
  handle('library:remove', id => libraryRemove(id));
  handle('media:get', () => media.state);
  handle('media:cmd', cmd => media.command(String(cmd || '')));
  handle('invite:state', () => invitableGame());
  handle('invite:send', name => sendGameInvite(String(name || '')));
  handle('invite:join', (appId, code, from) => joinGame(appId, code, from));
  handle('friend:join', name => joinFriend(name));
  handle('shots:list', id => listShots(id));
  handle('shots:thumb', file => shotThumb(file));
  handle('shots:view', file => shotView(file));
  handle('shots:open', file => shell.openPath(shotPath(file)));
  handle('shots:reveal', file => shell.showItemInFolder(shotPath(file)));
  handle('shots:folder', async id => {
    const dir = id ? shotDir(String(id)) : shotRoot();
    await fsp.mkdir(dir, { recursive: true });
    return shell.openPath(dir);
  });
  handle('shots:upload', file => uploadShot(file));
  handle('people:requests', () => velora.friendRequests());
  handle('user:info', async name => {
    const info = userInfo(name);
    if (info.pfp || info.color) return info;
    const u = await velora.lookupUser(String(name || '')).catch(() => null);
    return u ? remember(String(name).toLowerCase(), u) : info;
  });
  handle('friend:add', name => velora.addFriend(String(name || '')));
  handle('friend:accept', id => velora.acceptFriend(id));
  handle('friend:decline', id => velora.declineFriend(id));
  handle('friend:remove', name => velora.removeFriend(String(name || '')));
  handle('messages:chat', name => openMessages(null, String(name || '')));
  handle('notif:mouse', inside => { if (notifWin && !notifWin.isDestroyed()) notifWin.setIgnoreMouseEvents(!inside, { forward: true }); });
  handle('notif:empty', () => {
    if (!notifWin || notifWin.isDestroyed() || Date.now() - lastNotifyAt < 600) return;
    notifWin.setIgnoreMouseEvents(true, { forward: true });
    notifWin.hide();
  });
  handle('notif:click', action => onNotifAction(action));
  handleE('self:min', e => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w === win) return minimizeWin();
    if (w) return fadeWindow(w, 0, 150).then(() => w.minimize());
  });
  handleE('self:close', e => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w === win) return requestClose(false);
    if (w) return fadeWindow(w, 0, 150).then(() => w.close());
  });
  handle('open:url', url => openExternalSafe(String(url)));
  handle('music:resolve', url => resolveMusic(String(url || '')));
  handle('launcher:update', () => updateLauncher());
  handle('launcher:channel', on => {
    settings.betaChannel = !!on;
    saveSettings();
    push();
    const L = manifest?.launcher;
    return { update: launcherUpdateInfo(), betaAvailable: !!L?.beta?.version && cmpLauncher(L.beta.version, L.version) > 0 && (!IS_MAC || !!L.beta.mac?.download?.url) };
  });
  handleE('win:drag', e => dragStart(e));
  handle('win:dragEnd', () => dragStop());
  handle('win:min', () => minimizeWin());
  handle('win:close', force => requestClose(!!force));
}

if (gotLock) {
  app.on('second-instance', (_e, argv) => { showWin(); handleProtocolArgs(argv); });
  let macUrlsReady = false;
  const macUrls = [];
  if (IS_MAC) {
    app.on('open-url', (e, url) => { e.preventDefault(); if (macUrlsReady) handleProtocolArgs([url]); else macUrls.push(url); });
    app.on('activate', () => showWin());
  }
  app.on('before-quit', () => {
    quitting = true;
    media.stop();
    playtime.tick();
    for (const j of jobs.values()) { j.paused = true; j.abort?.(); }
  });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => app.quit());
  app.whenReady().then(() => {
    Menu.setApplicationMenu(IS_MAC ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null);
    if (IS_MAC && !app.isPackaged) { try { app.dock.setIcon(path.join(__dirname, 'build', 'icon.png')); } catch {  } }
    registerIpc();
    wireVelora();
    makeTray();
    syncLoginItem();
    createWindow();
    ensureNotifWin();
    wirePads();
    if (app.isPackaged) app.setAsDefaultProtocolClient('hyperfocus');
    startGameBridge();
    win.webContents.once('did-finish-load', () => {
      handleProtocolArgs(process.argv);
      macUrlsReady = true;
      for (const u of macUrls.splice(0)) handleProtocolArgs([u]);
    });
    validateSession().then(push);
    refreshManifest();
    setInterval(refreshManifest, REFRESH_MS);
    setInterval(validateSession, 30 * 60 * 1000);
    setInterval(() => playtime.tick(), 30 * 1000);
    setInterval(() => { if (running.size) playtime.sync(); }, 5 * 60 * 1000);
  });
}
