'use strict';
/* global hf */

const SERVER = 'wss://nookara.cc';
const SAMPLE_RATE = 16000;
const BUFFER_SIZE = 512;
const VOL_REPORT_MS = 100;
const SPEAKING_AT = 6;
const SFU_LEVEL = 300;
const isRtcRoom = r => /^bfc?_/.test(String(r || ''));

let ws = null;
let mode = null;
let ctx = null, master = null, ctxRate = -1;
let mic = null;
let sessionId = null;
let room = null, myName = '';
let status = 'idle';
let error = '';
let muted = false, deafened = false;
let myLevel = 0;
const users = new Map();
const queues = new Map();
const heard = new Map();
const levels = new Map();
let volTimer = null;
const gains = new Map();
let userPrefs = {};
let inputId = '', outputId = '';
function applySink() { if (ctx && ctx.setSinkId) ctx.setSinkId(outputId || '').catch(() => {}); }
function setGain(g, key) {
  const p = userPrefs[key] || {};
  g.gain.value = p.m ? 0 : Math.min(2, Math.max(0, Number(p.v ?? 1)));
}
function gainFor(name) {
  const key = String(name || '').toLowerCase();
  let g = gains.get(key);
  if (!g) {
    g = ctx.createGain();
    g.connect(master);
    gains.set(key, g);
  }
  setGain(g, key);
  return g;
}
function applyPrefs() { for (const [key, g] of gains) setGain(g, key); }

function snapshot() {
  const now = Date.now();
  return {
    status, room, error, muted, deafened,
    ringing: [...calling.values()],
    users: [...users.values()].map(u => ({
      id: u.id, name: u.name, me: u.id === sessionId,
      muted: u.id === sessionId ? muted : !!u.muted, deafened: u.id === sessionId ? deafened : !!u.deafened,
      speaking: u.id === sessionId ? (!muted && !deafened && myLevel >= SPEAKING_AT) : (heard.get(u.id) || 0) > now - 350,
    })),
  };
}
let lastSent = '';
function emit(force) {
  const s = snapshot();
  const key = JSON.stringify(s);
  if (!force && key === lastSent) return;
  lastSent = key;
  hf.voiceState(s).catch(() => {});
}
const sendRaw = obj => { if (ws && ws.readyState === WebSocket.OPEN) { ws.send(JSON.stringify(obj)); return true; } return false; };
const send = obj => sendRaw({ type: 'voice', msg: obj });

async function ensureCtx() {
  const want = mode === 'relay' ? SAMPLE_RATE : 0;
  if (ctx && ctx.state !== 'closed' && ctxRate !== want) { ctx.close().catch(() => {}); ctx = null; }
  if (!ctx || ctx.state === 'closed') {
    ctx = want ? new AudioContext({ sampleRate: want }) : new AudioContext();
    ctxRate = want;
    master = ctx.createGain();
    master.connect(ctx.destination);
    gains.clear();
    applySink();
  }
  if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
  master.gain.value = deafened ? 0 : 1;
}

const micConstraints = id => ({
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, ...(id ? { deviceId: { exact: id } } : {}) },
  video: false,
});

async function startMic() {
  if (mic) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia(micConstraints(inputId));
    if (!ws || mode !== 'relay') { stream.getTracks().forEach(t => t.stop()); return; }
    const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(BUFFER_SIZE, 1, 1);
    proc.onaudioprocess = e => {
      const input = e.inputBuffer.getChannelData(0);
      e.outputBuffer.getChannelData(0).fill(0);
      let sum = 0;
      for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
      myLevel = Math.sqrt(sum / input.length) * 100;
      if (muted || deafened || status !== 'connected' || !ws || ws.readyState !== WebSocket.OPEN) return;
      const int16 = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) int16[i] = Math.max(-32768, Math.min(32767, input[i] * 32768));
      ws.send(int16.buffer);
    };
    src.connect(proc);
    proc.connect(ctx.destination);
    mic = { stream, src, proc };
    if (error === 'mic') { error = ''; emit(true); }
  } catch {
    if (inputId) { inputId = ''; return startMic(); }
    error = 'mic';
    emit(true);
  }
}
function stopMic() {
  if (!mic) return;
  try { mic.proc.disconnect(); mic.src.disconnect(); } catch {}
  mic.stream.getTracks().forEach(t => t.stop());
  mic = null;
  myLevel = 0;
}

function playAudio(buf) {
  if (mode !== 'relay' || !ctx || buf.byteLength < 4) return;
  const idLen = new DataView(buf).getUint16(0, true);
  const start = 2 + idLen;
  const len = (buf.byteLength - start) & ~1;
  if (len <= 0) return;
  const id = new TextDecoder().decode(new Uint8Array(buf, 2, idLen));
  if (id === sessionId) return;
  const samples = new Int16Array(buf.slice(start, start + len));
  const f32 = new Float32Array(samples.length);
  let sum = 0;
  for (let i = 0; i < samples.length; i++) { const s = samples[i] / 32768; f32[i] = s; sum += s * s; }
  const level = Math.sqrt(sum / f32.length) * 100;
  levels.set(id, { level, at: Date.now() });
  if (level >= SPEAKING_AT) heard.set(id, Date.now());
  if (deafened) return;

  const now = ctx.currentTime;
  let at = queues.get(id) ?? now;
  if (at < now - 0.05 || at > now + 1) at = now + 0.05;
  const ab = ctx.createBuffer(1, f32.length, SAMPLE_RATE);
  ab.copyToChannel(f32, 0);
  const node = ctx.createBufferSource();
  node.buffer = ab;
  node.connect(gainFor(users.get(id)?.name));
  node.start(at);
  queues.set(id, at + ab.duration);
}

let producer = null, consumer = null, iceServers = [];
let rtcMic = null;
let micSender = null;
let announced = false, appliedSig = '', subSerial = Promise.resolve(), lastPeople = [];
let turnTimer = null, recoveryTimer = null, recoveryAttempts = 0, rtcGen = 0;
let ringTo = '';
let dmRing = '';
const pendingReq = new Map();
const receiveMids = new Map();
const remotes = new Map();

function request(type, data = {}) {
  return new Promise((resolve, reject) => {
    const nonce = `rtc_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const timer = setTimeout(() => { pendingReq.delete(nonce); reject(new Error('rtc_timeout')); }, 20000);
    pendingReq.set(nonce, { resolve, reject, timer });
    if (!sendRaw({ type, nonce, ...data })) { clearTimeout(timer); pendingReq.delete(nonce); reject(new Error('offline')); }
  });
}
function settle(m, fail) {
  const p = pendingReq.get(m.nonce);
  if (!p) return false;
  clearTimeout(p.timer);
  pendingReq.delete(m.nonce);
  if (fail) p.reject(Object.assign(new Error(m.error || 'rtc_error'), { code: m.error }));
  else p.resolve(m);
  return true;
}
const waitIce = (pc, cap = 350) => new Promise(done => {
  if (pc.iceGatheringState === 'complete') return done();
  let t;
  const f = () => { if (pc.iceGatheringState === 'complete') finish(); };
  const finish = () => { clearTimeout(t); pc.removeEventListener('icegatheringstatechange', f); done(); };
  pc.addEventListener('icegatheringstatechange', f);
  t = setTimeout(finish, cap);
});
const newPc = () => new RTCPeerConnection({ iceServers, iceTransportPolicy: 'all', bundlePolicy: 'max-bundle' });
const DISABLED_MSG = 'Voice chat was disabled for your account by an administrator.';
const RTC_ERRORS = {
  insufficient_scope: 'Hyperfocus needs the Nookara Voice permission - log in again.', scope_disabled: DISABLED_MSG,
  not_allowed: "You can't join that call.", not_a_member: "You're not in that Bonfire server.", channel_full: 'That voice channel is full.',
  realtime_not_configured: "Bonfire voice isn't set up on the server.", rtc_timeout: "Bonfire voice didn't answer.", offline: "Couldn't reach Nookara.",
};
const rtcErrorText = e => RTC_ERRORS[e?.code || e?.message] || "Couldn't start voice.";

function setPeople(people) {
  lastPeople = Array.isArray(people) ? people : [];
  users.clear();
  for (const p of lastPeople) {
    const id = String(p.username || '').toLowerCase();
    if (id && !users.has(id)) users.set(id, { id, name: p.username, muted: false, deafened: false });
  }
  if (sessionId && !users.has(sessionId)) users.set(sessionId, { id: sessionId, name: myName, muted, deafened });
  for (const [cid, name] of calling) if (users.has(String(name).toLowerCase())) calling.delete(cid);
  emit(true);
}
async function subscribe(people) {
  if (!consumer || mode !== 'rtc' || !room) return;
  const mine = myName.toLowerCase(), unique = new Map();
  for (const p of people || []) {
    if (String(p.username).toLowerCase() === mine) continue;
    if (!(p.tracks || []).some(t => t.trackName === 'audio')) continue;
    const key = `${Number(p.userId)}:audio`;
    if (!unique.has(key)) unique.set(key, { userId: p.userId, username: p.username, trackName: 'audio' });
  }
  const sources = [...unique.values()], sig = [...unique.keys()].sort().join('|');
  if (sig === appliedSig) return;
  const out = await request('chat_rtc_subscribe', { room, sources });
  if (!out.sessionDescription) { appliedSig = sig; return; }
  for (const t of out.tracks || []) {
    if (t?.mid === undefined || t?.mid === null) continue;
    const s = sources.find(x => x.userId === t.userId && x.trackName === t.trackName) || t;
    receiveMids.set(String(t.mid), { userId: t.userId ?? s.userId, username: t.username || s.username, trackName: t.trackName || s.trackName });
  }
  await consumer.setRemoteDescription(out.sessionDescription);
  await consumer.setLocalDescription(await consumer.createAnswer());
  await waitIce(consumer);
  await request('chat_rtc_answer', { room, session: 'receive', sessionDescription: consumer.localDescription });
  appliedSig = sig;
}
function queueSubscribe(people) {
  const gen = rtcGen;
  subSerial = subSerial.catch(() => {}).then(() => subscribe(people)).catch(e => { if (gen === rtcGen && room && e?.message !== 'realtime_track_rejected') recoverSoon(); });
}
function addRemote(track, owner) {
  if (track.kind !== 'audio' || !ctx) return;
  const name = owner?.username || 'Someone';
  const stream = new MediaStream([track]);
  const el = new Audio();
  el.muted = true;
  el.srcObject = stream;
  el.play().catch(() => {});
  const src = ctx.createMediaStreamSource(stream);
  const an = ctx.createAnalyser();
  an.fftSize = 512;
  src.connect(an);
  src.connect(gainFor(name));
  remotes.set(track.id, { name, key: name.toLowerCase(), el, src, an, buf: new Float32Array(an.fftSize) });
  track.onended = () => dropRemote(track.id);
}
function dropRemote(id) {
  const r = remotes.get(id);
  if (!r) return;
  try { r.src.disconnect(); } catch {}
  r.el.pause();
  r.el.srcObject = null;
  remotes.delete(id);
}
function dropGoneRemotes(people) {
  const alive = new Set((people || []).filter(p => (p.tracks || []).some(t => t.trackName === 'audio')).map(p => String(p.username).toLowerCase()));
  for (const [id, r] of [...remotes]) if (!alive.has(r.key)) dropRemote(id);
  for (const [mid, s] of [...receiveMids]) if (!alive.has(String(s.username).toLowerCase())) receiveMids.delete(mid);
}
async function openRtcMic() {
  try { return await navigator.mediaDevices.getUserMedia(micConstraints(inputId)); }
  catch (e) { if (!inputId) throw e; inputId = ''; return navigator.mediaDevices.getUserMedia(micConstraints('')); }
}
function meterMic(stream) {
  const src = ctx.createMediaStreamSource(stream);
  const an = ctx.createAnalyser();
  an.fftSize = 512;
  src.connect(an);
  return { stream, track: stream.getAudioTracks()[0], src, an, buf: new Float32Array(an.fftSize) };
}
function applyMicEnabled() { if (rtcMic?.track) rtcMic.track.enabled = !muted && !deafened; }
function dropRtcMic() {
  if (!rtcMic) return;
  try { rtcMic.src.disconnect(); } catch {}
  rtcMic.stream.getTracks().forEach(t => t.stop());
  rtcMic = null;
  myLevel = 0;
}
async function swapRtcMic() {
  if (mode !== 'rtc' || !rtcMic) return;
  const fresh = await openRtcMic().catch(() => null);
  if (!fresh) return;
  if (mode !== 'rtc' || !rtcMic) { fresh.getTracks().forEach(t => t.stop()); return; }
  const old = rtcMic;
  rtcMic = meterMic(fresh);
  applyMicEnabled();
  if (micSender) await micSender.replaceTrack(rtcMic.track).catch(() => {});
  try { old.src.disconnect(); } catch {}
  old.stream.getTracks().forEach(t => t.stop());
}
async function publish(track) {
  const tr = producer.addTransceiver(track, { direction: 'sendonly' });
  micSender = tr.sender;
  await producer.setLocalDescription(await producer.createOffer());
  await waitIce(producer);
  const out = await request('chat_rtc_publish', { room, sessionDescription: producer.localDescription, tracks: [{ mid: tr.mid, trackName: 'audio' }] });
  await producer.setRemoteDescription(out.sessionDescription);
}
function rtcConnected() {
  if (mode !== 'rtc' || !room) return;
  if (status !== 'connected') { status = 'connected'; emit(true); }
  if (announced) return;
  announced = true;
  sendRaw({ type: 'chat_rtc_connected', room });
  if (ringTo) {
    if (sendRaw({ type: 'voice_call', to: ringTo, room })) { if (/^bfc_/.test(room)) dmRing = ringTo; ringTo = ''; }
  }
}
async function startRtc() {
  const gen = ++rtcGen, myRoom = room;
  const alive = () => gen === rtcGen && room === myRoom && mode === 'rtc';
  announced = false;
  appliedSig = '';
  subSerial = Promise.resolve();
  receiveMids.clear();
  const micReady = openRtcMic().then(stream => {
    if (!alive()) { stream.getTracks().forEach(t => t.stop()); return null; }
    rtcMic = meterMic(stream);
    applyMicEnabled();
    if (error === 'mic') { error = ''; emit(true); }
    return rtcMic.track;
  }, () => { if (alive()) { error = 'mic'; emit(true); } return null; });
  try {
    const joined = await request('chat_rtc_join', { room: myRoom });
    if (!alive()) return;
    iceServers = joined.iceServers || [];
    producer = newPc();
    consumer = newPc();
    const pc = producer, cc = consumer;
    cc.ontrack = e => { if (cc === consumer) addRemote(e.track, receiveMids.get(String(e.transceiver.mid))); };
    pc.onconnectionstatechange = () => {
      if (pc !== producer) return;
      if (pc.connectionState === 'connected') { recoveryAttempts = 0; rtcConnected(); }
      if (pc.connectionState === 'failed') recoverSoon();
    };
    cc.onconnectionstatechange = () => {
      if (cc !== consumer) return;
      if (cc.connectionState === 'connected') rtcConnected();
      if (cc.connectionState === 'failed') recoverSoon();
    };
    setPeople(joined.people);
    const firstSub = subscribe(lastPeople);
    subSerial = firstSub.catch(() => {});
    const [published] = await Promise.all([
      micReady.then(async track => { if (!track || !alive()) return false; await publish(track); return true; }),
      firstSub.catch(e => { if (alive() && e?.message !== 'realtime_track_rejected') recoverSoon(); }),
    ]);
    if (!alive()) return;
    if (!published) rtcConnected();
    clearInterval(turnTimer);
    turnTimer = setInterval(() => request('chat_rtc_ice', { room: myRoom }).then(x => {
      iceServers = x.iceServers || iceServers;
      producer?.setConfiguration({ iceServers });
      consumer?.setConfiguration({ iceServers });
    }).catch(() => {}), 3 * 60 * 60 * 1000);
  } catch (e) {
    if (alive()) leave(rtcErrorText(e));
  }
}
function teardownRtc() {
  rtcGen++;
  for (const [n, p] of pendingReq) { clearTimeout(p.timer); p.reject(new Error('left')); pendingReq.delete(n); }
  clearInterval(turnTimer);
  turnTimer = null;
  dropRtcMic();
  micSender = null;
  for (const id of [...remotes.keys()]) dropRemote(id);
  receiveMids.clear();
  try { producer?.close(); } catch {}
  try { consumer?.close(); } catch {}
  producer = consumer = null;
  lastPeople = [];
  appliedSig = '';
  announced = false;
}
function recoverSoon() {
  if (mode !== 'rtc' || !room || recoveryTimer) return;
  if (recoveryAttempts >= 2) { leave('The voice connection dropped.'); return; }
  recoveryTimer = setTimeout(() => {
    recoveryTimer = null;
    if (mode !== 'rtc' || !room) return;
    recoveryAttempts++;
    teardownRtc();
    users.clear();
    status = 'connecting';
    emit(true);
    startRtc();
  }, 1000);
}
function pollRtcLevels() {
  const rms = (an, buf) => { an.getFloatTimeDomainData(buf); let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]; return Math.sqrt(s / buf.length); };
  const now = Date.now();
  myLevel = rtcMic && !muted && !deafened ? Math.min(100, rms(rtcMic.an, rtcMic.buf) * SFU_LEVEL) : 0;
  const loudest = new Map();
  for (const r of remotes.values()) loudest.set(r.key, Math.max(loudest.get(r.key) || 0, Math.min(100, rms(r.an, r.buf) * SFU_LEVEL)));
  for (const [key, level] of loudest) {
    levels.set(key, { level, at: now });
    if (level >= SPEAKING_AT) heard.set(key, now);
  }
}

// ── Velora-level messages on our socket ──────────────────────────────────────
async function onVelora(m) {
  switch (m.type) {
    case 'auth_success':
      if (mode === 'rtc') startRtc();
      else sendRaw({ type: 'voice_connect' });
      break;
    case 'auth_error': leave('Log in to Nookara again to use voice chat.'); break;
    case 'error':
      if (m.required_scope === 16384) leave(m.error === 'scope_disabled' || m.disabled_by_admin ? DISABLED_MSG : 'Hyperfocus needs the Nookara Voice permission - log in again.');
      break;
    case 'chat_rtc_joined': case 'chat_rtc_published': case 'chat_rtc_offer': case 'chat_rtc_ready':
      settle(m);
      break;
    case 'chat_error':
      if (!String(m.request || '').startsWith('chat_rtc')) break;
      if (!settle(m, true) && (m.error === 'insufficient_scope' || m.error === 'scope_disabled')) leave(RTC_ERRORS[m.error]);
      break;
    case 'chat_rtc_room':
      if (mode === 'rtc' && m.room === room) { setPeople(m.people); dropGoneRemotes(m.people); queueSubscribe(m.people); }
      break;
    case 'chat_call_state':
      if (m.ended && m.room && m.room === room) leave();
      break;
    case 'voice_open':
      send({ type: 'join', room });
      send({ type: 'mute_state', muted, deafened });
      break;
    case 'voice_closed':
      if (mode === 'relay') leave(m.reason === 'scope_disabled' ? DISABLED_MSG : 'Disconnected from the voice server.');
      break;
    case 'voice': if (mode === 'relay') onVoice(m.msg || {}); break;
    case 'voice_call_ringing': hf.voiceCallEvent({ result: 'ringing', to: m.to }).catch(() => {}); break;
    case 'voice_call_answered': hf.voiceCallEvent({ result: m.accepted ? 'accepted' : 'declined', to: m.by }).catch(() => {}); break;
    case 'voice_call_failed': hf.voiceCallEvent({ result: m.reason, to: m.to }).catch(() => {}); break;
    case 'voice_call_ended':
      if (m.reason === 'no_answer' || m.reason === 'cancelled') hf.voiceCallEvent({ result: m.reason === 'no_answer' ? 'no answer' : 'cancelled', to: calling.get(m.callId) || '' }).catch(() => {});
      break;
  }
  if (m.type === 'voice_call_ringing') { calling.set(m.callId, m.to); emit(true); }
  if ((m.type === 'voice_call_answered' && !m.accepted) || m.type === 'voice_call_ended') { calling.delete(m.callId); emit(true); }
  const who = String(m.by || m.to || '').toLowerCase();
  if (dmRing && who === dmRing.toLowerCase() && ((m.type === 'voice_call_answered' && !m.accepted) || m.type === 'voice_call_failed')) {
    dmRing = '';
    if (mode === 'rtc' && /^bfc_/.test(String(room)) && users.size <= 1) leave();
  }
  if (m.type === 'voice_call_answered' && m.accepted && dmRing && who === dmRing.toLowerCase()) dmRing = '';
}
const calling = new Map();
function onMessage(e) {
  if (e.data instanceof ArrayBuffer) { playAudio(e.data); return; }
  let m;
  try { m = JSON.parse(e.data); } catch { return; }
  onVelora(m);
}
function onVoice(m) {
  switch (m.type) {
    case 'session':
      sessionId = m.id;
      break;
    case 'room_update': {
      users.clear();
      const list = Array.isArray(m.users) ? m.users : [];
      for (const u of list) if (!u.pending) users.set(u.id, { id: u.id, name: u.name, muted: u.muted, deafened: u.deafened });
      for (const [id, name] of calling) if (list.some(u => String(u.name).toLowerCase() === String(name).toLowerCase())) calling.delete(id);
      const me = list.find(u => u.id === sessionId);
      if (me) status = me.pending ? 'waiting' : 'connected';
      emit(true);
      break;
    }
    case 'mute_update': {
      const u = users.get(m.id);
      if (u) { u.muted = m.muted; u.deafened = m.deafened; emit(true); }
      break;
    }
    case 'awaiting_approval': status = 'waiting'; emit(true); break;
    case 'kicked': leave(m.reason === 'not_allowed' || m.reason === 'not_a_member' ? RTC_ERRORS[m.reason] : 'You were removed from the room.'); break;
    case 'party_ended': leave(m.reason || 'The call ended.'); break;
    case 'party_missing': leave("That room doesn't exist anymore."); break;
    case 'joined':
      status = 'connected';
      startMic();
      clearInterval(volTimer);
      volTimer = setInterval(() => {
        const level = muted || deafened ? 0 : myLevel;
        send({ type: 'volume', volume: Math.round(level * 10) / 10, speaking: level >= SPEAKING_AT });
      }, VOL_REPORT_MS);
      emit(true);
      break;
  }
}

async function join(r, name, ring) {
  leave();
  room = r;
  myName = name;
  mode = isRtcRoom(r) ? 'rtc' : 'relay';
  sessionId = mode === 'rtc' ? String(name).toLowerCase() : null;
  ringTo = mode === 'rtc' ? String(ring || '') : '';
  status = 'connecting';
  error = '';
  emit(true);
  await ensureCtx();
  const token = await hf.voiceToken().catch(() => null);
  if (room !== r) return;
  if (!token) { leave('Log in with Nookara to use voice chat.'); return; }
  const sock = new WebSocket(SERVER);
  ws = sock;
  sock.binaryType = 'arraybuffer';
  const timer = setTimeout(() => { if (ws === sock && status === 'connecting') leave(mode === 'rtc' ? "Couldn't connect to Bonfire voice." : "Couldn't reach Nookara Voice."); }, mode === 'rtc' ? 25000 : 12000);
  sock.onopen = () => {
    if (ws !== sock) return;
    sendRaw({ type: 'auth_token', token });
  };
  sock.onmessage = onMessage;
  sock.onclose = () => {
    clearTimeout(timer);
    if (ws !== sock) return;
    leave(status === 'connected' ? 'Disconnected from the voice server.' : "Couldn't reach the voice server.");
  };
}

function leave(reason) {
  const sock = ws;
  ws = null;
  if (sock) {
    try {
      if (sock.readyState === WebSocket.OPEN) {
        if (mode === 'rtc') sock.send(JSON.stringify({ type: 'chat_rtc_leave', room }));
        else {
          sock.send(JSON.stringify({ type: 'voice', msg: { type: 'leave' } }));
          sock.send(JSON.stringify({ type: 'voice_disconnect' }));
        }
      }
      sock.close();
    } catch {}
  }
  teardownRtc();
  clearTimeout(recoveryTimer);
  recoveryTimer = null;
  recoveryAttempts = 0;
  ringTo = '';
  dmRing = '';
  clearInterval(volTimer);
  volTimer = null;
  stopMic();
  users.clear();
  queues.clear();
  heard.clear();
  levels.clear();
  sessionId = null;
  calling.clear();
  const wasIn = !!room;
  room = null;
  mode = null;
  status = 'idle';
  error = reason || '';
  if (wasIn || reason) emit(true);
}

hf.on('voiceCmd', c => {
  switch (c?.op) {
    case 'join': join(String(c.room), String(c.name), c.ring ? String(c.ring) : ''); break;
    case 'leave': leave(); break;
    case 'call': {
      const to = String(c.to || '');
      if (mode === 'rtc' && room && !announced) { ringTo = to; break; }
      if (!room || status !== 'connected') { hf.voiceCallEvent({ result: 'not_in_voice', to }).catch(() => {}); break; }
      if (mode === 'rtc') { if (sendRaw({ type: 'voice_call', to, room }) && /^bfc_/.test(room)) dmRing = to; }
      else sendRaw({ type: 'voice_call', to });
      break;
    }
    case 'prefs':
      userPrefs = c.prefs && typeof c.prefs === 'object' ? c.prefs : {};
      applyPrefs();
      break;
    case 'sound': {
      const src = { start: '../assets/sounds/joinVC.mp3', join: '../assets/sounds/joinVC.mp3', leave: '../assets/sounds/leaveVC.mp3' }[c.name];
      if (src) { const a = new Audio(src); a.volume = 0.8; a.play().catch(() => {}); }
      break;
    }
    case 'devices': {
      const newIn = String(c.input || ''), newOut = String(c.output || '');
      outputId = newOut;
      applySink();
      if (newIn !== inputId) {
        inputId = newIn;
        if (mic) { stopMic(); startMic(); }
        if (rtcMic) swapRtcMic().catch(() => {});
      }
      break;
    }
    case 'mute':
      muted = typeof c.value === 'boolean' ? c.value : !muted;
      if (mode === 'relay') send({ type: 'mute_state', muted, deafened });
      applyMicEnabled();
      emit(true);
      break;
    case 'deafen':
      deafened = typeof c.value === 'boolean' ? c.value : !deafened;
      if (master) master.gain.value = deafened ? 0 : 1;
      if (mode === 'relay') send({ type: 'mute_state', muted, deafened });
      applyMicEnabled();
      emit(true);
      break;
  }
});
setInterval(() => { if (room) emit(); }, 150);
let levelsWereZero = true;
setInterval(() => {
  if (!room || status !== 'connected') return;
  if (mode === 'rtc') pollRtcLevels();
  const now = Date.now();
  const out = {};
  let any = false;
  for (const u of users.values()) {
    let lv = 0;
    if (u.id === sessionId) lv = muted || deafened ? 0 : myLevel;
    else { const l = levels.get(u.id); if (l && now - l.at < 200) lv = l.level; }
    out[u.id] = Math.round(lv * 10) / 10;
    if (lv >= SPEAKING_AT) any = true;
  }
  if (!any && levelsWereZero) return;
  levelsWereZero = !any;
  hf.voiceLevels(out).catch(() => {});
}, 60);
window.addEventListener('beforeunload', () => leave());
