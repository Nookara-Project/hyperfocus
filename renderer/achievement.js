'use strict';
/* global hf */
const stage = document.getElementById('stage');
const MAX = 3, CARD = 104, GAP = 10;
const queue = [];
const shown = [];

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function layout() {
  const live = shown.filter(c => !c.leaving);
  live.forEach((c, i) => { c.el.style.bottom = `${(live.length - 1 - i) * (CARD + GAP)}px`; });
}

function show(a) {
  const rare = a.rarity === 'rare';
  const card = el('div', 'ach' + (rare ? ' rare' : ''));
  const ico = el('div', 'ico');
  const src = a.icon || a.gameIcon;
  if (src) {
    const img = el('img');
    img.src = src;
    img.alt = '';
    img.addEventListener('error', () => { img.remove(); ico.textContent = '🏆'; }, { once: true });
    ico.append(img);
  } else ico.textContent = '🏆';
  const txt = el('div', 'txt');
  txt.append(
    el('div', 'kick', rare ? '★ rare achievement unlocked' : 'achievement unlocked'),
    el('div', 'name', a.name || 'Achievement'),
    a.description ? el('div', 'desc', a.description) : '',
    a.gameName ? el('div', 'game', a.gameName) : '');
  card.append(ico, txt);
  card.style.bottom = '0px';
  stage.append(card);
  const c = { el: card, leaving: false };
  shown.push(c);
  layout();

  if (a.soundOn !== false) {
    const snd = new Audio('../assets/sounds/achievement.mp3');
    snd.volume = 0.8;
    snd.play().catch(() => {});
  }
  requestAnimationFrame(() => card.classList.add('in'));
  if (rare) setTimeout(() => sparkle(card), 650);
  setTimeout(() => leave(c), rare ? 6500 : 5200);
}

function leave(c) {
  if (c.leaving) return;
  c.leaving = true;
  c.el.classList.add('out');
  layout();
  setTimeout(() => {
    c.el.remove();
    shown.splice(shown.indexOf(c), 1);
    next();
  }, 550);
}

function next() {
  while (queue.length && shown.filter(c => !c.leaving).length < MAX) show(queue.shift());
  if (!shown.length && !queue.length) hf.achDone().catch(() => {});
}

function sparkle(card) {
  for (let i = 0; i < 18; i++) {
    const s = el('span', 'spark');
    const ang = Math.random() * Math.PI * 2, dist = 60 + Math.random() * 90;
    s.style.left = `${40 + Math.random() * 30}px`;
    s.style.top = `${30 + Math.random() * 40}px`;
    s.style.setProperty('--dx', `${Math.cos(ang) * dist}px`);
    s.style.setProperty('--dy', `${Math.sin(ang) * dist * 0.5}px`);
    s.style.animationDelay = `${Math.random() * 0.4}s`;
    card.append(s);
    setTimeout(() => s.remove(), 1800);
  }
}

hf.on('achievement', a => {
  if (!a) return;
  queue.push(a);
  next();
});
