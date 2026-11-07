'use strict';

const { SCOPES } = require('./velora');

class Playtime {
  constructor({ file, velora, readJson, writeJson, onChange }) {
    this.file = file;
    this.velora = velora;
    this.writeJson = writeJson;
    this.onChange = onChange;
    const saved = readJson(file, {});
    this.totals = saved.totals || {};
    this.pending = saved.pending || {};
    this.sessions = {};
    this.syncing = null;
  }

  save() { this.writeJson(this.file, { totals: this.totals, pending: this.pending }); }

  start(id) {
    const now = Date.now();
    this.sessions[id] = { start: now, last: now };
    this.onChange();
  }
  tick() {
    const now = Date.now();
    let changed = false;
    for (const [id, s] of Object.entries(this.sessions)) {
      const secs = Math.floor((now - s.last) / 1000);
      if (secs <= 0) continue;
      this.pending[id] = (this.pending[id] || 0) + secs;
      s.last += secs * 1000;
      changed = true;
    }
    if (changed) this.save();
  }
  stop(id) {
    this.tick();
    delete this.sessions[id];
    this.onChange();
    return this.sync();
  }

  canSync() { return !!this.velora.getToken() && this.velora.has(SCOPES.STORAGE_READ | SCOPES.STORAGE_WRITE); }

  sync() {
    if (this.syncing) return this.syncing;
    if (!this.canSync()) return Promise.resolve();
    this.syncing = (async () => {
      try {
        this.tick();
        let raw;
        try { raw = await this.velora.getStorage('playtime'); } catch { return; }
        let remote = {};
        if (raw) {
          try { remote = JSON.parse(raw); } catch { return; }
          if (!remote || typeof remote !== 'object' || Array.isArray(remote)) return;
        }
        const sending = { ...this.pending };
        if (Object.values(sending).some(v => v > 0)) {
          for (const [id, secs] of Object.entries(sending)) remote[id] = (Number(remote[id]) || 0) + secs;
          await this.velora.putStorage('playtime', JSON.stringify(remote));
          for (const [id, secs] of Object.entries(sending)) {
            this.pending[id] = (this.pending[id] || 0) - secs;
            if (this.pending[id] <= 0) delete this.pending[id];
          }
        }
        this.totals = Object.fromEntries(Object.entries(remote).map(([k, v]) => [k, Number(v) || 0]));
        this.save();
        this.onChange();
      } catch {
      } finally {
        this.syncing = null;
      }
    })();
    return this.syncing;
  }

  resetTotals() {
    this.totals = {};
    this.save();
    this.onChange();
  }

  view() {
    const totals = { ...this.totals };
    for (const [id, secs] of Object.entries(this.pending)) totals[id] = (totals[id] || 0) + secs;
    const sessions = {};
    for (const [id, s] of Object.entries(this.sessions)) sessions[id] = { start: s.start, last: s.last };
    return { totals, sessions };
  }
}

module.exports = { Playtime };
