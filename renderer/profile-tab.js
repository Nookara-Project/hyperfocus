'use strict';
/* global hf, ICONS, $, el, S, tab, setTab, toast, apps, libraryList, openGame, iconEl, safeColor, reduceMotion, mdBlocks,
   confirmBox, social, domReady, sGame, artOf, placeTabInk, closeMenus */

const PF_TTL = 60 * 1000;
const VELORA_SITE = 'https://nookara.cc';
const pf = {
  user: '',
  name: '',
  stack: [],
  cache: new Map(),
  loading: new Map(),
  errors: new Map(),
  key: '', keyName: '', shownTab: '', scrollTo: null,
  more: new Set(),
};
const vlAbs = u => (/^\/[^/]/.test(String(u || '')) ? VELORA_SITE + u : String(u || ''));
const httpsOnly = u => (/^https:\/\//i.test(String(u || '')) ? String(u) : '');
const nameColor = c => { const v = safeColor(c); return v && !/^#f{3}(f{3})?$/i.test(v) ? v : ''; };

function personPic(url, name, cls) {
  const letter = () => el('span', { class: `${cls} pic-letter`, text: String(name || '?')[0].toUpperCase() });
  if (!url) return letter();
  const img = el('img', { class: cls, src: url, alt: '', loading: 'lazy' });
  img.addEventListener('error', () => img.replaceWith(letter()), { once: true });
  return img;
}
function smallArt(url, cls, icon = 'controller') {
  const none = () => el('span', { class: `${cls} pic-none`, html: ICONS[icon] });
  if (!url) return none();
  const img = el('img', { class: cls, src: url, alt: '', loading: 'lazy' });
  img.addEventListener('error', () => img.replaceWith(none()), { once: true });
  return img;
}
function liveFriend(name) {
  const n = String(name || '').toLowerCase();
  return (social?.friends || []).find(f => String(f.username).toLowerCase() === n) || null;
}
function friendStatus(f) {
  const act = f?.activity;
  if (act) {
    const join = !!(act.joinable && act.joinCode);
    const verb = act.type === 'Game' || !act.type ? 'Playing' : 'Using';
    return { kind: 'playing', join, text: join ? `In joinable game · ${act.name || 'a game'}` : `${verb} ${act.name || 'something'}${act.state ? ` · ${act.state}` : ''}` };
  }
  return f?.online ? { kind: 'online', text: 'Online' } : { kind: 'offline', text: 'Offline' };
}
async function joinFriendNow(name, btn) {
  if (btn) btn.disabled = true;
  try {
    const r = await hf.joinFriend(name);
    if (r?.joined) toast(`Joining ${name}...`, 'ok');
  } catch (e) { toast(e.message || String(e), 'err'); }
  if (btn) setTimeout(() => { if (btn.isConnected) btn.disabled = false; }, 2500);
}
const iconBtn = (icon, label, props = {}) => el('button', { ...props, class: `pv-btn ${props.class || ''}`.trim() },
  el('span', { class: 'pv-bi', html: ICONS[icon] }), label ? el('span', { class: 'pv-bl', text: label }) : null);
function hrs(secs) {
  secs = Math.max(0, Number(secs) || 0);
  if (secs < 3600) return `${Math.max(1, Math.round(secs / 60))} min`;
  const h = secs / 3600;
  return `${h < 100 ? h.toFixed(1) : Math.round(h).toLocaleString()} hrs`;
}
const minsFor = since => { const s = Math.max(0, (Date.now() - Number(since)) / 1000); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h}h ${m}m` : `${Math.max(1, m)}m`; };

function loadProfile(name, force = false) {
  const k = name.toLowerCase();
  if (pf.loading.has(k)) return pf.loading.get(k);
  const hit = pf.cache.get(k);
  if (!force && hit && Date.now() - hit.at < PF_TTL) return Promise.resolve(hit.data);
  pf.errors.delete(k);
  const p = hf.profilePage(name).then(d => {
    pf.cache.set(k, { at: Date.now(), data: d });
    if (pf.cache.size > 40) pf.cache.delete(pf.cache.keys().next().value);
    return d;
  }, e => { pf.errors.set(k, e.message || String(e)); return null; })
    .finally(() => { pf.loading.delete(k); renderProfileTab(); });
  pf.loading.set(k, p);
  renderProfileTab();
  return p;
}
function profileReload() {
  const name = pf.name || S?.account?.username;
  if (!name) return;
  const had = pf.cache.has(name.toLowerCase());
  loadProfile(name, true).then(d => { if (d && had) toast('Profile refreshed.', 'ok'); else if (!d && had) toast(pf.errors.get(name.toLowerCase()) || "Couldn't refresh it.", 'err'); });
}

function openProfileTab(name) {
  name = String(name || '').trim();
  if (!name || !S?.account || S.offlineMode) return;
  const now = pf.name || S.account.username;
  if (tab === 'profile' && now.toLowerCase() === name.toLowerCase()) return;
  if (now.toLowerCase() !== name.toLowerCase()) {
    if (tab === 'profile') pf.stack.push({ name: pf.name, scroll: $('#pf-scroll').scrollTop });
    else pf.stack = name.toLowerCase() === S.account.username.toLowerCase() ? [] : [{ name: '', scroll: 0 }];
    pf.name = name.toLowerCase() === S.account.username.toLowerCase() ? '' : name;
    pf.scrollTo = 0;
  }
  if (tab !== 'profile') setTab('profile'); else renderProfileTab();
}
function profileHome() {
  closeMenus();
  pf.stack = [];
  pf.name = '';
  pf.scrollTo = 0;
  renderProfileTab();
}
function profileBack() {
  if (!pf.stack.length) return false;
  const p = pf.stack.pop();
  pf.name = p.name;
  pf.scrollTo = p.scroll;
  renderProfileTab();
  return true;
}
function profileCanGoBack() { return tab === 'profile' && pf.stack.length > 0; }
window.profileCanGoBack = profileCanGoBack;

$('#pf-back').innerHTML = ICONS.arrowLeft;
$('#pf-back').addEventListener('click', () => profileBack());
document.querySelector('#pf-top .sq-ico').innerHTML = ICONS.search;
$('#pf-refresh').innerHTML = ICONS.refresh;
$('#pf-refresh').addEventListener('click', () => profileReload());
$('#pf-q').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const v = e.target.value.trim().replace(/^@/, '');
    if (!v) return;
    e.target.value = '';
    e.target.blur();
    openProfileTab(v);
  } else if (e.key === 'Escape' && e.target.value) { e.stopPropagation(); e.target.value = ''; }
});

function pfSkeleton() {
  return [el('div', { class: 'pf-sk' },
    el('div', { class: 'sk pf-sk-banner' }),
    el('div', { class: 'pf-id' }, el('div', { class: 'pf-ava sk' }),
      el('div', { class: 'pf-idt' }, el('div', { class: 'sk pf-sk-l1' }), el('div', { class: 'sk pf-sk-l2' }))),
    el('div', { class: 'pf-body' },
      el('div', { class: 'pf-main' }, el('div', { class: 'sk pf-sk-box' }), el('div', { class: 'sk pf-sk-box tall' })),
      el('div', { class: 'pf-side' }, el('div', { class: 'sk pf-sk-box' }), el('div', { class: 'sk pf-sk-box' }))))];
}
function pfEmpty(title, text, ...acts) {
  acts = acts.filter(Boolean);
  return el('div', { class: 'st-empty pf-empty' }, el('img', { src: '../assets/hyperfocus.png', alt: '' }), el('b', { text: title }), el('span', { text }),
    acts.length ? el('div', { class: 'pf-empty-acts' }, ...acts) : null);
}
const backOrHome = () => (pf.stack.length
  ? el('button', { class: 'btn ghost', text: 'Go back', onclick: () => profileBack() })
  : null);

function pfHead(d, pres, acts) {
  const u = d.user;
  const color = nameColor(u.color);
  const banner = httpsOnly(u.banner_url);
  const ban = el('div', { class: 'pf-banner', style: color ? `--pc:${color}` : null });
  if (banner) {
    const img = el('img', { src: banner, alt: '' });
    img.addEventListener('error', () => img.replaceWith(el('span', { class: 'pf-stars' })), { once: true });
    ban.append(img);
  } else ban.append(el('span', { class: 'pf-stars' }));
  const country = /^[A-Za-z]{2}$/.test(u.country_code || '') ? u.country_code.toLowerCase() : '';
  let countryName = country.toUpperCase();
  try { countryName = new Intl.DisplayNames(['en'], { type: 'region' }).of(country.toUpperCase()) || countryName; } catch {  }
  const flag = country ? el('img', { class: 'pf-flag', src: `${VELORA_SITE}/assets/flags/${country}.png`, alt: '' }) : null;
  flag?.addEventListener('error', () => flag.remove(), { once: true });
  const badges = (d.badges || u.badges || []).filter(b => b && b.name);
  const staff = ['mod', 'admin', 'owner'].includes(String(u.rank || '').toLowerCase());
  const subs = [
    u.pronouns && !u.private ? el('span', { class: 'pf-pron', text: u.pronouns }) : null,
    staff && !u.private ? el('span', { class: 'tg off', text: u.rank }) : null,
    country && !u.private ? el('span', { class: 'pf-country' }, flag, countryName) : null,
  ].filter(Boolean);
  return [ban,
    el('div', { class: 'pf-id' },
      el('div', { class: `pf-ava st-${pres.kind}`, title: pres.kind === 'playing' ? 'In-game' : pres.kind === 'online' ? 'Online' : 'Offline' },
        personPic(httpsOnly(u.pfp_url), u.username, 'pf-pic')),
      el('div', { class: 'pf-idt' },
        el('div', { class: 'pf-name', text: u.username, style: color ? `color:${color}` : null }),
        subs.length ? el('div', { class: 'pf-sub' }, ...subs) : null,
        badges.length ? el('div', { class: 'pf-badges' }, ...badges.slice(0, 24).map(b => {
          const tip = `${b.name}${b.description ? ` - ${b.description}` : ''}${b.granted_at ? `\nEarned ${new Date(b.granted_at).toLocaleDateString()}` : ''}`;
          const src = vlAbs(b.icon_url);
          const ic = src ? el('img', { src, alt: '' }) : el('span', { class: 'pf-bdg-none', html: ICONS.trophy });
          if (src) ic.addEventListener('error', () => ic.replaceWith(el('span', { class: 'pf-bdg-none', html: ICONS.trophy })), { once: true });
          return el('span', { class: 'pf-bdg', title: tip, tabindex: '0' }, ic);
        })) : null),
      el('div', { class: 'pf-acts' }, ...acts)),
  ];
}

// who they are to you: Edit profile / Message, Add friend, Join game... + View on Nookara
function pfActions(d, pres) {
  const u = d.user;
  const web = iconBtn('external', '', { class: 'ghost ic', title: 'View on Nookara', onclick: () => hf.openUrl(`${VELORA_SITE}/u/${encodeURIComponent(u.username)}`) });
  if (d.me) {
    return [iconBtn('edit', 'Edit profile', { class: 'primary', onclick: () => hf.openUrl(`${VELORA_SITE}/me#profile`) }),
      iconBtn('external', 'View on Nookara', { class: 'ghost', onclick: () => hf.openUrl(`${VELORA_SITE}/u/${encodeURIComponent(u.username)}`) })];
  }
  const changed = () => { pf.cache.delete(u.username.toLowerCase()); loadProfile(u.username, true); };
  const act = fn => async e => {
    const b = e.currentTarget;
    b.disabled = true;
    try { await fn(); } catch (err) { if (!err.quiet) toast(err.message || String(err), 'err'); b.disabled = false; }
  };
  const out = [];
  if (pres.joinable) out.push(iconBtn('logIn', 'Join game', { class: 'primary', title: `Join ${u.username} in ${pres.gameName || 'their game'}`, onclick: e => joinFriendNow(u.username, e.currentTarget) }));
  if (!d.loggedIn) return [...out, web];
  if (d.needsRelogin) return [...out, iconBtn('veloraLogo', 'Log in again to add friends', { class: 'ghost', onclick: () => hf.login().catch(() => {}) }), web];
  const st = d.friendStatus;
  if (st === 'friends') {
    out.push(iconBtn('messageSquare', 'Message', { class: pres.joinable ? 'ghost' : 'primary', onclick: () => hf.openChat(u.username) }));
    out.push(iconBtn('userCheck', '', {
      class: 'ghost ic on', title: `Friends - click to remove ${u.username}`,
      onclick: act(async () => {
        if (!await confirmBox('Remove friend', `Remove ${u.username} from your friends?`, 'Remove', true)) throw Object.assign(new Error(''), { quiet: true });
        await hf.removeFriend(u.username);
        toast(`Removed ${u.username}.`);
        changed();
      }),
    }));
  } else if (st === 'pending_outgoing') {
    out.push(iconBtn('clock', 'Request sent', { class: 'ghost', disabled: true }));
  } else if (st === 'pending_incoming') {
    out.push(iconBtn('userPlus', 'Accept request', { class: 'primary', onclick: act(async () => { await hf.addFriend(u.username); toast(`You're friends with ${u.username} now!`, 'ok'); changed(); }) }));
    if (d.requestId != null) out.push(iconBtn('close', 'Decline', { class: 'ghost', onclick: act(async () => { await hf.declineFriend(d.requestId); changed(); }) }));
  } else {
    out.push(iconBtn('userPlus', 'Add friend', {
      class: 'primary', onclick: act(async () => {
        const r = await hf.addFriend(u.username);
        toast(r === 'accepted' ? `You're friends with ${u.username} now!` : 'Friend request sent!', 'ok');
        changed();
      }),
    }));
  }
  return [...out, web];
}

function pfPresence(d) {
  const u = d.user, hp = d.hyperfocus || {};
  if (d.me) {
    const id = S.currentGame && S.running.includes(S.currentGame) ? S.currentGame : S.running[0];
    const a = id && apps().find(x => x.id === id);
    const playing = a ? { id: a.id, name: a.name || a.id, icon: a.icon || '', type: a.type, since: S.playtime?.sessions?.[a.id]?.start || null, state: '' } : null;
    return { kind: playing ? 'playing' : 'online', playing, joinable: false };
  }
  const live = liveFriend(u.username);
  const act = live?.activity || null;
  let playing = hp.playing || null;
  if (!playing && act) playing = { id: act.appId, name: act.name, icon: act.icon, type: act.type, state: act.state || '', since: null };
  const joinable = !!((act?.joinable && act.joinCode) || (hp.playing?.joinable && hp.playing.joinCode));
  const online = live ? live.online : ['online', 'idle', 'dnd'].includes(String(u.status || ''));
  return { kind: playing ? 'playing' : online ? 'online' : 'offline', playing, joinable, gameName: playing?.name || '' };
}

const sideBox = (icon, title, count, cls, ...body) => el('section', { class: `gv-box ${cls || ''}`.trim() },
  el('div', { class: 'box-h gv-bh' }, el('span', { class: 'bh-ico', html: ICONS[icon] }), el('span', { class: 'grow', text: title }),
    count != null ? el('span', { class: 'gv-bn', text: String(count) }) : null), ...body);

function pfStatusBox(d, pres) {
  const u = d.user;
  const title = { playing: 'Currently in-game', online: 'Currently online', offline: 'Currently offline' }[pres.kind];
  const body = [];
  const p = pres.playing;
  if (p) {
    const verb = p.type === 'App' ? 'Using' : 'Playing';
    body.push(el('button', { class: 'pf-now', title: `Open ${p.name}`, onclick: () => p.id && openGame(p.id) },
      smallArt(httpsOnly(p.icon), 'pf-now-ico'),
      el('span', { class: 'pf-now-t' },
        el('span', { class: 'pf-now-k', text: pres.joinable ? 'In joinable game' : verb }),
        el('b', { text: p.name || 'a game' }),
        p.state ? el('span', { class: 'pf-now-s', text: p.state }) : null,
        p.since ? el('span', { class: 'pf-now-s', text: `for ${minsFor(p.since)}` }) : null)));
    if (pres.joinable) body.push(el('div', { class: 'pf-now-acts' }, iconBtn('logIn', 'Join game', { class: 'primary wide', onclick: e => joinFriendNow(u.username, e.currentTarget) })));
  }
  const others = (Array.isArray(u.activities) ? u.activities : []).filter(a => a && a.name && !(p && String(a.name) === String(p.name))).slice(0, 3);
  const VERB = { playing: 'Playing', listening: 'Listening to', watching: 'Watching', competing: 'Competing in', streaming: 'Streaming' };
  for (const a of others) {
    body.push(el('div', { class: 'pf-act' }, smallArt(httpsOnly(a.image || a.icon), 'pf-act-ico', a.type === 'listening' ? 'music' : 'controller'),
      el('span', { class: 'pf-act-t' }, el('span', { class: 'pf-now-k', text: `${VERB[a.type] || 'Playing'}${a.app ? ` · ${a.app}` : ''}` }),
        el('b', { text: a.name }), a.details || a.state ? el('span', { class: 'pf-now-s', text: [a.details, a.state].filter(Boolean).join(' · ') }) : null)));
  }
  if (!body.length) body.push(el('div', { class: 'pf-quiet', text: pres.kind === 'offline' ? `${d.me ? "You're" : `${u.username} is`} offline right now.` : d.me ? "You're not playing anything right now." : 'Not playing anything right now.' }));
  return sideBox(pres.kind === 'playing' ? 'controller' : 'activity', title, null, `pf-status st-${pres.kind}`, el('div', { class: 'pf-status-in' }, ...body));
}

function pfFacts(d, lib, games) {
  const u = d.user, hp = d.hyperfocus || {};
  const total = games.reduce((s, g) => s + (Number(g.seconds) || 0), 0);
  const rows = [];
  const row = (icon, k, v, cls = '') => rows.push(el('div', { class: 'sf-k' }, el('span', { html: ICONS[icon] }), k), el('div', { class: `sf-v ${cls}`.trim(), text: v }));
  row('clock', 'Hours played', total >= 60 ? hrs(total) : 'none yet', total >= 60 ? '' : 'muted');
  row('library', 'Games', String(lib.length));
  if (Array.isArray(hp.achievements)) row('trophy', 'Achievements', String(hp.achievements.length));
  const joined = u.created_at ? new Date(u.created_at) : null;
  if (joined && !Number.isNaN(joined.valueOf())) row('calendar', 'Member since', joined.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }));
  if (typeof u.tz_offset_min === 'number') {
    const time = new Date(Date.now() + u.tz_offset_min * 60000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
    const diff = u.tz_offset_min + new Date().getTimezoneOffset();
    const h = Math.abs(diff) / 60;
    const rel = d.me || diff === 0 ? '' : ` (${Number.isInteger(h) ? h : h.toFixed(1)}h ${diff > 0 ? 'ahead' : 'behind'})`;
    row('globe', 'Local time', `${time}${rel}`);
  }
  return el('div', { class: 'sp-facts pf-facts' }, ...rows);
}

function pfAbout(d) {
  const u = d.user;
  const links = [];
  if (/^https?:\/\//i.test(u.website || '')) {
    let host = u.website;
    try { host = new URL(u.website).hostname.replace(/^www\./, ''); } catch {  }
    links.push(['website', host, u.website]);
  }
  const PN = { github: 'GitHub', discord: 'Discord', fluxer: 'Fluxer', spotify: 'Spotify' };
  for (const c of Array.isArray(u.connections) ? u.connections : []) if (c && /^https:\/\//i.test(c.url || '')) links.push([c.provider, c.name || PN[c.provider] || c.provider, c.url]);
  if (!u.bio && !links.length && !d.me) return null;
  return el('section', { class: 'pf-sec' },
    el('div', { class: 'gv-h' }, el('span', { class: 'gv-ht', text: 'About' })),
    el('div', { class: 'pf-about' },
      u.bio ? el('div', { class: 'pf-bio md' }, mdBlocks(u.bio)) : el('div', { class: 'pf-bio muted' }, "You haven't written a bio yet. ",
        el('a', { href: '#', text: 'Add one on Nookara', onclick: e => { e.preventDefault(); hf.openUrl(`${VELORA_SITE}/me#profile`); } })),
      links.length ? el('div', { class: 'pf-links' }, ...links.map(([kind, text, url]) => el('button', { class: 'pf-link', title: url, onclick: () => hf.openUrl(url) },
        el('span', { class: 'pf-link-i', html: ICONS.social[kind] || ICONS.social.link }), el('span', { class: 'pf-link-t', text })))) : null));
}

function gameArt(g) {
  const ok = v => (/^(https:|file:|data:image\/)/i.test(String(v || '')) ? String(v) : '');
  const a = apps().find(x => x.id === g.id);
  const sg = typeof sGame === 'function' ? sGame(g.id) : null;
  return ok(a?.card) || ok(a?.background) || (sg && typeof artOf === 'function' ? ok(artOf(sg)) : '');
}
function artBox(g, cls) {
  const src = gameArt(g);
  const box = el('span', { class: cls });
  const none = () => el('span', { class: 'art-none' });
  if (!src) { box.append(none()); return box; }
  const img = el('img', { src, alt: '', loading: 'lazy' });
  img.addEventListener('error', () => img.replaceWith(none()), { once: true });
  box.append(img);
  return box;
}
const yours = id => libraryList().some(a => a.id === id);

function pfPlayed(d, games, pres) {
  if (!games.length) return null;
  const key = `${d.user.username.toLowerCase()}:played`;
  const all = pf.more.has(key);
  const playingId = pres.playing?.id;
  const list = games.slice().sort((a, b) => ((b.id === playingId) - (a.id === playingId)) || (b.seconds - a.seconds));
  const shown = all ? list : list.slice(0, 3);
  const total = games.reduce((s, g) => s + (Number(g.seconds) || 0), 0);
  const rows = shown.map((g, i) => {
    const ach = g.ach && g.ach.total ? g.ach : null;
    const got = ach ? ach.list.filter(x => x.unlocked).sort((x, y) => (y.unlockedAt || 0) - (x.unlockedAt || 0)) : [];
    const now = g.id === playingId;
    return el('button', { class: `pf-rg${now ? ' now' : ''}`, style: `animation-delay:${Math.min(i, 8) * 40}ms`, title: `Open ${g.name}`, onclick: () => openGame(g.id) },
      artBox(g, 'pf-rg-art'),
      el('span', { class: 'pf-rg-t' },
        el('span', { class: 'pf-rg-top' },
          el('span', { class: 'pf-rg-ico' }, smallArt(httpsOnly(g.icon), 'pf-rg-icoi')),
          el('span', { class: 'pf-rg-n' }, el('b', { text: g.name }),
            el('span', { class: 'pf-rg-h', text: now ? `${g.type === 'App' ? 'Using' : 'Playing'} now${g.seconds >= 60 ? ` · ${hrs(g.seconds)} on record` : ''}` : g.seconds >= 60 ? `${hrs(g.seconds)} on record` : 'No playtime yet' })),
          yours(g.id) || d.me ? null : el('span', { class: 'pf-rg-get', text: 'View in store' })),
        ach ? el('span', { class: `pf-ach${ach.unlocked === ach.total ? ' perfect' : ''}` },
          el('span', { class: 'pf-ach-k' }, el('span', { text: 'Achievement progress' }), el('b', { text: `${ach.unlocked} of ${ach.total}` })),
          el('i', { class: 'aw-bar' }, el('i', { style: `width:${Math.round(ach.unlocked / ach.total * 100)}%` })),
          got.length ? el('span', { class: 'pf-ach-ics' }, ...got.slice(0, 7).map(x => el('span', { class: `pf-ach-i${x.rarity === 'rare' ? ' rare' : ''}`, title: `${x.name}${x.description ? ` - ${x.description}` : ''}` }, smallArt(httpsOnly(x.icon), 'pf-ach-ii', 'trophy'))),
            got.length > 7 ? el('span', { class: 'pf-ach-i more', text: `+${got.length - 7}` }) : null) : null) : null));
  });
  return el('section', { class: 'pf-sec' },
    el('div', { class: 'gv-h' }, el('span', { class: 'gv-ht', text: 'Most played' }), el('span', { class: 'grow' }),
      total >= 60 ? el('span', { class: 'pf-h-r', text: `${hrs(total)} on record` }) : null),
    el('div', { class: 'pf-rgs' }, ...rows),
    list.length > 3 ? el('button', { class: 'aw-more pf-more', onclick: () => { if (all) pf.more.delete(key); else pf.more.add(key); renderProfileTab(true); } },
      el('span', { text: all ? 'Show less' : `Show all ${list.length} played` }), el('span', { class: `aw-chev${all ? ' up' : ''}`, html: ICONS.right })) : null);
}

function pfLibrary(d, lib) {
  const key = `${d.user.username.toLowerCase()}:games`;
  const all = pf.more.has(key);
  const PAGE = 12;
  const shown = all ? lib : lib.slice(0, PAGE);
  const body = lib.length ? el('div', { class: 'pf-grid' }, ...shown.map((g, i) => {
    const mine = !d.me && yours(g.id);
    return el('button', { class: 'pf-tile', style: `animation-delay:${Math.min(i, 12) * 30}ms`, title: g.name, onclick: () => openGame(g.id) },
      el('span', { class: 'pf-tart' }, artBox(g, 'pf-tart-in'),
        el('span', { class: 'sc-tags' }, el('span'),
          g.owned ? el('span', { class: 'sc-own' }, el('span', { html: ICONS.check }), 'owned')
            : mine ? el('span', { class: 'sc-own wish' }, el('span', { html: ICONS.library }), 'yours too') : null)),
      el('span', { class: 'pf-tbody' },
        el('span', { class: 'pf-tico' }, smallArt(httpsOnly(g.icon), 'pf-ticoi')),
        el('span', { class: 'pf-tt' }, el('span', { class: 'pf-tn', text: g.name }),
          el('span', { class: 'pf-tp', text: g.seconds >= 60 ? `${hrs(g.seconds)} played` : g.type === 'App' ? 'Not used yet' : 'Not played yet' }))));
  })) : el('div', { class: 'board-empty pf-none' }, el('span', { class: 'be-ico', html: ICONS.library }),
    el('b', { text: d.me ? 'Your library is empty' : 'No games yet' }),
    el('span', { text: d.me ? 'Games you add from the store show up here - and on your Nookara profile.' : `${d.user.username} hasn't added any Hyperfocus games yet.` }),
    d.me ? el('button', { class: 'btn pf-none-go', onclick: () => setTab('store') }, el('span', { class: 'btn-ico', html: ICONS.store }), el('span', { text: 'Browse the store' })) : null);
  return el('section', { class: 'pf-sec' },
    el('div', { class: 'gv-h' }, el('span', { class: 'gv-ht', text: 'Games' }), el('span', { class: 'pf-h-n', text: String(lib.length) })),
    body,
    lib.length > PAGE ? el('button', { class: 'aw-more pf-more', onclick: () => { if (all) pf.more.delete(key); else pf.more.add(key); renderProfileTab(true); } },
      el('span', { text: all ? 'Show less' : `Show all ${lib.length} games` }), el('span', { class: `aw-chev${all ? ' up' : ''}`, html: ICONS.right })) : null);
}

function pfFriends(d) {
  const u = d.user;
  let list = Array.isArray(u.friends) ? u.friends : null;
  let count = list ? Number(u.friends_count ?? list.length) || list.length : 0;
  if (!list && d.me && !u.friends_hidden && social?.friends) {
    list = social.friends.map(f => ({ username: f.username, pfp_url: f.pfp, color: f.color }));
    count = list.length;
  }
  if (!list) {
    if (!u.friends_hidden) return null;
    return sideBox('users', 'Friends', null, 'pf-friends', el('div', { class: 'pf-quiet' }, el('span', { class: 'pf-q-ico', html: ICONS.lock }), `${u.username} keeps their friends list private.`));
  }
  const key = `${u.username.toLowerCase()}:friends`;
  const all = pf.more.has(key);
  const rank = f => { const live = liveFriend(f.username); return !live ? 3 : live.activity ? 0 : live.online ? 1 : 2; };
  const sorted = list.map((f, i) => [f, i]).sort((x, y) => (rank(x[0]) - rank(y[0])) || (x[1] - y[1])).map(x => x[0]);
  const shown = all ? sorted : sorted.slice(0, 8);
  const rows = shown.map(f => {
    const live = liveFriend(f.username);
    const st = live ? friendStatus(live) : null;
    const color = nameColor(f.color);
    return el('button', { class: `pf-fr${st ? ` st-${st.kind}` : ''}`, title: `${f.username}'s profile`, onclick: () => openProfileTab(f.username) },
      personPic(httpsOnly(f.pfp_url), f.username, 'pf-fr-pic'),
      el('span', { class: 'pf-fr-t' }, el('b', { text: f.username, style: color ? `color:${color}` : null }),
        st ? el('span', { class: `pf-fr-s ${st.kind}`, text: st.text }) : null));
  });
  const note = u.friends_hidden && d.me ? el('div', { class: 'pf-note' }, el('span', { class: 'pf-q-ico', html: ICONS.eyeOff }),
    el('span', {}, 'Only you can see your friends - change it in your ',
      el('a', { href: '#', text: 'profile settings', onclick: e => { e.preventDefault(); hf.openUrl(`${VELORA_SITE}/me#profile`); } }), '.')) : null;
  return sideBox('users', 'Friends', count, 'pf-friends',
    note,
    rows.length ? el('div', { class: 'pf-frs' }, ...rows) : el('div', { class: 'pf-quiet', text: d.me ? 'No friends yet - add people from the Friends tab.' : 'No friends yet.' }),
    count > list.length && all ? el('div', { class: 'pf-quiet small', text: `Showing ${list.length} of ${count}.` }) : null,
    sorted.length > 8 ? el('button', { class: 'aw-more', onclick: () => { if (all) pf.more.delete(key); else pf.more.add(key); renderProfileTab(true); } },
      el('span', { text: all ? 'Show less' : `Show all ${count}` }), el('span', { class: `aw-chev${all ? ' up' : ''}`, html: ICONS.right })) : null);
}

function pfPrivate(d, pres) {
  const u = d.user;
  return [...pfHead(d, { ...pres, kind: 'offline' }, pfActions(d, { ...pres, joinable: false })),
    el('div', { class: 'pf-body one' },
      el('div', { class: 'board-empty pf-private' }, el('span', { class: 'be-ico', html: ICONS.lock }),
        el('b', { text: 'This profile is private' }),
        el('span', { text: `Only ${u.username}'s friends can see their profile, games and friends.` })))];
}

function pfPage(d) {
  const u = d.user, hp = d.hyperfocus || {};
  if (u.private) return pfPrivate(d, pfPresence(d));
  const pres = pfPresence(d);
  const games = Array.isArray(hp.games) ? hp.games.filter(g => g && g.id) : [];
  const lib = (Array.isArray(hp.library) ? hp.library : games.filter(g => Number(g.seconds) > 0)).filter(g => g && g.id);
  const played = games.filter(g => Number(g.seconds) > 0 || g.ach?.unlocked);
  return [...pfHead(d, pres, pfActions(d, pres)),
    el('div', { class: 'pf-body' },
      el('div', { class: 'pf-main' }, pfAbout(d), pfPlayed(d, played, pres), pfLibrary(d, lib)),
      el('aside', { class: 'pf-side' }, pfStatusBox(d, pres), pfFacts(d, lib, games), pfFriends(d)))];
}

// ── draw ─────────────────────────────────────────────────────────────────────
// (redraws only when something it shows changed: the data, your friends' presence, your library, the open lists)
function renderProfileTab(force) {
  if (!S || !domReady) return;
  const me = S.account?.username || '';
  if (me !== pf.user) {
    Object.assign(pf, { user: me, name: '', stack: [], key: '', keyName: '', scrollTo: 0 });
    pf.cache.clear(); pf.errors.clear(); pf.more.clear();
  }
  const opened = tab === 'profile' && pf.shownTab !== 'profile';
  pf.shownTab = tab;
  if (tab !== 'profile' || !me || S.offlineMode) return;
  const name = pf.name || me;
  const k = name.toLowerCase();
  const hit = pf.cache.get(k);
  if (!pf.loading.has(k) && !pf.errors.has(k) && (!hit || (opened && Date.now() - hit.at > PF_TTL))) loadProfile(name);
  $('#pf-back').hidden = !pf.stack.length;
  const d = pf.cache.get(k)?.data || null;
  $('#pf-crumb').replaceChildren(el('span', { class: 'pf-crumb-k', text: pf.name ? 'Profile' : 'Your profile' }),
    ...(pf.name ? [el('b', { text: d?.user?.username || pf.name })] : []));
  const live = (social?.friends || []).map(f => [f.username, f.online, f.activity?.appId, f.activity?.state, !!f.activity?.joinable]);
  const key = JSON.stringify([k, pf.cache.get(k)?.at || 0, pf.loading.has(k) && !d, pf.errors.get(k) || '', live, libraryList().map(a => a.id).join(),
    S.running, [...pf.more].join()]);
  if (!force && key === pf.key) return;
  pf.key = key;
  const scroll = $('#pf-scroll');
  const sameName = pf.keyName === k;
  const keep = pf.scrollTo == null && sameName ? scroll.scrollTop : null;
  pf.keyName = k;
  let nodes;
  if (!d) {
    if (pf.loading.has(k)) nodes = pfSkeleton();
    else nodes = [pfEmpty("Couldn't load this profile", pf.errors.get(k) || 'Something went wrong.',
      el('button', { class: 'btn', text: 'Try again', onclick: () => loadProfile(name, true) }), backOrHome())];
  } else if (d.notFound) {
    nodes = [pfEmpty('No such Nookara user', `Nobody on Nookara is called "${d.name}".`, backOrHome())];
  } else nodes = pfPage(d);
  const view = $('#pf-view');
  view.replaceChildren(...nodes.filter(Boolean));
  if (!sameName && !reduceMotion()) { view.classList.remove('pf-anim'); void view.offsetWidth; view.classList.add('pf-anim'); }
  scroll.scrollTop = pf.scrollTo ?? keep ?? 0;
  pf.scrollTo = null;
}

let meTabKey = '';
function renderMeTab() {
  const btn = document.querySelector('.mtab[data-tab="profile"]');
  if (!btn) return;
  const acc = S?.account;
  const key = JSON.stringify([acc?.username, acc?.pfp]);
  if (key === meTabKey) return;
  meTabKey = key;
  btn.title = acc ? `${acc.username} - your profile` : '';
  btn.replaceChildren(...(acc ? [personPic(httpsOnly(acc.pfp), acc.username, 'mt-pfp'), el('span', { class: 'mt-uname', text: acc.username })] : []));
  requestAnimationFrame(() => placeTabInk());
}
