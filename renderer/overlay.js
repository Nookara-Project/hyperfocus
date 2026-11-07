'use strict';
/* global hf, ICONS, MailUI */

const $ = s => document.querySelector(s);
function h(tag, props = {}, ...kids) {
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
function pic(url, name, size, cls = 'pfp') {
  const style = `width:${size}px;height:${size}px`;
  const letter = () => h('span', { class: 'pfp', style, text: (name || '?')[0].toUpperCase() });
  if (!url) return letter();
  const img = h('img', { class: cls, src: url, alt: '', style });
  img.addEventListener('error', () => img.replaceWith(letter()), { once: true });
  return img;
}
const safeColor = c => (/^#[0-9a-f]{3,8}$/i.test(String(c || '')) ? c : '');
function fmtPlaytime(s) {
  s = Math.floor(s);
  const hrs = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return hrs ? `${hrs}h ${m}m` : `${m}m`;
}
function fmtClock(secs) {
  secs = Math.max(0, Math.floor(secs));
  const p = v => String(v).padStart(2, '0');
  return `${Math.floor(secs / 3600)}:${p(Math.floor((secs % 3600) / 60))}:${p(secs % 60)}`;
}

let S = null;
let social = null;
let invite = null;
let ui = null;
const keys = {};

function renderUser() {
  const acc = S?.account;
  const key = JSON.stringify(acc);
  if (keys.user === key) return;
  keys.user = key;
  $('#ov-user').replaceChildren(acc
    ? h('div', { style: 'display:contents' }, pic(acc.pfp, acc.username, 52), h('div', {}, h('div', { class: 'ov-name', text: acc.username }), h('div', { class: 'ov-sub', text: 'velora' })))
    : h('div', {}, h('div', { class: 'ov-name', text: 'not logged in' }), h('div', { class: 'ov-sub', text: 'log in with Nookara in the launcher' })));
}

function currentApp() {
  const id = S?.currentGame;
  return id ? (S.manifest?.apps || []).find(a => a.id === id) || { id, name: id } : null;
}
function renderGame() {
  const a = currentApp();
  const key = a ? `${a.id}|${a.icon}|${a.name}` : '';
  if (keys.game !== key) {
    keys.game = key;
    $('#ov-game').replaceChildren(a
      ? h('div', { style: 'display:contents' }, a.icon ? pic(a.icon, a.name, 52, 'ov-icon') : null,
        h('div', { style: 'min-width:0' }, h('div', { class: 'ov-name', text: a.name || a.id }), h('div', { class: 'ov-sub', id: 'ov-times' })))
      : h('div', { class: 'ov-sub', text: 'nothing running' }));
  }
  tickGame();
}
function tickGame() {
  const a = currentApp();
  const el = $('#ov-times');
  if (!a || !el) return;
  const sess = S.playtime?.sessions?.[a.id];
  const live = sess ? (Date.now() - sess.last) / 1000 : 0;
  const total = (S.playtime?.totals?.[a.id] || 0) + live;
  const verb = a.type === 'Game' ? 'played' : 'used';
  el.textContent = `${sess ? `${fmtClock((Date.now() - sess.start) / 1000)} this session · ` : ''}${fmtPlaytime(total)} ${verb} total`;
}
const achStatsOv = {};
function renderAch() {
  const a = currentApp();
  const defs = a?.achievements && typeof a.achievements === 'object' && !Array.isArray(a.achievements) ? a.achievements : null;
  const list = defs ? Object.entries(defs).filter(([, d]) => d && typeof d === 'object').map(([id, d]) => ({ id, ...d })) : [];
  $('#w-ach').hidden = !list.length;
  if (!list.length) { keys.ach = ''; return; }
  const have = S?.achievements || {};
  const sig = list.filter(x => have[x.id]).map(x => x.id).join(',');
  const cached = achStatsOv[a.id];
  if (!cached || (!cached.loading && (cached.sig !== sig || Date.now() - cached.at > 120000))) {
    achStatsOv[a.id] = { ...(cached || {}), loading: true, sig };
    hf.achStats(a.id).then(d => { achStatsOv[a.id] = { at: Date.now(), sig, data: d }; }, () => { achStatsOv[a.id] = { at: Date.now(), sig, data: cached?.data || null }; })
      .finally(() => { keys.ach = ''; renderAch(); });
  }
  const st = achStatsOv[a.id]?.data;
  const key = JSON.stringify([a.id, list.map(x => [x.id, x.name, x.icon, x.hidden, x.rarity, have[x.id] || 0]), st]);
  if (keys.ach === key) return;
  keys.ach = key;
  const got = list.filter(x => have[x.id]).length;
  const perfect = got === list.length;
  $('#w-ach').classList.toggle('perfect', perfect);
  $('#ov-ach-h').textContent = perfect ? `★ Perfect Game · ${got} / ${list.length}` : `achievements · ${got} / ${list.length}`;
  $('#ov-ach-bar').style.width = `${Math.round(got / list.length * 100)}%`;
  const order = new Map(list.map((x, i) => [x.id, i]));
  list.sort((x, y) => {
    const hx = x.hidden && !have[x.id] ? 1 : 0, hy = y.hidden && !have[y.id] ? 1 : 0;
    return hx - hy || (st?.achievements?.[y.id]?.percent || 0) - (st?.achievements?.[x.id]?.percent || 0)
      || order.get(x.id) - order.get(y.id);
  });
  $('#ov-ach').replaceChildren(...list.map(x => {
    const on = !!have[x.id], masked = x.hidden && !on, rare = x.rarity === 'rare' && !masked;
    const ico = masked || !x.icon ? h('span', { class: 'oa-i', text: masked ? '?' : '🏆' }) : h('img', { class: 'oa-i', src: x.icon, alt: '' });
    const pct = st?.players ? (st.achievements?.[x.id]?.percent ?? 0) : null;
    return h('div', { class: `oa-row ${on ? 'on' : 'locked'}${rare ? ' rare' : ''}` }, ico,
      h('div', { class: 'oa-t' },
        h('b', { text: masked ? 'Hidden Achievement' : x.name || x.id }),
        h('span', { class: 'oa-d', text: masked ? 'Earn this to view it!' : x.description || '' }),
        h('span', { class: 'oa-m' },
          on ? h('span', { class: 'when', text: `unlocked ${new Date(have[x.id]).toLocaleDateString()}` }) : h('span', { text: 'locked' }),
          rare ? h('span', { class: 'rare', text: 'rare' }) : null),
        pct !== null ? h('span', { class: 'oa-p' }, h('i', {}, h('i', { style: `width:${Math.min(100, pct)}%` })), h('span', { text: `${pct}% of players` })) : null));
  }));
}
function tickClock() {
  const d = new Date();
  $('#ov-time').textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  $('#ov-date').textContent = d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

function renderFriends() {
  const box = $('#ov-friends');
  if (!social?.loggedIn) return box.replaceChildren(h('div', { class: 'ov-empty', text: 'log in to see your friends' }));
  if (social.needsRelogin) return box.replaceChildren(h('div', { class: 'ov-empty', text: 'log in again in the launcher to see friends' }));
  const friends = social.friends || [];
  if (!friends.length) return box.replaceChildren(h('div', { class: 'ov-empty', text: 'no friends added yet' }));
  const canJoin = f => !!(f.activity?.joinable && f.activity.joinCode);
  const rowFor = f => h('div', { class: 'fr-line' },
    h('button', { class: 'fr' + (f.online ? '' : ' off'), title: `view ${f.username}'s profile`, onclick: () => showProfile(f.username) },
      pic(f.pfp, f.username, 28),
      h('div', { class: 'fr-text' }, h('b', { text: f.username, style: safeColor(f.color) ? `color:${safeColor(f.color)}` : null }),
        f.activity ? h('div', { class: 'fr-act', text: canJoin(f) ? `in joinable game · ${f.activity.name}` : `${f.activity.type === 'Game' ? 'playing' : 'using'} ${f.activity.name}${f.activity.state ? ` · ${f.activity.state}` : ''}` }) : null),
      h('span', { class: 'dot' + (f.online ? ' on' : '') + (f.activity ? ' play' : '') })),
    canJoin(f) ? h('button', {
      class: 'fr-msg fr-game-invite fr-join', title: `join ${f.username} in ${f.activity.name}`,
      text: 'join', onclick: async ev => {
        const btn = ev.currentTarget;
        btn.disabled = true;
        try { const r = await hf.joinFriend(f.username); btn.textContent = r?.joined ? 'joining!' : 'get it first'; }
        catch (e) { btn.textContent = 'failed'; btn.title = e.message; }
        setTimeout(() => { btn.disabled = false; btn.textContent = 'join'; }, 3000);
      },
    }) : null,
    invite ? h('button', {
      class: 'fr-msg fr-game-invite', title: `invite ${f.username} to ${invite.name}`,
      text: 'invite', onclick: async ev => {
        const btn = ev.currentTarget;
        btn.disabled = true;
        try { await hf.inviteSend(f.username); btn.textContent = 'sent!'; }
        catch (e) { btn.textContent = 'failed'; btn.title = e.message; }
        setTimeout(() => { btn.disabled = false; btn.textContent = 'invite'; }, 3000);
      },
    }) : null,
    h('button', { class: 'fr-msg', title: `message ${f.username}`, html: ICONS.mail, onclick: () => { showMessages(); ui.compose(f.username); } }));
  const on = friends.filter(f => f.online || f.activity).sort((a, b) => canJoin(b) - canJoin(a));
  const off = friends.filter(f => !(f.online || f.activity));
  const group = (label, list) => (list.length ? [h('div', { class: 'fr-group', text: `${label} — ${list.length}` }), ...list.map(rowFor)] : []);
  box.replaceChildren(...group('online', on), ...group('offline', off));
  const n = social.unread || 0;
  $('#ov-open-msgs').innerHTML = `${ICONS.mail}<span>messages</span>${n ? `<span class="count">${n}</span>` : ''}`;
}

function showProfile(name) {
  $('#w-profile').hidden = false;
  ProfileUI.renderProfile($('#ov-profile'), name);
}
function showMessages(mailId) {
  $('#w-msgs').hidden = false;
  if (!ui) ui = MailUI.mount($('#mail-root'));
  if (mailId) ui.openMail(mailId, { reply: true });
}

const POS_KEY = 'hf-overlay-widgets';
function loadPositions() {
  try { return JSON.parse(localStorage.getItem(POS_KEY) || '{}'); } catch { return {}; }
}
function place(w, pos) {
  const x = Math.min(Math.max(0, pos.x), window.innerWidth - 80);
  const y = Math.min(Math.max(0, pos.y), window.innerHeight - 30);
  Object.assign(w.style, { left: `${x}px`, top: `${y}px`, right: 'auto', bottom: 'auto', transform: 'none' });
}
function applyPositions() {
  const saved = loadPositions();
  for (const w of document.querySelectorAll('.widget')) if (saved[w.id]) place(w, saved[w.id]);
}
for (const w of document.querySelectorAll('.widget')) {
  const head = w.querySelector('.box-h');
  head.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest('button')) return;
    const r = w.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    head.setPointerCapture(e.pointerId);
    w.classList.add('dragging');
    const move = ev => place(w, { x: ev.clientX - dx, y: ev.clientY - dy });
    const up = () => {
      head.removeEventListener('pointermove', move);
      w.classList.remove('dragging');
      const saved = loadPositions();
      const nr = w.getBoundingClientRect();
      saved[w.id] = { x: nr.left, y: nr.top };
      try { localStorage.setItem(POS_KEY, JSON.stringify(saved)); } catch {}
    };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up, { once: true });
  });
}
applyPositions();

$('#ov-msgs-x').innerHTML = ICONS.close;
$('#ov-msgs-x').onclick = () => { $('#w-msgs').hidden = true; };
$('#ov-profile-x').innerHTML = ICONS.close;
$('#ov-profile-x').onclick = () => { $('#w-profile').hidden = true; };
$('#ov-open-msgs').innerHTML = `${ICONS.mail}<span>messages</span>`;
$('#ov-open-msgs').onclick = () => (($('#w-msgs').hidden) ? showMessages() : ($('#w-msgs').hidden = true));
$('#ov-reset').innerHTML = `${ICONS.refresh}<span>reset layout</span>`;
$('#ov-reset').onclick = () => {
  try { localStorage.removeItem(POS_KEY); } catch {}
  for (const w of document.querySelectorAll('.widget')) w.removeAttribute('style');
};
$('#ov-pop').innerHTML = `${ICONS.external}<span>pop out messages</span>`;
$('#ov-pop').onclick = () => hf.openMessages();
$('#ov-launcher').innerHTML = `${ICONS.gear}<span>open launcher</span>`;
$('#ov-launcher').onclick = () => { hf.overlayHide(); hf.focusLauncher(); };
let endArmed = 0;
function drawEndGame() {
  const a = currentApp();
  const b = $('#ov-endgame');
  b.hidden = !a;
  const armed = Date.now() < endArmed;
  b.innerHTML = `${ICONS.xcircle || ICONS.close}<span>${armed ? `really close ${a?.name || 'it'}?` : `close ${a?.type === 'App' ? 'app' : 'game'}`}</span>`;
}
$('#ov-endgame').onclick = () => {
  const a = currentApp();
  if (!a) return;
  if (Date.now() < endArmed) { endArmed = 0; hf.closeGame(a.id).catch(() => {}); drawEndGame(); return; }
  endArmed = Date.now() + 3000;
  drawEndGame();
  setTimeout(drawEndGame, 3050);
};
window.padBack = () => { hf.overlayHide(); return true; };
window.padStartActive = true;
$('#ov-close').innerHTML = `${ICONS.close}<span>close overlay</span>`;
$('#ov-close').onclick = () => hf.overlayHide();
document.addEventListener('keydown', e => { if (e.key === 'Escape') hf.overlayHide(); });

let nowPlaying = { active: false };
const fmtTime = s => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const MEDIA_APPS = [['spotify', 'Spotify'], ['msedge', 'Edge'], ['chrome', 'Chrome'], ['firefox', 'Firefox'], ['zen', 'Zen'], ['opera', 'Opera'], ['brave', 'Brave']];
function mediaAppName(id) {
  const low = String(id || '').toLowerCase();
  const hit = MEDIA_APPS.find(([k]) => low.includes(k));
  return hit ? hit[1] : String(id || '').split(/[!\\]/).pop().replace(/\.exe$/i, '');
}
function mediaPosition() {
  const m = nowPlaying;
  let pos = Number(m.position) || 0;
  if (m.status === 'Playing' && m.updatedAt) pos += (Date.now() - m.updatedAt) / 1000;
  return m.duration > 0 ? Math.min(pos, m.duration) : pos;
}
function tickMedia() {
  const m = nowPlaying;
  if (!m.active) return;
  const pos = mediaPosition(), dur = Number(m.duration) || 0;
  $('#mm-bar').style.width = dur > 0 ? `${(pos / dur) * 100}%` : '0%';
  $('#mm-pos').textContent = fmtTime(pos);
  $('#mm-dur').textContent = dur > 0 ? fmtTime(dur) : '';
}
function renderMedia() {
  const m = nowPlaying;
  const w = $('#w-media');
  w.hidden = !m.active || !(m.title || m.artist);
  if (w.hidden) return;
  $('#mm-app').textContent = mediaAppName(m.app);
  $('#mm-title').textContent = m.title || 'unknown song';
  $('#mm-title').title = m.title || '';
  $('#mm-artist').textContent = [m.artist, m.album].filter(Boolean).join(' · ');
  const art = $('#mm-art');
  if (m.art) {
    if (art.getAttribute('src') !== m.art) art.src = m.art;
    art.hidden = false;
  } else {
    art.hidden = true;
    art.removeAttribute('src');
  }
  const playing = m.status === 'Playing';
  const play = $('#mm-play');
  const icon = playing ? 'pause' : 'play';
  if (play.dataset.icon !== icon) { play.innerHTML = ICONS[icon]; play.dataset.icon = icon; }
  play.title = playing ? 'Pause' : 'Play';
  play.disabled = !m.canToggle;
  $('#mm-prev').disabled = !m.canPrev;
  $('#mm-next').disabled = !m.canNext;
  tickMedia();
}
function mediaCmd(cmd) {
  hf.mediaCmd(cmd).catch(() => {});
  if (cmd === 'playpause' && nowPlaying.active) {
    const pos = mediaPosition();
    nowPlaying = { ...nowPlaying, status: nowPlaying.status === 'Playing' ? 'Paused' : 'Playing', position: pos, updatedAt: Date.now() };
    renderMedia();
  }
}
$('#mm-noart').innerHTML = ICONS.music;
$('#mm-prev').innerHTML = ICONS.prev;
$('#mm-next').innerHTML = ICONS.next;
$('#mm-prev').onclick = () => mediaCmd('prev');
$('#mm-next').onclick = () => mediaCmd('next');
$('#mm-play').onclick = () => mediaCmd('playpause');
hf.on('media', s => { nowPlaying = s || { active: false }; renderMedia(); });
hf.mediaGet().then(s => { nowPlaying = s || { active: false }; renderMedia(); }).catch(() => {});
setInterval(tickMedia, 500);

hf.on('overlay', d => {
  if (!d.open) return;
  $('#ov-hint').textContent = `${String(d.hotkey || 'Shift+Tab').toLowerCase()} or esc to close`;
  applyPositions();
  if (d.mailId) showMessages(d.mailId);
  else if (ui && !$('#w-msgs').hidden) ui.refresh();
  tickClock();
});
hf.on('state', s => {
  S = s;
  document.body.classList.toggle('still', s.settings?.videoBackgrounds === false);
  renderUser();
  renderGame();
  renderAch();
  drawEndGame();
});
hf.on('social', s => { social = s; renderFriends(); });
hf.on('gameInvite', v => { invite = v || null; renderFriends(); });
hf.getState().then(s => { S = s; renderUser(); renderGame(); renderAch(); drawEndGame(); });
hf.social().then(s => { social = s; renderFriends(); }).catch(() => {});
hf.inviteState().then(v => { invite = v || null; renderFriends(); }).catch(() => {});
VoiceUI.mount($('#voice-root'));
tickClock();
setInterval(() => { tickClock(); tickGame(); }, 1000);
