'use strict';
// The bubble cursor trail from the ikelene.net homepage (after mf2fm's "Bubble
// Cursor"): little purple bubbles float up from the pointer and grow a bit as
// they rise; holding the mouse button down keeps them coming. Never catches the
// mouse, and does nothing while the window is hidden. window.cursorTrail.set(false)
// turns it off (Settings > look & sound).
(() => {
  const COLOURS = ['#a6f', '#60f', '#60f', '#a6f'];
  const MAX = 66;
  const layer = document.createElement('div');
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999;overflow:hidden;';
  const els = [], state = [];
  for (let i = 0; i < MAX; i++) {
    const b = document.createElement('div');
    b.style.cssText = 'position:absolute;left:0;top:0;width:3px;height:3px;visibility:hidden;box-sizing:border-box;' +
      `border:1px solid;border-color:${COLOURS.join(' ')};border-radius:30%;background:rgba(204,204,204,.5);will-change:transform;`;
    layer.appendChild(b);
    els.push(b);
    state.push({ x: 0, y: 0, s: 0, on: false });
  }
  const mount = () => document.body.appendChild(layer);
  if (document.body) mount(); else addEventListener('DOMContentLoaded', mount);

  let enabled = true;
  let x = -99, y = -99, ox = x, oy = y, holding = null;
  addEventListener('mousemove', e => { x = e.clientX; y = e.clientY; }, { passive: true });
  addEventListener('mousedown', () => {
    const splash = () => { ox = oy = -1; holding = setTimeout(splash, 100); };
    clearTimeout(holding);
    splash();
  });
  addEventListener('mouseup', () => clearTimeout(holding));
  addEventListener('blur', () => clearTimeout(holding));

  function tick() {
    if (enabled && !document.hidden) {
      if (x >= 0 && (Math.abs(x - ox) > 1 || Math.abs(y - oy) > 1)) {
        ox = x;
        oy = y;
        const i = state.findIndex(b => !b.on);
        if (i >= 0) {
          Object.assign(state[i], { x, y: y - 3, s: 3, on: true });
          els[i].style.visibility = 'visible';
        }
      }
      const W = innerWidth, H = innerHeight;
      for (let i = 0; i < MAX; i++) {
        const b = state[i];
        if (!b.on) continue;
        b.y -= b.s / 2 + (i % 2);
        b.x += ((i % 5) - 2) / 5;
        if (b.y > 0 && b.x > 0 && b.x < W + b.s) {
          if (b.s < 8 && Math.random() < (b.s / H) * 2) b.s++;
          const st = els[i].style;
          st.width = st.height = `${b.s}px`;
          st.transform = `translate(${b.x}px,${b.y}px)`;
        } else {
          b.on = false;
          els[i].style.visibility = 'hidden';
        }
      }
    }
    setTimeout(tick, 40);
  }
  tick();

  window.cursorTrail = {
    set(on) {
      enabled = !!on;
      layer.hidden = !enabled;
      if (!enabled) state.forEach((b, i) => { b.on = false; els[i].style.visibility = 'hidden'; });
    },
  };
})();
