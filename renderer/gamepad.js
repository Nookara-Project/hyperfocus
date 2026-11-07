'use strict';
// Controller support for the main window: a selector box that glides between
// everything you can click, console-style.
//
//   left stick / d-pad   move the selector (nearest thing in that direction)
//   A                    select (clicks it)            -> press.wav
//   B                    back: close a dialog / menu / the all-games grid / the store page you're on -> back.wav
//   LB / RB              previous / next game in the library list
//   LT / RT, left stick  STORE <-> LIBRARY tab
//   Start                Play (or Install / Update...) - the RELEASE half when a game beta splits the button
//                        (on a store page: its main button - Add to library / Buy / Wishlist / Play)
//                        (#play-beta, the beta half, is a normal target: d-pad over to it, then A)
//   Y                    all games grid
//   X                    the game menu (the last small button in the play bar)
//   right stick          scroll whatever the selector is in
//   View / Select        console (big screen) mode on/off (launcher window)
//   guide / PS button    (non-Xbox pads) same as the Xbox button - Xbox pads go through main (lib/xinput.js)
//   left / right on a slider changes its value
// Moving: focus.wav. Nothing that way / nothing to go back to: fail.wav.
//
// Input is ignored unless the launcher window itself is focused, so playing a
// game with a controller never clicks around in the launcher behind it.
// Moving the mouse hides the selector until the controller is used again.
(() => {
  const SOUNDS = {};
  for (const n of ['press', 'back', 'focus', 'fail']) SOUNDS[n] = new Audio(`../assets/sounds/console/${n}.wav`);
  function sound(name) {
    const base = SOUNDS[name];
    if (!base) return;
    const a = base.cloneNode();
    a.volume = 0.6;
    a.play().catch(() => {});
  }

  const TARGETS = [
    'button', 'a[href]', 'input:not([type=hidden])', 'select', 'textarea',
    '#shot-strip > button', '.tr-video', '.sp-video',
    'label.opt',
  ].join(',');

  const cursor = document.createElement('div');
  cursor.id = 'pad-cursor';
  document.body.append(cursor);

  let current = null;
  let currentKey = null;
  let active = false;

  const visible = el => {
    if (!el.isConnected || el.closest('[hidden]') || el.disabled) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false;
    return typeof el.checkVisibility === 'function' ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) : true;
  };
  function scope() {
    const modals = [...document.querySelectorAll('.modal-back[data-id]')];
    if (modals.length) return modals[modals.length - 1];
    const menu = [...document.querySelectorAll('.menu')].find(m => !m.hidden);
    if (menu) return menu;
    return document;
  }
  const candidates = () => [...scope().querySelectorAll(TARGETS)]
    .filter(el => el !== cursor && !el.matches('label.opt input') && visible(el));

  const keyOf = el => el.id ? `#${el.id}`
    : el.dataset.id ? `${el.className.split(' ')[0]}|${el.dataset.id}`
    : null;
  function refind() {
    if (!currentKey) return null;
    if (currentKey.startsWith('#')) return document.querySelector(currentKey);
    const [cls, id] = currentKey.split('|');
    return document.querySelector(`.${CSS.escape(cls)}[data-id="${CSS.escape(id)}"]`);
  }
  function defaultTarget() {
    const list = candidates();
    return list.find(el => el.matches('.lib-row.active, .lib-card.active'))
      || list.find(el => el.id === 'play' || el.id === 'sp-main') || list.find(el => el.matches('#st-view .sc, #st-view .feat-acts .btn')) || list[0] || null;
  }

  function setCurrent(el, { silent = false } = {}) {
    if (!el || el === current) return;
    if (current?.classList.contains('lib-row')) current.dispatchEvent(new MouseEvent('mouseleave'));
    current = el;
    currentKey = keyOf(el);
    el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    if (el.classList.contains('lib-row')) el.dispatchEvent(new MouseEvent('mouseenter'));
    if (!silent) sound('focus');
    place();
  }
  function place() {
    if (!active || !current) { cursor.classList.remove('on'); return; }
    const z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    const r = current.getBoundingClientRect();
    cursor.style.transform = `translate(${r.left / z - 4}px, ${r.top / z - 4}px)`;
    cursor.style.width = `${r.width / z + 8}px`;
    cursor.style.height = `${r.height / z + 8}px`;
    cursor.style.borderRadius = getComputedStyle(current).borderRadius;
    cursor.classList.add('on');
  }
  function ensureCurrent() {
    const sc = scope();
    if (current && current.isConnected && visible(current) && (sc === document || sc.contains(current))) return true;
    const again = refind();
    if (again && visible(again) && (sc === document || sc.contains(again))) { current = again; return true; }
    current = null;
    const d = defaultTarget();
    if (d) { setCurrent(d, { silent: true }); return true; }
    return false;
  }

  function move(dx, dy) {
    if (!ensureCurrent()) return sound('fail');
    const from = current.getBoundingClientRect();
    const fx = from.left + from.width / 2, fy = from.top + from.height / 2;
    let best = null, bestScore = Infinity;
    for (const el of candidates()) {
      if (el === current || current.contains(el) || el.contains(current)) continue;
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const along = dx ? (dx > 0 ? r.left - from.right : from.left - r.right) : (dy > 0 ? r.top - from.bottom : from.top - r.bottom);
      const centre = dx ? (x - fx) * dx : (y - fy) * dy;
      if (centre <= 1 || along < -Math.min(from.width, from.height) / 2) continue;
      const side = dx ? Math.abs(y - fy) : Math.abs(x - fx);
      const score = Math.max(along, 0) + side * 2.5;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) setCurrent(best); else sound('fail');
  }

  function nudgeRange(el, dir) {
    const step = Number(el.step) || 1, min = Number(el.min) || 0, max = Number(el.max) || 100;
    const v = Math.min(max, Math.max(min, Number(el.value) + dir * Math.max(step, (max - min) / 20)));
    if (v === Number(el.value)) return sound('fail');
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    sound('focus');
  }

  function press() {
    if (!ensureCurrent()) return sound('fail');
    const el = current;
    sound('press');
    if (el.matches('input[type=range]')) return;
    if (el.matches('input:not([type=checkbox]):not([type=radio]), textarea, select')) { el.focus(); return; }
    el.click();
  }
  function back() {
    if (typeof window.padBack === 'function') { sound('back'); window.padBack(); return; }
    const hasModal = document.querySelector('.modal-back[data-id]');
    const hasMenu = [...document.querySelectorAll('.menu')].some(m => !m.hidden);
    const libOpen = !document.getElementById('library')?.hidden;
    const storeBack = typeof window.storeCanGoBack === 'function' && window.storeCanGoBack();
    const profileBack = typeof window.profileCanGoBack === 'function' && window.profileCanGoBack();
    if (!hasModal && !hasMenu && !libOpen && !storeBack && !profileBack) return sound('fail');
    sound('back');
    document.activeElement?.blur?.();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }
  function clickId(id) {
    const el = document.getElementById(id);
    if (!el || !visible(el)) return sound('fail');
    setCurrent(el, { silent: true });
    sound('press');
    el.click();
  }
  function cycleGame(dir) {
    const btns = document.getElementById('lib-view')?.hidden ? [] : [...document.querySelectorAll('#app-list .lib-row')];
    if (!btns.length) return sound('fail');
    let i = btns.findIndex(b => b.classList.contains('active'));
    i = i < 0 ? 0 : (i + dir + btns.length) % btns.length;
    sound('focus');
    btns[i].click();
    requestAnimationFrame(() => { const b = document.querySelector(`#app-list .lib-row[data-id="${CSS.escape(btns[i].dataset.id)}"]`); if (b) setCurrent(b, { silent: true }); });
  }
  function scrollBy(y) {
    let el = current || scope();
    while (el && el !== document && el !== document.body) {
      if (el.scrollHeight > el.clientHeight + 2 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) { el.scrollTop += y; return; }
      el = el.parentElement;
    }
  }

  const REPEAT_DELAY = 380, REPEAT_EVERY = 110;
  const held = new Map();
  let prev = {};
  let polling = false;

  function wake() {
    if (!active) {
      active = true;
      document.body.classList.add('pad-mode');
      ensureCurrent();
    }
  }
  function sleep() {
    if (!active) return;
    active = false;
    document.body.classList.remove('pad-mode');
    if (current?.classList.contains('lib-row')) current.dispatchEvent(new MouseEvent('mouseleave'));
    place();
  }
  addEventListener('mousemove', e => { if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) sleep(); });

  const inConsole = () => document.body.classList.contains('console-mode');
  function switchTabs() {
    if (typeof window.switchTab !== 'function' || !document.getElementById('mtabs') || document.querySelector('.modal-back[data-id]')) return sound('fail');
    sound('press');
    window.switchTab();
    current = null;
    requestAnimationFrame(() => ensureCurrent());
  }
  function toggleConsole() {
    if (!document.getElementById('app-list') || !window.hf?.setConsole) return sound('fail');
    sound('press');
    window.hf.setConsole(!inConsole()).catch(() => sound('fail'));
  }

  function tick() {
    const pads = [...(navigator.getGamepads?.() || [])].filter(Boolean);
    if (!pads.length) { polling = false; held.clear(); prev = {}; return; }
    requestAnimationFrame(tick);
    if (!document.hasFocus()) { held.clear(); prev = {}; return; }
    const now = performance.now();
    const btn = i => pads.some(p => p.buttons[i]?.pressed);
    const axis = i => pads.reduce((v, p) => (Math.abs(p.axes[i] || 0) > Math.abs(v) ? p.axes[i] || 0 : v), 0);
    const lx = axis(0), ly = axis(1), ry = axis(3);
    const state = {
      up: btn(12) || ly < -0.55, down: btn(13) || ly > 0.55, left: btn(14) || lx < -0.55, right: btn(15) || lx > 0.55,
      a: btn(0), b: btn(1), x: btn(2), y: btn(3), lb: btn(4), rb: btn(5), start: btn(9), view: btn(8),
      lt: btn(6), rt: btn(7), ls: btn(10),
      guide: pads.some(p => !isXInput(p) && p.buttons[16]?.pressed),
    };
    const any = Object.values(state).some(Boolean) || Math.abs(ry) > 0.3;
    if (state.guide && !prev.guide) window.hf?.padGuide?.().catch(() => {});
    if (!active && inConsole()) wake();
    if (any && !active && !state.guide) { wake(); prev = state; return; }
    for (const [k, on] of Object.entries(state)) {
      const was = prev[k];
      if (!on) { held.delete(k); continue; }
      const repeatable = ['up', 'down', 'left', 'right', 'lb', 'rb'].includes(k);
      let fire = !was;
      if (was && repeatable) {
        const h = held.get(k) || { since: now, last: now };
        held.set(k, h);
        if (now - h.since > REPEAT_DELAY && now - h.last > REPEAT_EVERY) { h.last = now; fire = true; }
      } else if (!was) held.set(k, { since: now, last: now });
      if (!fire) continue;
      if (['left', 'right'].includes(k) && current?.matches?.('input[type=range]')) { nudgeRange(current, k === 'left' ? -1 : 1); continue; }
      ({
        up: () => move(0, -1), down: () => move(0, 1), left: () => move(-1, 0), right: () => move(1, 0),
        a: press, b: back, x: () => clickId('play-more'), y: () => clickId('btn-library'),
        lb: () => cycleGame(-1), rb: () => cycleGame(1),
        start: () => clickId(document.body.dataset.tab === 'store' ? 'sp-main' : 'play'),
        lt: switchTabs, rt: switchTabs, ls: switchTabs,
        view: toggleConsole, guide: () => {},
      })[k]();
    }
    if (Math.abs(ry) > 0.3) scrollBy(ry * 14);
    prev = state;
    if (active) { ensureCurrent(); place(); }
  }
  function startPolling() { if (!polling) { polling = true; requestAnimationFrame(tick); } }
  function isXInput(p) { return /xinput/i.test(p?.id || ''); }
  const KNOWN = { '054c:0ce6': 'DualSense Wireless Controller', '054c:0df2': 'DualSense Edge', '054c:05c4': 'DualShock 4', '054c:09cc': 'DualShock 4',
    '057e:2009': 'Nintendo Switch Pro Controller', '057e:2006': 'Joy-Con (L)', '057e:2007': 'Joy-Con (R)', '28de:1142': 'Steam Controller', '28de:1205': 'Steam Deck' };
  function padName(id) {
    const m = /Vendor:\s*([0-9a-f]{4})\s*Product:\s*([0-9a-f]{4})/i.exec(id || '') || /^([0-9a-f]{4})-([0-9a-f]{4})-/i.exec(id || '');
    const known = m && KNOWN[`${m[1].toLowerCase()}:${m[2].toLowerCase()}`];
    if (known) return known;
    const name = String(id || '').replace(/^[0-9a-f]{4}-[0-9a-f]{4}-/i, '').replace(/\s*\(.*$/, '').trim();
    return name || 'Controller';
  }
  addEventListener('gamepadconnected', e => {
    startPolling();
    if (!isXInput(e.gamepad)) window.hf?.padSeen?.({ key: e.gamepad.id, name: padName(e.gamepad.id), connected: true }).catch(() => {});
    if (window.padStartActive && document.hasFocus()) wake();
  });
  addEventListener('gamepaddisconnected', e => {
    if (!isXInput(e.gamepad)) window.hf?.padSeen?.({ key: e.gamepad.id, name: padName(e.gamepad.id), connected: false }).catch(() => {});
  });
  addEventListener('focus', () => { if (window.padStartActive && [...(navigator.getGamepads?.() || [])].some(Boolean)) { wake(); startPolling(); } });
  startPolling();
})();
