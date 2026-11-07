'use strict';

const { EventEmitter } = require('events');
const dmKeys = require('./dm-keys');

const VELORA = 'https://nookara.cc';
const VELORA_WS = 'wss://nookara.cc';
const SCOPES = { PROFILE_READ: 1, STORAGE_READ: 16, STORAGE_WRITE: 32, VMAIL_READ: 64, VMAIL_SEND: 128, FRIENDS_READ: 256, FRIENDS_MANAGE: 512, MEDIA_UPLOAD: 4096, CHAT: 2048, VOICE: 16384 };
const WANTED_SCOPES = Object.values(SCOPES).reduce((a, b) => a | b, 0);
const STORAGE_ID = 'hyperfocus';

const normReactions = list => (Array.isArray(list) ? list.filter(r => r && r.emoji)
  .map(r => ({ emoji: String(r.emoji), count: Number(r.count) || 0, users: Array.isArray(r.users) ? r.users.map(String) : [] })) : []);
function normIm(m) {
  if (!m || m.id === undefined || m.id === null) return null;
  const system = !!m.from_system;
  return {
    id: Number(m.id), from: system ? 'System' : String(m.from || m.from_username || ''), to: String(m.to || m.to_username || ''),
    pfp: m.from_pfp || '', body: String(m.body ?? ''), sent_at: m.sent_at, read: !!m.read, system,
    edited_at: m.edited_at || null,
    reply: m.reply ? { id: Number(m.reply.id), from: String(m.reply.from || 'System'), body: m.reply.gone ? '' : String(m.reply.body ?? ''), gone: !!m.reply.gone } : null,
    reactions: normReactions(m.reactions),
  };
}
function normGroupMsg(m) {
  if (!m) return null;
  const ts = Number(m.timestamp) || Date.now();
  return {
    id: m.id ? String(m.id) : `${ts}_${m.user || ''}`, gid: m.id ? String(m.id) : null, room: String(m.room || ''),
    user: String(m.user || ''), body: String(m.message ?? ''), ts, sent_at: new Date(ts).toISOString(),
    system: !!m.system, rank: String(m.rank || ''), group: String(m.group || ''),
    reply: m.reply && m.reply.id ? { id: String(m.reply.id), from: String(m.reply.user || ''), body: String(m.reply.message ?? '') } : null,
  };
}
const IM_ERRORS = {
  user_not_found: 'No Nookara user with that name.', dms_friends_only: 'They only take messages from friends.',
  cannot_dm_bot: "Bots can't be messaged.", message_too_long: 'That message is too long (4000 characters max).',
  rate_limited: "You're sending messages too fast - wait a moment.", missing_fields: "You can't send an empty message.",
  insufficient_scope: 'Hyperfocus needs new Nookara permissions - log in again.', scope_disabled: 'That was disabled for your account by an administrator.',
};

class Velora extends EventEmitter {
  constructor(getToken) {
    super();
    this.getToken = getToken;
    this.scopes = 0;
    this.ws = null;
    this.connected = false;
    this.stopped = true;
    this.retry = 0;
    this.friends = new Map();
    this.unread = 0;
    this.activity = null;
    this.hello = null;
    this.disabled = 0;
    this.username = '';
    this.acks = new Map();
    this.nonceSeq = 0;
    this.recentIm = new Map();
  }
  isMe(name) { return !!this.username && String(name || '').toLowerCase() === this.username.toLowerCase(); }
  rememberIm(msg) {
    this.recentIm.set(msg.id, msg.system ? 'System' : this.isMe(msg.from) ? msg.to : msg.from);
    if (this.recentIm.size > 200) this.recentIm.delete(this.recentIm.keys().next().value);
  }
  failAcks(err) {
    for (const [n, a] of this.acks) { clearTimeout(a.timer); a.reject(err); this.acks.delete(n); }
  }

  setActivity(activity) {
    this.activity = activity || null;
    this.sendActivity();
  }
  sendActivity() {
    if (!this.connected || !this.ws) return;
    try { this.ws.send(JSON.stringify({ type: 'set_activity', activity: this.activity })); } catch {}
  }

  has(bits) { return (this.scopes & bits) === bits; }
  async groups() { return ((await this.api('/groups')).groups || []).map(g => ({ ...g, last: normGroupMsg(g.last) })); }
  async groupMessages(room) { return ((await this.api(`/groups/${encodeURIComponent(room)}/messages?limit=300`)).messages || []).map(normGroupMsg); }
  async groupSend(room, message) {
    if (!String(message || '').trim()) throw new Error("You can't send an empty message.");
    if (this.connected && this.ws) { this.ws.send(JSON.stringify({ type: 'roomMessage', room, message })); return null; }
    return normGroupMsg((await this.api(`/groups/${encodeURIComponent(room)}/messages`, { method: 'POST', body: { message } })).message);
  }
  async groupCreate(name, members) { return (await this.api('/groups', { method: 'POST', body: { name, members } })).group; }
  groupAdd(room, username) { return this.api(`/groups/${encodeURIComponent(room)}/members`, { method: 'POST', body: { username } }); }
  groupRemove(room, username) { return this.api(`/groups/${encodeURIComponent(room)}/members/${encodeURIComponent(username)}`, { method: 'DELETE' }); }
  groupRename(room, name) { return this.api(`/groups/${encodeURIComponent(room)}`, { method: 'PATCH', body: { name } }); }
  groupDelete(room) { return this.api(`/groups/${encodeURIComponent(room)}`, { method: 'DELETE' }); }
  answerCall(callId, accept) {
    try { this.ws?.send(JSON.stringify({ type: 'voice_call_answer', callId: String(callId), accept: !!accept })); } catch {}
  }

  async api(path, { method = 'GET', body, timeout = 12000 } = {}) {
    const token = this.getToken();
    if (!token) throw new Error('Log in with Nookara first.');
    const res = await fetch(VELORA + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = j.error === 'scope_disabled' ? 'That was disabled for your account by an administrator.'
        : j.error === 'insufficient_scope' ? 'Hyperfocus needs new Nookara permissions - log in again.'
        : j.error === 'mailbox_full' ? "Their mailbox is full."
        : j.error === 'too_many_groups' ? "You've made too many groups."
        : j.error === 'group_not_found' ? "That group doesn't exist anymore."
        : j.error === 'already_member' ? "They're already in the group."
        : j.error === 'group_full' ? 'That group is full (50 people).'
        : j.error === 'owner_only' ? 'Only the group owner can do that.'
        : j.error === 'not_a_member' ? "You're not in that group anymore."
        : j.error === 'user_not_found' ? 'No Nookara user with that name.'
        : j.error === 'already_friends' ? "You're already friends."
        : j.error === 'invalid_target' ? "You can't add yourself :3"
        : (j.error || `Nookara error ${res.status}`);
      const err = new Error(msg);
      err.status = res.status;
      err.code = j.error;
      throw err;
    }
    return j;
  }

  start(scopes) {
    const prev = this.scopes;
    this.scopes = Number(scopes) || 0;
    if (!this.stopped) {
      if (prev !== this.scopes) { this.refreshFriends(); this.refreshUnread(); }
      return;
    }
    this.stopped = false;
    this.connect();
    this.refreshFriends();
    this.refreshUnread();
    this.refreshRequests();
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    clearInterval(this.pingTimer);
    const ws = this.ws;
    this.ws = null;
    if (ws) { try { ws.close(); } catch {} }
    this.connected = false;
    this.failAcks(new Error('Log in with Nookara first.'));
    this.friends.clear();
    this.unread = 0;
    this.emit('change');
  }

  connect() {
    if (this.stopped || this.ws) return;
    const token = this.getToken();
    if (!token) return;
    let ws;
    try { ws = new WebSocket(VELORA_WS); } catch { this.scheduleRetry(); return; }
    this.ws = ws;
    ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'auth_token', token })));
    ws.addEventListener('message', ev => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      this.onMessage(m);
    });
    ws.addEventListener('close', () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.connected = false;
      clearInterval(this.pingTimer);
      this.failAcks(new Error('Lost the connection to Nookara - try again.'));
      this.emit('change');
      this.scheduleRetry();
    });
    ws.addEventListener('error', () => {});
  }
  scheduleRetry() {
    if (this.stopped) return;
    clearTimeout(this.retryTimer);
    const delay = Math.min(60000, 2000 * 2 ** Math.min(this.retry++, 5));
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  onMessage(m) {
    switch (m.type) {
      case 'auth_success':
        this.connected = true;
        this.retry = 0;
        this.username = String(m.user?.username || this.username || '');
        clearInterval(this.pingTimer);
        this.pingTimer = setInterval(() => { try { this.ws?.send('{"type":"ping"}'); } catch {} }, 25000);
        this.emit('change');
        this.refreshFriends();
        this.refreshUnread();
        if (this.hello) { try { this.ws.send(JSON.stringify({ type: 'hf_hello', ...this.hello })); } catch {} }
        this.sendActivity();
        break;
      case 'roomMessage':
        if (String(m.room || '').startsWith('grp_')) this.emit('group_message', normGroupMsg(m));
        break;
      case 'group_update':
        if (m.group) this.emit('group_update', m.group);
        break;
      case 'group_removed':
        this.emit('group_removed', String(m.room || ''));
        break;
      case 'achievement_unlocked':
        if (m.achievement?.id) this.emit('achievement', m.achievement);
        break;
      case 'achievement_revoked':
        this.emit('achievement_revoked', String(m.id || ''));
        break;
      case 'restrictions':
        this.disabled = Number(m.disabled_scopes) || 0;
        if (m.scopes !== undefined) this.scopes = Number(m.scopes) || 0;
        this.emit('restrictions', { disabled: this.disabled, scopes: this.scopes });
        this.emit('change');
        break;
      case 'voice_call_incoming':
        this.emit('voice_call', { callId: String(m.callId || ''), from: String(m.from || ''), room: String(m.room || '') });
        break;
      case 'voice_call_accepted':
        this.emit('voice_call_accepted', { callId: String(m.callId || ''), room: String(m.room || '') });
        break;
      case 'voice_call_ended':
        this.emit('voice_call_ended', { callId: String(m.callId || ''), reason: String(m.reason || '') });
        break;
      case 'hf_store_changed':
        this.emit('store_changed', { appId: String(m.appId || '') });
        break;
      case 'auth_error':
        this.emit('auth_error', m.error);
        this.stop();
        break;
      case 'kicked':
        this.stop();
        break;
      case 'friend_online':
        this.setOnline(m.username, true);
        break;
      case 'friend_offline':
        this.setOnline(m.username, false);
        break;
      case 'friend_request_accepted':
        this.refreshFriends();
        this.refreshRequests();
        this.emit('friend_accepted', { by: m.by });
        break;
      case 'friend_request':
        this.refreshRequests();
        this.emit('friend_request', { from: m.from });
        break;
      case 'dm_typing':
        this.emit('dm_typing', { from: m.from, typing: !!m.typing });
        break;
      case 'friend_activity':
        this.setFriendActivity(m);
        break;
      case 'im_unread':
        this.unread = Number(m.count) || 0;
        this.emit('change');
        break;
      case 'im_received':
      case 'im_sent':
        this.dms.open(m.message).then(opened => {
          const msg = normIm(opened);
          if (!msg) return;
          this.rememberIm(msg);
          const mine = m.type === 'im_sent' || (!msg.system && this.isMe(msg.from));
          if (!mine) { this.unread++; this.emit('change'); }
          this.emit('im', { message: msg, mine });
        });
        break;
      case 'im_edited':
        this.dms.open({ id: m.id, from_id: m.from_id, to_id: m.to_id, body: m.body, enc: m.enc }).then(o => this.emit('im_edited', { id: Number(m.id), with: String(m.with || ''), body: String(o.body ?? ''), edited_at: m.edited_at || Date.now() }));
        break;
      case 'e2ee_keys_changed':
        if (m.username) this.dms.forget(m.username);
        break;
      case 'im_reactions':
        this.emit('im_reactions', { id: Number(m.id), with: String(m.with || ''), reactions: normReactions(m.reactions) });
        break;
      case 'im_ack':
      case 'im_error': {
        const a = this.acks.get(m.nonce);
        if (!a) break;
        this.acks.delete(m.nonce);
        clearTimeout(a.timer);
        if (m.type === 'im_ack') { this.dms.open(m.message).then(o => { const msg = normIm(o); if (msg) this.rememberIm(msg); a.resolve(msg); }); }
        else if (m.error === 'stale_keys' && a.retry) a.retry();
        else a.reject(Object.assign(new Error(IM_ERRORS[m.error] || `Couldn't send it (${m.error || 'error'}).`), { code: m.error }));
        break;
      }
      case 'error':
      case 'chat_error':
        if (m.error === 'insufficient_scope' || m.error === 'scope_disabled') {
          const text = IM_ERRORS[m.error];
          if (Number(m.required_scope) === SCOPES.VMAIL_SEND) this.failAcks(Object.assign(new Error(text), { code: m.error }));
          this.emit('scope_error', { scope: Number(m.required_scope) || 0, code: m.error, text });
        }
        break;
    }
  }

  async setOnline(username, online) {
    let f = this.friends.get(username);
    const known = !!f;
    if (!f) {
      if (!online) return;
      await this.refreshFriends();
      f = this.friends.get(username);
      if (!f) return;
    }
    const was = known ? f.online : false;
    f.online = online;
    if (online && !was) this.emit('friend_online', { ...f });
    this.emit('change');
  }
  async refreshFriends() {
    if (!this.has(SCOPES.FRIENDS_READ)) return;
    try {
      const j = await this.api('/friends');
      const next = new Map();
      for (const r of j.friends || []) {
        next.set(r.friend_username, { username: r.friend_username, pfp: r.pfp_url || '', color: r.color || '', online: !!r.online });
      }
      try {
        const a = await this.api('/hyperfocus/friends');
        for (const r of a.friends || []) {
          const f = next.get(r.username);
          if (f) f.activity = r.activity || null;
        }
      } catch {}
      this.friends = next;
      this.emit('change');
    } catch {}
  }
  setFriendActivity({ username, activity, started }) {
    const f = this.friends.get(username);
    if (!f) return;
    f.activity = activity || null;
    if (activity && started) this.emit('friend_activity', { ...f });
    this.emit('change');
  }
  friendList() {
    return [...this.friends.values()]
      .map(f => ({ ...f }))
      .sort((a, b) => (b.online - a.online) || a.username.localeCompare(b.username));
  }

  async refreshUnread() {
    if (!this.has(SCOPES.VMAIL_READ)) return;
    try {
      const j = await this.api('/im/unread-count');
      this.unread = Number(j.unread) || 0;
      this.emit('change');
    } catch {}
  }
  async conversations() {
    const j = await this.api('/im/conversations');
    const list = await Promise.all((j.conversations || []).map(async c => ({ ...c, last_message: c.last_message ? await this.dms.open(c.last_message) : c.last_message })));
    return list.map(c => ({ username: String(c.username || ''), pfp: c.pfp || '', unread: Number(c.unread) || 0, last: normIm(c.last_message) }))
      .filter(c => c.username);
  }
  async imThread(username, before) {
    const q = `limit=50${before ? `&before=${encodeURIComponent(before)}` : ''}`;
    const j = await this.api(`/im/with/${encodeURIComponent(username)}?${q}`);
    const opened = await Promise.all((j.messages || []).map(this.dms.open));
    return { messages: opened.map(normIm).filter(Boolean), hasMore: !!j.has_more };
  }
  async imMarkRead(username) {
    await this.api(`/im/with/${encodeURIComponent(username)}/read`, { method: 'POST' });
    await this.refreshUnread();
  }
  useDmKeys({ file, safeStorage, getToken }) {
    this.dms = dmKeys.create({ api: (p, o) => this.api(p, o), file, safeStorage, baseUrl: VELORA, getToken });
  }
  async imSend(to, message, replyTo) {
    to = String(to || '').trim();
    message = String(message || '');
    if (!to) throw new Error('Who is it for? Add a username.');
    if (!message.trim()) throw new Error("You can't send an empty message.");
    if (message.length > 4000) throw new Error(IM_ERRORS.message_too_long);
    const noKeys = e => { if (e?.code === 'no_keys' || e?.message === 'no_keys') throw Object.assign(new Error("They haven't set up encrypted DMs yet, so this can't be sent. Try again once they have."), { code: 'no_keys' }); throw e; };
    let enc = await this.dms.seal(to, message).catch(noKeys);
    if (this.connected && this.ws) {
      const nonce = `hf${Date.now()}_${++this.nonceSeq}`;
      return new Promise((resolve, reject) => {
        const go = () => this.ws.send(JSON.stringify({ type: 'im_send', to, enc, reply_to: replyTo || undefined, nonce }));
        const timer = setTimeout(() => { this.acks.delete(nonce); reject(new Error("Nookara didn't answer - the message may not have been sent.")); }, 15000);
        const retry = () => {
          entry.retry = null; this.acks.set(nonce, entry); this.dms.forget(to);
          this.dms.seal(to, message, { fresh: true }).then(e => { enc = e; go(); }).catch(reject);
        };
        const entry = { resolve, reject, timer, retry };
        this.acks.set(nonce, entry);
        try { go(); }
        catch (e) { clearTimeout(timer); this.acks.delete(nonce); reject(e); }
      });
    }
    const post = e => this.api('/im/send', { method: 'POST', body: { to, enc: e, reply_to: replyTo || undefined } });
    try {
      const res = await post(enc).catch(async e => { if ((e.code || e.message) !== 'stale_keys') throw e; return post(await this.dms.seal(to, message, { fresh: true })); });
      const msg = normIm(await this.dms.open(res.message));
      if (msg) this.rememberIm(msg);
      return msg;
    } catch (e) { throw IM_ERRORS[e.code] ? Object.assign(new Error(IM_ERRORS[e.code]), { code: e.code }) : e; }
  }
  sendMail(to, subject, message) { return this.imSend(to, message); }

  async lookupUser(name) {
    const res = await fetch(`${VELORA}/account/lookup/${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(10000) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Nookara error ${res.status}`);
    return res.json();
  }
  async hyperfocusProfile(name) {
    const res = await fetch(`${VELORA}/hyperfocus/profile/${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(10000) });
    return res.ok ? res.json() : null;
  }
  async getPublic(path) {
    const token = this.getToken();
    const res = await fetch(VELORA + path, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(12000) });
    if (res.status === 404) return null;
    if (!res.ok) throw Object.assign(new Error(`Nookara error ${res.status}`), { status: res.status });
    return res.json();
  }
  async friendStatus(name) { return (await this.api(`/friends/status/${encodeURIComponent(name)}`)).status || 'none'; }
  async friendRequests() {
    const j = await this.api('/friends/requests');
    return { incoming: j.incoming || [], outgoing: j.outgoing || [] };
  }
  async refreshRequests() {
    if (!this.has(SCOPES.FRIENDS_READ)) return;
    try { this.requests = (await this.friendRequests()).incoming.length; this.emit('change'); } catch {}
  }
  async addFriend(name) {
    const j = await this.api('/friends/request', { method: 'POST', body: { username: String(name || '').trim() } });
    this.refreshFriends();
    this.refreshRequests();
    return j.status;
  }
  async acceptFriend(id) {
    await this.api(`/friends/request/${encodeURIComponent(id)}/accept`, { method: 'PATCH' });
    this.refreshFriends();
    this.refreshRequests();
  }
  async declineFriend(id) {
    await this.api(`/friends/request/${encodeURIComponent(id)}/decline`, { method: 'PATCH' });
    this.refreshRequests();
  }
  async removeFriend(name) {
    await this.api(`/friends/${encodeURIComponent(name)}`, { method: 'DELETE' });
    this.refreshFriends();
  }

  sendTyping(to, typing) {
    if (!this.connected || !this.ws || !to) return;
    try { this.ws.send(JSON.stringify({ type: 'dm_typing', to: String(to), typing: !!typing })); } catch {}
  }
  async uploadMedia(dataUrl) {
    const m = /^data:([\w/+.-]+);base64,/.exec(String(dataUrl || ''));
    if (!m) throw new Error("That file couldn't be read.");
    const mime = m[1];
    const kind = mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : null;
    if (!kind) throw new Error('Only images, videos and audio can be sent.');
    try {
      const j = await this.api(`/media/${kind}`, { method: 'POST', body: { data: dataUrl }, timeout: 180000 });
      if (!j.url) throw new Error('The upload failed.');
      return { url: j.url, kind };
    } catch (e) {
      if (e.code === 'pro_only') throw new Error('Sending videos needs Nookara Pro.');
      if (e.code === 'storage_limit_exceeded') throw new Error('Your Nookara storage is full.');
      if (e.code === 'unsupported_type' || e.code === 'invalid_data_uri') throw new Error("Nookara doesn't accept that file type.");
      if (e.code === 'file_too_large') throw new Error('That file is too big.');
      throw e;
    }
  }

  async getStorage(key) {
    try { return (await this.api(`/storage/${STORAGE_ID}/${encodeURIComponent(key)}`)).value; }
    catch (e) { if (e.status === 404) return null; throw e; }
  }
  async putStorage(key, value) {
    await this.api(`/storage/${STORAGE_ID}/${encodeURIComponent(key)}`, { method: 'PUT', body: { value: String(value) } });
  }
}

module.exports = { Velora, SCOPES, WANTED_SCOPES, VELORA, normIm, normGroupMsg };
