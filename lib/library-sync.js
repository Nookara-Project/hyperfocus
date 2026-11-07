'use strict';

const { SCOPES } = require('./velora');

const WAIT = 5000;
const RETRY = 2 * 60 * 1000;
const MAX_IDS = 500;
const ID_RE = /^(?:c-[a-z0-9]{8}|[A-Za-z0-9._-]{1,64})$/;

class LibrarySync {
  constructor({ file, velora, readJson, writeJson, ids, user }) {
    this.file = file;
    this.velora = velora;
    this.writeJson = writeJson;
    this.ids = ids;
    this.user = user;
    const saved = readJson(file, {});
    this.sent = { user: String(saved.user || ''), sig: String(saved.sig || '') };
    this.timer = null;
    this.busy = false;
    this.pending = '';
    this.failed = { sig: '', at: 0 };
  }

  canSync() { return !!this.velora.getToken() && this.velora.has(SCOPES.STORAGE_READ | SCOPES.STORAGE_WRITE); }

  list() {
    const raw = this.ids();
    if (!Array.isArray(raw)) return null;
    return [...new Set(raw.map(String))].filter(id => !id.endsWith('#beta') && ID_RE.test(id)).sort().slice(0, MAX_IDS);
  }

  soon() {
    const user = this.user();
    if (!user || !this.canSync()) return;
    const list = this.list();
    if (!list) return;
    const sig = JSON.stringify(list);
    if (this.sent.user === user.toLowerCase() && this.sent.sig === sig) { clearTimeout(this.timer); this.timer = null; this.pending = ''; return; }
    if (this.pending === sig && this.timer) return;
    if (this.failed.sig === sig && Date.now() - this.failed.at < RETRY) return;
    this.pending = sig;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.write(), WAIT);
  }

  async write() {
    this.timer = null;
    if (this.busy) { this.timer = setTimeout(() => this.write(), WAIT); return; }
    const user = this.user();
    const list = this.list();
    if (!user || !list || !this.canSync()) return;
    const sig = JSON.stringify(list);
    if (this.sent.user === user.toLowerCase() && this.sent.sig === sig) return;
    this.busy = true;
    try {
      await this.velora.putStorage('library', sig);
      this.sent = { user: user.toLowerCase(), sig };
      this.writeJson(this.file, this.sent);
      this.pending = '';
      this.failed = { sig: '', at: 0 };
    } catch {
      this.pending = '';
      this.failed = { sig, at: Date.now() };
      this.timer = setTimeout(() => this.soon(), RETRY + 1000);
    } finally {
      this.busy = false;
    }
  }
}

module.exports = { LibrarySync };
