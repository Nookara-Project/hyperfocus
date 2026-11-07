'use strict';
/* global hf */
(() => {
  let held = false;
  addEventListener('mousedown', e => {
    if (e.button !== 0 || held) return;
    const t = e.target;
    if (!(t instanceof Element) || !t.closest('[data-drag]')) return;
    if (t.closest('button, a, input, select, textarea, label, [role="button"], .no-drag')) return;
    held = true;
    hf.win?.drag?.().catch(() => {});
  }, true);
  const stop = () => {
    if (!held) return;
    held = false;
    hf.win?.dragEnd?.().catch(() => {});
  };
  addEventListener('mouseup', stop, true);
  addEventListener('blur', stop);
})();
