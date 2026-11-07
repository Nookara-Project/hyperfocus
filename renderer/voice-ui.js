'use strict';
/* global hf, ICONS */
// Voice chat panel - the launcher sidebar box and the overlay widget. The call
// itself runs in the hidden voice window; this only shows it and sends commands.

window.VoiceUI = (() => {
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
  const HIDDEN_ID = '•'.repeat(10);
  const safeColor = c => (/^#[0-9a-f]{3,8}$/i.test(String(c || '')) ? c : '');
  const fill = (node, ...kids) => node.replaceChildren(...kids.flat().filter(k => k !== null && k !== undefined && k !== false));

  function mount(root) {
    let state = { status: 'idle', users: [] };
    let showId = false;
    let frameKey = '', rosterKey = '';
    let usersEl = null;
    const rows = new Map();
    const frame = h('div', { class: 'vc' });
    root.replaceChildren(frame);

    function say(text, err) {
      const n = h('div', { class: err ? 'vc-err' : 'vc-note', text });
      frame.append(n);
      setTimeout(() => n.remove(), 3500);
    }
    const run = async fn => { try { await fn(); } catch (e) { say(e.message, true); } };

    let settingsOpen = false;
    async function settingsBox() {
      const box = h('div', { class: 'vc-settings' }, h('div', { class: 'vc-status', text: 'loading devices...' }));
      const devs = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      const pick = (kind, cur) => {
        const sel = h('select', { class: 'field' }, h('option', { value: '', text: 'Windows default' }),
          ...devs.filter(d => d.kind === kind && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
            .map((d, i) => h('option', { value: d.deviceId, text: d.label || `${kind === 'audioinput' ? 'Microphone' : 'Speakers'} ${i + 1}` })));
        sel.value = [...sel.options].some(o => o.value === cur) ? cur : '';
        return sel;
      };
      const input = pick('audioinput', state.devices?.input || '');
      const output = pick('audiooutput', state.devices?.output || '');
      box.replaceChildren(
        h('label', { class: 'vc-set' }, h('span', { class: 'vc-label', text: 'microphone' }), input),
        h('label', { class: 'vc-set' }, h('span', { class: 'vc-label', text: 'output' }), output),
        h('div', { class: 'vc-ctrls' },
          h('button', { class: 'btn vc-grow', text: 'save', onclick: () => run(async () => { await hf.voiceCmd({ op: 'devices', input: input.value, output: output.value }); say('voice settings saved'); }) }),
          h('button', { class: 'btn ghost', text: 'close', onclick: () => { settingsOpen = false; draw(true); } })));
      return box;
    }
    const gearBtn = () => h('button', { class: 'vc-ico' + (settingsOpen ? ' on' : ''), title: 'voice settings (mic + output)', html: ICONS.gear, onclick: () => { settingsOpen = !settingsOpen; draw(true); } });
    function withSettings() { if (settingsOpen) settingsBox().then(b => { if (settingsOpen) frame.append(b); }); }

    function build() {
      const s = state;
      usersEl = null;
      rosterKey = '';
      if (s.status === 'idle') {
        const idIn = h('input', { class: 'field vc-join-in', type: 'password', placeholder: 'room ID', autocomplete: 'off', spellcheck: 'false' });
        const eye = h('button', { class: 'vc-ico', title: 'show', html: ICONS.eye });
        eye.onclick = () => { idIn.type = idIn.type === 'password' ? 'text' : 'password'; eye.innerHTML = idIn.type === 'password' ? ICONS.eye : ICONS.eyeOff; };
        const join = () => { const r = idIn.value.trim(); if (r) run(() => hf.voiceCmd({ op: 'join', room: r })); };
        idIn.addEventListener('keydown', e => { if (e.key === 'Enter') join(); });
        fill(frame,
          h('button', { class: 'btn vc-create', html: `${ICONS.mic}<span>create room</span>`, onclick: () => run(() => hf.voiceCmd({ op: 'create' })) }),
          h('div', { class: 'vc-join' }, idIn, eye, h('button', { class: 'btn ghost', text: 'join', onclick: join }), gearBtn()),
          s.error && s.error !== 'mic' ? h('div', { class: 'vc-err', text: s.error }) : null);
        withSettings();
        return;
      }
      if (s.status === 'connecting' || s.status === 'waiting') {
        fill(frame,
          h('div', { class: 'vc-status', text: s.status === 'waiting' ? 'waiting for the host to let you in...' : 'connecting...' }),
          h('button', { class: 'btn ghost', text: 'cancel', onclick: () => hf.voiceCmd({ op: 'leave' }) }));
        return;
      }
      usersEl = h('div', { class: 'vc-users' });
      const invite = h('div', { class: 'vc-invite', hidden: true });
      fill(frame,
        h('div', { class: 'vc-room' },
          h('span', { class: 'vc-label', text: /^bfc_/.test(s.room) ? 'Bonfire call' : /^bf_/.test(s.room) ? 'Bonfire voice' : 'room' }),
          h('code', { class: 'vc-id' + (showId ? '' : ' hidden-id'), text: showId ? s.room : HIDDEN_ID }),
          h('button', { class: 'vc-ico', title: showId ? 'hide room ID' : 'show room ID', html: showId ? ICONS.eyeOff : ICONS.eye, onclick: () => { showId = !showId; draw(true); } }),
          h('button', { class: 'vc-ico', title: 'copy room ID', html: ICONS.copy, onclick: () => navigator.clipboard.writeText(s.room).then(() => say('room ID copied')).catch(() => {}) })),
        usersEl,
        s.error === 'mic' ? h('div', { class: 'vc-err', text: 'mic blocked - you can still listen' }) : null,
        h('div', { class: 'vc-ctrls' },
          h('button', { class: 'btn icon-btn' + (s.muted ? ' danger' : ''), title: s.muted ? 'unmute' : 'mute', html: s.muted ? ICONS.micOff : ICONS.mic, onclick: () => hf.voiceCmd({ op: 'mute' }) }),
          h('button', { class: 'btn icon-btn' + (s.deafened ? ' danger' : ''), title: s.deafened ? 'undeafen' : 'deafen', html: s.deafened ? ICONS.headphonesOff : ICONS.headphones, onclick: () => hf.voiceCmd({ op: 'deafen' }) }),
          h('button', { class: 'btn ghost vc-grow', text: 'invite', onclick: () => toggleInvite(invite) }),
          h('button', { class: 'btn danger', text: 'leave', onclick: () => hf.voiceCmd({ op: 'leave' }) }),
          gearBtn()),
        invite);
      withSettings();
    }

    async function toggleInvite(box) {
      if (!box.hidden) { box.hidden = true; return; }
      const soc = await hf.social().catch(() => null);
      const friends = soc?.friends || [];
      box.replaceChildren(...(friends.length
        ? friends.map(f => h('div', { class: 'vc-friend' },
          pfp(f.pfp, f.username, 20), h('span', { class: 'vc-grow', text: f.username }),
          h('button', {
            class: 'btn vc-mini', text: 'call', disabled: !f.online, title: f.online ? `ring ${f.username} into this room` : `${f.username} is offline`,
            onclick: () => run(async () => { await hf.voiceCmd({ op: 'call', to: f.username }); box.hidden = true; say(`calling ${f.username}...`); }),
          }),
          h('button', {
            class: 'btn ghost vc-mini', text: 'invite', title: `send ${f.username} an invite message`,
            onclick: () => run(async () => { await hf.voiceInvite(f.username); box.hidden = true; say(`invite sent to ${f.username}`); }),
          })))
        : [h('div', { class: 'vc-status', text: 'no friends to invite yet - share the room ID instead' })]));
      box.hidden = false;
    }

    function drawUsers() {
      if (!usersEl) return;
      const list = state.users || [];
      const ringing = state.ringing || [];
      const key = JSON.stringify([list.map(u => [u.id, u.name, u.pfp, u.color, u.muted, u.deafened, u.me, u.volume, u.mutedByMe]), ringing.map(r => [r.name, r.pfp])]);
      if (key !== rosterKey) {
        rosterKey = key;
        rows.clear();
        usersEl.replaceChildren(...list.map(u => {
          const top = h('div', { class: 'vc-top' },
            pfp(u.pfp, u.name, 26),
            h('span', { class: 'vc-name', text: u.me ? `${u.name} (you)` : u.name, style: safeColor(u.color) ? `color:${safeColor(u.color)}` : null }),
            u.deafened ? h('span', { class: 'vc-flag', title: 'deafened', html: ICONS.headphonesOff })
              : u.muted ? h('span', { class: 'vc-flag', title: 'muted', html: ICONS.micOff }) : null,
            u.me ? null : h('button', {
              class: 'vc-mini' + (u.mutedByMe ? ' danger' : ''),
              title: u.mutedByMe ? `unmute ${u.name} for you` : `mute ${u.name} for you`,
              html: u.mutedByMe ? ICONS.volOff : ICONS.vol,
              onclick: e => { e.stopPropagation(); hf.voiceCmd({ op: 'userMute', name: u.name }).catch(() => {}); },
            }));
          const row = h('div', { class: 'vc-user' + (u.mutedByMe ? ' muted-by-me' : '') }, top);
          if (!u.me) {
            const pctv = Math.round((u.volume ?? 1) * 100);
            const val = h('span', { class: 'vc-vol-v', text: `${pctv}%` });
            const slider = h('input', { type: 'range', min: '50', max: '200', step: '5', value: String(pctv), title: `${u.name}'s volume` });
            slider.addEventListener('input', () => { val.textContent = `${slider.value}%`; });
            slider.addEventListener('change', () => hf.voiceCmd({ op: 'userVolume', name: u.name, volume: Number(slider.value) / 100 }).catch(() => {}));
            row.append(h('div', { class: 'vc-vol' }, slider, val));
            top.title = 'click for volume';
            top.addEventListener('click', () => row.classList.toggle('open'));
          }
          rows.set(u.id, row);
          return row;
        }),
        ...ringing.map(r => h('div', { class: 'vc-user ringing', title: `ringing ${r.name}...` },
          h('div', { class: 'vc-top' }, pfp(r.pfp, r.name, 26), h('span', { class: 'vc-name', text: r.name }), h('span', { class: 'vc-ringing', text: 'ringing...' })))));
      }
      for (const u of list) rows.get(u.id)?.classList.toggle('speaking', !!u.speaking);
    }

    function draw(force) {
      const s = state;
      const key = JSON.stringify([s.status, s.room, s.muted, s.deafened, s.error, showId]);
      if (force || key !== frameKey) { frameKey = key; build(); }
      drawUsers();
    }

    hf.on('voice', s => { state = s || state; draw(); });
    hf.voiceGet().then(s => { state = s || state; draw(true); }).catch(() => draw(true));
    return { refresh: () => draw(true) };
  }

  return { mount };
})();
