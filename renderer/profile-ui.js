'use strict';
/* global hf, ICONS */
// People: look anyone up by username and see their Nookara profile, what they're
// playing and their Hyperfocus game stats - plus add / accept / decline /
// remove friends. Used by the launcher's people window.

window.ProfileUI = (() => {
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
  function pic(url, name, size, cls = 'pfp') {
    const style = `width:${size}px;height:${size}px`;
    const letter = () => h('span', { class: 'pfp', style, text: (name || '?')[0].toUpperCase() });
    if (!url) return letter();
    const img = h('img', { class: cls, src: url, alt: '', style });
    img.addEventListener('error', () => img.replaceWith(letter()), { once: true });
    return img;
  }
  const safeColor = c => (/^#[0-9a-f]{3,8}$/i.test(String(c || '')) ? c : '');
  const colorStyle = c => (safeColor(c) ? `color:${safeColor(c)}` : null);
  function fmtPlaytime(s) {
    s = Math.floor(s);
    const hrs = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return hrs ? `${hrs}h ${m}m` : `${Math.max(1, m)}m`;
  }
  function joined(ts) {
    const d = new Date(ts);
    if (Number.isNaN(d.valueOf())) return '';
    return d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
  }
  const section = (title, ...kids) => h('div', { class: 'pp-sec' }, h('div', { class: 'pp-sec-h', text: title }), ...kids);
  const fill = (node, ...kids) => node.replaceChildren(...kids.flat().filter(k => k !== null && k !== undefined && k !== false));

  async function renderProfile(box, name) {
    box.replaceChildren(h('div', { class: 'pp-note', text: 'looking them up...' }));
    let p;
    try { p = await hf.profile(name); } catch (e) { box.replaceChildren(h('div', { class: 'pp-note err', text: e.message })); return; }
    const u = p.user;
    const hfp = p.hyperfocus;
    const actions = h('div', { class: 'pp-actions' });
    const say = (text, err) => { const n = h('div', { class: 'pp-note' + (err ? ' err' : ''), text }); actions.after(n); setTimeout(() => n.remove(), 3500); };
    const act = fn => async e => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try { await fn(); } catch (err) { say(err.message, true); btn.disabled = false; }
    };

    function drawActions(status) {
      let kids;
      if (p.me) kids = [h('span', { class: 'pp-note', text: "that's you! :3" })];
      else if (!p.loggedIn) kids = [h('span', { class: 'pp-note', text: 'log in to add friends' })];
      else if (p.needsRelogin) kids = [h('button', { class: 'btn', text: 'log in again to add friends', onclick: () => hf.login().catch(() => {}) })];
      else if (status === 'friends') {
        const join = hfp?.playing?.joinable && hfp.playing.joinCode
          ? h('button', { class: 'btn', html: `${ICONS.logIn}<span>join game</span>`, title: `join ${u.username} in ${hfp.playing.name}`, onclick: act(async () => {
            const r = await hf.joinFriend(u.username);
            say(r?.joined ? `joining ${u.username}...` : `you need ${hfp.playing.name} first - its page is open in the launcher`);
          }) }) : null;
        let armed = false;
        const remove = h('button', { class: 'btn ghost', text: 'remove friend' });
        remove.onclick = act(async () => {
          if (!armed) { armed = true; remove.textContent = 'sure? click again'; remove.disabled = false; setTimeout(() => { armed = false; remove.textContent = 'remove friend'; }, 3000); return; }
          await hf.removeFriend(u.username);
          drawActions('none');
          say(`removed ${u.username}`);
        });
        kids = [join, h('button', { class: 'btn' + (join ? ' ghost' : ''), html: `${ICONS.mail}<span>message</span>`, onclick: () => hf.openChat(u.username) }), remove];
      } else if (status === 'pending_outgoing') {
        kids = [h('button', { class: 'btn ghost', text: 'request sent', disabled: true })];
      } else if (status === 'pending_incoming') {
        kids = [
          h('button', { class: 'btn', text: 'accept', onclick: act(async () => { await hf.addFriend(u.username); drawActions('friends'); say(`you're friends with ${u.username} now!`); }) }),
          p.requestId != null ? h('button', { class: 'btn ghost', text: 'decline', onclick: act(async () => { await hf.declineFriend(p.requestId); drawActions('none'); }) }) : null,
        ];
      } else {
        kids = [h('button', { class: 'btn', html: `${ICONS.userPlus}<span>add friend</span>`, onclick: act(async () => {
          const st = await hf.addFriend(u.username);
          drawActions(st === 'accepted' ? 'friends' : 'pending_outgoing');
          say(st === 'accepted' ? `you're friends with ${u.username} now!` : 'friend request sent!');
        }) })];
      }
      fill(actions, ...kids);
    }
    drawActions(p.friendStatus);

    const playingId = hfp?.playing?.id;
    const games = (hfp?.games || []).slice().sort((a, b) => (b.id === playingId) - (a.id === playingId));
    const playingInList = !!playingId && games.some(g => g.id === playingId);
    const achList = ach => {
      const order = new Map(ach.list.map((a, i) => [a.id, i]));
      return ach.list.slice().sort((x, y) => ((x.hidden && !x.unlocked) - (y.hidden && !y.unlocked)) || ((y.percent || 0) - (x.percent || 0)) || (order.get(x.id) - order.get(y.id)))
        .map(a => {
          const masked = a.hidden && !a.unlocked, rare = a.rarity === 'rare' && !masked;
          return h('div', { class: 'pp-ach' + (a.unlocked ? '' : ' locked') + (rare ? ' rare' : '') },
            a.icon ? pic(a.icon, a.name, 30, 'pp-icon') : h('span', { class: 'pp-ach-none', text: masked ? '?' : '🏆' }),
            h('div', { class: 'pp-ach-t' },
              h('b', { text: a.name }),
              h('span', { class: 'pp-dim', text: a.description || '' }),
              h('span', { class: 'pp-dim' }, a.unlocked ? h('span', { class: 'pp-got', text: `unlocked ${new Date(a.unlockedAt).toLocaleDateString()}` }) : 'locked', rare ? h('span', { class: 'pp-rare', text: ' rare' }) : null),
              a.percent !== null && a.percent !== undefined ? h('span', { class: 'pp-pct' }, h('i', {}, h('i', { style: `width:${Math.min(100, a.percent)}%` })), h('span', { text: `${a.percent}% of players` })) : null));
        });
    };
    let hfSection;
    if (hfp && (hfp.playing || games.length)) {
      const total = games.reduce((s, g) => s + g.seconds, 0);
      hfSection = section(`hyperfocus${total >= 60 ? ` · ${fmtPlaytime(total)} total` : ''}`,
        hfp.playing && !playingInList ? h('div', { class: 'pp-now' },
          pic(hfp.playing.icon, hfp.playing.name, 40, 'pp-icon'),
          h('div', {},
            h('div', { class: 'pp-now-k', text: hfp.playing.joinable ? 'in joinable game' : hfp.playing.type === 'Game' ? 'playing now' : 'using now' }),
            h('div', { class: 'pp-now-n', text: hfp.playing.name }),
            hfp.playing.state ? h('div', { class: 'pp-dim', text: hfp.playing.state }) : null,
            hfp.playing.since ? h('div', { class: 'pp-dim', text: `for ${fmtPlaytime((Date.now() - hfp.playing.since) / 1000)}` }) : null)) : null,
        games.length ? h('div', { class: 'pp-games' }, ...games.map(g => {
          const playing = g.id === playingId;
          const box = h('div', { class: 'pp-gamebox' + (playing ? ' playing' : '') },
            playing ? h('div', { class: 'pp-now-k', text: `${g.type === 'Game' ? 'playing' : 'using'} now${hfp.playing.state ? ` · ${hfp.playing.state}` : ''}${hfp.playing.since ? ` · for ${fmtPlaytime((Date.now() - hfp.playing.since) / 1000)}` : ''}` }) : null,
            h('div', { class: 'pp-game' },
              pic(g.icon, g.name, 30, 'pp-icon'),
              h('div', { class: 'pp-game-n' }, g.name, g.rankRequired ? h('span', { class: 'pp-tag', title: `${g.rankRequired} and up`, text: g.rankRequired }) : null),
              h('div', { class: 'pp-dim', text: g.seconds ? `${fmtPlaytime(g.seconds)} ${g.type === 'Game' ? 'played' : 'used'}` : 'no playtime yet' })));
          if (g.ach?.total) {
            const list = h('div', { class: 'pp-achs' }, ...achList(g.ach));
            box.append(h('button', { class: 'pp-achbar', title: 'show achievements', onclick: () => box.classList.toggle('open') },
              h('span', { text: 'achievements' }),
              h('i', { class: 'pp-bar' }, h('i', { style: `width:${Math.round(g.ach.unlocked / g.ach.total * 100)}%` })),
              h('b', { text: `${g.ach.unlocked} / ${g.ach.total}` }),
              h('span', { class: 'pp-chev', text: '▾' })), list);
          }
          return box;
        })) : null);
    } else {
      hfSection = section('hyperfocus', h('div', { class: 'pp-dim', text: "no Hyperfocus playtime yet" }));
    }

    const achSection = null;
    const badges = Array.isArray(u.badges) ? u.badges : [];
    const online = u.status ? String(u.status) : '';
    fill(box,
      u.banner_url ? h('img', { class: 'pp-banner', src: u.banner_url, alt: '' }) : h('div', { class: 'pp-banner none' }),
      h('div', { class: 'pp-head' },
        pic(u.pfp_url, u.username, 64),
        h('div', { class: 'pp-id' },
          h('div', {}, h('span', { class: 'pp-name', text: u.username, style: colorStyle(u.color) }), h('span', { class: 'pp-rank', text: u.rank || 'free' }),
            badges.length ? h('span', { class: 'pp-vbadges' }, ...badges.map(b => h('span', { class: 'pp-vbadge', tabindex: '0', 'aria-label': `${b.name}: ${b.description || ''}` },
              b.icon_url ? h('img', { src: /^\//.test(b.icon_url) ? `https://nookara.cc${b.icon_url}` : b.icon_url, alt: '' }) : null,
              h('span', { class: 'pp-vtip' }, h('b', { text: b.name }), h('span', { text: b.description || '' }))))) : null),
          h('div', { class: 'pp-dim' },
            h('span', { class: 'dot' + (online ? ' on' : '') }),
            ` ${online || 'offline'}`,
            u.created_at ? ` · joined ${joined(u.created_at)}` : '')),
        actions),
      u.bio ? section('about', h('div', { class: 'pp-bio', text: u.bio })) : null,
      hfSection, achSection);
  }

  async function drawRequests(box, open) {
    let r;
    try { r = await hf.friendRequests(); } catch { box.replaceChildren(); return; }
    const rows = [];
    for (const q of r.incoming) {
      const row = h('div', { class: 'pp-req' },
        pic(q.pfp_url, q.from_username, 26),
        h('button', { class: 'pp-req-n link', text: q.from_username, onclick: () => open(q.from_username) }),
        h('button', { class: 'btn', text: 'accept', onclick: async () => { await hf.addFriend(q.from_username).catch(() => {}); drawRequests(box, open); } }),
        h('button', { class: 'btn ghost', text: 'decline', onclick: async () => { await hf.declineFriend(q.id).catch(() => {}); drawRequests(box, open); } }));
      rows.push(row);
    }
    for (const q of r.outgoing) {
      rows.push(h('div', { class: 'pp-req out' },
        h('button', { class: 'pp-req-n link', text: q.to_username, onclick: () => open(q.to_username) }),
        h('span', { class: 'pp-dim', text: 'request sent' })));
    }
    box.replaceChildren(...(rows.length ? [h('div', { class: 'pp-sec-h', text: 'friend requests' }), ...rows] : []));
  }

  function mountPeople(root, { initial } = {}) {
    const input = h('input', { class: 'field pp-search-in', placeholder: 'look up a Nookara username', spellcheck: 'false' });
    const result = h('div', { class: 'pp-result' });
    const reqs = h('div', { class: 'pp-reqs' });
    const open = name => { input.value = name; renderProfile(result, name); };
    const go = () => { const n = input.value.trim(); if (n) renderProfile(result, n); };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    root.replaceChildren(h('div', { class: 'pp-search' }, input, h('button', { class: 'btn', text: 'look up', onclick: go })), reqs, result);
    drawRequests(reqs, open);
    if (initial) open(initial);
    else setTimeout(() => input.focus(), 50);
  }

  return { renderProfile, mountPeople, safeColor, colorStyle };
})();
