'use strict';
/* global hf, ICONS, $, el, S, tab, toast, social, domReady, reduceMotion, fillMenu, dropMenu, closeMenus, confirmBox,
   personPic, smallArt, friendStatus, joinFriendNow, iconBtn, nameColor, openProfileTab, startLogin */

const fv = { user: '', q: '', filter: 'all', key: '', reqs: null, reqCount: -1, reqBusy: false, shownTab: '', invite: null };
const FV_FILTERS = [['all', 'All'], ['online', 'Online'], ['playing', 'In game']];

const fvFriends = () => (Array.isArray(social?.friends) ? social.friends : []);
const isOn = f => !!(f.online || f.activity);
function renderFriendsChip() {
  const n = fvFriends().filter(isOn).length;
  const chip = document.querySelector('.mtab[data-tab="friends"] .mt-n');
  if (!chip) return;
  if (!chip.firstChild) chip.innerHTML = ICONS.users;
  chip.classList.toggle('some', n > 0);
  chip.title = `${n} ${n === 1 ? 'friend' : 'friends'} online`;
}

function loadRequests() {
  if (fv.reqBusy || !S?.account || !social?.loggedIn || social.needsRelogin) return;
  fv.reqBusy = true;
  hf.friendRequests().then(r => { fv.reqs = r; }, () => { fv.reqs = fv.reqs || { incoming: [], outgoing: [] }; })
    .finally(() => { fv.reqBusy = false; renderFriendsTab(); });
}

document.querySelector('#fv-top .sq-ico').innerHTML = ICONS.search;
$('#fv-q').addEventListener('input', e => { fv.q = e.target.value; renderFriendsTab(); });
$('#fv-q').addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !e.target.value) return;
  e.stopPropagation();
  e.target.value = fv.q = '';
  renderFriendsTab();
});
function renderFvChips() {
  const all = fvFriends();
  const counts = { all: all.length, online: all.filter(isOn).length, playing: all.filter(f => f.activity).length };
  $('#fv-chips').replaceChildren(...FV_FILTERS.map(([id, label]) => el('button', {
    class: `chip${fv.filter === id ? ' on' : ''}`, onclick: () => { if (fv.filter !== id) { fv.filter = id; renderFriendsTab(); } },
  }, label, el('span', { class: 'n', text: String(counts[id]) }))));
}

function fvMenu(btn, f) {
  const m = $('#people-menu');
  const wasOpen = !m.hidden && m.dataset.for === f.username;
  closeMenus();
  if (wasOpen) return;
  m.dataset.for = f.username;
  fillMenu(m, [
    { label: 'View profile', icon: 'user', run: () => openProfileTab(f.username) },
    { label: 'View on Nookara', icon: 'external', run: () => hf.openUrl(`https://nookara.cc/u/${encodeURIComponent(f.username)}`) },
    '-',
    { label: 'Remove friend', icon: 'trash', danger: true, run: async () => {
      if (!await confirmBox('Remove friend', `Remove ${f.username} from your friends?`, 'Remove', true)) return;
      try { await hf.removeFriend(f.username); toast(`Removed ${f.username}.`); } catch (e) { toast(e.message, 'err'); }
    } },
  ]);
  dropMenu(m, btn);
}
document.addEventListener('scroll', e => { if (e.target?.id === 'fv-scroll' && !$('#people-menu').hidden) closeMenus(); }, { capture: true, passive: true });

async function fvInvite(name, btn) {
  btn.disabled = true;
  const label = btn.querySelector('.pv-bl');
  try { await hf.inviteSend(name); if (label) label.textContent = 'Sent!'; } catch (e) { toast(e.message, 'err'); }
  setTimeout(() => { if (btn.isConnected) { btn.disabled = false; if (label) label.textContent = 'Invite'; } }, 3000);
}
hf.on('gameInvite', v => { fv.invite = v || null; renderFriendsTab(); });
hf.inviteState().then(v => { fv.invite = v || null; renderFriendsTab(); }).catch(() => {});

function fvRow(f, i) {
  const st = friendStatus(f);
  const color = nameColor(f.color);
  const act = f.activity;
  return el('div', {
    class: `fv-row st-${st.kind}${st.join ? ' join' : ''}`, style: i < 14 ? `animation-delay:${i * 22}ms` : null,
    title: `${f.username}'s profile`, onclick: e => { if (!e.target.closest('button')) openProfileTab(f.username); },
  },
  el('span', { class: 'fv-ava' }, personPic(/^https:\/\//i.test(f.pfp || '') ? f.pfp : '', f.username, 'fv-pic')),
  el('span', { class: 'fv-t' },
    el('b', { text: f.username, style: color ? `color:${color}` : null }),
    el('span', { class: `fv-s ${st.kind}` }, st.join ? el('span', { class: 'fv-jt', text: 'joinable' }) : null, el('span', { class: 'fv-st', text: st.text }))),
  act && /^https:\/\//i.test(act.icon || '') ? el('span', { class: 'fv-game', title: act.name || '' }, smallArt(act.icon, 'fv-gi')) : null,
  el('span', { class: 'fv-acts' },
    st.join ? iconBtn('logIn', 'Join game', { class: 'primary', title: `Join ${f.username} in ${act?.name || 'their game'}`, onclick: e => joinFriendNow(f.username, e.currentTarget) }) : null,
    fv.invite && isOn(f) && !(act && act.appId === fv.invite.id) ? iconBtn('send', 'Invite', { class: 'ghost', title: `Invite ${f.username} to ${fv.invite.name}`, onclick: e => fvInvite(f.username, e.currentTarget) }) : null,
    iconBtn('messageSquare', 'Message', { class: 'ghost', title: `Message ${f.username}`, onclick: () => hf.openChat(f.username) }),
    iconBtn('user', 'Profile', { class: 'ghost', title: `${f.username}'s profile`, onclick: () => openProfileTab(f.username) }),
    iconBtn('more', '', { class: 'ghost ic', title: 'More', 'data-menu-btn': '', onclick: e => fvMenu(e.currentTarget, f) })));
}

function fvList() {
  if (!social) return [el('div', { class: 'fv-list' }, ...[0, 1, 2, 3, 4].map(() => el('div', { class: 'sk fv-sk' })))];
  if (!social.loggedIn || social.needsRelogin) {
    return [el('div', { class: 'board-empty' }, el('span', { class: 'be-ico', html: ICONS.users }),
      el('b', { text: 'Log in again to see your friends' }),
      el('span', { text: 'Hyperfocus needs your OK for friends and messages on Nookara.' }),
      el('button', { class: 'btn fv-go', onclick: () => startLogin() }, el('span', { class: 'btn-ico vl-mark', html: ICONS.veloraLogo }), el('span', { text: 'Log in with Nookara' })))];
  }
  const all = fvFriends();
  if (!all.length) {
    return [el('div', { class: 'board-empty' }, el('span', { class: 'be-ico', html: ICONS.users }),
      el('b', { text: 'No friends yet' }),
      el('span', { text: 'Add people by their Nookara username - they show up here once they accept.' }))];
  }
  const q = fv.q.trim().toLowerCase();
  const list = all.filter(f => (!q || f.username.toLowerCase().includes(q) || String(f.activity?.name || '').toLowerCase().includes(q))
    && (fv.filter === 'all' || (fv.filter === 'online' ? isOn(f) : !!f.activity)));
  if (!list.length) {
    return [el('div', { class: 'board-empty' }, el('span', { class: 'be-ico', html: ICONS.search }),
      el('b', { text: q ? `No friends match "${fv.q.trim()}"` : fv.filter === 'playing' ? 'Nobody is in a game right now' : 'Nobody is online right now' }),
      el('span', { text: q ? 'Try another name, or a game they might be playing.' : 'They show up here as soon as they are.' }))];
  }
  const byName = (x, y) => x.username.localeCompare(y.username, undefined, { sensitivity: 'base' });
  const groups = [
    ['In game', list.filter(f => f.activity).sort((x, y) => (!!(y.activity.joinable && y.activity.joinCode) - !!(x.activity.joinable && x.activity.joinCode)) || byName(x, y))],
    ['Online', list.filter(f => !f.activity && f.online).sort(byName)],
    ['Offline', list.filter(f => !isOn(f)).sort(byName)],
  ].filter(g => g[1].length);
  let i = 0;
  return groups.map(([title, rows]) => el('section', { class: 'fv-group' },
    el('div', { class: 'ls-h fv-gh' }, el('span', { text: title }), el('span', { class: 'ls-n', text: String(rows.length) })),
    el('div', { class: 'fv-list' }, ...rows.map(f => fvRow(f, i++)))));
}

let fvAdd = null;
function fvAddBox() {
  if (fvAdd) return fvAdd;
  const input = el('input', { class: 'field grow', placeholder: 'Nookara username', spellcheck: 'false', maxlength: '32' });
  const add = el('button', { class: 'btn', text: 'Add' });
  const send = async () => {
    const name = input.value.trim().replace(/^@/, '');
    if (!name) { input.focus(); return; }
    add.disabled = true;
    try {
      const r = await hf.addFriend(name);
      toast(r === 'accepted' ? `You're friends with ${name} now!` : `Friend request sent to ${name}!`, 'ok');
      input.value = '';
      loadRequests();
    } catch (e) { toast(e.message, 'err'); }
    add.disabled = false;
  };
  add.onclick = send;
  input.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
  fvAdd = el('div', { class: 'fv-add' }, el('div', { class: 'fv-add-row' }, input, add),
    el('span', { class: 'fv-hint', text: 'Sending a request to someone who already asked you makes you friends right away.' }));
  return fvAdd;
}
function fvSide() {
  if (!social?.loggedIn || social.needsRelogin) return [];
  const r = fv.reqs;
  const inc = r?.incoming || [], out = r?.outgoing || [];
  const act = fn => async e => {
    const b = e.currentTarget;
    b.disabled = true;
    try { await fn(); } catch (err) { toast(err.message, 'err'); }
    loadRequests();
  };
  const reqRows = [
    ...inc.map(q => el('div', { class: 'fv-req' },
      el('button', { class: 'fv-req-who', title: `${q.from_username}'s profile`, onclick: () => openProfileTab(q.from_username) },
        personPic(/^https:\/\//i.test(q.pfp_url || '') ? q.pfp_url : '', q.from_username, 'fv-req-pic'), el('b', { text: q.from_username })),
      el('button', { class: 'btn fv-sm', text: 'Accept', onclick: act(async () => { await hf.addFriend(q.from_username); toast(`You're friends with ${q.from_username} now!`, 'ok'); }) }),
      el('button', { class: 'btn ghost fv-sm', text: 'Decline', onclick: act(() => hf.declineFriend(q.id)) }))),
    ...out.map(q => el('div', { class: 'fv-req out' },
      el('button', { class: 'fv-req-who', title: `${q.to_username}'s profile`, onclick: () => openProfileTab(q.to_username) },
        personPic('', q.to_username, 'fv-req-pic'), el('b', { text: q.to_username })),
      el('span', { class: 'fv-req-st', text: 'request sent' }))),
  ];
  const box = (icon, title, count, ...body) => el('section', { class: 'gv-box' },
    el('div', { class: 'box-h gv-bh' }, el('span', { class: 'bh-ico', html: ICONS[icon] }), el('span', { class: 'grow', text: title }),
      count != null ? el('span', { class: 'gv-bn', text: String(count) }) : null), ...body);
  return [
    box('userPlus', 'Add a friend', null, fvAddBox()),
    box('mail', 'Friend requests', inc.length,
      !r ? el('div', { class: 'fv-reqs' }, el('div', { class: 'sk fv-sk small' })) : reqRows.length ? el('div', { class: 'fv-reqs' }, ...reqRows)
        : el('div', { class: 'pf-quiet', text: 'No pending requests.' })),
    fv.invite ? box('send', 'Inviting friends', null, el('div', { class: 'pf-quiet', text: `${fv.invite.name} takes invites right now - online friends have an Invite button.` })) : null,
  ];
}

function renderFriendsTab() {
  if (!S || !domReady) return;
  renderFriendsChip();
  const me = S.account?.username || '';
  if (me !== fv.user) Object.assign(fv, { user: me, reqs: null, reqCount: -1, key: '' });
  const opened = tab === 'friends' && fv.shownTab !== 'friends';
  fv.shownTab = tab;
  if (tab !== 'friends' || !me || S.offlineMode) return;
  if (opened || (social && social.requests !== fv.reqCount)) { fv.reqCount = social?.requests ?? -1; loadRequests(); }
  const key = JSON.stringify([social ? [social.loggedIn, social.needsRelogin, fvFriends()] : null, fv.q, fv.filter, fv.reqs, fv.invite]);
  if (key === fv.key) return;
  const first = !fv.key;
  fv.key = key;
  renderFvChips();
  const scroll = $('#fv-scroll');
  const top = scroll.scrollTop;
  $('#fv-view').replaceChildren(el('div', { class: 'fv-body' },
    el('div', { class: 'fv-main' }, ...fvList()),
    el('aside', { class: 'fv-side' }, ...fvSide().filter(Boolean))));
  scroll.scrollTop = top;
  if ((first || opened) && !reduceMotion()) { const v = $('#fv-view'); v.classList.remove('pf-anim'); void v.offsetWidth; v.classList.add('pf-anim'); }
}
