'use strict';
/* global hf, ICONS */
// Shared instant-messenger UI. DMs are Nookara instant messages - the same /im
// API and socket events as Bonfire (conversations, paged threads, read, im_send),
// group chats are Nookara /groups; the main process hands us normalised messages
// (lib/velora.js normIm / normGroupMsg). Media is uploaded through Nookara and sent
// as its URL, which renders as an embed; typing uses the dm_typing socket message.

window.MailUI = (() => {
  function h(tag, props = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(c);
    return n;
  }
  function pfp(url, name, size) {
    const style = `width:${size}px;height:${size}px`;
    const letter = () => h('span', { class: 'pfp', style, text: (name || '?')[0].toUpperCase() });
    if (!url) return letter();
    const img = h('img', { class: 'pfp', src: url, alt: '', style });
    img.addEventListener('error', () => img.replaceWith(letter()), { once: true });
    return img;
  }
  function shortDate(value) {
    const d = new Date(value);
    if (Number.isNaN(d.valueOf())) return '';
    return d.toDateString() === new Date().toDateString()
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  const iconLabel = (icon, text) => `${ICONS[icon] || ''}<span>${text}</span>`;
  const fmtSize = n => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  const safeColor = c => (/^#[0-9a-f]{3,8}$/i.test(String(c || '')) ? c : '');

  const URL_RE = /(https:\/\/[^\s<>"']+)/g;
  function mediaKind(url) {
    const u = String(url).split(/[?#]/)[0].toLowerCase();
    if (/\/uploads\/images\//.test(u) || /\.(png|jpe?g|gif|webp|avif|bmp)$/.test(u)) return 'image';
    if (/\/uploads\/videos\//.test(u) || /\.(mp4|webm|mov|mkv)$/.test(u)) return 'video';
    if (/\/uploads\/audio\//.test(u) || /\.(mp3|ogg|wav|aac|m4a)$/.test(u)) return 'audio';
    return null;
  }
  const link = url => h('a', { class: 'chat-link', href: '#', text: url, onclick: e => { e.preventDefault(); hf.openUrl(url); } });
  function embed(url, kind) {
    if (kind === 'image') {
      const img = h('img', { class: 'chat-img', src: url, alt: '', loading: 'lazy', title: 'open full size', onclick: () => hf.openUrl(url) });
      img.addEventListener('error', () => img.replaceWith(link(url)), { once: true });
      return img;
    }
    if (kind === 'video') return h('video', { class: 'chat-video', src: url, controls: true, preload: 'metadata' });
    return h('audio', { class: 'chat-audio', src: url, controls: true, preload: 'metadata' });
  }
  const VOICE_RE = /hyperfocus:\/\/voice\/([A-Za-z0-9_-]{1,64})/i;
  const HIDDEN_ID = '•'.repeat(10);
  function voiceInvite(room, mine) {
    let shown = false;
    const id = h('code', { class: 'vi-id', text: HIDDEN_ID });
    const eye = h('button', { class: 'vi-eye', title: 'show room ID', html: ICONS.eye });
    eye.onclick = () => {
      shown = !shown;
      id.textContent = shown ? room : HIDDEN_ID;
      eye.innerHTML = shown ? ICONS.eyeOff : ICONS.eye;
      eye.title = shown ? 'hide room ID' : 'show room ID';
    };
    const join = h('button', { class: 'btn vi-join', html: iconLabel('mic', 'join voice chat') });
    join.onclick = async () => {
      join.disabled = true;
      try { await hf.voiceCmd({ op: 'join', room }); join.innerHTML = iconLabel('mic', 'joined!'); }
      catch (e) { join.textContent = e.message; }
      finally { setTimeout(() => { join.disabled = false; join.innerHTML = iconLabel('mic', 'join voice chat'); }, 2500); }
    };
    return h('div', { class: 'voice-invite' },
      h('div', { class: 'vi-top', html: `${ICONS.mic}<b>${mine ? 'you sent a voice chat invite' : 'voice chat invite'}</b>` }),
      h('div', { class: 'vi-room' }, h('span', { text: 'room' }), id, eye),
      join);
  }

  const GAME_RE = /hyperfocus:\/\/join\/([A-Za-z0-9._-]{1,64})(?:\/([A-Za-z0-9_-]{1,64}))?/i;
  function gameInvite(app, code, mine, from, text) {
    const game = /invited you to play (.{1,80}?)! hyperfocus:/i.exec(String(text || ''))?.[1] || 'a game';
    const join = h('button', { class: 'btn vi-join', html: iconLabel('play', 'join game') });
    join.onclick = async () => {
      join.disabled = true;
      try { await hf.inviteJoin(app, code, from || ''); join.innerHTML = iconLabel('play', 'joining!'); }
      catch (e) { join.textContent = e.message; }
      finally { setTimeout(() => { join.disabled = false; join.innerHTML = iconLabel('play', 'join game'); }, 2500); }
    };
    return h('div', { class: 'voice-invite game-invite' },
      h('div', { class: 'vi-top', html: `${ICONS.play}<b>${mine ? 'you sent a game invite' : 'game invite'}</b>` }),
      h('div', { class: 'vi-room' }, h('span', { text: 'play' }), h('b', { class: 'vi-game', text: game })),
      mine ? null : join);
  }

  const EMOJI_RE = /<(a?):(\w{1,32}):(e[0-9a-f]{10})>/g;
  const emojiImg = (anim, name, eid) => h('img', { class: 'chat-emoji', src: `https://nookara.cc/uploads/emojis/${eid}.${anim ? 'gif' : 'png'}`, alt: `:${name}:`, title: `:${name}:` });
  function appendText(node, text) {
    let last = 0;
    for (const m of text.matchAll(EMOJI_RE)) {
      if (m.index > last) node.append(text.slice(last, m.index));
      node.append(emojiImg(m[1], m[2], m[3]));
      last = m.index + m[0].length;
    }
    if (last < text.length) node.append(text.slice(last));
  }
  function emojiNode(e) {
    const m = /^<(a?):(\w{1,32}):(e[0-9a-f]{10})>$/.exec(e);
    return m ? emojiImg(m[1], m[2], m[3]) : h('span', { text: e });
  }
  function callLine(body, caller, mine, other) {
    const m = /^\[Voice call\] (.+)$/.exec(String(body || '').trim());
    if (!m) return null;
    const what = m[1].trim();
    if (/^missed (a )?call$/i.test(what)) return mine ? `${other || 'They'} missed your call` : `You missed a call from ${caller}`;
    if (/^started a call$/i.test(what)) return mine ? 'You started a call' : `${caller} started a call`;
    const ended = /^call ended(?: - (.+))?$/i.exec(what);
    if (ended) return ended[1] ? `Call ended · ${ended[1]}` : 'Call ended';
    return mine ? `You ${what}` : `${caller} ${what}`;
  }

  function renderBody(text, mine, from = '') {
    const invite = VOICE_RE.exec(String(text || ''));
    if (invite) return [voiceInvite(invite[1], mine)];
    const game = GAME_RE.exec(String(text || ''));
    if (game) return [gameInvite(game[1], game[2] || '', mine, from, text)];
    const body = h('div', { class: 'chat-body' });
    const embeds = [];
    String(text || '').split(URL_RE).forEach((part, i) => {
      if (i % 2 === 0) { if (part) appendText(body, part); return; }
      const kind = mediaKind(part);
      if (kind) embeds.push(embed(part, kind));
      else body.append(link(part));
    });
    const first = body.firstChild, last = body.lastChild;
    if (first?.nodeType === 3) first.textContent = first.textContent.replace(/^\s+/, '');
    if (last?.nodeType === 3) last.textContent = last.textContent.replace(/\s+$/, '');
    return [body.textContent.trim() || body.querySelector('img') ? body : null, embeds.length ? h('div', { class: 'chat-media' }, ...embeds) : null];
  }
  const previewText = body => (VOICE_RE.test(String(body || '')) ? 'voice chat invite' : GAME_RE.test(String(body || '')) ? 'game invite' : String(body || '')
    .replace(URL_RE, u => { const k = mediaKind(u); return k ? `[${k}]` : u; })
    .replace(EMOJI_RE, ':$2:')
    .replace(/\s+/g, ' ').trim());

  const MAX_BYTES = { image: 25 * 1048576, audio: 20 * 1048576, video: 40 * 1048576 };

  function mount(root) {
    let convos = [], threads = [];
    const dms = new Map();
    const started = new Map();
    let groups = [];
    const groupMsgs = new Map();
    const seenKey = 'hf-group-seen';
    let seen = {}; try { seen = JSON.parse(localStorage.getItem(seenKey) || '{}') || {}; } catch {}
    const markSeen = (room, ts) => { seen[room] = Math.max(seen[room] || 0, ts || Date.now()); try { localStorage.setItem(seenKey, JSON.stringify(seen)); } catch {} };
    let social = null;
    let currentKey = null;
    let loading = false;
    const drafts = new Map();
    const pending = new Map();
    const typingFrom = new Map();
    const colors = new Map();
    function colorOf(t) {
      if (t.system) return '';
      if (colors.has(t.key)) return colors.get(t.key);
      const f = (social?.friends || []).find(x => x.username.toLowerCase() === t.key);
      if (f) { colors.set(t.key, safeColor(f.color)); return colors.get(t.key); }
      colors.set(t.key, '');
      hf.userInfo(t.name).then(i => {
        const c = safeColor(i?.color);
        if (!c) return;
        colors.set(t.key, c);
        drawList();
        if (currentKey === t.key) { const b = main.querySelector('.chat-head b'); if (b) b.style.color = c; }
      }).catch(() => {});
      return '';
    }
    const nameStyle = t => (colorOf(t) ? `color:${colorOf(t)}` : null);
    let typingTo = null;
    let typingSentAt = 0, typingStopTimer = null;

    const list = h('div', { class: 'mail-list' });
    const main = h('div', { class: 'mail-main' });
    const lockBar = h('div', { class: 'dm-lock', style: 'display:none' });
    const datalist = h('datalist', { id: `chat-friends-${Math.random().toString(36).slice(2)}` });
    const head = h('div', { class: 'mail-tabs' },
      h('b', { class: 'mail-list-title', text: 'chats' }),
      h('button', { class: 'btn mail-new', html: iconLabel('edit', 'new chat'), onclick: () => startChat() }),
      h('button', { class: 'btn ghost mail-new', html: iconLabel('users', 'new group'), onclick: () => startGroup() }));
    root.replaceChildren(lockBar, h('div', { class: 'mail-ui' }, h('div', { class: 'mail-side box' }, head, list), main), datalist);

    const setMain = (...kids) => main.replaceChildren(...kids);
    const notice = (text, button) => setMain(h('div', { class: 'mail-empty' }, h('img', { src: '../assets/velora.png', alt: '' }), h('p', { text }), button || null));
    function flash(text, err) {
      const t = h('div', { class: 'mail-flash' + (err ? ' err' : ''), text });
      root.append(t);
      setTimeout(() => t.remove(), 2600);
    }
    function personKey(name, system) { return system ? '__system__' : String(name || '').trim().toLowerCase(); }
    const isSystemName = name => String(name) === 'System';
    const convoKey = c => personKey(c.username, isSystemName(c.username));
    function buildThreads() {
      const byKey = new Map();
      for (const c of convos) {
        const system = isSystemName(c.username);
        const key = convoKey(c);
        const d = dms.get(key);
        const messages = (d?.loaded ? d.list : c.last ? [c.last] : []).map(dmItem);
        const last = messages[messages.length - 1];
        byKey.set(key, { key, name: system ? 'System' : c.username, pfp: c.pfp || '', system, convo: c, messages, unread: c.unread || 0, latest: last ? new Date(last.sent_at).valueOf() || 0 : 0 });
      }
      for (const f of social?.friends || []) {
        const key = personKey(f.username, false);
        if (!byKey.has(key)) byKey.set(key, { key, name: f.username, pfp: f.pfp || '', system: false, messages: [], unread: 0, latest: 0 });
        else if (!byKey.get(key).pfp) byKey.get(key).pfp = f.pfp || '';
      }
      for (const [key, name] of started) {
        if (!byKey.has(key)) byKey.set(key, { key, name, pfp: (social?.friends || []).find(f => f.username.toLowerCase() === key)?.pfp || '', system: false, messages: [], unread: 0, latest: Date.now() });
      }
      for (const g of groups) {
        const msgs = (groupMsgs.get(g.room) || (g.last ? [g.last] : [])).map(groupItem);
        const unread = msgs.filter(m => !m.outgoing && !m.systemLine && (m.ts || 0) > (seen[g.room] || 0)).length;
        byKey.set(`g:${g.room}`, { key: `g:${g.room}`, name: g.name, group: g, pfp: '', system: false, messages: msgs, unread, latest: msgs.length ? msgs[msgs.length - 1].ts : 0 });
      }
      threads = [...byKey.values()];
      threads.sort((a, b) => b.latest - a.latest || a.name.localeCompare(b.name));
    }
    function current() { return threads.find(t => t.key === currentKey) || null; }
    const me = () => String(social?.me?.username || '').toLowerCase();
    const dmItem = m => {
      const outgoing = !m.system && m.from.toLowerCase() === me();
      const call = callLine(m.body, m.from, outgoing, m.to);
      return { ...m, outgoing, person: m.system ? 'System' : m.from, ...(call ? { systemLine: true, body: call } : {}) };
    };
    const groupItem = m => ({ ...m, outgoing: !m.system && m.user.toLowerCase() === me(), person: m.user, systemLine: m.system, read: true });
    const isTyping = key => (typingFrom.get(key) || 0) > Date.now();
    function drawList() {
      const itemFor = t => {
        const last = t.messages[t.messages.length - 1];
        const sub = isTyping(t.key) ? 'typing...'
          : last ? (last.systemLine ? last.body : last.outgoing ? `you: ${previewText(last.body)}` : t.group ? `${last.person}: ${previewText(last.body)}` : previewText(last.body))
          : t.group ? `${t.group.members.length} members` : 'start a chat :3';
        const f = t.system ? null : (social?.friends || []).find(x => x.username.toLowerCase() === t.key);
        const st = f ? (f.activity ? 'playing' : f.online ? 'online' : 'offline') : '';
        const pic = t.group ? h('span', { class: 'pfp group-pic', style: 'width:34px;height:34px', html: ICONS.users || '' }) : pfp(t.pfp, t.name, 34);
        if (st) pic.classList.add(`mi-st-${st}`);
        const status = !f ? null
          : f.activity ? h('div', { class: 'mi-status playing', title: f.activity.state || '' },
            `${f.activity.type === 'Game' ? 'playing' : 'using'} `, h('b', { text: f.activity.name }), f.activity.state ? ` · ${f.activity.state}` : null)
            : h('div', { class: `mi-status ${st}`, text: st });
        return h('button', { class: 'mail-item' + (t.unread ? ' unread' : '') + (t.key === currentKey ? ' on' : ''), onclick: () => openChat(t.key) },
          pic,
          h('div', { class: 'mi-text' },
            h('div', { class: 'mi-top' }, h('b', { text: t.name, style: nameStyle(t) }), h('span', { class: 'mi-date', text: last ? shortDate(last.sent_at) : '' })),
            status,
            h('div', { class: 'mi-sub' + (isTyping(t.key) ? ' typing' : ''), text: sub })));
      };
      const on = [], off = [], other = [], grp = [];
      for (const t of threads) {
        if (t.group) { grp.push(t); continue; }
        const f = t.system ? null : (social?.friends || []).find(x => x.username.toLowerCase() === t.key);
        (f ? (f.online || f.activity ? on : off) : other).push(t);
      }
      const group = (label, arr) => (arr.length ? [h('div', { class: 'mail-group', text: `${label} — ${arr.length}` }), ...arr.map(itemFor)] : []);
      list.replaceChildren(...group('groups', grp), ...group('online', on), ...group('offline', off), ...group('other chats', other));
      if (!threads.length) list.append(h('div', { class: 'mail-loading', text: 'no chats yet' }));
    }
    async function load(keepMain = false) {
      if (loading) return;
      loading = true;
      social = await hf.social().catch(() => null);
      datalist.replaceChildren(...(social?.friends || []).map(f => h('option', { value: f.username })));
      if (!social?.loggedIn) { list.replaceChildren(); loading = false; return notice('Log in with Nookara in the launcher to use messages.', h('button', { class: 'btn', text: 'open launcher', onclick: () => hf.focusLauncher() })); }
      if (social.chatReadDisabled) { list.replaceChildren(); loading = false; return notice('Chat was disabled by an administrator.'); }
      if (social.needsRelogin) { list.replaceChildren(); loading = false; return reloginNotice(); }
      if (!threads.length) list.replaceChildren(h('div', { class: 'mail-loading', text: 'loading chats...' }));
      try {
        [convos, groups] = await Promise.all([hf.imConversations(),
          social.groupsDisabled ? [] : hf.groups().catch(e => { flash(`Group chats: ${e.message}`, true); return []; })]);
        for (const [key, d] of dms) {
          const c = convos.find(x => convoKey(x) === key);
          if (c?.last && !d.list.some(m => m.id === c.last.id)) dms.delete(key);
        }
        buildThreads();
        drawList();
        if (currentKey && current()) openChat(currentKey);
        else if (!keepMain) notice(threads.length ? 'pick a chat or start a new one :3' : 'no messages yet — start a chat!');
      } catch (e) {
        if (/log in again/i.test(e.message)) { list.replaceChildren(); reloginNotice(); }
        else list.replaceChildren(h('div', { class: 'mail-loading', text: e.message }));
      } finally { loading = false; }
    }
    function reloginNotice() {
      return notice('Hyperfocus needs new Nookara permissions for messages — log in again.', h('button', { class: 'btn', text: 'log in again', onclick: () => { hf.focusLauncher(); hf.login().catch(() => {}); } }));
    }
    let readTimer = null;
    function markRead(t) {
      const c = t?.convo || convos.find(x => convoKey(x) === t?.key);
      if (!c || !c.unread) return;
      c.unread = 0;
      t.unread = 0;
      clearTimeout(readTimer);
      readTimer = setTimeout(() => hf.imRead(c.username).catch(() => {}), 300);
    }
    let dmState = { state: 'loading' };
    function drawLock(state) {
      lockBar.replaceChildren();
      lockBar.style.display = state === 'none' || state === 'locked' ? '' : 'none';
      if (state === 'none') { lockBar.append(h('span', { text: 'DMs are end-to-end encrypted now. Open Ember once to choose a PIN or password, then come back.' })); return; }
      if (state !== 'locked') return;
      const useCode = dmState.passcodeLocked;
      const input = h('input', { type: useCode ? 'text' : 'password', placeholder: useCode ? 'Recovery code' : dmState.type === 'password' ? 'DM password' : 'DM PIN' });
      const unlock = async () => {
        try { dmState = await (useCode ? hf.dmRecovery(input.value) : hf.dmUnlock(input.value)); afterUnlock(); }
        catch (e) { flash(e.message, true); dmState = await hf.dmStatus().catch(() => dmState); drawLock(dmState.state); }
      };
      input.addEventListener('keydown', e => { if (e.key === 'Enter') unlock(); });
      lockBar.append(
        h('span', { text: useCode ? 'Too many wrong tries. Enter your recovery code to read your DMs.' : 'Your DMs are encrypted. Unlock them on this PC:' }), input,
        h('button', { class: 'btn', text: 'Unlock', onclick: unlock }),
        h('button', { class: 'btn ghost', text: 'Use a code from another device', onclick: async () => {
          try { const l = await hf.dmLink(); lockBar.replaceChildren(h('span', { text: `In Ember on another device, go to Settings, Privacy, Approve a device, and enter this code: ${l.code}` })); }
          catch (e) { flash(e.message, true); }
        } }));
    }
    function afterUnlock() {
      drawLock(dmState.state);
      dms.clear();
      load();
    }
    hf.dmStatus().then(s => { dmState = s; drawLock(s.state); }).catch(() => {});
    hf.on('dmUnlocked', s => { dmState = s; afterUnlock(); });
    async function openDm(key, reply) {
      let t = current();
      if (!t || t.key !== key || t.group) return;
      if (!dms.get(key)?.loaded && (t.convo || t.system)) {
        try {
          const r = await hf.imThread(t.name);
          dms.set(key, { list: r.messages, hasMore: r.hasMore, loaded: true });
        } catch (e) { flash(e.message, true); return; }
        if (currentKey !== key) return;
        buildThreads();
        t = current();
        if (!t) return;
        renderChat(t, reply);
      }
      markRead(t);
      drawList();
    }
    async function loadOlder(t) {
      const d = dms.get(t.key);
      if (!d?.hasMore || d.busy || !d.list.length) return;
      d.busy = true;
      try {
        const r = await hf.imThread(t.name, d.list[0].id);
        const have = new Set(d.list.map(m => m.id));
        d.list = [...r.messages.filter(m => !have.has(m.id)), ...d.list];
        d.hasMore = r.hasMore;
      } catch (e) { flash(e.message, true); }
      d.busy = false;
      if (currentKey !== t.key) return;
      const tr = main.querySelector('.chat-transcript');
      const fromBottom = tr ? tr.scrollHeight - tr.scrollTop : 0;
      buildThreads();
      renderChat(current(), false, fromBottom);
    }
    function onIm(msg) {
      if (!msg?.id) return;
      const mine = !msg.system && msg.from.toLowerCase() === me();
      const other = msg.system ? 'System' : mine ? msg.to : msg.from;
      const key = personKey(other, msg.system);
      let c = convos.find(x => convoKey(x) === key);
      if (!c) { c = { username: other, pfp: mine ? '' : msg.pfp, unread: 0, last: null }; convos.unshift(c); }
      const d = dms.get(key);
      const known = (c.last && c.last.id === msg.id) || !!d?.list.some(m => m.id === msg.id);
      if (!c.last || msg.id >= c.last.id) c.last = msg;
      if (known) return;
      if (d?.loaded) d.list.push(msg);
      started.delete(key);
      const open = currentKey === key && document.visibilityState === 'visible';
      if (!mine) {
        typingFrom.delete(key);
        c.unread = (c.unread || 0) + 1;
      }
      buildThreads();
      const t = current();
      if (open && !mine) markRead(t);
      drawList();
      if (t?.key === key && d?.loaded) {
        const tr = main.querySelector('.chat-transcript');
        const atBottom = !tr || tr.scrollHeight - tr.scrollTop - tr.clientHeight < 60;
        tr?.append(messageBubble(dmItem(msg), t));
        if (tr && atBottom) tr.scrollTop = tr.scrollHeight;
        updateTyping();
      }
    }
    function patchIm(d, patch) {
      const key = personKey(d.with, isSystemName(d.with));
      const c = convos.find(x => convoKey(x) === key);
      const msgs = [...(dms.get(key)?.list || []), ...(c?.last ? [c.last] : [])].filter(m => m.id === d.id);
      if (!msgs.length) return;
      msgs.forEach(m => Object.assign(m, patch));
      buildThreads();
      drawList();
      const t = current();
      const row = t?.key === key && main.querySelector(`.chat-row[data-mid="${d.id}"]`);
      if (row) row.replaceWith(messageBubble(dmItem(msgs[0]), t));
    }
    function replyQuote(r) {
      if (!r) return null;
      return h('div', { class: 'chat-reply', title: r.gone ? '' : r.body },
        h('span', { class: 'chat-reply-ico', html: ICONS.reply || '' }),
        r.gone ? h('i', { text: 'original message was deleted' }) : [h('b', { text: r.from }), ' ', h('span', { text: previewText(r.body) || '[attachment]' })]);
    }
    function reactionsRow(list) {
      if (!list?.length) return null;
      return h('div', { class: 'chat-reacts' }, ...list.map(r => h('span', {
        class: 'chat-react' + (r.users.some(u => u.toLowerCase() === me()) ? ' mine' : ''), title: r.users.join(', '),
      }, emojiNode(r.emoji), h('b', { text: String(r.count) }))));
    }
    const dateLine = m => h('span', { class: 'chat-date', text: shortDate(m.sent_at) + (m.edited_at ? ' · edited' : ''), title: m.edited_at ? `edited ${new Date(m.edited_at).toLocaleString()}` : null });
    function messageBubble(m, t) {
      if (m.systemLine) return h('div', { class: 'chat-sysline', 'data-mid': String(m.id), text: m.body });
      if (t.group && !m.outgoing) {
        const who = { name: m.person, pfp: '' };
        const info = h('span', { class: 'chat-from', text: m.person });
        hf.userInfo(m.person).then(i => { if (i?.color && safeColor(i.color)) info.style.color = i.color; const img = row.querySelector('.pfp'); if (i?.pfp && img?.tagName !== 'IMG') img.replaceWith(pfp(i.pfp, m.person, 28)); }).catch(() => {});
        const row = h('div', { class: 'chat-row theirs', 'data-mid': String(m.id) }, pfp(who.pfp, who.name, 28),
          h('div', { class: 'chat-bubble' }, info, replyQuote(m.reply), ...renderBody(m.body, false, m.person), dateLine(m)));
        return row;
      }
      const mine = !!m.outgoing;
      return h('div', { class: `chat-row ${mine ? 'mine' : 'theirs'}`, 'data-mid': String(m.id) },
        mine ? null : pfp(t.pfp, t.name, 28),
        h('div', { class: 'chat-bubble' }, replyQuote(m.reply), ...renderBody(m.body, mine, mine || t.system ? '' : t.name), reactionsRow(m.reactions), dateLine(m)));
    }

    function stopTyping() {
      clearTimeout(typingStopTimer);
      if (typingTo) hf.chatTyping(typingTo, false).catch(() => {});
      typingTo = null;
      typingSentAt = 0;
    }
    function noteTyping(name, hasText) {
      if (!hasText) return stopTyping();
      if (typingTo && typingTo !== name) stopTyping();
      if (typingTo !== name || Date.now() - typingSentAt > 3000) {
        typingTo = name;
        typingSentAt = Date.now();
        hf.chatTyping(name, true).catch(() => {});
      }
      clearTimeout(typingStopTimer);
      typingStopTimer = setTimeout(stopTyping, 4000);
    }
    function updateTyping() {
      const t = current();
      const el = main.querySelector('.chat-typing');
      if (el && t) {
        const on = isTyping(t.key);
        el.classList.toggle('on', on);
        el.replaceChildren(...(on ? [h('span', { text: `${t.name} is typing` }), h('span', { class: 'chat-dots' }, h('i'), h('i'), h('i'))] : []));
      }
    }

    function attach(t, file, redraw) {
      const kind = /^image\//.test(file.type) ? 'image' : /^video\//.test(file.type) ? 'video' : /^audio\//.test(file.type) ? 'audio' : null;
      if (!kind) return flash('Only images, videos and audio can be sent.', true);
      if (file.size > MAX_BYTES[kind]) return flash(`That ${kind} is too big (max ${fmtSize(MAX_BYTES[kind])}).`, true);
      const reader = new FileReader();
      reader.onload = () => { pending.set(t.key, { dataUrl: reader.result, kind, name: file.name || kind, size: file.size }); redraw(); };
      reader.onerror = () => flash("Couldn't read that file.", true);
      reader.readAsDataURL(file);
    }

    // fromBottom: keep the view where it was (after loading older messages above it)
    function renderChat(t, focus = false, fromBottom = 0) {
      if (!t) return;
      const hadFocus = !!document.activeElement?.classList?.contains('chat-input');
      const d = t.group ? null : dms.get(t.key);
      const top = t.group ? null
        : d?.loaded ? (d.hasMore ? h('button', { class: 'btn ghost chat-older', text: 'load older messages', onclick: e => { e.currentTarget.disabled = true; loadOlder(t); } }) : null)
          : (t.convo || t.system) ? h('div', { class: 'mail-loading chat-older', text: 'loading messages...' }) : null;
      const transcript = h('div', { class: 'chat-transcript' }, top, ...t.messages.map(m => messageBubble(m, t)));
      const typingEl = h('div', { class: 'chat-typing' });
      const off = !t.system && (t.group ? !!social?.groupsDisabled : !!social?.chatDisabled);
      const ta = h('textarea', { class: 'field chat-input' + (off ? ' chat-off' : ''), rows: 2, placeholder: t.system ? 'System messages cannot be replied to.' : off ? 'Chat was disabled by an administrator' : t.group ? `message ${t.name}...` : `message ${t.name}...`, disabled: t.system || off });
      ta.value = drafts.get(t.key) || '';
      const send = h('button', { class: 'btn chat-send', html: iconLabel('send', 'send'), disabled: t.system || off });
      const fileIn = h('input', { type: 'file', accept: 'image/*,video/*,audio/*', hidden: true });
      const attachBtn = h('button', { class: 'btn ghost chat-attach', title: 'Send an image, video or audio', html: ICONS.image, disabled: t.system || off, onclick: () => fileIn.click() });
      const pendingBox = h('div', { class: 'chat-pending', hidden: true });
      const drawPending = () => {
        const p = pending.get(t.key);
        pendingBox.hidden = !p;
        if (!p) return pendingBox.replaceChildren();
        pendingBox.replaceChildren(
          p.kind === 'image' ? h('img', { src: p.dataUrl, alt: '' }) : h('span', { class: 'chat-pending-kind', text: p.kind }),
          h('span', { class: 'chat-pending-name', text: `${p.name} · ${fmtSize(p.size)}` }),
          h('button', { class: 'm-x', title: 'Remove', html: ICONS.close, onclick: () => { pending.delete(t.key); drawPending(); } }));
      };
      fileIn.addEventListener('change', () => { if (fileIn.files[0]) attach(t, fileIn.files[0], drawPending); fileIn.value = ''; });

      const doSend = async () => {
        const p = pending.get(t.key);
        const text = ta.value.trim();
        if ((!text && !p) || send.disabled) return;
        send.disabled = true;
        attachBtn.disabled = true;
        stopTyping();
        try {
          let url = '';
          if (p) {
            send.innerHTML = iconLabel('send', 'uploading...');
            url = t.group ? (await hf.mediaUpload(p.dataUrl)).url : await hf.dmFile(p.dataUrl, p.name, p.mime || (/^data:([^;,]+)/.exec(p.dataUrl) || [])[1]);
          }
          const message = [text, url].filter(Boolean).join('\n');
          const sentMsg = t.group ? await hf.groupSend(t.group.room, message) : await hf.imSend(t.name, message);
          ta.value = '';
          drafts.delete(t.key);
          pending.delete(t.key);
          drawPending();
          if (sentMsg && t.group) onGroupMessage(sentMsg);
          else if (sentMsg) {
            const fresh = !convos.some(c => convoKey(c) === t.key);
            if (fresh && !dms.get(t.key)?.loaded) dms.set(t.key, { list: [], hasMore: false, loaded: true });
            onIm(sentMsg);
            if (!dms.get(t.key)?.loaded && currentKey === t.key) renderChat(current());
          }
          setTimeout(() => { const tr = main.querySelector('.chat-transcript'); if (tr) tr.scrollTop = tr.scrollHeight; }, 0);
        } catch (e) {
          flash(e.message, true);
        }
        send.innerHTML = iconLabel('send', 'send');
        send.disabled = false;
        attachBtn.disabled = false;
      };
      send.onclick = doSend;
      ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); } });
      ta.addEventListener('input', () => { drafts.set(t.key, ta.value); if (!t.system && !t.group) noteTyping(t.name, !!ta.value.trim()); });
      ta.addEventListener('blur', () => stopTyping());
      ta.addEventListener('paste', e => {
        const file = [...(e.clipboardData?.files || [])][0];
        if (file && !t.system) { e.preventDefault(); attach(t, file, drawPending); }
      });

      const view = h('div', { class: 'chat-view' },
        t.group ? groupHead(t) : h('div', { class: 'chat-head' }, pfp(t.pfp, t.name, 36), h('div', {},
          h('b', { text: t.name, style: nameStyle(t), class: t.system ? null : 'chat-who', title: t.system ? null : `view ${t.name}'s profile`, onclick: t.system ? null : () => hf.showProfile(t.name) }),
          h('span', { text: t.system ? 'system messages' : 'instant message' })),
          t.system ? null : h('button', {
            class: 'btn ghost chat-voice', title: `call ${t.name} (voice chat)`, html: iconLabel('mic', 'call'),
            onclick: async () => {
              try {
                await hf.voiceCmd({ op: 'callUser', to: t.name });
                flash(`calling ${t.name}...`);
              } catch (e) { flash(e.message, true); }
            },
          })),
        transcript,
        typingEl,
        h('div', { class: 'chat-compose' }, pendingBox, attachBtn, ta, send, fileIn,
          h('span', { class: 'chat-hint', text: 'enter to send · shift+enter for a new line · paste or drop images' })));
      if (!t.system) {
        view.addEventListener('dragover', e => { e.preventDefault(); main.classList.add('dragover'); });
        view.addEventListener('dragleave', e => { if (!view.contains(e.relatedTarget)) main.classList.remove('dragover'); });
        view.addEventListener('drop', e => {
          e.preventDefault();
          main.classList.remove('dragover');
          const file = e.dataTransfer?.files?.[0];
          if (file) attach(t, file, drawPending);
        });
      }
      setMain(view);
      drawPending();
      updateTyping();
      transcript.scrollTop = fromBottom ? transcript.scrollHeight - fromBottom : transcript.scrollHeight;
      if (!fromBottom) transcript.querySelectorAll('img.chat-img').forEach(img => img.addEventListener('load', () => { transcript.scrollTop = transcript.scrollHeight; }, { once: true }));
      if ((focus || hadFocus) && !t.system) setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 50);
    }
    function groupHead(t) {
      const g = t.group;
      const owner = String(g.owner).toLowerCase() === me();
      const panel = h('div', { class: 'group-panel', hidden: true });
      const drawPanel = () => {
        const addIn = h('input', { class: 'field', placeholder: 'add someone (username)', list: datalist.id });
        const add = async () => { const n = addIn.value.trim(); if (!n) return; try { await hf.groupAdd(g.room, n); addIn.value = ''; } catch (e) { flash(e.message, true); } };
        addIn.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
        panel.replaceChildren(
          h('div', { class: 'gp-title', text: `${g.members.length} members` }),
          ...g.members.map(n => h('div', { class: 'gp-member' },
            h('span', { class: 'gp-name', text: n }),
            n === g.owner ? h('span', { class: 'gp-owner', text: 'owner' }) : null,
            owner && n.toLowerCase() !== me() ? h('button', { class: 'btn ghost gp-mini', text: 'remove', onclick: async () => { try { await hf.groupRemove(g.room, n); } catch (e) { flash(e.message, true); } } }) : null)),
          owner ? h('div', { class: 'gp-row' }, addIn, h('button', { class: 'btn gp-mini', text: 'add', onclick: add })) : null,
          h('div', { class: 'gp-row' },
            owner ? h('button', { class: 'btn ghost gp-mini', text: 'rename', onclick: async () => {
              const name = prompt('New group name', g.name); if (!name || !name.trim()) return;
              try { await hf.groupRename(g.room, name.trim()); } catch (e) { flash(e.message, true); } } }) : null,
            h('button', { class: 'btn ghost gp-mini', text: 'leave group', onclick: async () => {
              if (!confirm(`Leave "${g.name}"?`)) return;
              try { await hf.groupRemove(g.room, social?.me?.username || ''); currentKey = null; await load(); } catch (e) { flash(e.message, true); } } }),
            owner ? h('button', { class: 'btn danger gp-mini', text: 'delete group', onclick: async () => {
              if (!confirm(`Delete "${g.name}" for everyone?`)) return;
              try { await hf.groupDelete(g.room); currentKey = null; await load(); } catch (e) { flash(e.message, true); } } }) : null));
      };
      drawPanel();
      return h('div', { class: 'chat-head-wrap' },
        h('div', { class: 'chat-head' },
          h('span', { class: 'pfp group-pic', style: 'width:36px;height:36px', html: ICONS.users || '' }),
          h('div', {}, h('b', { text: g.name }), h('span', { text: `group chat · ${g.members.length} members · owner ${g.owner}` })),
          h('button', { class: 'btn ghost chat-voice', html: iconLabel('users', 'members'), onclick: () => { panel.hidden = !panel.hidden; } })),
        panel);
    }
    async function openGroup(key, reply) {
      const t = current();
      if (!t?.group) return;
      try {
        const msgs = await hf.groupMessages(t.group.room);
        groupMsgs.set(t.group.room, msgs);
        t.messages = msgs.map(groupItem);
        if (msgs.length) markSeen(t.group.room, msgs[msgs.length - 1].ts);
        t.unread = 0;
      } catch (e) { flash(e.message, true); }
      if (currentKey !== key) return;
      drawList();
      renderChat(t, reply);
    }
    function startGroup() {
      const nameIn = h('input', { class: 'field', placeholder: 'group name', maxlength: '50' });
      const friends = (social?.friends || []).map(f => {
        const box = h('input', { type: 'checkbox', value: f.username });
        return h('label', { class: 'gp-pick' }, box, pfp(f.pfp, f.username, 20), h('span', { text: f.username }));
      });
      const extraIn = h('input', { class: 'field', placeholder: 'anyone else (usernames, comma separated)' });
      const go = async () => {
        const name = nameIn.value.trim();
        if (!name) return flash('Give the group a name.', true);
        const members = [...friends.map(l => l.querySelector('input')).filter(b => b.checked).map(b => b.value),
          ...extraIn.value.split(',').map(x => x.trim()).filter(Boolean)];
        try {
          const g = await hf.groupCreate(name, members);
          await load(true);
          openChat(`g:${g.room}`, { reply: true });
        } catch (e) { flash(e.message, true); }
      };
      setMain(h('div', { class: 'mail-compose chat-start' },
        h('h3', { text: 'new group' }),
        h('p', { text: "A group chat - you're the owner, so you can add and remove people later." }),
        h('label', {}, 'name', nameIn),
        friends.length ? h('div', { class: 'gp-picks' }, ...friends) : null,
        h('label', {}, 'others', extraIn),
        h('div', { class: 'mr-acts' }, h('button', { class: 'btn', text: 'create group', onclick: go }))));
      nameIn.focus();
    }

    function openChat(key, { reply = false } = {}) {
      if (currentKey !== key) stopTyping();
      currentKey = key;
      const t = current();
      if (!t) return;
      if (t.group) { drawList(); renderChat(t, reply); openGroup(key, reply); return; }
      drawList();
      renderChat(t, reply);
      openDm(key, reply);
    }
    function ensureThread(name) {
      const key = personKey(name, false);
      if (!threads.some(t => t.key === key)) { started.set(key, name); buildThreads(); }
      return key;
    }
    function startChat(to = '') {
      const toIn = h('input', { class: 'field', placeholder: 'Nookara username', list: datalist.id });
      toIn.value = to;
      const go = () => {
        const name = toIn.value.trim();
        if (!name) return;
        openChat(ensureThread(name), { reply: true });
      };
      setMain(h('div', { class: 'mail-compose chat-start' }, h('h3', { text: 'new chat' }), h('p', { text: 'Send an instant message to any Nookara user.' }), h('label', {}, 'username', toIn), h('div', { class: 'mr-acts' }, h('button', { class: 'btn', text: 'start chat', onclick: go }))));
      toIn.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
      toIn.focus();
    }
    async function openMail(id, opts = {}) {
      const name = await hf.imFind(id).catch(() => null);
      await load(true);
      if (!name) return notice('That message is no longer here.');
      const key = isSystemName(name) ? personKey(name, true) : ensureThread(name);
      openChat(key, opts);
    }

    hf.on('im', d => { if (d?.message) onIm(d.message); });
    hf.on('imEdited', d => { if (d?.id) patchIm(d, { body: d.body, edited_at: d.edited_at }); });
    hf.on('imReactions', d => { if (d?.id) patchIm(d, { reactions: d.reactions || [] }); });
    hf.on('imError', text => { if (text) flash(text, true); });
    hf.on('groupMessage', onGroupMessage);
    function onGroupMessage(m) {
      if (!m?.room) return;
      const have = groupMsgs.get(m.room);
      if (have?.some(x => x.id === m.id)) return;
      if (have) have.push(m);
      const g = groups.find(x => x.room === m.room);
      if (g) g.last = m; else return load(true);
      if (currentKey === `g:${m.room}`) markSeen(m.room, m.ts);
      buildThreads();
      drawList();
      const t = current();
      if (t?.group?.room === m.room) {
        const tr = main.querySelector('.chat-transcript');
        const atBottom = !tr || tr.scrollHeight - tr.scrollTop - tr.clientHeight < 60;
        tr?.append(messageBubble(groupItem(m), t));
        if (tr && atBottom) tr.scrollTop = tr.scrollHeight;
      }
    }
    hf.on('groupUpdate', d => {
      if (d?.removed && currentKey === `g:${d.removed}`) { currentKey = null; flash("You're not in that group anymore.", true); }
      load(true);
    });
    hf.on('social', s => {
      if (!s) return;
      const flip = !!s.chatDisabled !== !!social?.chatDisabled || !!s.chatReadDisabled !== !!social?.chatReadDisabled;
      social = s;
      if (flip) load(true);
      else if (threads.length) drawList();
    });
    hf.on('typing', d => {
      const key = personKey(d.from, false);
      if (d.typing) typingFrom.set(key, Date.now() + 6000);
      else typingFrom.delete(key);
      drawList();
      updateTyping();
    });
    setInterval(() => {
      let changed = false;
      for (const [k, exp] of typingFrom) if (exp <= Date.now()) { typingFrom.delete(k); changed = true; }
      if (changed) { drawList(); updateTyping(); }
    }, 1000);
    window.addEventListener('beforeunload', stopTyping);
    load();
    async function chatWith(name) {
      await load(true);
      openChat(ensureThread(name), { reply: true });
    }
    return { openMail, compose: startChat, chatWith, refresh: () => load(true) };
  }
  return { mount };
})();
