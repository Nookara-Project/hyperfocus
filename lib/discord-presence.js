'use strict';
const RPC = require('discord-rpc');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const RETRY_MS = [3000, 10000, 30000];

function toRawActivity(a) {
  const raw = { instance: !!a.instance };
  if (a.details) raw.details = String(a.details).slice(0, 128);
  if (a.state) raw.state = String(a.state).slice(0, 128);
  if (a.startTimestamp) raw.timestamps = { start: Math.round(new Date(a.startTimestamp).getTime()) };
  const assets = {};
  if (a.largeImageKey) assets.large_image = a.largeImageKey;
  if (a.largeImageText) assets.large_text = String(a.largeImageText).slice(0, 128);
  if (a.smallImageKey) assets.small_image = a.smallImageKey;
  if (a.smallImageText) assets.small_text = String(a.smallImageText).slice(0, 128);
  if (Object.keys(assets).length) raw.assets = assets;
  if (a.buttons?.length) raw.buttons = a.buttons.slice(0, 2).map(b => ({ label: String(b.label).slice(0, 32), url: b.url }));
  if (a.statusDisplayType != null) raw.status_display_type = a.statusDisplayType;
  return raw;
}

class DiscordPresence {
  constructor(clientId) {
    this.defaultClientId = String(clientId);
    this.clientId = this.defaultClientId;
    this.client = null;
    this.ready = false;
    this.connecting = false;
    this.enabled = true;
    this.activity = null;
    this.retryTimer = null;
    this.failures = 0;
    this.gen = 0;
    this.closing = null;
  }
  setEnabled(enabled) {
    this.enabled = !!enabled;
    if (!this.enabled) this.disconnect();
    else this.sync();
  }
  setActivity(activity, clientId) {
    const want = String(clientId || this.defaultClientId);
    this.activity = activity || null;
    if (want !== this.clientId) { this.disconnect(); this.clientId = want; }
    this.sync();
  }
  push(client) {
    return client.request('SET_ACTIVITY', { pid: process.pid, activity: toRawActivity(this.activity) });
  }
  async sync() {
    if (!this.enabled || !this.activity) return this.disconnect();
    if (this.ready && this.client) {
      try { await this.push(this.client); } catch { this.resetAndRetry(); }
      return;
    }
    if (this.connecting || this.client) return;
    this.connecting = true;
    const gen = this.gen;
    if (this.closing) {
      await this.closing;
      await sleep(400);
      if (gen !== this.gen) return;
      if (!this.enabled || !this.activity) { this.connecting = false; return; }
    }
    const client = new RPC.Client({ transport: 'ipc' });
    this.client = client;
    client.on('ready', async () => {
      if (this.client !== client) return;
      this.ready = true;
      this.connecting = false;
      this.failures = 0;
      try { await this.push(client); } catch { return this.resetAndRetry(client); }
      await sleep(1500);
      if (this.client === client && this.ready && this.activity) this.push(client).catch(() => {});
    });
    client.on('error', () => this.resetAndRetry(client));
    client.on('disconnected', () => this.resetAndRetry(client));
    try {
      await Promise.race([
        client.login({ clientId: this.clientId }),
        sleep(15000).then(() => { if (!this.ready && this.client === client) throw new Error('Discord login timed out'); }),
      ]);
    } catch { this.resetAndRetry(client); }
  }
  close(old, clear) {
    if (!old) return;
    const done = (async () => {
      if (clear) { try { await Promise.race([old.clearActivity(), sleep(800)]); } catch {} }
      try { await Promise.race([old.destroy(), sleep(1500)]); } catch {}
    })();
    this.closing = done;
    done.then(() => { if (this.closing === done) this.closing = null; });
  }
  resetAndRetry(client = this.client) {
    if (client && this.client !== client) return;
    this.ready = false;
    this.connecting = false;
    const old = this.client;
    this.client = null;
    this.close(old, false);
    if (!this.enabled || !this.activity || this.retryTimer) return;
    const delay = RETRY_MS[Math.min(this.failures++, RETRY_MS.length - 1)];
    this.retryTimer = setTimeout(() => { this.retryTimer = null; this.sync(); }, delay);
    this.retryTimer.unref?.();
  }
  disconnect() {
    this.gen++;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.ready = false;
    this.connecting = false;
    this.failures = 0;
    const old = this.client;
    this.client = null;
    this.close(old, true);
  }
}

module.exports = { DiscordPresence };
