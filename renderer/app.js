'use strict';
/* global hf, ICONS */

const $ = (s, r = document) => r.querySelector(s);
function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(c);
  return n;
}

let S = null;
let sel = null;
let visible = false;
let libraryOpen = false;
let trailer = null;
let social = null;
let voiceNow = null;
let pageTrailer = false;
let domReady = false;
const keys = {};

const apps = () => S?.manifest?.apps || [];
const cur = () => apps().find(a => a.id === sel) || null;

const libIds = () => (Array.isArray(S?.settings?.library) ? S.settings.library : []);
const inLibrary = a => !!a && (a.community || libIds().includes(a.id) || !!S.installed[a.id] || !!S.installedBetas?.[a.id]
  || S.running.includes(a.id) || !!S.jobs[a.id] || !!S.jobs[a.id + BETA] || !!S.settings.betaChoice?.[a.id]);
const libraryList = () => apps().filter(inLibrary);
function priceView(g) {
  const full = Math.max(0, Number(g?.price) || 0);
  const s = g?.sale;
  const on = full > 0 && s && Number.isFinite(Number(s.price)) && Number(s.until) * 1000 > Date.now() && Number(s.price) < full;
  const now = on ? Math.max(0, Number(s.price)) : full;
  return { full, now, sale: !!on, off: on ? Math.round((1 - now / full) * 100) : 0, until: on ? Number(s.until) * 1000 : 0 };
}
const credits = n => `${Number(n).toLocaleString()} credit${Number(n) === 1 ? '' : 's'}`;
function timeLeft(t) {
  const s = Math.max(0, Math.floor((t - Date.now()) / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${Math.max(1, m)}m`;
}
const BUSY = ['downloading', 'paused', 'verifying', 'installing'];
const isGame = a => a?.type === 'Game';
const verb = a => (isGame(a) ? 'Play' : 'Launch');
const isUrl = s => /^(https?:|data:|file:)/i.test(String(s || ''));
function descOf(g) {
  const v = g?.description;
  if (typeof v !== 'string') return '';
  const t = v.trim();
  return /^(null|undefined)$/i.test(t) ? '' : t;
}
const effStatus = (a, st = S?.status?.[a?.id]) => (st === 'buy' && stageOf(a) === 'soon' ? 'soon' : st);

const BETA = '#beta';
const chosenBeta = a => {
  const id = a && S?.settings?.betaChoice?.[a.id];
  return id ? (S.betas?.[a.id] || []).find(b => b.id === id && b.member) || null : null;
};
const gameRunning = a => !!S && S.running.includes(a.id);
const betaRunning = a => gameRunning(a) && (S.runningBeta || []).includes(a.id);
const betaVia = b => (b.via === 'grant' ? 'invited' : b.via === 'code' ? 'code' : b.via === 'public' ? 'public' : b.via === 'admin' ? 'admin' : '');
const betaVer = b => (b.version && String(b.version) !== '0' ? `v${b.version}` : '');

function fmtBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '?';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (i ? n.toFixed(n < 10 ? 1 : 0) : String(Math.round(n))) + ' ' + u[i];
}
function fmtEta(s) {
  if (!Number.isFinite(s) || s <= 0) return '--';
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  const p = v => String(v).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(x)}` : `${m}:${p(x)}`;
}
const pct = j => (j && j.total ? Math.min(100, Math.floor((j.received / j.total) * 100)) : 0);
const shortHash = h => (h ? String(h).slice(0, 8) : '');
function inkFor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#000';
  const n = parseInt(m[1], 16);
  const l = (0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) / 255;
  return l > 0.55 ? '#000' : '#fff';
}
function setRangeFill(input) { input.style.setProperty('--p', `${((input.value - input.min) / (input.max - input.min)) * 100}%`); }

function toast(msg, kind = 'info') {
  const t = el('div', { class: `toast ${kind}`, text: msg });
  $('#toasts').append(t);
  requestAnimationFrame(() => t.classList.add('in'));
  setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 300); }, 4200);
}
async function attempt(fn) {
  try { return await fn(); } catch (e) { toast(e.message || String(e), 'err'); }
}

function openModal(id, title, content, { dismiss = true, onclose = null } = {}) {
  closeModal(id, true);
  const back = el('div', { class: 'modal-back', 'data-id': id });
  back._onclose = onclose;
  const head = el('div', { class: 'box-h' }, el('span', { text: title }),
    dismiss ? el('button', { class: 'm-x', html: ICONS.close, onclick: () => closeModal(id) }) : null);
  back.append(el('div', { class: 'modal' }, head, content));
  if (dismiss) back.addEventListener('mousedown', e => { if (e.target === back) closeModal(id); });
  back.dataset.dismiss = dismiss ? '1' : '';
  $('#modal-root').append(back);
  requestAnimationFrame(() => back.classList.add('in'));
  document.body.classList.add('modal-open');
  return back;
}
function closeModal(id, instant) {
  if (trailer && (!id || id === 'trailer')) stopTrailer();
  document.querySelectorAll(id ? `.modal-back[data-id="${id}"]` : '.modal-back').forEach(b => {
    const done = b._onclose;
    b._onclose = null;
    if (done) try { done(); } catch (e) { console.warn(e); }
    b.classList.remove('in');
    b.removeAttribute('data-id');
    if (instant) b.remove(); else setTimeout(() => b.remove(), 200);
  });
  if (!document.querySelector('.modal-back[data-id]')) document.body.classList.remove('modal-open');
}
function confirmBox(title, text, okLabel = 'OK', danger = false) {
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (done) return; done = true; closeModal('confirm'); resolve(v); };
    const back = openModal('confirm', title, el('div', { class: 'dialog' },
      el('p', { text }),
      el('div', { class: 'acts' },
        el('button', { class: 'btn ghost', text: 'Cancel', onclick: () => finish(false) }),
        el('button', { class: `btn ${danger ? 'danger' : ''}`, text: okLabel, onclick: () => finish(true) }))));
    back.addEventListener('mousedown', e => { if (e.target === back) finish(false); });
    back.querySelector('.m-x').addEventListener('click', () => finish(false));
  });
}

async function installWithPicker(a) {
  if (String(a.download?.type || '').toLowerCase() === 'installer') return attempt(() => hf.install(a.id));
  let root = S.settings.installRoot;
  const where = el('code', { class: 'iw-path' });
  const space = el('span', { class: 'hint' });
  const remember = el('input', { type: 'checkbox' });
  const rememberRow = el('label', { class: 'opt', hidden: true }, remember, el('span', { text: 'Use this folder for future installs too' }));
  const go = el('button', { class: 'btn', text: 'Install' });
  const draw = async () => {
    const w = await attempt(() => hf.installWhere(a.id, root));
    if (!w) return;
    where.textContent = w.dir;
    const need = w.size ? `download ${fmtBytes(w.size)}` : '';
    space.textContent = [w.free != null ? `${fmtBytes(w.free)} free on this drive` : '', need].filter(Boolean).join(' · ');
    space.classList.toggle('warn', w.free != null && w.size > 0 && w.free < w.size * 2.5);
    rememberRow.hidden = root === w.defaultRoot;
  };
  const change = el('button', { class: 'btn ghost', text: 'Change...', onclick: async () => {
    const p = await attempt(() => hf.pickInstallFolder(root));
    if (p) { root = p; draw(); }
  } });
  go.onclick = async () => {
    go.disabled = true;
    if (remember.checked && !rememberRow.hidden) await setS({ installRoot: root });
    closeModal('install');
    attempt(() => hf.install(a.id, root));
  };
  openModal('install', `install ${a.name || a.id}`, el('div', { class: 'dialog iw' },
    el('p', { text: 'It will be installed to:' }),
    el('div', { class: 'row iw-row' }, where, change),
    space,
    rememberRow,
    el('div', { class: 'acts' }, el('button', { class: 'btn ghost', text: 'Cancel', onclick: () => closeModal('install') }), go)));
  draw();
}

function closeMenus() { document.querySelectorAll('.menu').forEach(m => { m.hidden = true; }); }
function fillMenu(menu, items) {
  menu.replaceChildren(...items.map(it => {
    if (it === '-') return el('hr');
    const b = el('button', { class: it.danger ? 'danger' : '', html: ICONS[it.icon] || '', onclick: () => { closeMenus(); it.run(); } });
    b.append(el('span', { text: it.label }));
    return b;
  }));
}
document.addEventListener('mousedown', e => {
  if (!e.target.closest('.menu') && !e.target.closest('#play-more') && !e.target.closest('#account') && !e.target.closest('[data-menu-btn]')) closeMenus();
});
document.addEventListener('keydown', e => {
  if (e.key === 'F5' || (e.ctrlKey && e.key.toLowerCase() === 'r')) {
    e.preventDefault();
    if (tab === 'store') return storeReload();
    if (tab === 'profile') return profileReload();
    if (tab === 'friends') { hf.social().then(s => { social = s; renderFriendsTab(); }).catch(() => {}); loadRequests(); return; }
    attempt(async () => {
      const s = await hf.refresh();
      if (s.jsonBroken) return;
      toast(s.offline ? `Couldn't reach ikelene.net (${s.manifestError || 'offline'})` : 'Library refreshed.', s.offline ? 'err' : 'ok');
    });
    return;
  }
  if (e.key !== 'Escape') return;
  const open = document.querySelector('.modal-back[data-id]');
  if (open) { if (open.dataset.dismiss) closeModal(open.dataset.id); return; }
  if (document.querySelector('.menu:not([hidden])')) return closeMenus();
  if (libraryOpen) { libraryOpen = false; render(); return; }
  if (tab === 'store') storeBack();
  else if (tab === 'profile') profileBack();
});

const STATUS_TEXT = {
  install: 'not installed', update: 'update required!', repair: 'repair required!', ready: 'installed', running: 'running',
  downloading: 'downloading', paused: 'paused', verifying: 'verifying', installing: 'installing', unavailable: 'unavailable',
  external: 'opens in your browser', soon: 'coming soon', winonly: 'windows only',
};
const IS_MAC = hf.platform === 'darwin';
const WINONLY_TITLE = "This game only comes for Windows - there's no Mac version yet. You can still add it to your library or wishlist it.";
function winOnly(g) {
  if (!IS_MAC || !g || g.stage === 'soon') return false;
  if (Array.isArray(g.platforms) && g.platforms.length) return !g.platforms.includes('mac');
  return !!apps().find(x => x.id === g.id)?.winonly;
}
const stageOf = a => (a?.stage === 'early' || a?.stage === 'soon' ? a.stage : '');
function releaseDay(a) {
  if (stageOf(a) !== 'soon') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(a.releaseDate || ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? d : null;
}
const fmtRelease = (d, withYear = true) => d.toLocaleDateString('en-US', withYear ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric' });
function daysToRelease(d) {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return Math.round((d - t) / 86400000);
}
function releaseIn(a) {
  const d = releaseDay(a);
  const n = d ? daysToRelease(d) : -1;
  return n < 0 || n > 14 ? '' : n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`;
}
const capFirst = s => s.charAt(0).toUpperCase() + s.slice(1);
function stageInfo(a, short = false) {
  const kind = stageOf(a);
  if (!kind) return null;
  if (kind === 'early') return { kind, text: 'early access', title: "This game is in early access - it's still being made and things may change.", icon: 'sparkles' };
  const d = releaseDay(a);
  const dated = d && daysToRelease(d) >= 0;
  const year = !short || (dated && d.getFullYear() !== new Date().getFullYear());
  return { kind, text: dated ? `coming ${fmtRelease(d, year)}` : 'coming soon', title: `This game isn't out yet.${dated ? ` Planned for ${fmtRelease(d)}.` : ''}`, icon: 'calendar' };
}
function iconEl(a, cls) {
  const letter = () => el('span', { class: 'letter', text: (a.name || a.id)[0].toUpperCase() });
  if (!a.icon) return letter();
  const img = el('img', { src: a.icon, alt: '', class: cls });
  img.addEventListener('error', () => img.replaceWith(letter()), { once: true });
  return img;
}
const pinnedIds = () => (Array.isArray(S?.settings?.pinned) ? S.settings.pinned : []);
const isPinned = id => pinnedIds().includes(id);
function togglePin(id) {
  const next = isPinned(id) ? pinnedIds().filter(x => x !== id) : [...pinnedIds(), id];
  S.settings.pinned = next;
  hf.setSettings({ pinned: next }).catch(() => {});
  render();
}
function pinBtn(a) {
  const on = isPinned(a.id);
  return el('span', {
    class: 'pin' + (on ? ' on' : ''), role: 'button', title: on ? 'Unpin' : 'Pin to top', html: ICONS.pin,
    onclick: e => { e.stopPropagation(); togglePin(a.id); },
  });
}
function sortGames(list) {
  const pins = pinnedIds();
  const last = a => S.installed[a.id]?.lastPlayed || 0;
  const pinned = list.filter(a => pins.includes(a.id)).sort((a, b) => pins.indexOf(a.id) - pins.indexOf(b.id));
  const rest = list.filter(a => !pins.includes(a.id)).map((a, i) => [a, i])
    .sort((x, y) => (last(y[0]) - last(x[0])) || (x[1] - y[1])).map(x => x[0]);
  return [...pinned, ...rest];
}
function librarySections() {
  const all = libraryList();
  return [
    { title: 'hyperfocus games', list: sortGames(all.filter(a => !a.community)) },
    { title: 'community games', list: sortGames(all.filter(a => a.community)) },
  ].filter(s => s.list.length);
}
const busyPct = id => (['verifying', 'installing'].includes(S.status[id]) ? 100 : pct(S.jobs[id]));

let libQuery = '';
const RECENT_MAX = 5;
const lastPlayedOf = a => Math.max(S.installed[a.id]?.lastPlayed || 0, S.installedBetas?.[a.id]?.lastPlayed || 0);
const byName = (x, y) => (x.name || x.id).localeCompare(y.name || y.id, undefined, { sensitivity: 'base' });
function libraryGroups() {
  const list = libraryList();
  const q = libQuery.trim().toLowerCase();
  if (q) return [{ key: 'results', title: 'results', list: list.filter(a => [a.name, a.id, a.author].some(v => String(v || '').toLowerCase().includes(q))).sort(byName) }];
  const pins = pinnedIds();
  const pinned = list.filter(a => pins.includes(a.id)).sort((x, y) => pins.indexOf(x.id) - pins.indexOf(y.id));
  const rest = list.filter(a => !pins.includes(a.id));
  const recent = rest.filter(a => lastPlayedOf(a) > 0).sort((x, y) => lastPlayedOf(y) - lastPlayedOf(x)).slice(0, RECENT_MAX);
  return [
    { key: 'pinned', title: 'pinned', list: pinned },
    { key: 'recent', title: 'recently played', list: recent },
    { key: 'az', title: pinned.length || recent.length ? 'all games' : 'games', list: rest.filter(a => !recent.includes(a)).sort(byName) },
  ].filter(g => g.list.length);
}
const libraryOrder = () => libraryGroups().flatMap(g => g.list);
function rowJobKey(a) {
  if (BUSY.includes(S.status[a.id])) return a.id;
  return chosenBeta(a) && BUSY.includes(S.status[a.id + BETA]) ? a.id + BETA : null;
}
function rowStatus(a) {
  if (gameRunning(a)) return [betaRunning(a) ? `playing ${chosenBeta(a)?.name || 'the beta'}` : isGame(a) ? 'playing now' : 'open now', 'run'];
  const jk = rowJobKey(a);
  if (jk) {
    const s = S.status[jk], who = jk === a.id ? '' : 'beta ';
    const had = jk === a.id ? S.installed[a.id] : S.installedBetas?.[a.id];
    return [s === 'downloading' ? `${who}${had ? 'updating' : 'downloading'} ${busyPct(jk)}%` : s === 'paused' ? `${who}paused · ${busyPct(jk)}%` : `${who}${s}...`, 'busy'];
  }
  const st = effStatus(a) || 'unavailable';
  switch (st) {
    case 'ready': return ['installed', 'ok'];
    case 'update': return ['update available', 'upd'];
    case 'repair': return ['repair needed', 'upd'];
    case 'install': return [chosenBeta(a) && S.status[a.id + BETA] === 'ready' ? 'beta installed' : 'not installed', ''];
    case 'buy': { const p = priceView(a); return [p.sale ? `on sale · ${credits(p.now)}` : credits(p.full), 'buy']; }
    case 'soon': return [stageInfo(a, true)?.text || 'coming soon', 'soon'];
    case 'external': return ['opens in your browser', ''];
    case 'winonly': return ['windows only', ''];
    default: return ['unavailable', ''];
  }
}
function rowAction(a) {
  const st = effStatus(a);
  if (!['ready', 'install', 'update', 'repair', 'paused', 'downloading', 'buy', 'external'].includes(st)) return null;
  const [label, icon] = labelFor(a, st, S.jobs[a.id]);
  return st === 'ready' ? [label, 'trailer'] : st === 'downloading' ? ['Pause', 'pause'] : st === 'buy' ? [`Buy · ${credits(priceView(a).now)}`, 'tag'] : [label, icon];
}
let rowsSeen = new Set();
function libRow(a, i) {
  const [text, cls] = rowStatus(a);
  const jk = rowJobKey(a);
  const stage = stageInfo(a, true);
  const beta = chosenBeta(a);
  const p = priceView(a);
  const act = rowAction(a);
  const fresh = !rowsSeen.has(a.id);
  return el('button', {
    class: `lib-row${a.id === sel ? ' active' : ''}${jk ? ` busy st-${S.status[jk]}` : ''}${fresh ? ' lr-new' : ''}`, 'data-id': a.id,
    style: fresh ? `animation-delay:${Math.min(i, 14) * 22}ms` : null,
    onclick: () => selectApp(a.id), ondblclick: () => primaryAction(a),
    onmouseenter: e => showHover(a.id, e.currentTarget, 'right'), onmouseleave: hideHover,
  },
  el('span', { class: 'lr-ico' }, iconEl(a)),
  el('span', { class: 'lr-txt' },
    el('span', { class: 'lr-name' }, el('span', { class: 'lr-n', text: a.name || a.id }),
      stage ? el('span', { class: `lr-tag ${stage.kind}`, title: stageInfo(a).title, text: stage.kind === 'early' ? 'early' : 'soon' }) : null,
      beta ? el('span', { class: 'lr-beta', title: `Beta: ${beta.name}`, html: ICONS.flask }) : null,
      effStatus(a) === 'buy' && p.sale ? el('span', { class: 'lr-sale', title: `On sale until ${new Date(p.until).toLocaleString()}`, text: `-${p.off}%` }) : null),
    el('span', { class: `lr-st ${cls}`, text })),
  act ? el('span', { class: 'lr-play', role: 'button', title: act[0], html: ICONS[act[1]], onclick: e => { e.stopPropagation(); hideNow(); primaryAction(a); } }) : null,
  jk ? el('span', { class: 'lr-prog' }, el('i', { style: `width:${busyPct(jk)}%` })) : null);
}
function renderLibList() {
  const groups = libraryGroups();
  const box = $('#app-list');
  const key = JSON.stringify([groups.map(g => [g.key, g.title, g.list.map(a => [a.id, a.name, a.icon, S.status[a.id], S.status[a.id + BETA], gameRunning(a),
    stageInfo(a, true)?.text, chosenBeta(a)?.name, a.price, a.owned, a.sale])]), sel, libQuery]);
  if (keys.side !== key) {
    keys.side = key;
    let i = 0;
    const nodes = groups.flatMap(g => [el('div', { class: 'ls-h' }, el('span', { text: g.title }), el('span', { class: 'ls-n', text: String(g.list.length) })),
      ...g.list.map(a => libRow(a, i++))]);
    if (!nodes.length) nodes.push(el('div', { class: 'ls-empty', text: libQuery.trim() ? `Nothing in your library matches "${libQuery.trim()}".` : 'Your library is empty - games you add from the store show up here.' }));
    box.replaceChildren(...nodes);
    rowsSeen = new Set([...rowsSeen, ...groups.flatMap(g => g.list.map(a => a.id))]);
  }
  for (const r of box.querySelectorAll('.lib-row.busy')) {
    const a = apps().find(x => x.id === r.dataset.id);
    const jk = a && rowJobKey(a);
    if (!jk) continue;
    const bar = r.querySelector('.lr-prog i');
    if (bar) bar.style.width = `${busyPct(jk)}%`;
    const line = r.querySelector('.lr-st');
    if (line) line.textContent = rowStatus(a)[0];
  }
  const n = libraryList().length;
  $('#lib-count').textContent = `${n} ${n === 1 ? 'game' : 'games'}`;
}
$('#lib-q').addEventListener('input', e => { libQuery = e.target.value; renderLibList(); });
$('#lib-q').addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !e.target.value) return;
  e.stopPropagation();
  e.target.value = libQuery = '';
  renderLibList();
});
document.querySelector('#lib-top .lq-ico').innerHTML = ICONS.search;
$('#lib-browse').replaceChildren(el('span', { class: 'btn-ico', html: ICONS.store }), el('span', { text: 'Browse the store' }));
$('#lib-browse').addEventListener('click', () => setTab('store'));

let libShown = false;
function renderLibraryView() {
  const libEl = $('#library');
  if (libraryOpen && !libShown) { libEl.classList.remove('closing'); libEl.hidden = false; }
  if (!libraryOpen && libShown && !reduceMotion()) {
    libEl.classList.add('closing');
    setTimeout(() => { if (!libraryOpen) { libEl.hidden = true; libEl.classList.remove('closing'); } }, 200);
  } else if (!libraryOpen) libEl.hidden = true;
  libShown = libraryOpen;
  document.body.classList.toggle('lib-open', libraryOpen);
  $('#btn-library').classList.toggle('active', libraryOpen);
  if (!libraryOpen) return;
  const sections = librarySections();
  const list = sections.flatMap(s => s.list);
  const key = JSON.stringify([sections.map(s => s.list.map(a => [a.id, a.icon, a.name, a.card, a.background, a.type, a.rankRequired, a.author, S.status[a.id], isPinned(a.id), a.stage, a.releaseDate])), sel]);
  if (keys.libv !== key) {
    keys.libv = key;
    $('#lib-grid').replaceChildren(...sections.flatMap(sec => [sections.length > 1 ? el('div', { class: 'lib-sec', text: sec.title }) : null, ...sec.list.map((a, i) => {
      const st = S.status[a.id];
      const busy = BUSY.includes(st);
      const art = a.card || a.background;
      return el('button', {
        class: 'lib-card' + (a.id === sel ? ' active' : '') + (busy ? ` busy st-${st}` : ''), 'data-id': a.id,
        style: `animation-delay:${i * 35}ms`, title: a.name || a.id, onclick: () => selectApp(a.id),
      },
      art ? el('img', { class: 'lc-art', src: art, alt: '' }) : el('span', { class: 'lc-art none' }),
      stageTag(a),
      busy ? el('span', { class: 'row-prog lc-prog' }, el('i')) : null,
      el('div', { class: 'lc-foot' },
        iconEl(a, 'lc-ico'),
        el('div', { class: 'lc-text' },
          el('div', { class: 'lc-name' }, a.name || a.id,
            a.rankRequired ? el('span', { class: 'tag', title: `${a.rankRequired} and up only`, text: String(a.rankRequired).toLowerCase() }) : null),
          el('div', { class: 'lc-st' + (st === 'update' || st === 'repair' ? ' upd' : ''), text: `${a.community ? `by ${a.author || '?'}` : a.type.toLowerCase()} · ${STATUS_TEXT[st] || ''}` })),
        pinBtn(a)));
    })]).filter(Boolean));
  }
  for (const c of $('#lib-grid').querySelectorAll('.lib-card.busy')) {
    const id = c.dataset.id;
    const p = busyPct(id);
    const bar = c.querySelector('.lc-prog i');
    if (bar) bar.style.width = `${p}%`;
    const st = S.status[id];
    const a = list.find(x => x.id === id);
    c.querySelector('.lc-st').textContent = `${a.type.toLowerCase()} · ${st === 'downloading' ? `${S.installed[id] ? 'updating' : 'downloading'} ${p}%` : STATUS_TEXT[st]}`;
  }
}
function stageTag(a) {
  const short = stageInfo(a, true);
  return short ? el('span', { class: `lc-stage ${short.kind}`, title: stageInfo(a).title, text: short.text }) : null;
}
function selectApp(id) {
  const wasLib = libraryOpen;
  libraryOpen = false;
  if (sel === id && !wasLib) return;
  sel = id;
  closeMenus();
  hf.setSettings({ lastApp: id }).catch(() => {});
  render();
  loadShots(id);
}
function reduceMotion() { return document.documentElement.classList.contains('no-anim') || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; }
$('#btn-library').innerHTML = ICONS.grid;
$('#btn-library').addEventListener('click', () => {
  closeMenus();
  if (tab !== 'library') setTab('library');
  libraryOpen = !libraryOpen;
  render();
});
$('#btn-browse').replaceChildren(el('span', { class: 'btn-ico', html: ICONS.store }), el('span', { text: 'Browse the store' }));
$('#btn-browse').addEventListener('click', () => { libraryOpen = false; setTab('store'); });

const TABS = ['store', 'library', 'friends', 'profile'];
const VELORA_TABS = ['store', 'friends', 'profile'];
let tab = (() => { try { return localStorage.getItem('hf-tab') || ''; } catch { return ''; } })();
if (!TABS.includes(tab)) tab = '';
let tabBooted = false, tabShown = '';
const TAB_ICONS = { store: 'store', library: 'library' };
document.querySelectorAll('.mtab').forEach(b => {
  const ico = b.querySelector('.mt-ico');
  if (ico) ico.innerHTML = ICONS[TAB_ICONS[b.dataset.tab]];
  b.addEventListener('click', () => (b.dataset.tab === 'store' && tab === 'store' ? storeHome()
    : b.dataset.tab === 'profile' && tab === 'profile' ? profileHome() : setTab(b.dataset.tab)));
});
const tabUsable = t => TABS.includes(t) && (!VELORA_TABS.includes(t) || (!!S && !S.offlineMode && (t === 'store' || !!S.account)));
function setTab(t) {
  if (!tabUsable(t)) t = 'library';
  if (t === tab) return;
  tab = t;
  tabBooted = true;
  try { localStorage.setItem('hf-tab', t); } catch {  }
  closeMenus();
  hideNow();
  render();
}
function switchTab() {
  const list = TABS.filter(tabUsable);
  setTab(list[(list.indexOf(tab) + 1) % list.length] || 'library');
}
function renderTabs() {
  if (!tabBooted && ((S.manifestChecked && S.account) || S.offlineMode)) {
    tabBooted = true;
    if (!S.offlineMode && !libraryList().length) tab = 'store';
  }
  if (!tab || !tabUsable(tab)) tab = 'library';
  $('#lib-view').hidden = tab !== 'library';
  $('#store').hidden = tab !== 'store';
  $('#friends-view').hidden = tab !== 'friends';
  $('#profile-view').hidden = tab !== 'profile';
  document.body.dataset.tab = tab;
  document.querySelectorAll('.mtab').forEach(b => {
    b.classList.toggle('on', b.dataset.tab === tab);
    if (b.dataset.tab === 'friends' || b.dataset.tab === 'profile') b.hidden = !tabUsable(b.dataset.tab);
  });
  renderMeTab();
  renderFriendsChip();
  if (tab !== tabShown) {
    const first = !tabShown;
    tabShown = tab;
    document.querySelectorAll('#bg video').forEach(v => (tab === 'library' && visible && !trailer ? v.play().catch(() => {}) : v.pause()));
    if (!first && !reduceMotion()) {
      const view = { store: $('#store'), friends: $('#friends-view'), profile: $('#profile-view') }[tab] || $('#lib-view');
      view.classList.remove('tab-in');
      void view.offsetWidth;
      view.classList.add('tab-in');
    }
  }
  placeTabInk();
}
addEventListener('resize', () => placeTabInk());
function placeTabInk() {
  const on = document.querySelector('.mtab.on'), ink = $('#mtab-ink');
  if (!on || !on.offsetWidth) return;
  ink.style.width = `${on.offsetWidth}px`;
  ink.style.transform = `translateX(${on.offsetLeft}px)`;
  ink.classList.add('on');
}
function openGame(id) {
  const a = apps().find(x => x.id === id);
  if (a && inLibrary(a)) { setTab('library'); selectApp(id); }
  else if (!S?.offlineMode) { setTab('store'); openStorePage(id); }
}

const needLogin = () => !!S && !!S.manifestChecked && !S.serverDown && !S.offlineMode && !S.account;
let gateKey = '';
function renderLoginGate() {
  const on = needLogin();
  $('#login-gate').hidden = !on || !revealed;
  document.body.classList.toggle('need-login', on);
  if (!on) { gateKey = ''; return; }
  const key = String(loginBusy);
  if (gateKey === key) return;
  gateKey = key;
  $('#lg-act').replaceChildren(...(loginBusy ? [
    el('div', { class: 'lg-wait' }, el('span', { class: 'lg-spin', html: ICONS.spinner }),
      el('span', { text: "Nookara opened in your browser - sign in there and approve Hyperfocus. This page updates by itself once you're done." })),
    el('div', { class: 'lg-row' },
      el('button', { class: 'btn ghost', text: 'Reopen the page', onclick: () => hf.reopenLogin() }),
      el('button', { class: 'btn ghost', text: 'Cancel', onclick: () => { hf.cancelLogin(); loginBusy = false; renderLoginGate(); } })),
  ] : [
    el('button', { class: 'btn lg-go', onclick: () => startLogin() }, el('span', { class: 'btn-ico vl-mark', html: ICONS.veloraLogo }), el('span', { text: 'Sign in with Nookara' })),
    el('div', { class: 'lg-new' }, el('span', { text: 'New to Nookara? ' }),
      el('a', { href: '#', text: 'Create an account', onclick: e => { e.preventDefault(); hf.openUrl('https://nookara.cc/register'); } })),
  ]));
}
$('#lg-min').innerHTML = ICONS.min;
$('#lg-close').innerHTML = ICONS.close;
$('#lg-min').addEventListener('click', () => hf.win.minimize());
$('#lg-close').addEventListener('click', () => $('#btn-close').click());

const safeColor = c => (/^#[0-9a-f]{3,8}$/i.test(String(c || '')) ? c : '');
function avatarEl(acc) {
  const letter = () => el('span', { class: 'avatar', text: (acc.username || '?')[0].toUpperCase(), style: `background:${safeColor(acc.color) || 'var(--palegreen)'}` });
  if (!acc.pfp) return letter();
  const img = el('img', { class: 'avatar', src: acc.pfp, alt: '' });
  img.addEventListener('error', () => img.replaceWith(letter()), { once: true });
  return img;
}
const unreadCount = () => S?.social?.unread || social?.unread || 0;
const requestCount = () => social?.requests || 0;
const VL_DEFAULT = '#9d8ad1';
function applyVeloraAccent(color) {
  const hex = /^#[0-9a-f]{6}$/i.test(String(color || '')) && !/^#f{6}$/i.test(color) ? color : VL_DEFAULT;
  const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const root = document.documentElement.style;
  root.setProperty('--vl', hex);
  root.setProperty('--vl-dim', `rgba(${r}, ${g}, ${b}, .14)`);
  root.setProperty('--vl-glow', `rgba(${r}, ${g}, ${b}, .35)`);
  root.setProperty('--vl-ink', (r * 299 + g * 587 + b * 114) / 1000 > 140 ? '#16141c' : '#ffffff');
  try { localStorage.setItem('hf-vl-accent', hex); } catch {  }
}
try { applyVeloraAccent(localStorage.getItem('hf-vl-accent')); } catch { applyVeloraAccent(null); }

function renderAccount() {
  const acc = S.account;
  applyVeloraAccent(acc?.color);
  const n = acc ? unreadCount() + requestCount() : 0;
  const key = JSON.stringify([acc, n]);
  if (keys.acc === key) return;
  keys.acc = key;
  const btn = $('#account');
  if (acc) {
    btn.replaceChildren(...[avatarEl(acc), el('span', { class: 'uname', text: acc.username, style: safeColor(acc.color) ? `color:${safeColor(acc.color)}` : null }),
      n ? el('span', { class: 'count', text: n > 99 ? '99+' : String(n) }) : null].filter(Boolean));
    btn.title = n ? `${acc.username} · ${unreadCount()} unread, ${requestCount()} friend requests` : `Logged in to Nookara as ${acc.username}`;
  } else {
    btn.replaceChildren(el('span', { class: 'uico vl-mark', html: ICONS.veloraLogo }), el('span', { class: 'uname', text: 'log in with Nookara' }));
    btn.title = 'Log in with your Nookara account';
  }
}
$('#account').addEventListener('click', () => {
  if (!S.account) return startLogin();
  const m = $('#account-menu');
  const wasOpen = !m.hidden;
  closeMenus();
  if (wasOpen) return;
  const unread = unreadCount(), reqs = requestCount();
  const inRoom = voiceNow?.status === 'connected' && voiceNow.room;
  fillMenu(m, [
    ...(S.social?.needsRelogin ? [{ label: 'Log in again (messages & friends)', icon: 'veloraLogo', run: () => startLogin() }] : []),
    { label: unread ? `Messages (${unread})` : 'Messages', icon: 'mail', run: () => hf.openMessages() },
    { label: reqs ? `Friends (${reqs} request${reqs > 1 ? 's' : ''})` : 'Friends', icon: 'userPlus', run: () => hf.openPanel('friends') },
    { label: inRoom ? 'Voice Chat (in a room)' : 'Voice Chat', icon: 'mic', run: () => hf.openPanel('voice') },
    '-',
    ...(S.account?.rank === 'owner' ? [{ label: 'Dashboard', icon: 'grid', run: () => openDashboard() }] : []),
    { label: 'Account Center', icon: 'idcard', run: () => hf.accountCenter() },
    { label: 'Log Out', icon: 'logout', run: async () => { await attempt(() => hf.logout()); toast('Logged out. see you soon!'); } },
  ]);
  m.hidden = false;
});
hf.on('social', s => { social = s; if (S) { renderAccount(); renderFriends(cur()); if (domReady) { renderFriendsTab(); renderProfileTab(); } } });
hf.social().then(s => { social = s; if (S) { renderAccount(); if (domReady) { renderFriendsTab(); renderProfileTab(); } } }).catch(() => {});

function renderVoiceBtn() {
  const inRoom = voiceNow?.status === 'connected' && !!voiceNow.room;
  $('#btn-voice').hidden = !inRoom;
  if (inRoom) $('#btn-voice').title = `In a voice room with ${(voiceNow.users || []).length} ${(voiceNow.users || []).length === 1 ? 'person' : 'people'} - open voice chat`;
}
$('#btn-voice').innerHTML = ICONS.mic;
$('#btn-voice').addEventListener('click', () => hf.openPanel('voice'));
hf.on('voice', s => { voiceNow = s; renderVoiceBtn(); });
hf.voiceGet().then(s => { voiceNow = s; renderVoiceBtn(); }).catch(() => {});

let loginBusy = false;
async function startLogin() {
  if (loginBusy) return;
  loginBusy = true;
  if (needLogin()) renderLoginGate();
  else openModal('login', 'log in with Nookara', el('div', { class: 'dialog' },
    el('p', { text: "Nookara just opened in your browser - log in there and approve Hyperfocus. This window updates by itself once you're done :3" }),
    el('div', { class: 'acts' },
      el('button', { class: 'btn ghost', text: 'Cancel', onclick: () => { hf.cancelLogin(); closeModal('login'); loginBusy = false; } }),
      el('button', { class: 'btn', text: 'Reopen login page', onclick: () => hf.reopenLogin() }))),
  { dismiss: false });
  try {
    await hf.login();
  } catch (e) {
    closeModal('login');
    loginBusy = false;
    if (S) renderLoginGate();
    toast(e.message, 'err');
  }
}
hf.on('login', d => {
  if (d.state === 'done') {
    loginBusy = false;
    closeModal('login');
    if (S) renderLoginGate();
    toast(`haii ${S?.account?.username || ''}! you're logged in :3`, 'ok');
  } else if (d.state === 'expired') {
    loginBusy = false;
    closeModal('login');
    if (S) renderLoginGate();
    toast('Login timed out - try again whenever.', 'err');
  }
});
let reloginNudged = false;
function nudgeRelogin() {
  if (S.account && S.social?.needsRelogin && !reloginNudged) {
    reloginNudged = true;
    toast('New: messages, friends & playtime! Log in with Nookara again to turn them on :3');
  }
}

const shots = {};
const thumbs = new Map();
async function loadShots(id) {
  if (!id) return;
  try { shots[id] = await hf.shotsList(id); } catch { shots[id] = shots[id] || []; }
  const a = cur();
  if (a && a.id === id) drawShots(a);
}
function thumbFor(file) {
  if (!thumbs.has(file)) thumbs.set(file, hf.shotThumb(file).catch(() => null));
  return thumbs.get(file);
}
const achList = a => Object.entries(a?.achievements && typeof a.achievements === 'object' && !Array.isArray(a.achievements) ? a.achievements : {})
  .filter(([id, d]) => d && typeof d === 'object').map(([id, d]) => ({ id, ...d }));
const achStats = {};
let achKey = '';
let achAll = false;
try { achAll = localStorage.getItem('hf-ach-all') === '1'; } catch {}
function loadAchStats(a, sig) {
  const hit = achStats[a.id];
  if (hit && !hit.loading && sig !== undefined && hit.sig !== undefined && hit.sig !== sig) hit.at = 0;
  if (hit) hit.sig = sig;
  if (hit && (hit.loading || Date.now() - hit.at < 120000)) return;
  achStats[a.id] = { ...(hit || {}), loading: true, sig };
  hf.achStats(a.id).then(d => { achStats[a.id] = { at: Date.now(), data: d, sig }; }, () => { achStats[a.id] = { at: Date.now(), data: hit?.data || null, sig }; })
    .finally(() => { const c = cur(); if (c && c.id === a.id) { achKey = ''; drawAchWidget(c); } });
}
const fmtDay = t => new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
let stageKey = '';
function renderStageBadge(a) {
  const box = $('#stage-badge');
  const info = a ? stageInfo(a) || (winOnly(a) ? { kind: 'win', text: 'windows only', title: WINONLY_TITLE, icon: 'windows' } : null) : null;
  if (!info) { box.hidden = true; stageKey = ''; return; }
  const key = JSON.stringify([a.id, info.text]);
  if (key !== stageKey) {
    stageKey = key;
    box.className = info.kind;
    box.title = info.title;
    box.replaceChildren(el('span', { class: 'sb-ico', html: ICONS[info.icon] }), el('span', { text: info.text }));
  }
  box.hidden = false;
}
function achIcon(x, masked, cls = 'aw-i') {
  const none = () => el('span', { class: `${cls} none`, html: masked ? '' : ICONS.trophy, text: masked ? '?' : null });
  if (masked || !x.icon) return none();
  const img = el('img', { class: cls, src: x.icon, alt: '' });
  img.addEventListener('error', () => img.replaceWith(none()), { once: true });
  return img;
}
function drawAchWidget(a) {
  renderStageBadge(a);
  renderTrailerBtn(a);
  const box = $('#ach-widget');
  const list = a ? achList(a) : [];
  const have = S?.achievements || {};
  const got = list.filter(x => have[x.id]).length;
  renderAchStat(list, got);
  if (!list.length) { box.hidden = true; achKey = ''; return; }
  loadAchStats(a, list.filter(x => have[x.id]).map(x => x.id).join(','));
  const st = achStats[a.id]?.data;
  const key = JSON.stringify([a.id, achAll, list.map(x => [x.id, x.name, x.icon, x.hidden, x.rarity, x.description]), list.map(x => have[x.id] || 0), st]);
  if (key !== achKey) {
    achKey = key;
    const perfect = got === list.length;
    const pctGot = Math.round(got / list.length * 100);
    box.classList.toggle('perfect', perfect);
    const order = new Map(list.map((x, i) => [x.id, i]));
    list.sort((x, y) => {
      const hx = x.hidden && !have[x.id] ? 1 : 0, hy = y.hidden && !have[y.id] ? 1 : 0;
      return hx - hy || (st?.achievements?.[y.id]?.percent || 0) - (st?.achievements?.[x.id]?.percent || 0)
        || order.get(x.id) - order.get(y.id);
    });
    const head = el('div', { class: 'box-h gv-bh' }, el('span', { class: 'bh-ico', html: ICONS.trophy }), el('span', { class: 'grow', text: 'achievements' }),
      el('span', { class: 'gv-bn', text: `${got} / ${list.length}` }));
    const sum = perfect
      ? el('div', { class: 'aw-sum perfect', title: 'You unlocked every achievement in this game!' }, el('span', { class: 'aw-pg', html: ICONS.trophy }), el('b', { text: 'Perfect Game' }))
      : el('div', { class: 'aw-sum' }, el('span', { class: 'aw-st', text: got ? `You've unlocked ${got} of ${list.length} (${pctGot}%)` : `0 of ${list.length} unlocked` }),
        el('i', { class: 'aw-bar' }, el('i', { style: `width:${pctGot}%` })));
    const recent = list.filter(x => have[x.id]).sort((x, y) => have[y.id] - have[x.id]).slice(0, 3);
    const recentBox = recent.length
      ? el('div', { class: 'aw-recent' }, el('div', { class: 'aw-sub', text: 'recently unlocked' }), ...recent.map(x => el('div', { class: `aw-rrow${x.rarity === 'rare' ? ' rare' : ''}` },
        achIcon(x, false), el('div', { class: 'aw-txt' }, el('b', { text: x.name || x.id }),
          el('span', { class: 'aw-when', text: `unlocked ${agoText(have[x.id])}`, title: new Date(have[x.id]).toLocaleString() })))))
      : el('div', { class: 'aw-none', text: "Nothing unlocked yet - the ones you earn show up here." });
    const locked = list.filter(x => !have[x.id]);
    const LOCK_MAX = 7;
    const lockedBox = locked.length && !perfect ? el('div', { class: 'aw-locked' }, el('div', { class: 'aw-sub', text: `locked · ${locked.length}` }),
      el('div', { class: 'aw-lgrid' }, ...locked.slice(0, LOCK_MAX).map(x => {
        const masked = !!x.hidden;
        const t = el('span', { class: 'aw-lt', title: masked ? 'Hidden achievement' : [x.name || x.id, x.description].filter(Boolean).join('\n') }, achIcon(x, masked, 'aw-li'));
        return t;
      }), locked.length > LOCK_MAX ? el('span', { class: 'aw-lt more', text: `+${locked.length - LOCK_MAX}` }) : null)) : null;
    const rows = achAll ? el('div', { class: 'aw-list' }, ...list.map(x => {
      const on = !!have[x.id];
      const masked = x.hidden && !on;
      const rare = x.rarity === 'rare' && !masked;
      const pctOf = st?.achievements?.[x.id]?.percent ?? 0;
      const pctText = st && st.players ? `${pctOf}% of players` : '';
      return el('div', { class: `aw-row${on ? ' on' : ' locked'}${rare ? ' rare' : ''}` },
        achIcon(x, masked),
        el('div', { class: 'aw-txt' },
          el('b', { text: masked ? 'Hidden Achievement' : x.name || x.id }),
          el('span', { class: 'aw-d', text: masked ? 'Earn this to view it!' : x.description || '' }),
          el('span', { class: 'aw-m' },
            on ? el('span', { class: 'aw-when', text: `unlocked ${fmtDay(have[x.id])}`, title: new Date(have[x.id]).toLocaleString() }) : el('span', { text: 'locked' }),
            rare ? el('span', { class: 'aw-rare', text: 'rare' }) : null),
          pctText ? el('span', { class: 'aw-pct', title: `${st.achievements?.[x.id]?.count || 0} of ${st.players} player${st.players === 1 ? '' : 's'} who launched it` },
            el('i', { class: 'aw-pbar' }, el('i', { style: `width:${Math.min(100, Math.max(0, pctOf))}%` })),
            el('span', { text: pctText })) : null));
    })) : null;
    const more = el('button', { class: 'aw-more', onclick: () => {
      achAll = !achAll;
      try { localStorage.setItem('hf-ach-all', achAll ? '1' : '0'); } catch {}
      achKey = '';
      drawAchWidget(cur());
    } }, el('span', { text: achAll ? 'Hide the full list' : `Show all ${list.length} achievements` }), el('span', { class: `aw-chev${achAll ? ' up' : ''}`, html: ICONS.right }));
    box.replaceChildren(...[head, el('div', { class: 'aw-body' }, ...[sum, recentBox, lockedBox, rows].filter(Boolean)), more]);
  }
  box.hidden = false;
}
function renderAchStat(list, got) {
  const box = $('#st-ach');
  box.hidden = !list.length;
  if (!list.length) return fitStats();
  $('#stat-ach').textContent = `${got} / ${list.length}`;
  $('#stat-ach-bar').style.width = `${Math.round(got / list.length * 100)}%`;
  box.classList.toggle('perfect', got === list.length);
  box.title = got === list.length ? 'Perfect Game - every achievement unlocked' : `${list.length - got} still to unlock`;
  fitStats();
}

const httpsUrl = s => (/^https:\/\//i.test(String(s || '').trim()) ? String(s).trim() : '');
const trailerOf = a => (a && S && !S.offlineMode ? httpsUrl(a.trailer) : '');
$('#trailer-btn').replaceChildren(el('span', { class: 'tb-ico', html: ICONS.trailer }), el('span', { text: 'Watch trailer' }));
$('#trailer-btn').addEventListener('click', () => openTrailer(cur()));
function renderTrailerBtn(a) { $('#trailer-btn').hidden = !trailerOf(a); }
function openTrailer(a) {
  const url = trailerOf(a);
  if (!a || !url || trailer) return;
  closeMenus();
  const poster = httpsUrl(a.trailerPoster);
  const video = el('video', { class: 'tr-video', controls: true, autoplay: true, playsinline: true, preload: 'auto', poster: poster || null });
  video.src = url;
  const err = el('div', { class: 'tr-err', hidden: true, text: "Couldn't play this trailer." });
  video.addEventListener('error', () => { err.hidden = false; });
  video.addEventListener('click', e => { if (!e.isTrusted) (video.paused ? video.play().catch(() => {}) : video.pause()); });
  const back = openModal('trailer', `${a.name || a.id} · trailer`, el('div', { class: 'tr-wrap' }, video, err));
  back.classList.add('trailer-back');
  trailer = { id: a.id, url, video };
  document.querySelectorAll('#bg video').forEach(v => v.pause());
  syncMusic();
  video.play().catch(() => {});
}
function stopTrailer() {
  const t = trailer;
  if (!t) return;
  trailer = null;
  try { t.video.pause(); t.video.removeAttribute('src'); t.video.removeAttribute('poster'); t.video.load(); } catch {  }
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  if (visible) document.querySelectorAll('#bg video').forEach(v => v.play().catch(() => {}));
  syncMusic();
}
document.addEventListener('keydown', e => {
  if (!trailer || e.code !== 'Space' || e.target === trailer.video) return;
  e.preventDefault();
  if (e.repeat) return;
  if (trailer.video.paused) trailer.video.play().catch(() => {}); else trailer.video.pause();
});
document.addEventListener('keyup', e => { if (trailer && e.code === 'Space' && e.target !== trailer.video) e.preventDefault(); });

const SHOTS_MAX = 5;
let shotsKey = '';
function drawShots(a) {
  const box = $('#gv-shots');
  const list = (a && shots[a.id]) || [];
  const inst = a && (S.installed[a.id] || S.installedBetas?.[a.id]);
  box.hidden = !a || (!list.length && !inst);
  if (box.hidden) { shotsKey = ''; return; }
  const hk = S.settings.screenshotHotkey || 'F11';
  const key = JSON.stringify([a.id, list.map(s => s.file), hk]);
  if (key === shotsKey) return;
  shotsKey = key;
  $('#shots-n').textContent = list.length ? String(list.length) : '';
  const folder = el('button', { class: 'shot-folder', title: 'Open the screenshots folder', onclick: () => attempt(() => hf.shotFolder(a.id)) },
    el('span', { html: ICONS.folder }), el('span', { text: list.length > SHOTS_MAX ? `+${list.length - SHOTS_MAX} more` : 'open folder' }));
  $('#shot-strip').classList.toggle('empty', !list.length);
  $('#shot-strip').replaceChildren(...(list.length ? [
    ...list.slice(0, SHOTS_MAX).map(s => {
      const img = el('img', { alt: '' });
      thumbFor(s.file).then(u => { if (u) img.src = u; });
      return el('button', { class: 'shot', title: new Date(s.time).toLocaleString(), onclick: () => openShot(s.file) }, img);
    }), folder,
  ] : [
    el('div', { class: 'shots-none', text: hk === 'off'
      ? 'No screenshots yet. Turn on a screenshot key in Settings to take some while you play.'
      : `No screenshots yet - press ${hk} while you play.` }), folder,
  ]));
}
async function openShot(file) {
  const a = cur();
  if (a) await loadShots(a.id);
  let list = (a && shots[a.id]) || [];
  let i = list.findIndex(s => s.file === file);
  if (i < 0) { list = [{ file, name: String(file).split(/[\\/]/).pop(), time: Date.now(), url: null }]; i = 0; }
  const img = el('img', { class: 'sv-img', alt: '' });
  const when = el('span', { class: 'sv-name grow' });
  const link = el('div', { class: 'sv-link', hidden: true });
  const up = el('button', { class: 'btn' }, el('span', { html: ICONS.upload }), el('span', { text: 'upload to Nookara' }));
  const setLink = url => {
    link.hidden = !url;
    up.hidden = !!url;
    if (url) link.replaceChildren(
      el('input', { class: 'field grow', value: url, readonly: true, onfocus: e => e.target.select() }),
      el('button', { class: 'btn', text: 'copy link', onclick: () => attempt(async () => { await hf.shotUpload(list[i].file); toast('Link copied!', 'ok'); }) }),
      el('button', { class: 'btn ghost', text: 'open', onclick: () => hf.openUrl(url) }));
  };
  const show = j => {
    i = (j + list.length) % list.length;
    const s = list[i];
    when.textContent = `${new Date(s.time).toLocaleString()} · ${i + 1} / ${list.length}`;
    img.removeAttribute('src');
    hf.shotView(s.file).then(u => { if (list[i] === s) img.src = u; }).catch(e => toast(e.message, 'err'));
    setLink(s.url);
  };
  up.addEventListener('click', async () => {
    const s = list[i];
    up.disabled = true;
    up.lastChild.textContent = 'uploading...';
    const url = await attempt(() => hf.shotUpload(s.file));
    up.disabled = false;
    up.lastChild.textContent = 'upload to Nookara';
    if (!url) return;
    s.url = url;
    if (list[i] === s) setLink(url);
    toast('Uploaded! The link is copied to your clipboard :3', 'ok');
  });
  const multi = list.length > 1;
  const back = openModal('shot', `${a?.name || 'screenshot'} · screenshots`, el('div', { class: 'viewer' },
    el('div', { class: 'sv-stage' }, img,
      multi ? el('button', { class: 'sv-nav l', title: 'Previous', html: ICONS.left, onclick: () => show(i - 1) }) : null,
      multi ? el('button', { class: 'sv-nav r', title: 'Next', html: ICONS.right, onclick: () => show(i + 1) }) : null),
    el('div', { class: 'sv-bar' }, when,
      el('button', { class: 'btn ghost', onclick: () => attempt(() => hf.shotOpen(list[i].file)) }, el('span', { html: ICONS.image }), el('span', { text: 'open' })),
      el('button', { class: 'btn ghost', onclick: () => attempt(() => hf.shotReveal(list[i].file)) }, el('span', { html: ICONS.folder }), el('span', { text: 'show in explorer' })),
      up),
    link));
  const arrows = e => {
    if (!back.isConnected) return document.removeEventListener('keydown', arrows);
    if (multi && e.key === 'ArrowLeft') show(i - 1);
    if (multi && e.key === 'ArrowRight') show(i + 1);
  };
  document.addEventListener('keydown', arrows);
  show(i);
}
hf.on('shots', d => { if (d?.id) loadShots(d.id); });
hf.on('openShot', f => { if (f) openShot(String(f)); });

function mediaMode(a) {
  if (!a?.video || S.settings.videoBackgrounds === false) return 'image';
  return S.settings.mediaMode?.[a.id] || 'video';
}
function setBackground(a) {
  const bg = $('#bg');
  const mode = mediaMode(a);
  const src = mode === 'video' ? a?.video : a?.background;
  const key = `${mode}|${src || ''}`;
  if (bg.dataset.key === key) return;
  bg.dataset.key = key;
  const old = [...bg.children];
  const drop = () => old.forEach(o => { o.classList.remove('show'); setTimeout(() => o.remove(), 650); });
  if (!src) { bg.classList.add('default'); drop(); return; }
  const node = mode === 'video' ? el('video', { src, autoplay: true, loop: true, playsinline: true }) : el('img', { src, alt: '' });
  if (mode === 'video') node.muted = true;
  if (trailer || tab === 'store') node.autoplay = false;
  node.addEventListener(mode === 'video' ? 'loadeddata' : 'load', () => {
    bg.classList.remove('default');
    requestAnimationFrame(() => node.classList.add('show'));
    drop();
  }, { once: true });
  node.addEventListener('error', () => { node.remove(); bg.classList.add('default'); drop(); }, { once: true });
  bg.append(node);
}
$('#media-toggle').addEventListener('click', e => {
  const b = e.target.closest('button');
  const a = cur();
  if (!b || !a) return;
  S.settings.mediaMode = { ...(S.settings.mediaMode || {}), [a.id]: b.dataset.mode };
  hf.setSettings({ mediaMode: S.settings.mediaMode }).catch(() => {});
  renderVisuals(true);
});

const SOCIAL_COLORS = {
  website: '#89b4fa', web: '#89b4fa', discord: '#5865f2', reddit: '#ff4500', youtube: '#ff0033', x: '#e7e7ea', twitter: '#e7e7ea', github: '#e7e7ea',
  tiktok: '#25f4ee', instagram: '#e1306c', twitch: '#9146ff', bluesky: '#1185fe', fluxer: '#6d68ff', velora: '#f5c2e7',
  kofi: '#ff5e5b', mail: '#a6e3a1', link: '#b09bcb',
};
const linksOf = a => (Array.isArray(a?.links) ? a.links : []).filter(l => l && l.url);
function linkIco(l) {
  const type = String(l.type || 'link').toLowerCase();
  if (l.icon) return el('span', { class: 'sl-ico' }, el('img', { src: l.icon, alt: '' }));
  const known = !!ICONS.social[type];
  return el('span', { class: 'sl-ico', html: ICONS.social[type] || ICONS.social.link, style: `color:${SOCIAL_COLORS[known ? type : 'link']}` });
}
const linkName = l => String(l.title || '').trim() || capFirst(String(l.type || 'link').toLowerCase());
let linksKey = '';
function renderSocials(a) {
  const links = linksOf(a);
  $('#gv-links').hidden = !links.length;
  const box = $('#gv-linkbox');
  box.hidden = !links.length;
  const key = JSON.stringify(links);
  if (!links.length || key === linksKey) return;
  linksKey = key;
  box.replaceChildren(el('div', { class: 'box-h gv-bh' }, el('span', { class: 'bh-ico', html: ICONS.social.link }), el('span', { class: 'grow', text: 'links' })),
    el('div', { class: 'gv-links' }, ...links.map(l => el('button', { class: 'sp-link', title: l.url, onclick: () => hf.openUrl(l.url) },
      linkIco(l), el('span', { class: 'grow', text: linkName(l) }), el('span', { class: 'sl-ext', html: ICONS.external })))));
}
function dropMenu(menu, btn) {
  menu.hidden = false;
  const z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
  const r = btn.getBoundingClientRect(), w = menu.offsetWidth, h = menu.offsetHeight;
  const vw = innerWidth / z, vh = innerHeight / z;
  menu.style.left = `${Math.max(8, Math.min(vw - w - 8, r.right / z - w))}px`;
  menu.style.top = `${r.bottom / z + h + 6 > vh ? Math.max(8, r.top / z - h - 6) : r.bottom / z + 6}px`;
}
$('#gv-links').innerHTML = ICONS.social.link;
$('#gv-links').addEventListener('click', () => {
  const m = $('#links-menu');
  const wasOpen = !m.hidden;
  closeMenus();
  const a = cur();
  if (wasOpen || !a) return;
  m.replaceChildren(...linksOf(a).map(l => el('button', { title: l.url, onclick: () => { closeMenus(); hf.openUrl(l.url); } }, linkIco(l), el('span', { text: linkName(l) }))));
  dropMenu(m, $('#gv-links'));
});
$('#gv-store').innerHTML = ICONS.store;
$('#gv-store').addEventListener('click', () => { const a = cur(); if (a && !S.offlineMode) { setTab('store'); openStorePage(a.id); } });
$('#gv-settings').innerHTML = ICONS.gear;
$('#gv-settings').addEventListener('click', () => { const a = cur(); if (a) openGameSettings(a); });
$('#gv').addEventListener('scroll', () => {
  syncBarStuck();
  if (!$('#play-menu').hidden || !$('#links-menu').hidden) closeMenus();
  if (hoverFor) hideNow();
}, { passive: true });

let boardTab = '';
let boardKey = '', boardFor = '';
function postTime(s) {
  s = String(s || '').trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  m = /^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2}|\d{4}))?$/.exec(s);
  if (m) {
    const now = new Date();
    let y = m[3] ? Number(m[3]) : null;
    if (y !== null && y < 100) y += 2000;
    const d = new Date(y ?? now.getFullYear(), Number(m[1]) - 1, Number(m[2]));
    if (y === null && d - now > 31 * 86400000) d.setFullYear(d.getFullYear() - 1);
    return Number.isNaN(d.getTime()) ? null : d.getTime();
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}
function boardPosts(a) {
  const news = a?.news && typeof a.news === 'object' && !Array.isArray(a.news) ? a.news : {};
  const tabs = Object.keys(news).filter(k => k.toLowerCase() !== 'screenshots' && Array.isArray(news[k]) && news[k].some(x => x && x.title));
  const posts = [];
  tabs.forEach((tab, ti) => {
    const items = news[tab].filter(x => x && typeof x.title === 'string' && x.title.trim());
    const times = items.map(x => postTime(x.date));
    items.forEach((x, i) => {
      let t = times[i];
      if (t === null) t = times.slice(0, i).reverse().find(v => v !== null) ?? times.slice(i + 1).find(v => v !== null) ?? null;
      posts.push({ key: `${ti}:${i}`, tab, ti, i, title: x.title.trim(), date: String(x.date || '').trim(), url: httpsUrl(x.url) || (/^http:\/\//i.test(String(x.url || '')) ? String(x.url).trim() : ''),
        image: httpsUrl(x.image), body: typeof x.body === 'string' ? x.body.slice(0, 4000).trim() : '', t });
    });
  });
  posts.sort((x, y) => (y.t ?? -Infinity) - (x.t ?? -Infinity) || x.ti - y.ti || x.i - y.i);
  return { tabs, posts };
}
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
function postCard(p, n, a) {
  const open = p.url ? () => hf.openUrl(p.url) : null;
  let art = null;
  if (p.image) {
    const img = el('img', { src: p.image, alt: '', loading: 'lazy', decoding: 'async' });
    art = el('button', { class: 'post-art', title: open ? (hostOf(p.url) ? `Open ${hostOf(p.url)}` : 'Open the link') : 'View the picture',
      onclick: () => (open ? open() : openPicture(p.image, p.title)) }, img);
    img.addEventListener('error', () => { img.replaceWith(el('span', { class: 'art-none' })); if (!open) art.disabled = true; }, { once: true });
  }
  const long = !!p.body && (p.body.length > 380 || p.body.split('\n').length > 7 || p.body.includes('```'));
  const body = p.body ? el('div', { class: `post-body md${long ? ' clamp' : ''}` }, mdBlocks(p.body)) : null;
  const more = long ? el('button', { class: 'gv-more post-more', text: 'Read more' }) : null;
  const card = el('article', {
    class: `post${open ? ' linked' : ''}${p.image ? ' has-art' : ''}${p.body ? ' has-body' : ''}`, 'data-id': `${a.id}:${p.key}`,
    style: n < 12 ? `animation-delay:${n * 30}ms` : null,
  },
  art,
  el('div', { class: 'post-txt' },
    el('div', { class: 'post-meta' },
      el('span', { class: 'post-tab', text: p.tab }),
      p.date ? el('span', { class: 'post-date', text: p.t !== null && p.t === postTime(p.date) ? new Date(p.t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: new Date(p.t).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }) : p.date, title: p.date }) : null),
    open ? el('button', { class: 'post-title lnk', text: p.title, title: p.url, onclick: open }) : el('div', { class: 'post-title', text: p.title }),
    body,
    more || open ? el('div', { class: 'post-foot' }, more,
      open ? el('button', { class: 'post-link', title: p.url, onclick: open }, el('span', { html: ICONS.external }), el('span', { text: hostOf(p.url) || 'open link' })) : null) : null));
  if (more) {
    body._more = more;
    more.addEventListener('click', () => {
      const shut = !body.classList.toggle('clamp');
      more.textContent = shut ? 'Show less' : 'Read more';
      if (!shut) card.scrollIntoView({ block: 'nearest', behavior: reduceMotion() ? 'auto' : 'smooth' });
    });
  }
  return card;
}
function openPicture(src, title) {
  const img = el('img', { class: 'sv-img', alt: '', src });
  img.addEventListener('error', () => img.replaceWith(el('span', { class: 'art-none' })), { once: true });
  openModal('picture', title || 'picture', el('div', { class: 'viewer' },
    el('div', { class: 'sv-stage' }, img),
    el('div', { class: 'sv-bar' }, el('span', { class: 'sv-name grow', text: hostOf(src) }),
      el('button', { class: 'btn ghost', onclick: () => hf.openUrl(src) }, el('span', { html: ICONS.external }), el('span', { text: 'open in browser' })))));
}

const MD_INLINE = /`([^`\n]+)`|\[([^\]\n]+)\]\((https?:\/\/[^\s()]+(?:\([^\s()]*\)[^\s()]*)*)\)|\*\*(?=\S)([^\n]*?\S)\*\*|__(?=\S)([^\n]*?\S)__|\*(?=[^\s*])([^\n*]*?[^\s*])\*|(?<!\w)_(?=[^\s_])([^\n_]*?[^\s_])_(?!\w)|(https?:\/\/[^\s<>]*[^\s<>.,;:!?'")\]])/;
function mdLink(kids, url) {
  return el('a', { class: 'md-a', href: url, title: url, onclick: e => { e.preventDefault(); e.stopPropagation(); hf.openUrl(url); } }, kids);
}
function mdText(out, t) { t.split('\n').forEach((line, i) => { if (i) out.push(el('br')); if (line) out.push(line); }); }
function mdInline(s, links = true) {
  const out = [];
  for (let guard = 0; s && guard < 2000; guard++) {
    const m = MD_INLINE.exec(s);
    if (!m) { mdText(out, s); break; }
    if (m.index) mdText(out, s.slice(0, m.index));
    if (m[1] !== undefined) out.push(el('code', { class: 'md-code', text: m[1] }));
    else if (m[2] !== undefined) out.push(links ? mdLink(mdInline(m[2], false), m[3]) : el('span', {}, mdInline(m[2], false)));
    else if (m[4] !== undefined || m[5] !== undefined) out.push(el('strong', {}, mdInline(m[4] ?? m[5], links)));
    else if (m[6] !== undefined || m[7] !== undefined) out.push(el('em', {}, mdInline(m[6] ?? m[7], links)));
    else out.push(links ? mdLink(m[8], m[8]) : m[8]);
    s = s.slice(m.index + m[0].length);
  }
  return out;
}
function mdBlocks(src) {
  const lines = String(src || '').replace(/\r\n?/g, '\n').slice(0, 4000).split('\n');
  const out = [];
  let para = [], list = null;
  const flushPara = () => { if (para.length) out.push(el('p', {}, mdInline(para.join('\n')))); para = []; };
  const flushList = () => { if (list) out.push(list.node); list = null; };
  const flush = () => { flushPara(); flushList(); };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      flush();
      const code = [];
      while (++i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i]);
      out.push(el('pre', { class: 'md-pre' }, el('code', { text: code.join('\n') })));
      continue;
    }
    if (!line.trim()) { flush(); continue; }
    const h = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) { flush(); out.push(el(`h${Math.min(6, h[1].length + 2)}`, { class: `md-h md-h${Math.min(3, h[1].length)}` }, mdInline(h[2]))); continue; }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); out.push(el('hr', { class: 'md-hr' })); continue; }
    const li = /^\s*([-*+]|\d{1,9}[.)])\s+(.*)$/.exec(line);
    if (li) {
      flushPara();
      const ordered = /\d/.test(li[1]);
      if (!list || list.ordered !== ordered) {
        flushList();
        const start = ordered ? parseInt(li[1], 10) : 1;
        list = { ordered, node: el(ordered ? 'ol' : 'ul', { class: 'md-list', start: start !== 1 ? String(start) : null }) };
      }
      list.last = el('li', {}, mdInline(li[2]));
      list.node.append(list.last);
      continue;
    }
    if (list && /^\s+\S/.test(line)) { list.last.append(el('br'), ...mdInline(line.trim())); continue; }
    flushList();
    para.push(line.replace(/^\s+/, ''));
  }
  flush();
  return out;
}
function renderBoard(a) {
  const { tabs, posts } = boardPosts(a);
  if (boardTab && !tabs.includes(boardTab)) boardTab = '';
  const key = JSON.stringify([a?.id, a?.name, posts.map(p => [p.key, p.title, p.date, p.url, p.image, p.body]), boardTab]);
  if (key === boardKey) return;
  const switched = boardFor !== (a?.id || '');
  if (switched && boardTab) { boardTab = ''; return renderBoard(a); }
  boardFor = a?.id || '';
  boardKey = key;
  $('#board-chips').replaceChildren(...(tabs.length > 1 ? [['', 'All', posts.length], ...tabs.map(t => [t, t, posts.filter(p => p.tab === t).length])].map(([v, label, n]) =>
    el('button', { class: `chip${v === boardTab ? ' on' : ''}`, onclick: () => { if (boardTab !== v) { boardTab = v; renderBoard(cur()); } } },
      el('span', { class: 'chip-t', text: label }), el('span', { class: 'n', text: String(n) }))) : []));
  const list = posts.filter(p => !boardTab || p.tab === boardTab);
  const box = $('#board-list');
  box.replaceChildren(...(list.length ? list.map((p, n) => postCard(p, n, a)) : [
    el('div', { class: 'board-empty' }, el('span', { class: 'be-ico', html: ICONS.newspaper }),
      el('b', { text: 'No posts yet' }),
      el('span', { text: `When ${a?.name || 'this game'} posts news or updates, they show up here.` })),
  ]));
  if (!switched && !reduceMotion()) { box.classList.remove('vl-tab-r'); void box.offsetWidth; box.classList.add('vl-tab-r'); }
  requestAnimationFrame(() => box.querySelectorAll('.post-body.clamp').forEach(b => {
    if (b.clientHeight && b.scrollHeight <= b.clientHeight + 4) { b.classList.remove('clamp'); b._more?.remove(); }
  }));
}

let aboutKey = '';
function renderAbout(a) {
  const box = $('#gv-about');
  box.hidden = !a;
  if (!a) { aboutKey = ''; return; }
  const desc = descOf(a);
  const key = JSON.stringify([a.id, desc, a.author, a.community]);
  if (key === aboutKey) return;
  aboutKey = key;
  const long = desc.length > 260 || desc.split('\n').length > 5;
  const text = el('div', { class: `gv-desc${desc ? '' : ' muted'}${long ? ' clamp' : ''}`, text: desc || 'No description' });
  const more = long ? el('button', { class: 'gv-more', text: 'Read more', onclick: () => { const open = text.classList.toggle('clamp'); more.textContent = open ? 'Read more' : 'Show less'; } }) : null;
  box.replaceChildren(el('div', { class: 'box-h gv-bh' }, el('span', { class: 'bh-ico', html: ICONS.idcard }), el('span', { class: 'grow', text: `about ${a.name || a.id}` })),
    el('div', { class: 'gv-about-in' }, text, more,
      el('div', { class: 'gv-by' }, a.community ? ['by ', el('b', { text: a.author || '?' })] : 'A Hyperfocus game')));
}
let friendsKey = '';
function renderFriends(a) {
  const box = $('#gv-friends');
  const all = social?.friends || S?.social?.friends || [];
  const list = a ? all.filter(f => f && f.activity && f.activity.appId === a.id) : [];
  box.hidden = !list.length;
  const key = JSON.stringify([a?.id, list.map(f => [f.username, f.pfp, f.color, f.activity.state])]);
  if (!list.length || key === friendsKey) { if (!list.length) friendsKey = ''; return; }
  friendsKey = key;
  box.replaceChildren(el('div', { class: 'box-h gv-bh' }, el('span', { class: 'bh-ico', html: ICONS.users }), el('span', { class: 'grow', text: 'friends playing' }),
    el('span', { class: 'gv-bn', text: String(list.length) })),
  el('div', { class: 'gv-friends' }, ...list.map(f => el('button', { class: 'gv-fr', title: `Open ${f.username}'s profile`, onclick: () => openProfileTab(f.username) },
    avatarEl(f),
    el('span', { class: 'gv-frt' }, el('b', { text: f.username, style: safeColor(f.color) ? `color:${safeColor(f.color)}` : null }),
      el('span', { text: f.activity.state ? `playing now · ${f.activity.state}` : 'playing now' }))))));
}

function renderVisuals(force) {
  const a = cur();
  const key = JSON.stringify([a, mediaMode(a), S.settings.videoBackgrounds]);
  if (!force && keys.vis === key) return;
  keys.vis = key;
  const switched = keys.visId !== (a?.id || '');
  keys.visId = a?.id || '';
  $('#gv').hidden = !a;
  const accent = /^#[0-9a-f]{6}$/i.test(a?.accent || '') ? a.accent : (getComputedStyle(document.documentElement).getPropertyValue('--vl').trim() || '#9d8ad1');
  document.documentElement.style.setProperty('--accent', accent);
  document.documentElement.style.setProperty('--accent-ink', inkFor(accent));

  setBackground(a);
  const zone = $('#media-zone');
  zone.hidden = !a?.video || S.settings.videoBackgrounds === false;
  zone.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.mode === mediaMode(a)));

  const logo = $('#app-logo'), title = $('#app-title');
  const logoVal = String(a?.logo || '').trim();
  if (a && isUrl(logoVal)) {
    if (logo.getAttribute('src') !== logoVal) logo.src = logoVal;
    logo.hidden = false;
    title.hidden = true;
    logo.onerror = () => { logo.hidden = true; title.hidden = false; title.textContent = a.name || a.id; };
  } else {
    logo.hidden = true;
    title.hidden = !a;
    title.textContent = a ? (logoVal || a.name || a.id) : '';
  }
  const by = $('#hero-by');
  by.hidden = !a?.community;
  if (a?.community) by.replaceChildren('by ', el('b', { text: a.author || '?' }));
  renderSocials(a);
  renderBoard(a);
  renderAbout(a);
  drawAchWidget(a);
  if (a && !(a.id in shots)) loadShots(a.id);
  if (switched && a) {
    $('#gv').scrollTop = 0;
    if (!reduceMotion()) for (const n of [$('#hero-in'), $('#gv-body')]) { n.classList.remove('gv-in'); void n.offsetWidth; n.classList.add('gv-in'); }
  }
}
function renderSide() {
  const a = cur();
  drawShots(a);
  renderFriends(a);
}
function labelFor(a, st, job) {
  switch (st) {
    case 'buy': return ['Buy', 'external'];
    case 'external': return [a.buttonLabel ? String(a.buttonLabel) : 'Download', 'external'];
    case 'soon': return [capFirst(stageInfo(a, true)?.text || 'coming soon'), 'calendar'];
    case 'winonly': return ['Windows only', 'windows'];
    case 'install': return ['Install', 'download'];
    case 'update': return ['Update', 'update'];
    case 'repair': return ['Repair', 'repair'];
    case 'ready': return [verb(a), 'play'];
    case 'running': return ['Running', 'play'];
    case 'downloading': return [`${pct(job)}%`, 'pause'];
    case 'paused': return ['Resume', 'download'];
    case 'verifying': return ['Verifying', 'spinner'];
    case 'installing': return ['Installing', 'spinner'];
    default: return ['Unavailable', 'lock'];
  }
}
function subText(a, st, job) {
  switch (st) {
    case 'downloading': {
      const eta = job.speed > 0 && job.total ? (job.total - job.received) / job.speed : NaN;
      return `${fmtBytes(job.received)} / ${job.total ? fmtBytes(job.total) : '?'} · ${fmtBytes(job.speed || 0)}/s · ${fmtEta(eta)} left`;
    }
    case 'paused': return `paused · ${fmtBytes(job.received)} / ${job.total ? fmtBytes(job.total) : '?'}`;
    case 'buy': {
      const p = priceView(a);
      return p.sale ? `${credits(p.now)} (was ${Number(p.full).toLocaleString()}) · -${p.off}% · sale ends in ${timeLeft(p.until)}` : credits(p.full);
    }
    case 'verifying': return 'checking file integrity...';
    case 'installing': return 'unpacking files...';
    default: return '';
  }
}
function fmtPlaytime(s) {
  s = Math.floor(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}
function playedSeconds(a) {
  const sess = S.playtime?.sessions?.[a.id];
  return (S.playtime?.totals?.[a.id] || 0) + (sess ? Math.max(0, (Date.now() - sess.last) / 1000) : 0);
}
function agoText(t) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d} days ago`;
  return new Date(t).toLocaleDateString();
}
function renderStats(a, st, inst) {
  const secs = playedSeconds(a);
  const running = st === 'running';
  const show = !!(inst || secs >= 60 || running);
  $('#st-time').hidden = $('#st-last').hidden = !show;
  if (!show) return;
  const lastAt = lastPlayedOf(a);
  $('#stat-time-k').textContent = isGame(a) ? 'play time' : 'time used';
  $('#stat-time').textContent = secs >= 60 ? fmtPlaytime(secs) : running ? '<1m' : 'none yet';
  const last = $('#stat-last');
  last.textContent = running ? (isGame(a) ? 'playing now' : 'open now') : lastAt ? agoText(lastAt) : 'never';
  last.classList.toggle('live', running);
  last.title = lastAt && !running ? new Date(lastAt).toLocaleString() : '';
}
function renderPadStat(a) {
  const c = a?.controller;
  const box = $('#st-pad');
  box.hidden = !(c === true || c === false || c === 'partial');
  if (box.hidden) return;
  const v = $('#stat-pad');
  v.textContent = c === true ? 'Supported' : c === 'partial' ? 'Partial' : 'Not supported';
  v.className = `v ${c === true ? 'ok' : c === 'partial' ? 'part' : 'no'}`;
  box.title = c === true ? 'Plays with a controller' : c === 'partial' ? 'Some parts may need your mouse and/or keyboard' : "Doesn't support controllers";
}

const hoverCard = el('div', { id: 'hover-card', hidden: true });
document.body.append(hoverCard);
let hoverFor = null, hoverTimer = null;
function showHover(id, anchor, side) {
  clearTimeout(hoverTimer);
  const go = () => { hoverFor = { id, anchor, side }; drawHover(); };
  if (hoverFor) go();
  else hoverTimer = setTimeout(go, 180);
}
function hideNow() { clearTimeout(hoverTimer); hoverFor = null; hoverCard.hidden = true; }
function hideHover() { clearTimeout(hoverTimer); hoverTimer = setTimeout(hideNow, 60); }
function statusInfo(a, key = a.id) {
  const st = (key === a.id ? effStatus(a) : S.status[key]) || 'unavailable';
  const haveInst = key === a.id ? S.installed[a.id] : S.installedBetas?.[a.id];
  switch (st) {
    case 'ready': return S.jsonBroken ? ['apps.json has a typo', 'warn'] : S.offline ? ["offline - can't check", 'off'] : ['up to date', 'ok'];
    case 'update': return ['update required', 'upd'];
    case 'repair': return ['repair required - fixed files', 'upd'];
    case 'buy': { const p = priceView(a); return [`costs ${credits(p.now)}${p.sale ? ` (-${p.off}%)` : ''}`, 'off']; }
    case 'install': return ['not installed', 'off'];
    case 'soon': return ['not out yet', 'off'];
    case 'winonly': return ['no Mac version', 'off'];
    case 'external': return ['opens in your browser', 'off'];
    case 'running': return ['running', 'run'];
    case 'downloading': return [`${haveInst ? 'updating' : 'downloading'} ${pct(S.jobs[key])}%`, 'run'];
    case 'paused': return ['download paused', 'off'];
    case 'verifying': return ['verifying files', 'run'];
    case 'installing': return ['installing', 'run'];
    default: return ['no download yet', 'off'];
  }
}
function drawHover() {
  if (!hoverFor) return;
  const a = apps().find(x => x.id === hoverFor.id);
  if (!a || !hoverFor.anchor.isConnected || libraryOpen) return hideNow();
  const inst = S.installed[a.id];
  const [stText, stCls] = statusInfo(a);
  const have = inst ? (inst.version ? `v${inst.version}` : shortHash(inst.sha256) || 'installed') : '--';
  const latest = a.version ? `v${a.version}` : shortHash(a.download?.sha256) || '--';
  const beta = chosenBeta(a), betaSt = beta ? statusInfo(a, a.id + BETA) : null;
  const stage = stageInfo(a);
  const row = (k, v, cls) => [el('span', { class: 'k', text: k }), el('span', { class: 'v' + (cls ? ' ' + cls : ''), text: v })];
  hoverCard.replaceChildren(
    el('div', { class: 'hc-h' }, iconEl(a, 'hc-ico'), el('span', { class: 'hc-name', text: a.name || a.id }), el('span', { class: 'hc-type', text: a.type.toLowerCase() })),
    el('div', { class: 'hc-rows' },
      ...(a.community ? row('by', a.author || '?') : []),
      ...row('status', stText, `hc-st ${stCls}`),
      ...(stage ? row('stage', stage.text, `hc-stage ${stage.kind}`) : []),
      ...row('installed', have),
      ...row('latest', latest, stCls === 'upd' ? 'upd' : ''),
      ...(a.download?.size ? row('size', fmtBytes(a.download.size)) : []),
      ...(beta ? [...row('beta', [beta.name, betaVer(beta)].filter(Boolean).join(' ')), ...row('beta status', betaSt[0], `hc-st ${betaSt[1]}`)] : []),
      ...(a.controller === 'partial' ? row('controller', 'partially supported', 'upd')
        : typeof a.controller === 'boolean' ? row('controller', a.controller ? 'supported' : 'not supported', a.controller ? '' : 'upd') : [])));
  hoverCard.hidden = false;
  const r = hoverFor.anchor.getBoundingClientRect();
  const w = hoverCard.offsetWidth, h = hoverCard.offsetHeight;
  const x = hoverFor.side === 'right' ? r.right + 12 : hoverFor.side === 'down' ? r.left : r.right - w;
  const y = hoverFor.side === 'right' ? r.top + r.height / 2 - h / 2 : hoverFor.side === 'down' ? r.bottom + 10 : r.top - h - 10;
  hoverCard.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, x))}px`;
  hoverCard.style.top = `${Math.max(8, Math.min(innerHeight - h - 8, y))}px`;
}
for (const id of ['#play', '#play-beta']) {
  $(id).addEventListener('mouseenter', () => { if (sel) showHover(sel, $('#play-box'), 'down'); });
  $(id).addEventListener('mouseleave', hideHover);
}
const ago = t => {
  const s = Math.max(0, (Date.now() - t) / 1000);
  return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : fmtDay(t);
};
let cloudAskedFor = '';
function renderCloudLine(a) {
  const chip = $('#cloud-chip');
  const hasSpec = a && Array.isArray(a.saveData) ? a.saveData.length : !!a?.saveData;
  if (!a || !hasSpec || !S.installed[a.id]) { chip.hidden = true; return; }
  if (cloudAskedFor !== a.id) { cloudAskedFor = a.id; hf.cloudCheck(a.id, false).catch(() => {}); }
  const c = S.cloud?.[a.id] || { state: 'checking' };
  const from = c.deviceName ? ` · ${c.deviceName}` : '';
  const beta = betaRunning(a);
  const [cls, text] = beta ? ['', 'Cloud saves are off while you play a beta'] : {
    synced: ['ok', `Cloud save synced${c.at ? ` ${ago(c.at)}` : ''}`],
    uploading: ['busy', 'Backing up your save...'],
    downloading: ['busy', 'Loading your cloud save...'],
    cloudNewer: ['info', `Newer save in the cloud${from} - loads when you play`],
    localNewer: ['info', 'This PC has newer saves - they upload after you play'],
    local: ['info', 'Save not backed up yet - click to back up'],
    conflict: ['warn', `Save conflict with the cloud${from} - press Play to choose`],
    error: ['warn', `Cloud save: ${c.error || 'error'}`],
    loggedOut: ['', 'Log in to Nookara to use cloud saves'],
    playing: ['', 'Cloud save uploads when you stop playing'],
  }[c.state] || ['', ''];
  const clickable = !beta && ['local', 'synced', 'error'].includes(c.state);
  chip.hidden = !text;
  if (!text) return;
  chip.className = `${cls}${clickable ? ' click' : ''}`;
  chip.title = `${text}${clickable && c.state !== 'local' ? ' - click to back up now' : ''}`;
  if (chip.dataset.t !== text) {
    chip.dataset.t = text;
    chip.replaceChildren(el('span', { class: 'cc-ico', html: ICONS.cloud || '' }), el('span', { class: 'cc-t', text }));
  }
}
$('#cloud-chip').addEventListener('click', () => {
  const a = cur();
  const c = a && S.cloud?.[a.id];
  if (a && c && !betaRunning(a) && ['local', 'synced', 'error'].includes(c.state)) attempt(() => hf.cloudCheck(a.id, true));
});
function syncBarStuck() { $('#play-wrap').classList.toggle('stuck', $('#gv').scrollTop > $('#hero').offsetHeight - 2); }
const STAT_DROP = ['#st-pad', '#st-ach', '#st-last', '#st-time'];
let fitRaf = 0;
function fitStats() {
  cancelAnimationFrame(fitRaf);
  fitRaf = requestAnimationFrame(() => {
    const bar = $('#play-wrap'), box = $('#play-stats');
    bar.classList.remove('tight', 'squeeze', 'wrap');
    for (const s of STAT_DROP) $(s).classList.remove('fit-out');
    if (!box.offsetParent) return;
    const over = () => box.scrollWidth > box.clientWidth + 1;
    if (!over()) return;
    bar.classList.add('tight');
    if (!over()) return;
    if ($('#play-row').classList.contains('split')) { bar.classList.add('squeeze'); if (!over()) return; }
    $('#st-pad').classList.add('fit-out');
    if (!over()) return;
    $('#st-pad').classList.remove('fit-out');
    bar.classList.remove('squeeze');
    bar.classList.add('wrap');
    for (const s of STAT_DROP) {
      if (!over()) break;
      if (!$(s).hidden) $(s).classList.add('fit-out');
    }
  });
}
new ResizeObserver(fitStats).observe($('#play-wrap'));
hf.on('gamePerms', q => {
  let done = false;
  const finish = choice => { if (done) return; done = true; hf.gamePermsResolve(q.reqId, choice).catch(() => {}); };
  const extra = q.perms.filter(p => p.extra), had = q.perms.filter(p => !p.extra);
  const comm = !!q.community;
  const permRow = p => el('li', { class: `gp-perm${p.extra || comm ? ' new' : ''}` },
    el('span', { class: 'gp-dot' }), el('div', {}, el('b', { text: p.name }), p.note ? el('small', { text: p.note }) : null),
    p.extra ? el('span', { class: 'gp-tag', text: comm ? 'on Nookara' : 'new', title: comm ? 'Also needs your approval on the Nookara page' : null }) : null);
  const body = el('div', { class: 'dialog gp' },
    el('div', { class: 'gp-head' },
      q.icon ? el('img', { class: 'gp-icon', src: q.icon, alt: '' }) : el('div', { class: 'gp-icon gp-ph', text: (q.name || '?').slice(0, 1) }),
      comm
        ? el('p', {}, el('b', { text: q.name }), ' wants to sign in with your Nookara account.',
          el('small', { class: 'gp-by', text: `Community game${q.author ? ` by ${q.author}` : ''} · asks for:` }))
        : el('p', {}, el('b', { text: q.name }), ' is requesting additional permissions to your Nookara account.')),
    el('ul', { class: 'gp-list' }, ...extra.map(permRow), ...had.map(permRow)),
    el('p', { class: 'gp-note', text: comm
      ? `Allow gives it its own Nookara login with these permissions${extra.length ? ' - the ones marked "on Nookara" open Nookara in your browser so you can approve them there' : ''}. Hyperfocus never shares its own login or your password. Play without it and the game asks you to sign in by itself. You can change this in its Game settings.`
      : "Allow opens Nookara in your browser so you can approve it there - Hyperfocus never sees your password. The game gets its own login; Hyperfocus's doesn't change." }),
    el('div', { class: 'acts' },
      el('button', { class: 'btn ghost', text: 'Cancel', onclick: () => { closeModal('game-perms'); finish('cancel'); } }),
      el('button', { class: 'btn ghost', text: comm ? 'Play without it' : 'Play without them', onclick: () => { closeModal('game-perms'); finish('limited'); } }),
      el('button', { class: 'btn', text: 'Allow', onclick: () => {
        if (extra.length) waiting(); else closeModal('game-perms');
        finish('allow');
      } })));
  const back = openModal('game-perms', 'permission request', body, { dismiss: false });
  back?.querySelector?.('.m-x')?.addEventListener('click', () => { closeModal('game-perms'); finish('cancel'); });
  function waiting() {
    body.replaceChildren(
      el('div', { class: 'gp-head' }, el('div', { class: 'gp-spin' }), el('p', {}, 'Approve ', el('b', { text: q.name }), ' on the Nookara page that just opened in your browser...')),
      el('p', { class: 'gp-note', text: 'It starts as soon as you approve it.' }),
      el('div', { class: 'acts' }, el('button', { class: 'btn ghost', text: 'Cancel', onclick: () => { hf.gamePermsCancel().catch(() => {}); closeModal('game-perms'); } })));
  }
});
hf.on('gamePermsState', s => {
  closeModal('game-perms');
  if (s.state === 'done') toast('Approved on Nookara - starting it now!', 'ok');
  else if (s.state === 'failed') toast(s.error === 'expired' ? 'The Nookara approval timed out.' : (s.error || "Nookara didn't approve it."), 'err');
});

hf.on('cloudConflict', q => {
  const when = t => t ? new Date(t).toLocaleString() : 'unknown';
  const finish = choice => { closeModal('cloud-conflict'); hf.cloudResolve(q.reqId, choice).catch(() => {}); };
  const pick = (title, lines, choice, primary) => el('button', { class: `cc-pick${primary ? ' primary' : ''}`, onclick: () => finish(choice) },
    el('b', { text: title }), ...lines.map(t => el('span', { text: t })));
  const back = openModal('cloud-conflict', 'save data conflict', el('div', { class: 'dialog cc' },
    el('p', { text: `${q.name} was saved on another device after you last played it on this PC, and this PC's save is different too. Which copy do you want to keep? The other one is backed up in case you change your mind.` }),
    el('div', { class: 'cc-row' },
      pick('this PC', [`last played here: ${when(q.local.playedAt)}`, q.local.empty ? 'no save' : fmtBytes(q.local.size)], 'local'),
      pick('the cloud', [`uploaded ${when(q.cloud.at)}`, `from ${q.cloud.sameDevice ? 'this PC' : q.cloud.deviceName || 'another device'}`, fmtBytes(q.cloud.size || 0)], 'cloud', true)),
    el('div', { class: 'acts' }, el('button', { class: 'btn ghost', text: "Don't play yet", onclick: () => finish('cancel') }))), { dismiss: false });
  back?.querySelector?.('.m-x')?.addEventListener('click', () => finish('cancel'));
});

hf.on('joinWhich', q => {
  let done = false;
  const finish = choice => { if (done) return; done = true; closeModal('join-which'); hf.joinResolve(q.reqId, choice).catch(() => {}); };
  const pick = (title, sub, choice, primary) => el('button', { class: `cc-pick${primary ? ' primary' : ''}`, onclick: () => finish(choice) },
    el('b', { text: title }), el('span', { text: sub }));
  openModal('join-which',q.kind === 'join' ? `join ${q.from ? `${q.from}'s ` : 'the '}game` : 'accept invite', el('div', { class: 'dialog cc' },
    el('p', { text: `Which version of ${q.name} do you want to start?` }),
    el('div', { class: 'cc-row' },
      pick(q.releaseLabel, 'the normal game', 'release', true),
      pick(q.betaLabel, 'your beta', 'beta')),
    el('div', { class: 'acts' }, el('button', { class: 'btn ghost', text: 'Cancel', onclick: () => finish('cancel') }))),
  { dismiss: true, onclose: () => finish('cancel') });
});

function renderPlay() {
  const a = cur();
  $('#play-wrap').hidden = !a;
  renderCloudLine(a);
  if (!a) return;
  const st = effStatus(a) || 'unavailable';
  const job = S.jobs[a.id];
  const inst = S.installed[a.id];
  const b = chosenBeta(a);
  const busy = BUSY.includes(st);
  const relBlocked = !!b && betaRunning(a) && st === 'ready';
  const off = st === 'running' || st === 'unavailable' || st === 'soon' || st === 'winonly' || relBlocked;
  const play = $('#play');
  play.className = busy ? 'busy' : off ? 'off' : '';
  let [label, icon] = labelFor(a, st, job);
  if (b && ['ready', 'install', 'update', 'repair'].includes(st)) label += ' Release';
  $('#play-label').textContent = label;
  const sale = st === 'buy' ? priceView(a) : null;
  $('#play-off').hidden = !sale?.sale;
  if (sale?.sale) $('#play-off').textContent = `-${sale.off}%`;
  if ($('#play-ico').dataset.icon !== icon) { $('#play-ico').innerHTML = ICONS[icon]; $('#play-ico').dataset.icon = icon; }
  $('#play-fill').style.width = busy ? `${busyPct(a.id)}%` : '0%';
  play.disabled = ['running', 'verifying', 'installing', 'unavailable', 'soon', 'winonly'].includes(st) || relBlocked;
  $('#play-row').classList.toggle('split', !!b);
  const soonIn = releaseIn(a);
  let sub = [soonIn && `coming ${soonIn}`, subText(a, st, job)].filter(Boolean).join('\n');
  const pb = $('#play-beta');
  pb.hidden = !b;
  if (b) {
    const h = betaHalf(a, b);
    const bBusy = BUSY.includes(h.st);
    const betaBlocked = h.st === 'ready' && gameRunning(a) && !betaRunning(a);
    pb.className = bBusy ? 'busy' : h.st === 'running' || h.st === 'unavailable' || h.st === 'winonly' || betaBlocked ? 'off' : '';
    $('#play-beta-label').textContent = h.label;
    if ($('#play-beta-ico').dataset.icon !== h.icon) { $('#play-beta-ico').innerHTML = ICONS[h.icon]; $('#play-beta-ico').dataset.icon = h.icon; }
    $('#play-beta-fill').style.width = bBusy ? `${busyPct(a.id + BETA)}%` : '0%';
    pb.disabled = ['running', 'verifying', 'installing', 'unavailable', 'winonly'].includes(h.st) || betaBlocked;
    pb.title = betaBlocked ? `Close ${a.name || a.id} first - the release and the beta can't run together` : `${b.name}${betaVer(b) ? ` ${betaVer(b)}` : ''}`;
    const bsub = subText(a, h.st, h.job);
    sub = [sub && `Release: ${sub}`, bsub && `${b.name}: ${bsub}`].filter(Boolean).join('\n');
  }
  $('#play-sub').textContent = sub;
  $('#play-sub').hidden = !sub;
  renderBetaNotice(b);
  renderStats(a, gameRunning(a) ? 'running' : st, inst || S.installedBetas?.[a.id]);
  renderPadWarn(a);
  renderPadStat(a);
  fitStats();
  syncBarStuck();
  $('#gv-store').hidden = !!S.offlineMode;
  if (relBlocked) play.title = `Close ${b.name} first - the release and the beta can't run together`;
  else if (st === 'soon') play.title = stageInfo(a).title;
  else if (st === 'winonly') play.title = WINONLY_TITLE;
  drawHover();
}
function betaHalf(a, b) {
  const st = S.status[a.id + BETA] || 'unavailable';
  const job = S.jobs[a.id + BETA];
  let [label, icon] = st === 'unavailable' ? [b.locked === 'nobuild' ? 'No build yet' : 'Unavailable', 'lock'] : labelFor(a, st, job);
  if (['ready', 'install', 'update', 'repair'].includes(st)) label = `${label} ${b.name}`;
  return { st, job, label, icon };
}
function renderBetaNotice(b) {
  const n = $('#gbeta-notice');
  n.hidden = !b;
  if (!b) { n.dataset.k = ''; return; }
  const k = JSON.stringify([b.id, b.name, b.version, b.notes]);
  if (n.dataset.k === k) return;
  n.dataset.k = k;
  const notes = String(b.notes || '').trim();
  n.title = notes ? `${b.name}\n\n${notes}` : b.name;
  n.replaceChildren(el('span', { class: 'gbn-ico', html: ICONS.flask }),
    el('div', { class: 'gbn-txt' },
      el('b', { text: `You're in the ${b.name} beta${betaVer(b) ? ` · ${betaVer(b)}` : ''}` }),
      notes ? el('span', { class: 'gbn-notes', text: notes }) : null));
}
$('#play-beta').addEventListener('click', () => {
  const a = cur();
  if (a) betaClick(a);
});
function betaClick(a) {
  if (!chosenBeta(a)) return;
  const st = S.status[a.id + BETA];
  if (st === 'buy') openBuy(a);
  else if (['install', 'update', 'repair', 'paused'].includes(st)) attempt(() => hf.betaInstall(a.id));
  else if (st === 'ready') attempt(() => hf.betaLaunch(a.id));
  else if (st === 'downloading') attempt(() => hf.pause(a.id + BETA));
}
function renderPadWarn(a) {
  const partial = a?.controller === 'partial';
  const show = (a?.controller === false || partial) && padConnected();
  const kind = a?.type === 'App' ? 'app' : 'game';
  const text = partial ? `Some parts of this ${kind} may need your mouse and/or keyboard.` : `This ${kind} doesn't support controllers - it may not work with one.`;
  const w = $('#pad-warn');
  w.hidden = !show;
  if (show && !w.dataset.drawn) {
    w.dataset.drawn = '1';
    w.replaceChildren(el('span', { class: 'pw-ico', html: ICONS.warn }), el('span', { text }));
  } else if (show) w.lastChild.textContent = text;
  $('#play').title = show ? (partial ? 'Partially supports controllers' : "Doesn't support controllers") : '';
}
$('#play').addEventListener('click', () => { const a = cur(); if (a) primaryAction(a); });
function primaryAction(a) {
  const st = effStatus(a);
  if (st === 'buy') openBuy(a);
  else if (st === 'external') openExternalApp(a);
  else if (st === 'install') installWithPicker(a);
  else if (st === 'update' || st === 'repair' || st === 'paused') attempt(() => hf.install(a.id));
  else if (st === 'ready') attempt(() => hf.launch(a.id));
  else if (st === 'downloading') attempt(() => hf.pause(a.id));
}
const buyUrlOf = a => a.buyUrl || `https://nookara.cc/buy/${encodeURIComponent(a.id)}`;
function openExternalApp(a) {
  hf.openUrl(a.download.url);
  toast(`Opening ${a.name || a.id} in your browser...`);
}
function openBuy(a) {
  hf.openUrl(buyUrlOf(a));
  toast(`Finish buying ${a.name || a.id} in your browser - it unlocks here right after.`);
}
$('#play-more').addEventListener('click', () => {
  const m = $('#play-menu');
  const wasOpen = !m.hidden;
  closeMenus();
  if (wasOpen) return;
  const a = cur();
  if (!a) return;
  fillMenu(m, gameMenuItems(a));
  dropMenu(m, $('#play-more'));
});
function openGameMenu(e, id) {
  e.preventDefault();
  const a = apps().find(x => x.id === id);
  if (!a) return;
  closeMenus();
  const m = $('#ctx-menu');
  const st = effStatus(a);
  const first = [];
  const cb = chosenBeta(a), cbs = cb ? betaHalf(a, cb) : null;
  const rel = cb ? ' Release' : '';
  if (st === 'ready') first.push({ label: (a.type === 'Game' ? 'Play' : 'Launch') + rel, icon: 'play', run: () => attempt(() => hf.launch(a.id)) });
  else if (st === 'buy') first.push({ label: `Buy (${credits(priceView(a).now)})`, icon: 'external', run: () => openBuy(a) });
  else if (st === 'external') first.push({ label: a.buttonLabel ? String(a.buttonLabel) : 'Download', icon: 'external', run: () => openExternalApp(a) });
  else if (st === 'install' || st === 'update' || st === 'repair') first.push({ label: (st === 'install' ? 'Install' : st === 'update' ? 'Update' : 'Repair') + rel, icon: 'download', run: () => st === 'install' ? installWithPicker(a) : attempt(() => hf.install(a.id)) });
  if (cbs && ['ready', 'install', 'update', 'repair', 'buy'].includes(cbs.st)) first.push({ label: cbs.st === 'buy' ? `Buy (${credits(priceView(a).now)})` : cbs.label, icon: 'flask', run: () => betaClick(a) });
  if (sel !== a.id || libraryOpen || tab !== 'library') first.push({ label: 'Show', icon: 'grid', run: () => openGame(a.id) });
  fillMenu(m, [...first, ...(first.length ? ['-'] : []), ...gameMenuItems(a)]);
  m.hidden = false;
  const r = m.getBoundingClientRect();
  m.style.left = `${Math.min(e.clientX, innerWidth - r.width - 6)}px`;
  m.style.top = `${Math.min(e.clientY, innerHeight - r.height - 6)}px`;
}
document.addEventListener('contextmenu', e => {
  const b = e.target.closest('.lib-row, .lib-card');
  if (b?.dataset.id) openGameMenu(e, b.dataset.id);
});
function gameMenuItems(a) {
  const st = S.status[a.id];
  const inst = S.installed[a.id];
  const name = a.name || a.id;
  const items = [];
  if (st === 'downloading') items.push({ label: 'Pause download', icon: 'pause', run: () => attempt(() => hf.pause(a.id)) });
  if (st === 'paused') items.push({ label: 'Resume download', icon: 'download', run: () => attempt(() => hf.install(a.id)) });
  if (st === 'downloading' || st === 'paused') items.push({ label: 'Cancel download', icon: 'xcircle', danger: true, run: () => attempt(() => hf.cancel(a.id)) }, '-');
  const b = chosenBeta(a), bk = a.id + BETA, bst = b ? S.status[bk] : null, binst = b ? S.installedBetas?.[a.id] : null;
  if (bst === 'downloading') items.push({ label: 'Pause beta download', icon: 'pause', run: () => attempt(() => hf.pause(bk)) });
  if (bst === 'paused') items.push({ label: 'Resume beta download', icon: 'download', run: () => attempt(() => hf.betaInstall(a.id)) });
  if (bst === 'downloading' || bst === 'paused') items.push({ label: 'Cancel beta download', icon: 'xcircle', danger: true, run: () => attempt(() => hf.cancel(bk)) }, '-');
  items.push({ label: isPinned(a.id) ? 'Unpin' : 'Pin to top', icon: 'pin', run: () => togglePin(a.id) });
  items.push({ label: 'Game settings', icon: 'gear', run: () => openGameSettings(a) });
  if (!S.offlineMode) items.push({ label: 'Check for updates', icon: 'refresh', run: checkUpdates });
  items.push({ label: 'Screenshots folder', icon: 'camera', run: () => attempt(() => hf.shotFolder(a.id)) });
  if (a.purchase?.refundable) items.push({ label: `Refund (${Number(a.purchase.price).toLocaleString()} credits)`, icon: 'external', run: () => hf.openUrl(buyUrlOf(a)) });
  if (!S.offlineMode) items.push({ label: 'View in the store', icon: 'store', run: () => { setTab('store'); openStorePage(a.id); } });
  if (a.community) items.push({ label: 'View on the website', icon: 'external', run: () => hf.openUrl(`https://nookara.cc/community/#/game/${a.communityId}`) });
  const bBusy = BUSY.includes(S.status[a.id + BETA]);
  if (!S.offlineMode && (a.community || libIds().includes(a.id) || inst || S.installedBetas?.[a.id]) && !gameRunning(a) && !BUSY.includes(st) && !bBusy) {
    items.push({ label: 'Remove from library', icon: 'trash', danger: true, run: async () => {
      const there = inst || S.installedBetas?.[a.id];
      if (!await confirmBox(`remove ${name}?`, `${name} leaves your library${there ? ' and gets uninstalled from this PC (its install folder is deleted)' : ''}. You can add it again from the store any time.`, 'Remove', true)) return;
      await attempt(async () => { await hf.libraryRemove(a.id); toast(`${name} was removed from your library.`); });
    } });
  }
  if (inst && !BUSY.includes(st)) {
    items.push({ label: 'Open install folder', icon: 'folder', run: () => hf.openFolder(a.id) });
    if (st !== 'running' && a.download?.url) {
      items.push({ label: 'Repair files', icon: 'repair', run: async () => {
        if (await confirmBox('repair files?', `This re-downloads ${name} and replaces its files with a fresh copy.`, 'Repair')) attempt(() => hf.install(a.id));
      } });
    }
    if (st !== 'running') {
      items.push('-', { label: 'Uninstall', icon: 'trash', danger: true, run: async () => {
        if (!await confirmBox(`uninstall ${name}?`, 'Its install folder gets deleted from this PC. You can always install it again later.', 'Uninstall', true)) return;
        await attempt(async () => { await hf.uninstall(a.id); toast(`${name} was uninstalled.`); });
      } });
    }
  }
  if (binst && !BUSY.includes(bst)) {
    items.push('-', { label: 'Open beta install folder', icon: 'folder', run: () => hf.openFolder(bk) });
    if (bst !== 'running' && b.download?.url) {
      items.push({ label: 'Repair beta files', icon: 'repair', run: async () => {
        if (await confirmBox('repair beta files?', `This re-downloads ${b.name} and replaces its files with a fresh copy.`, 'Repair')) attempt(() => hf.betaInstall(a.id));
      } });
    }
    if (bst !== 'running') {
      items.push({ label: 'Uninstall beta', icon: 'trash', danger: true, run: async () => {
        if (!await confirmBox(`uninstall ${b.name}?`, `The ${b.name} install folder gets deleted from this PC. You stay in the beta and can install it again later.`, 'Uninstall', true)) return;
        await attempt(async () => { await hf.betaUninstall(a.id); toast(`${b.name} was uninstalled.`); });
      } });
    }
  }
  if (a.saveData && (!Array.isArray(a.saveData) || a.saveData.length)) {
    const off = (S.settings.cloudSavesOff || []).includes(a.id);
    items.push('-', { label: off ? 'Turn on cloud saves' : 'Turn off cloud saves', icon: 'cloud', run: () => attempt(() => hf.cloudToggle(a.id, off)) });
    if (!off && S.installed[a.id]) items.push({ label: 'Back up save now', icon: 'cloud', run: () => attempt(() => hf.cloudCheck(a.id, true)) });
    items.push({ label: 'Open save folder', icon: 'folder', run: () => attempt(() => hf.cloudOpen(a.id)) });
    items.push({ label: 'Save backups on this PC', icon: 'folder', run: () => attempt(() => hf.cloudBackups(a.id)) });
  }
  if (S.settings.devMode) {
    const achs = achList(a);
    items.push('-', { label: 'Copy game ID', icon: 'copy', run: () => attempt(async () => { await hf.devTool('copy', a.id); toast(`Copied the game ID: ${a.id}`, 'ok'); }) });
    if (b) items.push({ label: 'Copy beta ID', icon: 'copy', run: () => attempt(async () => { await hf.devTool('copy', b.id); toast(`Copied the beta ID: ${b.id}`, 'ok'); }) });
    if (achs.length) items.push({ label: 'Copy achievement IDs', icon: 'copy', run: () => attempt(async () => {
      await hf.devTool('copy', JSON.stringify(Object.fromEntries(achs.map(x => [x.id, x.name])), null, 2));
      toast(`Copied ${achs.length} achievement ID${achs.length === 1 ? '' : 's'}.`, 'ok');
    }) });
  }
  return items;
}
async function checkUpdates() {
  const s = await attempt(() => hf.refresh());
  if (!s || s.jsonBroken) return;
  if (s.offline) return toast(`Couldn't reach ikelene.net (${s.manifestError || 'offline'})`, 'err');
  const st = sel && s.status[sel];
  if (st === 'update') toast('An update is available!');
  else if (st === 'repair') toast('Fixed game files are out - hit Repair!');
  else if (st === 'ready') toast("You're on the latest version :3", 'ok');
  else toast('Library refreshed.', 'ok');
}

function renderOffline() {
  const gate = !!S.serverDown && !S.offlineMode;
  const known = !!S.manifestChecked || !!S.offlineMode;
  document.body.classList.toggle('hold-ui', !known || gate || needLogin());
  $('#offline-gate').hidden = !gate || !revealed;
  $('#connecting').hidden = known || !revealed;
  if (gate) $('#og-why').textContent = S.manifestError ? `(${S.manifestError})` : '';
  $('#offline-banner').hidden = !S.offlineMode;
  document.body.classList.toggle('offline-mode', !!S.offlineMode);
}
$('#og-retry').addEventListener('click', e => {
  const b = e.currentTarget;
  b.disabled = true;
  b.textContent = 'trying...';
  hf.refresh()
    .then(s => { if (s.serverDown) toast("Still can't reach the server.", 'err'); })
    .catch(() => {})
    .finally(() => { b.disabled = false; b.textContent = 'try again'; });
});
$('#og-offline').addEventListener('click', e => { e.preventDefault(); attempt(() => hf.setOfflineMode(true)); });
$('#ob-reconnect').addEventListener('click', e => {
  e.preventDefault();
  attempt(async () => {
    const s = await hf.setOfflineMode(false);
    toast(s.serverDown ? "Still can't reach the server." : 'Back online!', s.serverDown ? 'err' : 'ok');
  });
});

function renderEmpty() {
  let content = null;
  if (!S.manifest) {
    content = [el('h2', { text: "can't reach IKELENE.net" }),
      el('p', { text: S.manifestError ? `The library didn't load (${S.manifestError}).` : 'Loading the library...' }),
      el('button', { class: 'btn', text: 'Try again', onclick: () => attempt(() => hf.refresh()) })];
  } else if (!libraryList().length) {
    content = S.offlineMode
      ? [el('h2', { text: 'no games to play offline' }), el('p', { text: 'Offline Mode only shows games that are already installed on this PC.' })]
      : [el('div', { class: 'em-kicker', text: 'YOUR LIBRARY' }), el('h2', { text: 'nothing here yet' }),
        el('p', { text: 'Games you add from the store show up here, ready to install and play.' }),
        el('button', { class: 'btn em-go', onclick: () => setTab('store') }, el('span', { class: 'btn-ico', html: ICONS.store }), el('span', { text: 'Browse the store' }))];
  }
  const box = $('#empty');
  box.hidden = !content;
  box.classList.toggle('lib-empty', !!content && !!S.manifest);
  const key = content ? `${!!S.manifest}|${S.manifestError}|${S.offlineMode}|${libraryList().length}` : '';
  if (content && keys.empty !== key) box.replaceChildren(el('img', { src: S.manifest ? '../assets/hyperfocus.png' : '../assets/hyperfocus.png', alt: '' }), ...content);
  keys.empty = key;
}

const MUSIC_FADE_MS = 600;
const players = new Map();
let activeMusic = null;
function fadeTo(p, to, ms) {
  if (p.fadeTarget === to && (p.fading || Math.abs(p.a.volume - to) < 0.001)) return p.fading || Promise.resolve(true);
  const tok = p.fadeTok = (p.fadeTok || 0) + 1;
  p.fadeTarget = to;
  const from = p.a.volume, t0 = performance.now();
  p.fading = new Promise(resolve => {
    const step = () => {
      if (tok !== p.fadeTok) return resolve(false);
      const t = Math.min(1, (performance.now() - t0) / ms);
      p.a.volume = Math.max(0, Math.min(1, from + (to - from) * t));
      if (t >= 1) { p.fading = null; return resolve(true); }
      setTimeout(step, 16);
    };
    step();
  });
  return p.fading;
}
const musicUrl = () => {
  const own = tab !== 'library' || needLogin() ? '' : cur()?.music;
  return String((typeof own === 'string' && own.trim()) || S?.manifest?.launcher?.music || '').trim();
};
const targetVolume = () => (S.settings.musicMuted ? 0 : Math.max(0, Math.min(1, Number(S.settings.musicVolume ?? 0.4))));
const shouldPlay = () => visible && !S.running.length && targetVolume() > 0 && !trailer && !pageTrailer;
function loadTrack(p) {
  p.a.src = p.list[p.i];
  p.a.loop = p.list.length === 1;
}
function nextTrack(p) {
  if (p.list.length < 2) return;
  p.i = (p.i + 1) % p.list.length;
  loadTrack(p);
  syncMusic();
}
function playerFor(url) {
  let p = players.get(url);
  if (p) return p;
  p = { url, a: new Audio(), list: [], i: 0, ready: null };
  p.a.preload = 'auto';
  p.a.volume = 0;
  p.a.addEventListener('ended', () => nextTrack(p));
  p.a.addEventListener('error', () => setTimeout(() => nextTrack(p), 800));
  p.ready = hf.resolveMusic(url)
    .then(list => { p.list = Array.isArray(list) ? list : []; if (p.list.length) loadTrack(p); })
    .catch(e => console.warn('music playlist failed', e));
  players.set(url, p);
  return p;
}
const intro = { done: false, a: null, ended: false };
const INTRO_MIN_S = 3;
let revealed = false;
const boot = { loaded: false, checking: false };
const waitFor = (node, events, ms) => new Promise(res => {
  const done = () => { clearTimeout(t); events.forEach(e => node.removeEventListener(e, done)); res(); };
  const t = setTimeout(done, ms);
  events.forEach(e => node.addEventListener(e, done, { once: true }));
});
async function bootLoaded() {
  if (!S || !(S.manifestChecked || S.offlineMode || S.serverDown)) return false;
  const waits = [];
  const bg = $('#bg').lastElementChild;
  if (bg && !bg.classList.contains('show')) waits.push(waitFor(bg, bg.tagName === 'VIDEO' ? ['loadeddata', 'error'] : ['load', 'error'], 15000));
  const logo = $('#app-logo');
  if (!logo.hidden && logo.getAttribute('src') && !logo.complete) waits.push(waitFor(logo, ['load', 'error'], 15000));
  const url = musicUrl();
  if (url) {
    const p = playerFor(url);
    waits.push(Promise.resolve(p.ready).then(() => p.list.length && p.a.readyState < 4 ? waitFor(p.a, ['canplaythrough', 'error'], 15000) : null));
  }
  await Promise.all(waits);
  return true;
}
function checkBoot() {
  if (boot.loaded || boot.checking || revealed) return;
  boot.checking = true;
  new Promise(r => setTimeout(r, 50)).then(bootLoaded).then(ok => {
    boot.checking = false;
    if (!ok) return;
    boot.loaded = true;
    maybeReveal();
  }, () => { boot.checking = false; boot.loaded = true; maybeReveal(); });
}
function maybeReveal() {
  if (revealed || !boot.loaded) return;
  const a = intro.a;
  if (a && !intro.ended && !a.ended && a.currentTime < INTRO_MIN_S) return;
  reveal();
}
let firstMusicFade = true;
function reveal() {
  if (revealed) return;
  revealed = true;
  const ia = intro.a;
  if (ia && !ia.ended && !ia.paused) {
    const from = ia.volume, t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / 1200);
      ia.volume = from * (1 - k);
      if (k < 1) requestAnimationFrame(step); else ia.pause();
    };
    requestAnimationFrame(step);
  }
  intro.done = true;
  intro.a = null;
  syncMusic();
  document.body.classList.add('intro-out');
  setTimeout(() => {
    document.body.classList.remove('intro', 'intro-out');
    document.getElementById('splash')?.remove();
    if (S) { renderOffline(); renderLoginGate(); maybeShowDrops(); }
  }, 500);
}
const introVolume = () => { const v = Math.max(0, Math.min(1, Number(S.settings.musicVolume ?? 0.4))); return v > 0 ? v : 0.4; };
function playIntro() {
  if (!visible) { if (intro.a && !intro.a.paused) intro.a.pause(); return; }
  if (S.running.length) {
    reveal();
    intro.done = true;
    if (intro.a) intro.a.pause();
    intro.a = null;
    return;
  }
  if (!intro.a) {
    const a = intro.a = new Audio('../assets/sounds/launch.mp3');
    const over = () => { intro.ended = true; maybeReveal(); };
    a.addEventListener('ended', over);
    a.addEventListener('error', over);
    a.addEventListener('timeupdate', maybeReveal);
    setTimeout(reveal, 25000);
    a.volume = introVolume();
    a.play().catch(over);
    checkBoot();
    return;
  }
  intro.a.volume = introVolume();
  if (intro.a.paused && !intro.a.ended) intro.a.play().catch(() => {});
}
function syncMusic() {
  if (!S) return;
  if (!intro.done) { playIntro(); if (!intro.done) return; }
  for (const p of players.values()) {
    const wanted = p.url === activeMusic && shouldPlay() && p.list.length > 0;
    if (wanted) {
      if (p.a.paused) {
        const ms = firstMusicFade ? 1800 : MUSIC_FADE_MS;
        firstMusicFade = false;
        p.a.play().then(() => fadeTo(p, targetVolume(), ms)).catch(() => {});
      }
      else fadeTo(p, targetVolume(), p.fadeTarget === 0 ? MUSIC_FADE_MS : 150);
    } else if (!p.a.paused) {
      fadeTo(p, 0, MUSIC_FADE_MS).then(ok => {
        if (ok && !(p.url === activeMusic && shouldPlay())) p.a.pause();
      });
    }
  }
}
async function updateMusic() {
  const url = musicUrl() || null;
  if (url !== activeMusic) {
    activeMusic = url;
    const p = url ? playerFor(url) : null;
    syncMusic();
    if (p && !p.list.length) {
      await p.ready;
      if (activeMusic !== url) return;
    }
  }
  syncMusic();
}
function renderVolume() {
  $('#vol-wrap').hidden = !musicUrl();
  const v = Math.round((S.settings.musicMuted ? 0 : S.settings.musicVolume ?? 0.4) * 100);
  const icon = v === 0 ? 'volOff' : 'vol';
  const btn = $('#btn-vol');
  if (btn.dataset.icon !== icon) { btn.innerHTML = ICONS[icon]; btn.dataset.icon = icon; }
  btn.title = v === 0 ? 'Unmute music' : 'Mute music';
  const r = $('#vol');
  if (document.activeElement !== r) { r.value = v; setRangeFill(r); $('#vol-val').textContent = `${v}%`; }
}
$('#vol').addEventListener('input', e => {
  setRangeFill(e.target);
  $('#vol-val').textContent = `${e.target.value}%`;
  Object.assign(S.settings, { musicVolume: Number(e.target.value) / 100, musicMuted: false });
  syncMusic();
});
$('#vol').addEventListener('pointerdown', () => $('#vol-wrap').classList.add('dragging'));
window.addEventListener('pointerup', () => $('#vol-wrap').classList.remove('dragging'));
$('#vol').addEventListener('change', e => {
  e.target.blur();
  hf.setSettings({ musicVolume: Number(e.target.value) / 100, musicMuted: false }).catch(() => {});
});
$('#btn-vol').addEventListener('click', () => {
  const mute = !(S.settings.musicMuted || !S.settings.musicVolume);
  const patch = mute ? { musicMuted: true } : { musicMuted: false, musicVolume: S.settings.musicVolume || 0.4 };
  Object.assign(S.settings, patch);
  renderVolume();
  syncMusic();
  hf.setSettings(patch).catch(() => {});
});

let gsApp = null, gsKey = '', gsRefs = null;
async function redeemCode(raw, btn) {
  const code = String(raw || '').trim();
  if (!code) { toast('Type a code first.', 'err'); return null; }
  if (btn) btn.disabled = true;
  const r = await attempt(() => (hf.redeemCode || hf.betaRedeem)(code));
  if (btn) btn.disabled = false;
  if (!r) return null;
  if (r.kind === 'key') { toast(`${r.app?.name || 'The game'} is in your library - it's yours!`, 'ok'); return r; }
  const game = r.app?.name ? ` for ${r.app.name}` : '';
  toast(r.chosen ? `You're in the ${r.beta.name} beta${game}!` : `You joined ${r.beta.name}${game} - pick it in the game's settings (another beta is installed, so switching is up to you).`, 'ok');
  return r;
}
function openRedeem() {
  const input = el('input', { class: 'field grow rd-in', placeholder: 'XXXXX-XXXXX-XXXXX', maxlength: 32, spellcheck: 'false', autocomplete: 'off' });
  const go = el('button', { class: 'btn' }, el('span', { class: 'btn-ico', html: ICONS.key }), el('span', { text: 'Redeem' }));
  const canAct = !!S.account && !S.offlineMode;
  input.disabled = go.disabled = !canAct;
  const run = async () => {
    const r = await redeemCode(input.value, go);
    if (!r) { input.focus(); return; }
    closeModal('redeem');
    if (r.app?.id && apps().some(a => a.id === r.app.id)) { setTab('library'); selectApp(r.app.id); }
  };
  go.addEventListener('click', run);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
  openModal('redeem', 'redeem a game code', el('div', { class: 'dialog rd' },
    el('div', { class: 'rd-head' }, el('span', { class: 'rd-ico', html: ICONS.key }),
      el('p', { text: "Got a code from a game developer? A game key adds the full game to your library; a beta code gets you into that game's beta." })),
    el('div', { class: 'row' }, input, go),
    el('span', { class: 'hint', text: canAct ? 'Game keys look like XXXXX-XXXXX-XXXXX, beta codes like XXXX-XXXX.' : S.offlineMode ? "Codes can't be redeemed in Offline Mode." : 'Sign in with Nookara to redeem a code.' }),
    el('div', { class: 'acts' }, el('button', { class: 'btn ghost', text: 'Close', onclick: () => closeModal('redeem') }))));
  if (canAct) requestAnimationFrame(() => input.focus());
}
$('#lib-redeem .lrd-ico').innerHTML = ICONS.key;
$('#lib-redeem').addEventListener('click', () => openRedeem());
async function selectBeta(a, betaId) {
  if ((S.settings.betaChoice?.[a.id] || null) === betaId) return true;
  const rec = S.installedBetas?.[a.id];
  if (rec && rec.betaId !== betaId) {
    if (betaRunning(a)) { toast('Close the beta first.', 'err'); drawGameSettings(true); return false; }
    const n = rec.betaName || 'the beta';
    if (!await confirmBox(`switch away from ${n}?`, `Only one beta can be installed at a time, so ${n} gets uninstalled from this PC (its install folder is deleted). You can install a beta again any time.`, 'Switch', true)) { drawGameSettings(true); return false; }
  }
  const ok = await attempt(async () => { await hf.betaChoose(a.id, betaId); return true; });
  if (!ok) drawGameSettings(true);
  return !!ok;
}
async function joinPublicBeta(a, b, btn) {
  btn.disabled = true;
  const joined = await attempt(() => hf.betaJoin(b.id));
  btn.disabled = false;
  if (!joined) return;
  toast(`You joined ${b.name}.`, 'ok');
  selectBeta(a, b.id);
}
async function leaveJoinedBeta(a, b) {
  const there = S.installedBetas?.[a.id]?.betaId === b.id;
  const text = `${b.via === 'code' ? "You'll need the code again to get back in." : 'You can join it again any time.'}${there ? ` ${b.name} also gets uninstalled from this PC.` : ''}`;
  if (!await confirmBox(`leave ${b.name}?`, text, 'Leave', true)) return;
  await attempt(async () => { await hf.betaLeave(b.id); toast(`You left ${b.name}.`); });
}
function openGameSettings(a) {
  gsApp = a.id;
  gsKey = '';
  const go = el('button', { class: 'btn ghost gs-redeem', onclick: () => openRedeem() }, el('span', { class: 'btn-ico', html: ICONS.key }), el('span', { text: 'Redeem a game code...' }));
  const login = a.community && a.veloraToken ? el('div', { class: 'gs-login' }) : null;
  gsRefs = { list: el('div', { class: 'gs-list' }), go, login };
  openModal('game-settings', `${a.name || a.id} - game settings`, el('div', { class: 'dialog gs' },
    el('div', { class: 'gs-h' }, el('span', { html: ICONS.flask }), el('span', { text: 'betas' })),
    gsRefs.list,
    login ? [el('div', { class: 'gs-h gs-vh' }, el('span', { html: ICONS.veloraLogo }), el('span', { text: 'velora login' })), login] : null,
    el('div', { class: 'gs-h', text: 'have a beta code or a game key?' }),
    el('div', { class: 'row' }, go)));
  drawGameSettings(true);
  if (S.account && !S.offlineMode) hf.betaRefresh().catch(() => {});
}
function drawGameSettings(force) {
  if (!gsRefs || !gsRefs.list.isConnected) return;
  const a = apps().find(x => x.id === gsApp);
  if (!a) return closeModal('game-settings');
  const all = S.betas?.[a.id] || [];
  const mine = all.filter(b => b.member), open = all.filter(b => b.public && !b.member);
  const choice = S.settings.betaChoice?.[a.id] || '';
  const rec = S.installedBetas?.[a.id];
  const canAct = !!S.account && !S.offlineMode;
  const lg = S.settings.gameLogins?.[a.id] || null;
  const key = JSON.stringify([all, choice, rec && [rec.betaId, rec.version], canAct, a.veloraToken || null, lg, S.account?.username || '']);
  if (!force && key === gsKey) return;
  gsKey = key;
  drawGameLogin(a, lg);
  gsRefs.go.disabled = !canAct;
  gsRefs.go.title = canAct ? '' : S.offlineMode ? "Not available in Offline Mode" : 'Log in with Nookara to redeem a code';
  const hint = text => el('span', { class: 'hint', text });
  const pick = b => {
    const input = el('input', { type: 'radio', name: 'gs-beta' });
    input.checked = (b ? b.id : '') === choice;
    input.addEventListener('change', () => { if (input.checked) selectBeta(a, b ? b.id : null); });
    const notes = b && String(b.notes || '').trim();
    const meta = b ? [betaVer(b), rec?.betaId === b.id ? 'installed' : '', b.locked === 'nobuild' ? 'no build yet' : b.locked === 'buy' ? 'buy the game to play it' : ''].filter(Boolean).join(' · ') : '';
    return el('div', { class: 'gs-row' },
      el('label', { class: 'opt grow' }, input, el('span', {},
        b ? el('b', { text: b.name }) : el('b', { text: 'Release (no beta)' }),
        b && betaVia(b) ? el('span', { class: 'tag', text: betaVia(b) }) : null,
        meta ? hint(meta) : b ? null : hint('The normal version of the game.'),
        notes ? el('span', { class: 'hint gs-notes', text: notes, title: notes }) : null)),
      b && (b.via === 'public' || b.via === 'code') ? el('button', { class: 'btn ghost', text: 'Leave', disabled: !canAct, onclick: () => leaveJoinedBeta(a, b) }) : null);
  };
  const join = b => {
    const notes = String(b.notes || '').trim();
    const btn = el('button', { class: 'btn', text: 'Join', disabled: !canAct });
    btn.addEventListener('click', () => joinPublicBeta(a, b, btn));
    return el('div', { class: 'gs-row' },
      el('div', { class: 'grow' }, el('b', { text: b.name }), el('span', { class: 'tag', text: 'public' }),
        betaVer(b) ? hint(betaVer(b)) : null,
        notes ? el('span', { class: 'hint gs-notes', text: notes, title: notes }) : null),
      btn);
  };
  gsRefs.list.replaceChildren(...[
    !canAct ? hint(S.offlineMode ? "Betas can't be joined in Offline Mode." : 'Log in with Nookara to join betas.') : null,
    pick(null), ...mine.map(pick),
    open.length ? el('div', { class: 'gs-sub', text: 'public betas you can join' }) : null,
    ...open.map(join),
    !mine.length && !open.length ? hint("No betas for this game right now. If you've got a beta code, redeem it below.") : null,
  ].filter(Boolean));
}

function drawGameLogin(a, lg) {
  const box = gsRefs?.login;
  if (!box) return;
  const vt = a.veloraToken || {};
  const project = String(vt.project || a.name || a.id).slice(0, 100);
  const scopes = ((Math.floor(Number(vt.scopes)) || 1) & (2 ** 21 - 1)) || 1;
  const same = lg && Number(lg.scopes) === scopes && lg.project === project && lg.user === (S.account?.username || '');
  const [state, cls, hint] = !lg ? ['not asked yet', '', "You'll be asked the first time you play it."]
    : !same ? ['asks again', '', lg.user !== (S.account?.username || '') ? 'You answered on another Nookara account - it asks again when you play.' : 'It wants different permissions now - it asks again when you play.']
      : lg.allow ? ['allowed', 'ok', `It gets its own Nookara login when it starts${project !== (a.name || a.id) ? ` (as "${project}")` : ''}. Revoking takes effect the next time it starts.`]
        : ['not given', 'no', 'It starts without a Nookara login and asks you to sign in by itself.'];
  const forget = (label, done) => el('button', { class: 'btn ghost', text: label, onclick: async () => {
    if (await attempt(() => hf.gameLoginForget(a.id)) === undefined) return;
    toast(done, 'ok');
  } });
  box.replaceChildren(el('div', { class: 'gs-row' },
    el('div', { class: 'grow' }, el('b', { text: 'Nookara login: ' }), el('span', { class: `gs-lstate ${cls}`, text: state }),
      el('span', { class: 'hint', text: hint })),
    lg ? forget(same && lg.allow ? 'Revoke' : 'Ask again', same && lg.allow ? `Revoked - ${a.name || a.id} asks again next time you play.` : `${a.name || a.id} asks again next time you play.`) : null));
}

function check(label, hint, checked, onchange) {
  const input = el('input', { type: 'checkbox' });
  input.checked = !!checked;
  input.addEventListener('change', () => onchange(input.checked));
  return el('label', { class: 'opt' }, input, el('span', {}, label, hint ? el('span', { class: 'hint', text: hint }) : null));
}
function radios(name, options, value, onchange) {
  return options.map(([v, label]) => {
    const input = el('input', { type: 'radio', name });
    input.checked = String(value) === String(v);
    input.addEventListener('change', () => input.checked && onchange(v));
    return el('label', { class: 'opt' }, input, el('span', { text: label }));
  });
}
const sbox = (title, ...body) => el('div', { class: 'box' }, el('div', { class: 'box-h', text: title }), el('div', { class: 'p-5' }, ...body));
const setS = patch => { Object.assign(S.settings, patch); return hf.setSettings(patch).catch(e => toast(e.message, 'err')); };

function cloudBox() {
  const games = apps().filter(x => x.saveData && (!Array.isArray(x.saveData) || x.saveData.length));
  if (!games.length) return null;
  const off = new Set(S.settings.cloudSavesOff || []);
  return sbox('save data cloud',
    el('p', { class: 'hint', text: 'Saves back up to your Nookara account when a game closes, and load on your other PCs. Turn it off for a game here (or in its game menu).' }),
    ...games.map(g => check(g.name || g.id, '', !off.has(g.id), v => attempt(() => hf.cloudToggle(g.id, v)))));
}
function devTab() {
  const wrap = el('div');
  const save = patch => { setS(patch).then(r => { if (r && typeof r === 'object') Object.assign(S.settings, r); draw(); }); draw(); };
  const draw = () => {
    const s = S.settings;
    const tool = (label, hint, name) => el('div', { class: 'row dev-tool' },
      el('span', { class: 'grow' }, el('b', { text: label }), el('span', { class: 'hint', text: hint })),
      el('button', { class: 'btn ghost', text: 'go', onclick: () => attempt(() => hf.devTool(name)) }));
    wrap.replaceChildren(
      sbox('developer mode',
        check('Developer Mode', 'Tools for making games for Hyperfocus. Adds "Copy game ID" to game menus (right-click a game, or its menu button in the play bar).', !!s.devMode, v => save({ devMode: v })),
        s.devMode ? check('Allow game extension connections when no game is open',
          "Lets the Hyperfocus extension's blocks reach the launcher from an editor (PenguinMod, TurboWarp...) without launching the game: Discord Rich Presence works even without a game ID, and achievements and friend invites work for any game ID you set - even one that isn't reviewed yet.",
          !!s.devBridgeNoGame, v => save({ devBridgeNoGame: v })) : null),
      s.devMode ? sbox('developer tools',
        tool('Test achievement popups', 'Shows a common and a rare one (with the sound).', 'testAchievement'),
        tool('Game bridge log', 'Every call the Hyperfocus extension made to the launcher (127.0.0.1:47833).', 'bridgeLog'),
        tool('Open the data folder', 'Settings, install records, caches.', 'dataFolder'),
        tool('Reload the game list', 'Skips the cache: new apps.json edits, achievements and community changes.', 'refresh'),
        tool('Open DevTools', "The launcher window's Chromium DevTools.", 'devtools')) : null);
  };
  draw();
  return [wrap];
}
function settingsTab(tab) {
  const s = S.settings;
  if (tab === 'developer') return devTab();
  if (tab === 'launcher') {
    const vol = el('input', { type: 'range', min: 0, max: 100, step: 1 });
    vol.value = Math.round((s.musicMuted ? 0 : s.musicVolume ?? 0.4) * 100);
    setRangeFill(vol);
    const volVal = el('span', { class: 'hint', text: vol.value + '%' });
    vol.addEventListener('input', () => {
      setRangeFill(vol);
      volVal.textContent = vol.value + '%';
      Object.assign(S.settings, { musicVolume: vol.value / 100, musicMuted: false });
      syncMusic();
      renderVolume();
    });
    vol.addEventListener('change', () => setS({ musicVolume: vol.value / 100, musicMuted: false }));
    const hotkey = el('select', { class: 'field' },
      ...['Shift+Tab', 'Shift+F1', 'Ctrl+Shift+O', 'Alt+Z', 'F10'].map(k => el('option', { value: k, text: k.toLowerCase() })));
    hotkey.value = s.overlayHotkey || 'Shift+Tab';
    hotkey.addEventListener('change', () => setS({ overlayHotkey: hotkey.value }));
    const shotKey = el('select', { class: 'field' },
      ...['F11', 'F12', 'Shift+F12', 'Ctrl+F12', 'off'].map(k => el('option', { value: k, text: k.toLowerCase() })));
    shotKey.value = s.screenshotHotkey || 'F11';
    shotKey.addEventListener('change', () => setS({ screenshotHotkey: shotKey.value }));
    const shotPathEl = el('div', { class: 'path grow', text: s.screenshotRoot, title: s.screenshotRoot });
    const shotsBox = sbox('screenshots',
      el('div', { class: 'row' }, el('span', { class: 'grow', text: 'Screenshot key (while something you launched is running)' }), shotKey),
      el('div', { class: 'row' }, shotPathEl,
        el('button', { class: 'btn', text: 'Change', onclick: async () => {
          const p = await attempt(() => hf.pickFolder('shots'));
          if (!p) return;
          await setS({ screenshotRoot: p });
          shotPathEl.textContent = p;
          shotPathEl.title = p;
          for (const k of Object.keys(shots)) delete shots[k];
          loadShots(sel);
        } }),
        el('button', { class: 'btn ghost', text: 'Open', onclick: () => attempt(() => hf.shotFolder()) })),
      el('span', { class: 'hint', text: "Sorted into a folder per game. Changing the location doesn't move old screenshots." }));
    const siteList = el('div', {});
    const drawSites = () => {
      const cur = Object.entries(S.settings.bridgeOrigins || {});
      siteList.replaceChildren(...(cur.length ? cur.map(([site, ok]) => el('div', { class: 'row' },
        el('span', { class: 'path grow', text: site, title: site }),
        el('span', { class: 'hint', text: ok ? 'allowed' : 'blocked' }),
        el('button', { class: 'btn ghost', text: 'forget', title: "it'll ask again next time", onclick: async () => {
          const next = { ...S.settings.bridgeOrigins };
          delete next[site];
          await setS({ bridgeOrigins: next });
          drawSites();
        } })))
        : [el('span', { class: 'hint', text: 'No sites yet. Packaged games never need permission.' })]));
    };
    drawSites();
    const blocksBox = sbox('game blocks (Scratch extension)',
      el('span', { class: 'hint', text: "Websites (like the PenguinMod or TurboWarp editor) have to be allowed before they can use the player + invite blocks - you're asked the first time." }),
      siteList);
    const redeemGo = el('button', { class: 'btn', onclick: () => { closeModal('settings'); openRedeem(); } }, el('span', { class: 'btn-ico', html: ICONS.key }), el('span', { text: 'Redeem a game code' }));
    return [
      cloudBox(),
      sbox('launch settings', check(IS_MAC ? 'Open at login' : 'Start with Windows', IS_MAC ? 'Hyperfocus opens when you log in and waits in the menu bar - your games stay one click away.' : 'Hyperfocus starts with Windows and waits in the tray - your games stay one click away.', s.autoLaunch !== false, v => setS({ autoLaunch: v })),
        check('Show new games when Hyperfocus opens', 'A popup with the games that came out since you last opened the launcher.', S.settings.newGamesPopup !== false, v => setS({ newGamesPopup: v }))),
      sbox('overlay & notifications',
        check('In-game overlay', 'Press the hotkey while something you launched from Hyperfocus is running.', s.overlayEnabled !== false, v => setS({ overlayEnabled: v })),
        el('div', { class: 'row' }, el('span', { class: 'grow', text: 'Overlay hotkey' }), hotkey),
        check('Friend online popups', 'Pop up when one of your friends comes online.', s.friendOnlinePopups === true, v => setS({ friendOnlinePopups: v })),
        check('Notification sounds', 'Friends coming online, new messages and launcher alerts.', s.notifySounds !== false, v => setS({ notifySounds: v })),
        check('Voice chat overlay', "Show who's in your voice room on top of your game (click-through, top-left).", s.voiceHud !== false, v => setS({ voiceHud: v }))),
      sbox('redeem a game code',
        el('span', { class: 'hint', text: 'Got a code from a game developer? A game key adds the full game to your library; a beta code gets you into its beta.' }),
        el('div', { class: 'row' }, redeemGo)),
      shotsBox,
      blocksBox,
      sbox('discord',
        check('Discord Rich Presence', 'Show what you are playing on your Discord profile (needs the Discord desktop app open).', s.discordRichPresence !== false, v => setS({ discordRichPresence: v }))),
      sbox('when closing the window', ...radios('close', [['tray', 'Minimize to tray'], ['exit', 'Exit launcher']], s.closeAction, v => setS({ closeAction: v }))),
      sbox('when launching something', ...radios('launch', [['minimize', 'Minimize the launcher'], ['tray', 'Hide the launcher to the tray'], ['keep', 'Keep the launcher open']], s.onLaunch, v => setS({ onLaunch: v }))),
      sbox('look & sound',
        check('Video backgrounds', 'Play animated backgrounds when there is one (hover the top of the cover to switch).', s.videoBackgrounds !== false, v => { setS({ videoBackgrounds: v }); renderVisuals(true); }),
        check('Animations', 'Windows opening, games growing out of their buttons, sliding and fading around the launcher. Off = everything changes instantly.', s.animations !== false, v => setS({ animations: v })),
        check('Cursor bubbles', 'The bubble trail from the ikelene.net homepage.', s.cursorTrail !== false, v => { setS({ cursorTrail: v }); window.cursorTrail?.set(v); }),
        el('div', { class: 'row' }, el('span', { class: 'grow', text: 'Music volume' }), vol, volVal)),
    ];
  }
  if (tab === 'downloads') {
    const pathEl = el('div', { class: 'path grow', text: s.installRoot, title: s.installRoot });
    return [
      sbox('install location',
        el('div', { class: 'row' }, pathEl, el('button', { class: 'btn', text: 'Change', onclick: async () => {
          const p = await attempt(() => hf.pickFolder());
          if (!p) return;
          await setS({ installRoot: p });
          pathEl.textContent = p;
          pathEl.title = p;
          toast('New installs go there now. Already-installed stuff stays put.');
        } })),
        el('span', { class: 'hint', text: 'Only affects new installs.' })),
      sbox('download speed limit', ...radios('speed', [
        [0, 'No limit'], [1048576, '1 MB/s'], [5242880, '5 MB/s'], [10485760, '10 MB/s'], [26214400, '25 MB/s'],
      ], s.speedLimit || 0, v => setS({ speedLimit: v }))),
    ];
  }
  const L = S.manifest?.launcher || {};
  return [
    sbox('about', el('div', { class: 'about' },
      el('span', { class: 'about-mark vl-mark', html: ICONS.hyperfocusLogo }),
      el('div', {}, el('div', { class: 'n', text: 'HYPERFOCUS' }), el('div', { class: 'hint', text: `version ${S.version} · the IKELENE.net launcher · created by ike` })))),
    sbox('status',
      el('ul', { class: 'stats' },
        el('li', {}, el('b', { text: 'server' }), `: ${S.offline ? `offline (${S.manifestError || '?'})` : 'connected to ikelene.net'}`),
        el('li', {}, el('b', { text: 'latest launcher' }), `: ${L.version ? `v${L.version}` : '--'}`),
        el('li', {}, el('b', { text: 'velora' }), `: ${S.account ? S.account.username : 'not logged in'}`)),
      el('div', { class: 'row' },
        el('button', { class: 'btn', text: 'ikelene.net', onclick: () => hf.openUrl('https://ikelene.net') }),
        el('button', { class: 'btn', text: 'Nookara', onclick: () => hf.openUrl('https://nookara.cc') }),
        S.launcherUpdate ? el('button', { class: 'btn', text: `Update to v${S.launcherUpdate.version}`, onclick: () => { closeModal('settings'); showLauncherUpdate(true); } }) : null)),
    sbox('beta',
      check('Hyperfocus beta', "Get new versions early. Bugs are expected! Unchecking it puts you back on the normal release.", !!S.settings.betaChannel, async v => {
        const r = await attempt(() => hf.setLauncherChannel(v));
        if (!r) return;
        if (r.update) { closeModal('settings'); luShown = false; showLauncherUpdate(true, r.update); }
        else if (v) toast(r.betaAvailable ? "You're already on the latest beta." : "There's no beta right now - you'll get the next one when it's out.", 'ok');
        else toast("You're on the release version.", 'ok');
      })),
  ];
}
function openSettings(tab = 'launcher') {
  const body = el('div', { class: 's-body' });
  const navBtns = {};
  let shownTab = null;
  const order = ['launcher', 'downloads', 'developer', 'about'];
  const show = t => {
    Object.entries(navBtns).forEach(([k, b]) => b.classList.toggle('on', k === t));
    body.replaceChildren(...settingsTab(t));
    body.scrollTop = 0;
    if (shownTab && shownTab !== t && !reduceMotion()) {
      body.classList.remove('vl-tab-r', 'vl-tab-l'); void body.offsetWidth;
      body.classList.add(order.indexOf(t) > order.indexOf(shownTab) ? 'vl-tab-r' : 'vl-tab-l');
    }
    shownTab = t;
  };
  const nav = el('div', { class: 's-nav' },
    ...[['launcher', 'launcher'], ['downloads', 'downloads'], ['developer', 'developer'], ['about', 'about']].map(([k, label]) => (navBtns[k] = el('button', { text: label, onclick: () => show(k) }))));
  openModal('settings', 'settings', el('div', { class: 'settings' }, nav, body));
  show(tab);
}

async function openDashboard() {
  const body = el('div', { class: 'dash' }, el('p', { class: 'hint', text: 'loading...' }));
  openModal('dash', 'dashboard', body);
  const d = await attempt(() => hf.ownerStats());
  if (!d) return closeModal('dash');
  const card = (n, label) => el('div', { class: 'dash-card' }, el('b', { text: String(n) }), el('span', { text: label }));
  const max = Math.max(1, ...d.days.map(x => x.users));
  const dayName = s => new Date(`${s}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short' });
  body.replaceChildren(
    el('div', { class: 'dash-cards' },
      card(d.week.users, 'people · last 7 days'),
      card(d.week.loggedIn, 'logged in'),
      card(d.week.guests, 'not logged in'),
      card(d.month?.users ?? 0, 'last 30 days')),
    sbox('per day',
      el('div', { class: 'dash-chart' }, ...d.days.map(x => el('div', { class: 'dash-col', title: `${x.day}: ${x.users} (${x.loggedIn} logged in, ${x.guests} not)` },
        el('span', { class: 'dash-v', text: String(x.users) }),
        el('div', { class: 'dash-bar' },
          el('i', { class: 'g', style: `height:${x.guests / max * 100}%` }),
          el('i', { class: 'l', style: `height:${x.loggedIn / max * 100}%` })),
        el('span', { class: 'dash-d', text: dayName(x.day) })))),
      el('div', { class: 'dash-key' }, el('span', { class: 'l', text: 'logged in' }), el('span', { class: 'g', text: 'not logged in' }))),
    sbox('launcher versions · 7 days',
      el('ul', { class: 'stats' }, ...Object.entries(d.versions || {}).map(([v, n]) => el('li', {}, el('b', { text: v }), `: ${n}`)))),
    el('p', { class: 'hint', text: `Counted since ${d.since || 'today'}: every launcher that opens (or refreshes the game list) checks in once a day. 1.3.16+ launchers send an anonymous install ID; older ones are counted by a hashed IP.` }));
}

let luShown = false, luBar = null;
function showLauncherUpdate(manual, info) {
  const u = info || S.launcherUpdate;
  if (!u || (luShown && !manual)) return;
  luShown = true;
  luBar = el('i');
  const barWrap = el('div', { class: 'bar', hidden: true }, luBar);
  const go = el('button', { class: 'btn', text: 'Update now', onclick: async () => {
    go.disabled = true;
    go.textContent = 'Downloading...';
    barWrap.hidden = false;
    await attempt(() => hf.updateLauncher());
    go.disabled = false;
    go.textContent = 'Update now';
  } });
  const title = u.toRelease ? `back to hyperfocus v${u.version}` : u.beta ? `hyperfocus beta v${u.version}` : `hyperfocus v${u.version} is here!`;
  const blurb = u.toRelease ? "You left the beta - install the normal release version?"
    : u.releaseOverBeta ? `A release version (v${u.version}) is out that's newer than your beta (v${S.version}) - update to it? You stay in the beta and get the next beta when it's newer.`
    : u.beta ? 'A new beta is out! Bugs are expected - report them with the link at the top.'
    : u.required ? 'This update is required to keep using the launcher.' : 'Grab the new version? It only takes a sec.';
  openModal('lu', title, el('div', { class: 'dialog' },
    el('p', { text: (u.notes ? u.notes + '\n\n' : '') + blurb }),
    barWrap,
    el('div', { class: 'acts' }, u.required ? null : el('button', { class: 'btn ghost', text: 'Later', onclick: () => closeModal('lu') }), go)),
  { dismiss: !u.required });
}

$('#btn-settings').innerHTML = ICONS.gear;
$('#btn-min').innerHTML = ICONS.min;
$('#btn-close').innerHTML = ICONS.close;
$('#play-more').innerHTML = ICONS.menu;
$('#ic-time').innerHTML = ICONS.clock;
$('#ic-last').innerHTML = ICONS.calendar;
$('#ic-ach').innerHTML = ICONS.trophy;
$('#ic-pad').innerHTML = ICONS.controller;
$('#ic-shots').innerHTML = ICONS.camera;
$('#brand-mark').innerHTML = ICONS.hyperfocusLogo;
$('#lg-mark').innerHTML = ICONS.hyperfocusLogo;
$('#media-toggle [data-mode=video]').innerHTML = ICONS.video;
$('#media-toggle [data-mode=image]').innerHTML = ICONS.image;
$('#btn-settings').addEventListener('click', () => openSettings());
$('#btn-min').addEventListener('click', () => hf.win.minimize());
async function askClose() {
  if (await confirmBox('quit hyperfocus?', "A download is still running. It'll pause and pick up where it left off next time you open the launcher.", 'Quit', true)) hf.win.close(true);
}
$('#btn-close').addEventListener('click', async () => {
  const r = await hf.win.close(false).catch(() => null);
  if (r?.confirm) askClose();
});
hf.on('confirmClose', askClose);
hf.on('fx', d => document.body.classList.toggle('fx-out', d === 'out'));
hf.on('visible', v => {
  visible = !!v;
  document.body.classList.toggle('away', !visible);
  document.querySelectorAll('#bg video').forEach(vd => (visible && !trailer && tab === 'library' ? vd.play().catch(() => {}) : vd.pause()));
  if (!visible) storePausePage();
  if (!visible && trailer) trailer.video.pause();
  if (S) syncMusic();
});
hf.on('toast', t => toast(t.msg, t.kind));
hf.on('selectApp', id => { if (S && apps().some(a => a.id === id)) openGame(id); });
hf.on('storePage', id => { if (S && !S.offlineMode) { setTab('store'); openStorePage(String(id)); } });
setInterval(() => { const a = cur(); if (S && a && S.running.includes(a.id)) renderPlay(); }, 1000);

function renderBetaBanner() {
  const b = $('#beta-banner');
  b.hidden = !S.betaBuild;
  if (!S.betaBuild || b.dataset.v === S.version) return;
  b.dataset.v = S.version;
  const url = `https://nookara.cc/bug-report?${new URLSearchParams({ summary: 'Hyperfocus: ' })}`;
  b.replaceChildren(
    el('b', { text: `beta v${S.version}` }),
    el('span', { text: " - you're on a beta version, bugs are expected. Report bugs " }),
    el('a', { href: '#', text: 'here', onclick: e => { e.preventDefault(); hf.openUrl(url); } }));
}
function render() {
  if (!S || !domReady) return;
  const list = libraryList();
  if (!list.some(a => a.id === sel)) sel = (list.find(a => a.id === S.settings.lastApp) || libraryOrder()[0])?.id || null;
  if (trailer && (trailer.id !== sel || libraryOpen || trailerOf(cur()) !== trailer.url)) closeModal('trailer');
  renderConsole();
  renderTabs();
  renderBetaBanner();
  checkBoot();
  drawAchWidget(cur());
  document.body.classList.toggle('still', S.settings.videoBackgrounds === false);
  const noAnim = S.settings.animations === false;
  document.documentElement.classList.toggle('no-anim', noAnim);
  try { if ((localStorage.getItem('hf-anim') === 'off') !== noAnim) localStorage.setItem('hf-anim', noAnim ? 'off' : 'on'); } catch {  }
  window.cursorTrail?.set(S.settings.cursorTrail !== false);
  renderLibList();
  renderLibraryView();
  renderAccount();
  renderVisuals();
  renderSide();
  renderPlay();
  drawGameSettings();
  renderOffline();
  renderLoginGate();
  renderEmpty();
  renderStore();
  renderFriendsTab();
  renderProfileTab();
  maybeShowDrops();
  renderVolume();
  nudgeRelogin();
  updateMusic();
  if (S.launcherUpdate) showLauncherUpdate(false);
  if (luBar) luBar.style.width = `${pct(S.jobs.__launcher__)}%`;
}
$('#btn-console').innerHTML = ICONS.controller;
$('#btn-console').addEventListener('click', () => attempt(() => hf.setConsole(!S?.consoleMode)));
const glyph = (text, cls) => el('span', { class: `pg pg-${cls}`, text });
$('#pad-hints').replaceChildren(
  el('span', { class: 'ph' }, glyph('A', 'a'), 'select'),
  el('span', { class: 'ph' }, glyph('B', 'b'), 'back'),
  el('span', { class: 'ph' }, glyph('Y', 'y'), 'all games'),
  el('span', { class: 'ph' }, glyph('X', 'x'), 'menu'),
  el('span', { class: 'ph' }, glyph('LB', 'bumper'), glyph('RB', 'bumper'), 'switch game'),
  el('span', { class: 'ph' }, glyph('LT', 'bumper'), glyph('RT', 'bumper'), 'store / library'),
  el('span', { class: 'ph' }, el('span', { class: 'pg pg-start', html: ICONS.menu }), 'play'),
  el('span', { class: 'ph' }, el('span', { class: 'pg pg-start', html: ICONS.copy }), 'exit console mode'),
  el('button', { class: 'btn ghost', id: 'pad-exit', onclick: () => attempt(() => hf.setConsole(false)) },
    el('span', { html: ICONS.controller }), el('span', { text: 'exit console mode' })));
let wasConsole = false;
const padConnected = () => !!S?.pads?.length || [...(navigator.getGamepads?.() || [])].some(Boolean);
function applyConsoleZoom() {
  const on = document.body.classList.contains('console-mode');
  const z = on ? Math.max(1, Math.min(innerWidth / 1280, innerHeight / 740)) : 1;
  document.documentElement.style.zoom = z === 1 ? '' : String(z);
}
addEventListener('resize', applyConsoleZoom);
function renderConsole() {
  const on = !!S.consoleMode;
  $('#btn-console').hidden = !on && !padConnected();
  $('#btn-console').title = on ? 'Leave console mode' : 'Console mode (big screen, for controllers)';
  $('#btn-console').classList.toggle('active', on);
  $('#pad-hints').hidden = !on;
  $('#btn-library').hidden = !on;
  if (on === wasConsole) return;
  wasConsole = on;
  document.body.classList.toggle('console-mode', on);
  applyConsoleZoom();
  closeMenus();
  if (on) libraryOpen = true;
}
addEventListener('gamepadconnected', () => render());
addEventListener('gamepaddisconnected', () => render());

hf.on('state', s => { S = s; render(); });
addEventListener('DOMContentLoaded', () => {
  domReady = true;
  if (S) render(); else hf.getState().then(s => { S = s; render(); });
});
