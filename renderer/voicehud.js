'use strict';
/* global hf, ICONS */

const hud = document.querySelector('#hud');
const rows = new Map();
let rosterKey = '';
const SPEAKING_AT = 6;
const safeColor = c => (/^#[0-9a-f]{3,8}$/i.test(String(c || '')) ? c : '');

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
function picture(url, name) {
  const letter = () => el('span', { class: 'pfp', text: (name || '?')[0].toUpperCase() });
  if (!url) return letter();
  const img = el('img', { class: 'pfp', src: url, alt: '' });
  img.addEventListener('error', () => img.replaceWith(letter()), { once: true });
  return img;
}

function render(s) {
  const users = (s?.users || []).slice();
  const key = JSON.stringify(users.map(u => [u.id, u.name, u.pfp, u.color, u.muted, u.deafened, u.me]));
  if (key === rosterKey) return;
  rosterKey = key;
  rows.clear();
  hud.replaceChildren(...users.map(u => {
    const pic = el('span', { class: 'pic' }, picture(u.pfp, u.name));
    rows.set(u.id, pic);
    return el('div', { class: 'hu' + (u.me ? ' me' : '') + (u.muted || u.deafened ? ' off' : '') },
      pic,
      el('span', { class: 'nm', text: u.name, ...(safeColor(u.color) ? { style: `color:${safeColor(u.color)}` } : {}) }),
      u.deafened ? el('span', { class: 'flag', html: ICONS.headphonesOff })
        : u.muted ? el('span', { class: 'flag', html: ICONS.micOff }) : null);
  }));
}

const spread = level => (level < SPEAKING_AT ? 0 : Math.min(9, 2 + (level - SPEAKING_AT) / 4));

hf.on('voice', render);
hf.on('voiceLevels', levels => {
  for (const [id, pic] of rows) {
    const px = spread(Number(levels?.[id]) || 0);
    pic.style.boxShadow = px ? `0 0 0 ${px.toFixed(1)}px var(--online)` : 'none';
  }
});
hf.voiceGet().then(render).catch(() => {});
