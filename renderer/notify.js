'use strict';
/* global hf, ICONS */

const SOUNDS = {
  friend: '../assets/sounds/friend-online-wav.mp3',
  message: '../assets/sounds/message.wav',
  warning: '../assets/sounds/system.wav',
  voiceJoin: '../assets/sounds/joinVC.mp3',
  camera: '../assets/sounds/camera1.wav',
  padOn: '../assets/sounds/console/press.wav',
  call: '../assets/sounds/call.mp3',
  padOff: '../assets/sounds/console/back.wav',
};
const KIND = {
  friend: { label: 'friend online', icon: 'user', color: 'var(--st-online)' },
  friendreq: { label: 'friend request', icon: 'userPlus', color: 'var(--pink)' },
  friendplay: { label: 'now playing', icon: 'play', color: 'var(--st-playing)' },
  mail: { label: 'new message', icon: 'mail', color: 'var(--pink)' },
  launcher: { label: 'hyperfocus', icon: 'download', color: 'var(--palegreen)' },
  game: { label: 'game', icon: 'play', color: 'var(--palegreen)' },
  overlay: { label: 'overlay ready', icon: 'eye', color: 'var(--palegreen)' },
  voice: { label: 'voice chat', icon: 'mic', color: 'var(--online)' },
  screenshot: { label: 'screenshot', icon: 'camera', color: 'var(--palegreen)' },
  invite: { label: 'game invite', icon: 'play', color: 'var(--st-playing)' },
  call: { label: 'voice call', icon: 'mic', color: 'var(--st-online)' },
  controller: { label: 'controller connected', icon: 'controller', color: 'var(--palegreen)' },
  controllerOff: { label: 'controller disconnected', icon: 'controller', color: 'var(--st-offline)' },
};
const PRESENCE = ['online', 'playing', 'offline'];
const MAX_SHOWN = 4;
const stack = document.querySelector('#stack');

function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else n.setAttribute(k, v);
  }
  n.append(...kids.filter(Boolean));
  return n;
}
function picture(n, kind) {
  const letter = () => el('span', { class: 'pic pfp', text: (n.title || '?')[0].toUpperCase() });
  const src = n.image === 'icon' ? '../assets/icon.png' : n.image;
  let pic = letter();
  if (n.image === 'controller') {
    pic = el('span', { class: 'pic pad-pic', html: ICONS.controller });
    return el('div', { class: 'pic-w' }, pic);
  }
  if (src) {
    pic = el('img', { class: 'pic', src, alt: '' });
    pic.addEventListener('error', () => pic.replaceWith(letter()), { once: true });
  }
  const wrap = el('div', { class: 'pic-w' }, pic, el('span', { class: 'badge', html: ICONS[n.icon] || ICONS[kind.icon] || '' }));
  if (PRESENCE.includes(n.presence)) {
    wrap.classList.add('ring');
    wrap.style.setProperty('--ring', `var(--st-${n.presence})`);
  }
  return wrap;
}
function bodyEl(n) {
  const d = el('div', { class: 'bd' });
  const body = String(n.body);
  const at = n.highlight ? body.indexOf(n.highlight) : -1;
  if (at < 0) d.textContent = body;
  else d.append(body.slice(0, at), el('b', { text: n.highlight }), body.slice(at + n.highlight.length));
  return d;
}
function syncMouse() {
  if (!stack.querySelector('.nt:hover')) hf.notifMouse(false);
}

function add(n) {
  let ring = null;
  if (n.sound && n.soundOn !== false && SOUNDS[n.sound]) {
    const a = new Audio(SOUNDS[n.sound]);
    a.volume = 0.8;
    a.loop = !!n.soundLoop;
    if (n.soundLoop) ring = a;
    a.play().catch(() => {});
  }
  const kind = KIND[n.kind] || KIND.launcher;
  const duration = n.duration || 6500;
  const bar = el('i', { class: 'bar' });
  bar.style.animationDuration = `${duration}ms`;
  const t = el('div', { class: 'nt' },
    picture(n, kind),
    el('div', { class: 'txt' },
      el('div', { class: 'kick', text: n.kicker || kind.label }),
      el('div', { class: 'ttl', text: n.title || '' }),
      n.body ? bodyEl(n) : null,
      n.preview ? el('img', { class: 'shot', src: n.preview, alt: '' }) : null,
      Array.isArray(n.buttons) && n.buttons.length ? el('div', { class: 'nt-acts' }, ...n.buttons.map(b => {
        const btn = el('button', { class: 'nt-btn' + (b.danger ? ' no' : ''), text: b.label });
        btn.addEventListener('click', e => { e.stopPropagation(); hf.notifClick(b.action); close(); });
        return btn;
      })) : null),
    el('button', { class: 'x', html: ICONS.close, title: 'Dismiss' }),
    bar);
  t.style.setProperty('--k', kind.color);
  if (n.tag) t.dataset.tag = String(n.tag);

  let remaining = duration;
  let startedAt = Date.now();
  let timer = n.sticky ? null : setTimeout(close, duration);
  function close() {
    clearTimeout(timer);
    if (ring) { ring.pause(); ring = null; }
    if (t.classList.contains('out')) return;
    t.classList.add('out');
    t.append(el('span', { class: 'nt-scan rev' }));
    setTimeout(() => {
      t.remove();
      syncMouse();
      if (!stack.children.length) hf.notifEmpty();
    }, 320);
  }
  t.addEventListener('mouseenter', () => {
    hf.notifMouse(true);
    clearTimeout(timer);
    remaining -= Date.now() - startedAt;
  });
  t.addEventListener('mouseleave', () => {
    syncMouse();
    startedAt = Date.now();
    if (!n.sticky) timer = setTimeout(close, Math.max(1500, remaining));
  });
  t.addEventListener('click', e => {
    if (!e.target.closest('.x') && n.action) hf.notifClick(n.action);
    close();
  });

  stack.prepend(t);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    t.classList.add('in');
    const scan = el('span', { class: 'nt-scan' });
    t.append(scan);
    setTimeout(() => scan.remove(), 900);
  }));
  const shown = [...stack.querySelectorAll('.nt:not(.out)')];
  if (shown.length > MAX_SHOWN) shown.slice(MAX_SHOWN).forEach(old => old.dispatchEvent(new Event('hf-close')));
  t.addEventListener('hf-close', close);
}

hf.on('notify', add);
hf.on('notifyDismiss', tag => stack.querySelectorAll('.nt').forEach(x => { if (x.dataset.tag === String(tag)) x.dispatchEvent(new Event('hf-close')); }));
