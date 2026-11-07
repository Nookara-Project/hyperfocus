'use strict';
/* global hf, ICONS, ProfileUI */

const $ = s => document.querySelector(s);
function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(c);
  return n;
}
function pic(url, name, st = 'offline') {
  const letter = () => el('span', { class: `pfp st-${st}`, text: (name || '?')[0].toUpperCase() });
  if (!url) return letter();
  const img = el('img', { class: `pfp st-${st}`, src: url, alt: '' });
  img.addEventListener('error', () => img.replaceWith(letter()), { once: true });
  return img;
}

$('#btn-min').innerHTML = ICONS.min;
$('#btn-close').innerHTML = ICONS.close;
$('#btn-min').onclick = () => hf.selfMin();
$('#btn-close').onclick = () => hf.selfClose();

const root = $('#people-root');
let social = null;
let showing = '';
let listKey = '';

function openProfile(name) {
  showing = String(name || '');
  ProfileUI.mountPeople(root, { initial: showing || undefined });
  drawList(true);
}

function drawList(force) {
  const box = $('#fr-list');
  if (!social?.loggedIn) { listKey = ''; return box.replaceChildren(el('div', { class: 'fr-empty', text: 'log in with Nookara in the launcher to see your friends' })); }
  if (social.needsRelogin) { listKey = ''; return box.replaceChildren(el('div', { class: 'fr-empty', text: 'log in again in the launcher to see your friends' })); }
  const friends = social.friends || [];
  const key = JSON.stringify([friends, showing.toLowerCase(), invite]);
  if (!force && key === listKey) return;
  listKey = key;
  if (!friends.length) return box.replaceChildren(el('div', { class: 'fr-empty', text: 'no friends yet - look someone up on the right :3' }));
  const rowFor = f => {
    const st = f.activity ? 'playing' : f.online ? 'online' : 'offline';
    const joinable = !!(f.activity?.joinable && f.activity.joinCode);
    const act = joinable
      ? el('div', { class: 'fr-act play', title: f.activity.state || '' }, 'In joinable game · ', el('b', { text: f.activity.name }))
      : f.activity
        ? el('div', { class: 'fr-act play', title: f.activity.state || '' }, `${f.activity.type === 'Game' ? 'playing' : 'using'} `, el('b', { text: f.activity.name }),
          f.activity.state ? ` · ${f.activity.state}` : null)
        : el('div', { class: `fr-act ${st}`, text: st });
    const row = el('button', {
      class: 'fr-row' + (f.online ? '' : ' off') + (f.username.toLowerCase() === showing.toLowerCase() ? ' on-profile' : ''),
      title: `${f.username}'s profile`, onclick: () => openProfile(f.username),
    },
    pic(f.pfp, f.username, st),
    el('div', { class: 'fr-text' },
      el('b', { text: f.username, style: ProfileUI.colorStyle(f.color) }),
      act));
    const join = joinable ? el('button', { class: 'btn fr-invite', text: 'join', title: `join ${f.username} in ${f.activity.name}` }) : null;
    if (join) join.onclick = () => joinFriend(f.username, join);
    if (!invite) return join ? el('div', { class: 'fr-line' }, row, join) : row;
    const btn = el('button', { class: 'btn ghost fr-invite', text: 'invite', title: `invite ${f.username} to ${invite.name}` });
    btn.onclick = () => sendInvite(f.username, btn);
    return el('div', { class: 'fr-line' }, row, join, btn);
  };
  const on = friends.filter(f => f.online || f.activity);
  const off = friends.filter(f => !(f.online || f.activity));
  const group = (label, list) => (list.length ? [el('div', { class: 'fr-group', text: `${label} — ${list.length}` }), ...list.map(rowFor)] : []);
  box.replaceChildren(...group('online', on), ...group('offline', off));
}

let invite = null;
function drawInviteBar() {
  const bar = $('#invite-bar');
  bar.hidden = !invite;
  if (!invite) return;
  const icon = invite.icon ? el('img', { src: invite.icon, alt: '' }) : null;
  bar.replaceChildren(...[icon, el('span', {}, 'Inviting friends to ', el('b', { text: invite.name }))].filter(Boolean));
}
async function sendInvite(name, btn) {
  btn.disabled = true;
  try {
    await hf.inviteSend(name);
    btn.textContent = 'sent!';
  } catch (e) {
    btn.textContent = 'failed';
    btn.title = e.message;
  }
  setTimeout(() => { btn.disabled = false; btn.textContent = 'invite'; }, 3000);
}
async function joinFriend(name, btn) {
  btn.disabled = true;
  try {
    const r = await hf.joinFriend(name);
    btn.textContent = r?.joined ? 'joining!' : 'get it first';
  } catch (e) {
    btn.textContent = 'failed';
    btn.title = e.message;
  }
  setTimeout(() => { btn.disabled = false; btn.textContent = 'join'; }, 3000);
}
hf.on('gameInvite', v => { invite = v || null; drawInviteBar(); drawList(true); });
hf.inviteState().then(v => { invite = v || null; drawInviteBar(); drawList(true); }).catch(() => {});

hf.on('social', s => { social = s; drawList(); });
hf.on('openProfile', name => { if (name) openProfile(name); });
hf.social().then(s => { social = s; drawList(true); }).catch(() => drawList(true));
openProfile(new URLSearchParams(location.search).get('profile') || '');
