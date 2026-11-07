'use strict';
/* global hf, ICONS, $, el, S, tab, setTab, selectApp, render, toast, attempt, openModal, closeModal, closeMenus, check, setS,
   apps, inLibrary, libraryList, priceView, credits, timeLeft, stageInfo, iconEl, isUrl, httpsUrl, fmtBytes, labelFor, primaryAction,
   gameRunning, BUSY, STATUS_TEXT, SOCIAL_COLORS, safeColor, reduceMotion, syncMusic, visible, revealed, needLogin,
   joinPublicBeta, betaVer, buyUrlOf, descOf, effStatus, winOnly, WINONLY_TITLE, pageTrailer:writable */

const STORE_TTL = 2 * 60 * 1000;
const store = {
  data: null, map: null, at: 0, loading: null, error: '', ver: 0, lver: 0,
  view: { kind: 'home' }, stack: [], q: '', key: '', user: '', shownTab: '', scrollTo: null, feat: 0,
};
let page = null;
const NOTIFY_LABEL = { email: 'email', ember: 'Ember DM', both: 'email and Ember DM' };
const CHIP_LABEL = { wishlist: 'Wishlist', new: 'New', official: 'Official', liked: 'Most liked', soon: 'Coming soon', early: 'Early access',
  popular: 'Most played', free: 'Free', paid: 'Paid', controller: 'Controller', apps: 'Apps' };

function loadStore(force = false) {
  if (!S?.account || S.offlineMode) return Promise.resolve(null);
  if (store.loading) return store.loading;
  if (!force && store.data && Date.now() - store.at < STORE_TTL) return Promise.resolve(store.data);
  store.error = '';
  store.loading = hf.storeGet().then(d => {
    store.data = d;
    store.map = new Map(d.games.map(g => [g.id, g]));
    store.at = Date.now();
    store.ver++;
    return d;
  }, e => { store.error = e.message || String(e); return null; })
    .finally(() => { store.loading = null; renderStore(); });
  renderStore();
  return store.loading;
}
function storeReload() { loadStore(true).then(d => { if (d) toast('Store refreshed.', 'ok'); else if (store.error) toast(store.error, 'err'); }); }

const storeScroll = () => $('#st-scroll');
function storeGo(view) {
  stopPageMedia();
  store.stack.push({ view: store.view, q: store.q, scroll: storeScroll().scrollTop });
  store.view = view;
  store.scrollTo = 0;
  renderStore();
}
function storeBack() {
  if (store.stack.length) {
    const p = store.stack.pop();
    stopPageMedia();
    store.view = p.view;
    store.q = p.q || '';
    $('#st-q').value = store.q;
    store.scrollTo = p.scroll;
    renderStore();
    return true;
  }
  if (store.q) { setStoreQuery(''); return true; }
  return false;
}
function storeHome() {
  stopPageMedia();
  store.stack = [];
  store.view = { kind: 'home' };
  store.q = '';
  $('#st-q').value = '';
  store.scrollTo = 0;
  renderStore();
}
function storeCanGoBack() { return tab === 'store' && !!S && (store.stack.length > 0 || !!store.q); }
function openStorePage(id) {
  if (store.view.kind === 'game' && store.view.id === id) return;
  storeGo({ kind: 'game', id });
}
function setStoreQuery(q) {
  store.q = q;
  if ($('#st-q').value !== q) $('#st-q').value = q;
  if (store.view.kind !== 'home') { stopPageMedia(); store.stack.push({ view: store.view, q: '', scroll: storeScroll().scrollTop }); store.view = { kind: 'home' }; }
  store.scrollTo = 0;
  renderStore();
}
let qTimer = null;
$('#st-q').addEventListener('input', e => { clearTimeout(qTimer); const v = e.target.value; qTimer = setTimeout(() => setStoreQuery(v), 120); });
$('#st-q').addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !e.target.value) return;
  e.stopPropagation();
  clearTimeout(qTimer);
  setStoreQuery('');
});
document.querySelector('#st-top .sq-ico').innerHTML = ICONS.search;
$('#st-back').innerHTML = ICONS.arrowLeft;
$('#st-back').addEventListener('click', () => storeBack());
document.addEventListener('keydown', e => {
  if (tab !== 'store' || !page?.nav || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  if (document.querySelector('.modal-back[data-id], .menu:not([hidden])') || e.target.closest?.('input, textarea, select, video')) return;
  page.nav(e.key === 'ArrowLeft' ? -1 : 1);
});
addEventListener('focus', () => { if (tab === 'store' && store.data && store.at === 0) loadStore(true); });

const sGame = id => store.map?.get(id) || null;
const appOf = g => apps().find(a => a.id === g.id) || null;
function storeInLib(g) {
  const a = appOf(g);
  if (a && inLibrary(a)) return true;
  return !g.official && (S.settings.community || []).includes(g.communityId);
}
const byLine = g => (g.official ? 'Hyperfocus' : `by ${g.author || '?'}`);
const artOf = g => g.background || httpsUrl(g.trailerPoster) || g.banners?.find(b => b?.image)?.image || '';
const isFresh = g => g.stage !== 'soon' && g.released > 0 && Date.now() / 1000 - g.released < 60 * 86400;
const shortText = (s, n = 180) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}...` : s; };
function artImg(src, cls = '') {
  if (!src) return el('span', { class: `art-none ${cls}` });
  const img = el('img', { src, alt: '', class: cls, loading: 'lazy' });
  img.addEventListener('error', () => img.replaceWith(el('span', { class: `art-none ${cls}` })), { once: true });
  return img;
}
function logoEl(g, imgCls, textCls) {
  const v = String(g.logo || '').trim();
  const text = () => el('div', { class: textCls, text: v && !isUrl(v) ? v : g.name });
  if (!isUrl(v)) return text();
  const img = el('img', { class: imgCls, src: v, alt: g.name });
  img.addEventListener('error', () => img.replaceWith(text()), { once: true });
  return img;
}
function priceEl(g, big = false, libLabel = true) {
  const p = priceView(g);
  const cls = big ? 'price big' : 'price';
  if (g.stage === 'soon' && !g.keyed) return el('span', { class: `${cls} soon`, title: stageInfo(g)?.title || '' }, el('span', { class: 'pr-ico', html: ICONS.calendar }), capWord(stageInfo(g, true)?.text || 'coming soon'));
  if (libLabel && storeInLib(g)) return el('span', { class: `${cls} owned` }, el('span', { class: 'pr-ico', html: ICONS.check }), 'In library');
  if (!p.full) return el('span', { class: `${cls} free`, text: 'Free' });
  if (g.owned === true) return el('span', { class: `${cls} owned` }, el('span', { class: 'pr-ico', html: ICONS.check }), 'Owned');
  if (!p.sale) return el('span', { class: cls }, el('b', { text: Number(p.full).toLocaleString() }), el('span', { class: 'pr-cr', text: p.full === 1 ? ' credit' : ' credits' }));
  return el('span', { class: `${cls} on-sale`, title: `On sale until ${new Date(p.until).toLocaleString()}` },
    el('span', { class: 'pr-off', text: `-${p.off}%` }),
    el('span', { class: 'pr-was', text: Number(p.full).toLocaleString() }),
    el('b', { class: 'pr-now', text: Number(p.now).toLocaleString() }), el('span', { class: 'pr-cr', text: p.now === 1 ? ' credit' : ' credits' }));
}
const likesEl = g => el('span', { class: `sc-likes${g.liked ? ' on' : ''}`, title: `${g.likes} like${g.likes === 1 ? '' : 's'}` }, el('span', { html: ICONS.heart }), String(g.likes || 0));
function stageTagEl(g, cls = 'sc-stage') {
  const s = stageInfo(g, true);
  return s ? el('span', { class: `${cls} ${s.kind}`, title: stageInfo(g).title, text: s.text }) : null;
}

function winOnlyTagEl(g, cls = 'sc-stage') {
  return winOnly(g) ? el('span', { class: `${cls} win`, title: WINONLY_TITLE }, el('span', { class: 'wo-ico', html: ICONS.windows }), 'Windows only') : null;
}

function storeCard(g, i = 0, onclick = null) {
  const mine = storeInLib(g);
  return el('button', {
    class: 'sc', 'data-id': g.id, title: g.name, style: i < 10 ? `animation-delay:${i * 40}ms` : null,
    onclick: () => (onclick ? onclick(g) : openStorePage(g.id)),
  },
  el('span', { class: 'sc-art' }, artImg(artOf(g)),
    el('span', { class: 'sc-tags' }, winOnly(g) ? el('span', { class: 'sc-tagrow' }, stageTagEl(g), winOnlyTagEl(g)) : stageTagEl(g) || el('span'),
      mine ? el('span', { class: 'sc-own' }, el('span', { html: ICONS.check }), 'in library')
        : priceView(g).full > 0 && g.owned === true ? el('span', { class: 'sc-own' }, el('span', { html: ICONS.check }), 'owned')
          : g.wishlisted ? el('span', { class: 'sc-own wish' }, el('span', { html: ICONS.bookmark }), 'wishlist') : null)),
  el('span', { class: 'sc-body' },
    el('span', { class: 'sc-ico' }, iconEl(g)),
    el('span', { class: 'sc-txt' }, el('span', { class: 'sc-name', text: g.name }), el('span', { class: 'sc-by', text: byLine(g) }))),
  el('span', { class: 'sc-foot' }, likesEl(g), priceEl(g)));
}

function featuredList() {
  const d = store.data;
  const ids = [];
  for (const c of ['new', 'popular', 'official']) for (const id of d.categories.find(x => x.id === c)?.ids || []) if (!ids.includes(id) && ids.length < 5) ids.push(id);
  const list = ids.map(sGame).filter(g => g && artOf(g));
  return list.length ? list : d.games.filter(artOf).slice(0, 5);
}
function featuredBox(list) {
  let i = Math.min(store.feat, list.length - 1), timer = null;
  const art = el('div', { class: 'feat-art' });
  const info = el('div', { class: 'feat-info' });
  const picks = list.length > 1 ? list.map((g, j) => el('button', { class: 'feat-pick', onclick: () => { show(j); restart(); } },
    el('span', { class: 'fp-art' }, artImg(artOf(g))),
    el('span', { class: 'fp-txt' }, el('b', { text: g.name }), el('small', { text: byLine(g) })),
    el('i', { class: 'fp-time' }))) : [];
  const main = el('div', { class: 'feat-main', onclick: e => { if (!e.target.closest('button')) openStorePage(list[i].id); } }, art, el('div', { class: 'feat-shade' }), info);
  const box = el('section', { class: 'feat' + (picks.length ? '' : ' solo') }, main, picks.length ? el('div', { class: 'feat-side' }, ...picks) : null);
  const show = (j, first = false) => {
    i = store.feat = (j + list.length) % list.length;
    const g = list[i];
    const node = artImg(artOf(g), 'fa-img');
    const old = [...art.children];
    const done = () => { requestAnimationFrame(() => node.classList.add('on')); setTimeout(() => old.forEach(o => o.remove()), 700); };
    if (node.tagName === 'IMG' && !node.complete) node.addEventListener('load', done, { once: true }); else done();
    art.append(node);
    const p = priceView(g);
    info.replaceChildren(
      el('div', { class: 'feat-kicker' }, el('span', { html: ICONS[g.stage === 'soon' ? 'calendar' : 'sparkles'] }),
        el('span', { text: g.stage === 'soon' ? 'Coming soon' : isFresh(g) ? 'New release' : p.sale && !g.owned ? `On sale · -${p.off}%` : 'Featured' })),
      logoEl(g, 'feat-logo', 'feat-title'),
      el('div', { class: `feat-desc${descOf(g) ? '' : ' muted'}`, text: descOf(g) ? shortText(descOf(g), 220) : 'No description' }),
      el('div', { class: 'feat-meta' }, el('span', { text: byLine(g) }), stageTagEl(g, 'mini-stage'), winOnlyTagEl(g, 'mini-stage'), likesEl(g), g.stage === 'soon' ? null : priceEl(g)),
      el('div', { class: 'feat-acts' }, el('button', { class: 'btn', onclick: () => openStorePage(g.id) }, el('span', { text: 'View' }), el('span', { class: 'btn-ico', html: ICONS.right }))));
    if (!first && !reduceMotion()) { info.classList.remove('swap'); void info.offsetWidth; info.classList.add('swap'); }
    picks.forEach((b, k) => b.classList.toggle('on', k === i));
  };
  const restart = () => {
    clearTimeout(timer);
    if (picks.length < 2) return;
    const bar = picks[i].querySelector('.fp-time');
    bar.classList.remove('run'); void bar.offsetWidth; bar.classList.add('run');
    timer = setTimeout(() => { if (box.isConnected) { show(i + 1); restart(); } }, 8000);
  };
  box.addEventListener('mouseenter', () => { clearTimeout(timer); picks[i]?.querySelector('.fp-time')?.classList.remove('run'); });
  box.addEventListener('mouseleave', restart);
  show(i, true);
  restart();
  return box;
}
function storeSection(c) {
  const list = c.ids.map(sGame).filter(Boolean);
  if (!list.length) return null;
  const row = el('div', { class: 'st-row' }, ...list.slice(0, 18).map((g, i) => storeCard(g, i)));
  const go = dir => row.scrollBy({ left: dir * Math.max(240, row.clientWidth - 120), behavior: reduceMotion() ? 'auto' : 'smooth' });
  return el('section', { class: 'st-sec' },
    el('div', { class: 'st-sec-h' },
      el('button', { class: 'st-sec-t', onclick: () => storeGo({ kind: 'cat', id: c.id }) }, c.title),
      el('span', { class: 'st-sec-n', text: String(list.length) }),
      el('span', { class: 'grow' }),
      list.length > 5 ? el('span', { class: 'st-arrows' },
        el('button', { class: 'st-arrow', title: 'Scroll left', html: ICONS.left, onclick: () => go(-1) }),
        el('button', { class: 'st-arrow', title: 'Scroll right', html: ICONS.right, onclick: () => go(1) })) : null,
      el('button', { class: 'st-all', onclick: () => storeGo({ kind: 'cat', id: c.id }) }, el('span', { text: 'See all' }), el('span', { html: ICONS.right }))),
    row);
}
function homeView() {
  const d = store.data;
  if (!d.games.length) return [storeEmpty('The store is empty right now', 'Check back soon - new games show up here.')];
  const feat = featuredList();
  return [feat.length ? featuredBox(feat) : null, ...d.categories.map(storeSection)];
}
function headEl(kicker, title, count) {
  return el('div', { class: 'st-head' },
    el('div', {}, el('div', { class: 'st-kicker', text: kicker }), el('div', { class: 'st-title', text: title })),
    count != null ? el('span', { class: 'st-count', text: `${count} ${count === 1 ? 'game' : 'games'}` }) : null);
}
function catView(id) {
  const c = store.data.categories.find(x => x.id === id);
  const list = c ? c.ids.map(sGame).filter(Boolean) : [];
  if (!c || !list.length) return [storeEmpty('Nothing in here right now', 'This list is empty at the moment.')];
  return [headEl('Category', c.title, list.length), el('div', { class: 'st-grid' }, ...list.map((g, i) => storeCard(g, i)))];
}
function searchView(q) {
  const t = q.trim().toLowerCase();
  const has = (v, s) => String(v || '').toLowerCase().includes(s);
  const list = store.data.games.filter(g => has(g.name, t) || has(g.author, t) || has(descOf(g), t))
    .sort((x, y) => (has(y.name, t) - has(x.name, t)) || x.name.localeCompare(y.name, undefined, { sensitivity: 'base' }));
  if (!list.length) return [headEl('Search', `"${q.trim()}"`), storeEmpty('No games found', 'Try another name, a creator, or a word from the description.')];
  return [headEl('Search', `"${q.trim()}"`, list.length), el('div', { class: 'st-grid' }, ...list.map((g, i) => storeCard(g, i)))];
}
function storeEmpty(title, text, act) {
  return el('div', { class: 'st-empty' }, el('img', { src: '../assets/hyperfocus.png', alt: '' }), el('b', { text: title }), el('span', { text }), act || null);
}
function storeSkeleton() {
  const card = () => el('div', { class: 'sk-card' }, el('div', { class: 'sk sk-art' }), el('div', { class: 'sk sk-line' }), el('div', { class: 'sk sk-line short' }));
  return [el('div', { class: 'sk sk-feat' }), ...[0, 1].map(() => el('div', { class: 'st-sec' }, el('div', { class: 'sk sk-h' }), el('div', { class: 'sk-row' }, ...[0, 1, 2, 3, 4].map(card))))];
}

function setPageTrailer(on) {
  if (pageTrailer === on) return;
  pageTrailer = on;
  syncMusic();
}
function stopPageMedia() { page?.stopMedia?.(); }
function storePausePage() { page?.pauseMedia?.(); }
// trailer first, then the banners (the game's store art - the library view doesn't show them); a thumbnail strip
// under it. The trailer starts by itself MUTED (the poster shows until it plays / if it can't); the launcher music
// only fades out once it's actually audible (unmuted, volume up, playing).
function mediaViewer(g) {
  const items = [];
  const tr = httpsUrl(g.trailer);
  if (tr) items.push({ kind: 'video', src: tr, poster: httpsUrl(g.trailerPoster) || g.background || '' });
  for (const b of Array.isArray(g.banners) ? g.banners : []) if (b?.image) items.push({ kind: 'image', src: b.image, url: b.url || '' });
  if (!items.length && g.background) items.push({ kind: 'image', src: g.background });
  if (!items.length) return null;
  const stage = el('div', { class: 'sp-stage' });
  let i = 0, video = null;
  const stopVideo = () => {
    if (!video) return;
    try { video.pause(); video.removeAttribute('src'); video.load(); } catch {  }
    video = null;
    setPageTrailer(false);
  };
  const nav = items.length > 1 ? [
    el('button', { class: 'sp-nav l', title: 'Previous', html: ICONS.left, onclick: e => { e.stopPropagation(); show(i - 1); } }),
    el('button', { class: 'sp-nav r', title: 'Next', html: ICONS.right, onclick: e => { e.stopPropagation(); show(i + 1); } }),
  ] : [];
  const thumbs = items.length > 1 ? items.map((it, j) => el('button', { class: 'sp-thumb', title: it.kind === 'video' ? 'Trailer' : '', onclick: () => show(j) },
    artImg(it.kind === 'video' ? it.poster : it.src), it.kind === 'video' ? el('span', { class: 'sp-pl', html: ICONS.trailer }) : null)) : [];
  const strip = thumbs.length ? el('div', { class: 'sp-strip' }, ...thumbs) : null;
  const show = (j, first = false) => {
    i = (j + items.length) % items.length;
    stopVideo();
    const it = items[i];
    let node;
    if (it.kind === 'video') {
      node = video = el('video', { class: 'sp-video', controls: true, playsinline: true, preload: first ? 'auto' : 'metadata', poster: it.poster || null });
      video.muted = true;
      video.src = it.src;
      const v = video;
      const audible = () => { if (v === video) setPageTrailer(!v.paused && !v.ended && !v.muted && v.volume > 0); };
      for (const ev of ['play', 'playing', 'pause', 'ended', 'emptied', 'volumechange']) v.addEventListener(ev, audible);
      if (first && visible) v.play().catch(() => {});
      v.addEventListener('error', () => { if (v === video) stage.append(el('div', { class: 'sp-err', text: "Couldn't play this trailer." })); });
      v.addEventListener('click', e => { if (!e.isTrusted) (v.paused ? v.play().catch(() => {}) : v.pause()); });
    } else {
      node = artImg(it.src, 'sp-img');
      if (it.url) { node.classList.add('link'); node.title = it.url; node.addEventListener('click', () => hf.openUrl(it.url)); }
    }
    stage.replaceChildren(node, ...nav);
    thumbs.forEach((t, k) => t.classList.toggle('on', k === i));
    const t = thumbs[i];
    if (t && !first && (t.offsetLeft < strip.scrollLeft || t.offsetLeft + t.offsetWidth > strip.scrollLeft + strip.clientWidth)) strip.scrollLeft = t.offsetLeft - 7;
  };
  show(0, true);
  return {
    box: el('div', { class: 'sp-media' }, stage, strip),
    stop: stopVideo, pause: () => video?.pause(), nav: items.length > 1 ? d => show(i + d) : null,
  };
}
function mainAction(g) {
  const a = appOf(g);
  const p = priceView(g);
  if (storeInLib(g)) {
    if (!a) return { label: 'In your library', icon: 'library', sub: '', run: () => setTab('library') };
    const st = effStatus(a) || 'unavailable';
    const go = () => { setTab('library'); selectApp(a.id); };
    if (gameRunning(a) || BUSY.includes(st) || ['soon', 'unavailable', 'running', 'winonly'].includes(st)) {
      return { label: 'In your library', icon: 'library', sub: gameRunning(a) ? 'playing now' : STATUS_TEXT[st] || '', run: go };
    }
    if (st === 'buy') return { label: `Buy for ${credits(p.now)}`, icon: 'tag', cls: p.sale ? 'sale' : '', sub: 'In your library · opens Nookara in your browser', run: () => storeBuy(g) };
    const [label, icon] = labelFor(a, st, S.jobs[a.id]);
    return { label, icon: st === 'ready' ? 'trailer' : icon, sub: 'In your library', run: () => { go(); primaryAction(a); } };
  }
  if (g.stage === 'soon' && !g.keyed) {
    const s = stageInfo(g);
    return { label: g.wishlisted ? 'On your wishlist' : 'Wishlist', icon: g.wishlisted ? 'bookmarkCheck' : 'bookmark', cls: `wish${g.wishlisted ? ' on' : ''}`,
      sub: g.wishlisted ? `We'll tell you by ${NOTIFY_LABEL[g.wishlistNotify] || 'email and Ember DM'} when it's out` : `${capWord(s?.text || 'coming soon')} - get told when it's out`, menu: true };
  }
  if (p.full > 0 && g.owned !== true && !g.keyed) {
    return { label: `Buy for ${credits(p.now)}`, icon: 'tag', cls: p.sale ? 'sale' : '', sub: 'Opens Nookara in your browser', run: () => storeBuy(g) };
  }
  return { label: 'Add to library', icon: 'plus', sub: g.keyed ? 'You redeemed a key for this game' : p.full > 0 ? 'You own this game' : 'Free to play', run: btn => storeAdd(g, btn) };
}
const capWord = s => s.charAt(0).toUpperCase() + s.slice(1);
function storeBuy(g) {
  hf.openUrl(g.buyUrl || buyUrlOf(g));
  store.at = 0;
  toast(`Finish buying ${g.name} on Nookara in your browser - it unlocks here right after.`);
}
async function storeAdd(g, btn) {
  if (btn) { btn.disabled = true; btn.lastChild.textContent = 'Adding...'; }
  const r = await attempt(() => hf.libraryAdd(g.id));
  if (btn?.isConnected) btn.disabled = false;
  if (!r) { if (page) page.key = ''; refreshPage(); return null; }
  if (g.wishlisted) {
    if (g.official) hf.storeWishlist(g.id, false).catch(() => {});
    setWish(g, { wishlisted: false, notify: '', wishlists: Math.max(0, (g.wishlists || 1) - 1) });
  }
  store.lver++;
  toast(`${r.name} is in your library!`, 'ok');
  if (page) page.key = '';
  refreshPage();
  return r;
}
function setWish(g, r) {
  Object.assign(g, { wishlisted: !!r.wishlisted, wishlistNotify: r.notify || '', wishlists: Number(r.wishlists) || 0 });
  const cats = store.data?.categories;
  if (!cats) return;
  let c = cats.find(x => x.id === 'wishlist');
  if (g.wishlisted) {
    if (!c) cats.unshift(c = { id: 'wishlist', title: 'Your Wishlist', ids: [] });
    c.ids = [g.id, ...c.ids.filter(x => x !== g.id)];
  } else if (c) {
    c.ids = c.ids.filter(x => x !== g.id);
    if (!c.ids.length) cats.splice(cats.indexOf(c), 1);
  }
  store.lver++;
}
async function wishSet(g, on, notify) {
  closeMenus();
  const r = await attempt(() => hf.storeWishlist(g.id, on, notify));
  if (!r) return;
  setWish(g, r);
  refreshPage();
  toast(r.wishlisted ? `${g.name} is on your wishlist - you'll hear by ${NOTIFY_LABEL[r.notify] || 'email'} when it's ${g.stage === 'soon' ? 'out or ' : ''}on sale.` : `${g.name} is off your wishlist.`, 'ok');
}
const wishMenu = el('div', { id: 'wl-menu', class: 'menu', hidden: true });
document.body.append(wishMenu);
function openWishMenu(btn, g) {
  const open = !wishMenu.hidden && wishMenu.dataset.for === g.id;
  closeMenus();
  if (open) return;
  const opt = (v, label, icon) => el('button', { class: g.wishlisted && g.wishlistNotify === v ? 'on' : '', onclick: () => wishSet(g, true, v) },
    el('span', { class: 'wl-i', html: ICONS[icon] }), el('span', { class: 'grow', text: label }),
    g.wishlisted && g.wishlistNotify === v ? el('span', { class: 'wl-i wl-on', html: ICONS.check }) : null);
  wishMenu.replaceChildren(...[
    el('div', { class: 'wl-h', text: g.wishlisted ? 'on your wishlist' : 'add to your wishlist' }),
    el('div', { class: 'wl-p', text: g.stage === 'soon' ? "We'll tell you when it comes out, and when it goes on sale." : "We'll tell you when it goes on sale." }),
    el('div', { class: 'wl-sub', text: 'notify me by' }),
    opt('email', 'Email', 'mail'), opt('ember', 'Ember DM', 'flame'), opt('both', 'Email and Ember DM', 'bell'),
    g.wishlisted ? el('hr') : null,
    g.wishlisted ? el('button', { class: 'danger', onclick: () => wishSet(g, false) }, el('span', { class: 'wl-i', html: ICONS.xcircle }), el('span', { text: 'Remove from wishlist' })) : null,
  ].filter(Boolean));
  wishMenu.dataset.for = g.id;
  wishMenu.hidden = false;
  const r = btn.getBoundingClientRect(), z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
  const w = wishMenu.offsetWidth, h = wishMenu.offsetHeight;
  wishMenu.style.left = `${Math.max(8, Math.min(innerWidth / z - w - 8, r.right / z - w))}px`;
  wishMenu.style.top = `${r.bottom / z + h + 6 > innerHeight / z ? r.top / z - h - 6 : r.bottom / z + 6}px`;
}
async function toggleLike(g, btn) {
  const was = { likes: g.likes, liked: g.liked };
  g.liked = !g.liked;
  g.likes = Math.max(0, (g.likes || 0) + (g.liked ? 1 : -1));
  refreshPage();
  if (g.liked && !reduceMotion()) { const b = page?.buy.querySelector('.sp-act.like'); b?.classList.remove('pop'); void b?.offsetWidth; b?.classList.add('pop'); }
  const r = await hf.storeLike(g.id, g.liked).catch(e => { toast(e.message, 'err'); return null; });
  Object.assign(g, r || was);
  store.lver++;
  refreshPage();
}
function buyBlock(g) {
  const p = priceView(g);
  const m = mainAction(g);
  const main = el('button', { id: 'sp-main', class: `btn ${m.cls || ''}`, 'data-menu-btn': m.menu ? '' : null },
    el('span', { class: 'btn-ico', html: ICONS[m.icon] || '' }), el('span', { text: m.label }));
  main.addEventListener('click', () => (m.menu ? openWishMenu(main, g) : m.run(main)));
  const like = el('button', { class: `sp-act like${g.liked ? ' on' : ''}`, title: g.liked ? 'Unlike' : 'Like', onclick: e => toggleLike(g, e.currentTarget) },
    el('span', { html: ICONS.heart }), el('span', { text: g.liked ? 'Liked' : 'Like' }), el('span', { class: 'n', text: String(g.likes || 0) }));
  const wish = !storeInLib(g) && g.stage !== 'soon' && p.full > 0 && !g.owned ? el('button', { class: `sp-act wish${g.wishlisted ? ' on' : ''}`, 'data-menu-btn': '', title: 'Wishlist: get told when it goes on sale' },
    el('span', { html: ICONS[g.wishlisted ? 'bookmarkCheck' : 'bookmark'] }), el('span', { text: g.wishlisted ? 'Wishlisted' : 'Wishlist' })) : null;
  wish?.addEventListener('click', () => openWishMenu(wish, g));
  return [
    p.full > 0 && g.owned !== true && !g.keyed && g.stage !== 'soon' ? el('div', { class: 'sp-price' },
      priceEl(g, true, false),
      p.sale ? el('span', { class: 'sp-ends', title: new Date(p.until).toLocaleString() }, el('span', { html: ICONS.clock }), `sale ends in ${timeLeft(p.until)}`) : null) : null,
    main,
    m.sub ? el('div', { class: 'sp-sub', text: m.sub }) : null,
    el('div', { class: `sp-acts${wish ? '' : ' one'}` }, like, wish),
  ].filter(Boolean);
}
function factsBlock(g) {
  const rows = [];
  const add = (icon, k, v, cls = '') => rows.push(el('div', { class: 'sf-k' }, el('span', { html: ICONS[icon] }), k), el('div', { class: `sf-v ${cls}`, text: v }));
  const s = stageInfo(g);
  if (g.stage === 'soon') add('calendar', 'Release', capWord(s?.text || 'coming soon'), 'soon');
  else if (g.released > 0) add('calendar', 'Released', new Date(g.released * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }));
  if (g.stage === 'early') add('sparkles', 'Stage', 'Early access', 'early');
  if (winOnly(g)) add('windows', 'Platform', 'Windows only', 'muted');
  if (!g.official && g.players > 0) add('users', 'Players', Number(g.players).toLocaleString());
  add('activity', 'Plays (30 days)', Number(g.plays30 || 0).toLocaleString());
  add('heart', 'Likes', Number(g.likes || 0).toLocaleString());
  if (g.wishlists > 0) add('bookmark', 'Wishlists', Number(g.wishlists).toLocaleString());
  add('trophy', 'Achievements', g.achievements > 0 ? String(g.achievements) : 'None');
  add('controller', 'Controller', g.controller === true ? 'Supported' : g.controller === 'partial' ? 'Partly supported' : g.controller === false ? 'Not supported' : 'Not stated', g.controller === false ? 'muted' : '');
  add('cloud', 'Cloud saves', g.saveData ? 'Yes' : 'No', g.saveData ? '' : 'muted');
  if (g.version) add('refresh', 'Version', /^v/i.test(g.version) ? g.version : `v${g.version}`);
  if (g.size > 0) add('drive', 'Size', fmtBytes(g.size));
  return rows;
}
function betasBlock(g) {
  const a = appOf(g);
  const list = (S.betas?.[g.id] || []).filter(b => b.public || b.member);
  if (!a || !list.length) return null;
  return el('section', { class: 'sp-box' }, el('div', { class: 'box-h' }, el('span', { class: 'bh-ico beta', html: ICONS.flask }), 'betas'),
    ...list.map(b => {
      const notes = String(b.notes || '').trim();
      let act;
      if (b.member) act = el('button', { class: 'btn ghost', text: 'Open in library', onclick: () => { setTab('library'); selectApp(a.id); } });
      else {
        act = el('button', { class: 'btn', text: 'Join', disabled: !S.account || S.offlineMode });
        act.addEventListener('click', () => joinPublicBeta(a, b, act));
      }
      return el('div', { class: 'sp-beta' },
        el('div', { class: 'grow' }, el('b', { text: b.name }), betaVer(b) ? el('span', { class: 'tg', text: betaVer(b) }) : null,
          el('span', { class: `tg ${b.member ? 'in' : ''}`, text: b.member ? "you're in" : 'public' }),
          notes ? el('span', { class: 'sp-bnotes', text: notes, title: notes }) : null),
        act);
    }));
}
function linksBlock(g) {
  const links = (Array.isArray(g.links) ? g.links : []).filter(l => l && l.url);
  if (!links.length) return null;
  return el('section', { class: 'sp-box' }, el('div', { class: 'box-h', text: 'links' }),
    el('div', { class: 'sp-links' }, ...links.map(l => {
      const type = String(l.type || 'link').toLowerCase();
      const known = !!ICONS.social[type];
      return el('button', { class: 'sp-link', title: l.url, onclick: () => hf.openUrl(l.url) },
        el('span', { class: 'sl-ico', html: ICONS.social[type] || ICONS.social.link, style: `color:${SOCIAL_COLORS[known ? type : 'link']}` }),
        el('span', { class: 'grow', text: l.title || capWord(type) }), el('span', { class: 'sl-ext', html: ICONS.external }));
    })));
}
function gamePage(id) {
  const g = sGame(id);
  if (!g) return [storeEmpty("This game isn't in the store", "It may have been taken down, or it isn't out for your account.", el('button', { class: 'btn ghost', text: 'Back to the store', onclick: () => storeHome() }))];
  const media = mediaViewer(g);
  const tags = [
    stageTagEl(g, 'tg'),
    winOnlyTagEl(g, 'tg'),
    el('span', { class: 'tg', text: String(g.type || 'Game') }),
    g.official ? el('span', { class: 'tg off', text: 'official' }) : el('span', { class: 'tg', text: 'community' }),
  ].filter(Boolean);
  const color = !g.official && safeColor(g.authorColor);
  const buy = el('div', { class: 'sp-buy' });
  const facts = el('div', { class: 'sp-facts' });
  const desc = descOf(g);
  const art = artOf(g);
  const box = el('article', { class: 'sp' },
    el('header', { class: 'sp-hero' },
      el('div', { class: 'sp-hero-art' }, artImg(art)),
      el('div', { class: 'sp-hero-shade' }),
      el('div', { class: 'sp-hero-in' }, logoEl(g, 'sp-logo', 'sp-title'))),
    el('div', { class: 'sp-grid' },
      el('div', { class: 'sp-left' },
        media ? media.box : null,
        el('section', { class: 'sp-box' }, el('div', { class: 'box-h', text: `about ${g.name}` }),
          el('div', { class: `sp-desc${desc ? '' : ' muted'}`, text: desc || 'No description' })),
        linksBlock(g),
        betasBlock(g)),
      el('aside', { class: 'sp-side' },
        el('div', { class: 'sp-card' },
          el('div', { class: 'sp-id' }, el('span', { class: 'sp-ico' }, iconEl(g)),
            el('div', { class: 'sp-idt' }, el('b', { text: g.name }),
              el('span', { class: 'sp-by' }, g.official ? 'Hyperfocus' : ['by ', el('span', { text: g.author || '?', style: color ? `color:${color}` : null })]))),
          el('p', { class: `sp-short${desc ? '' : ' muted'}`, text: desc ? shortText(desc, 200) : 'No description' }),
          el('div', { class: 'sp-tags' }, ...tags),
          buy),
        facts)));
  page = { id, g, box, buy, facts, key: '', stopMedia: media?.stop, pauseMedia: media?.pause, nav: media?.nav };
  refreshPage();
  return [box];
}
function refreshPage() {
  const P = page;
  if (!P || !P.box.isConnected && P.key) return;
  const g = P.g, a = appOf(g);
  const key = JSON.stringify([g.liked, g.likes, g.wishlisted, g.wishlistNotify, g.wishlists, g.owned, g.price, g.sale, storeInLib(g),
    a && [S.status[a.id], gameRunning(a)], Math.floor(Date.now() / 60000)]);
  if (key === P.key) return;
  P.key = key;
  P.buy.replaceChildren(...buyBlock(g));
  P.facts.replaceChildren(...factsBlock(g));
}

function renderChips() {
  const cats = store.data?.categories || [];
  const v = store.view;
  const on = id => (id === 'home' ? v.kind === 'home' && !store.q : v.kind === 'cat' && v.id === id);
  $('#st-chips').replaceChildren(
    el('button', { class: `chip${on('home') ? ' on' : ''}`, onclick: () => storeHome() }, el('span', { class: 'chip-ico', html: ICONS.store }), 'Home'),
    ...cats.map(c => el('button', { class: `chip${on(c.id) ? ' on' : ''}${c.id === 'wishlist' ? ' wish' : ''}`, title: c.title, onclick: () => (on(c.id) ? null : store.view.kind === 'cat' ? (store.view = { kind: 'cat', id: c.id }, store.scrollTo = 0, renderStore()) : storeGo({ kind: 'cat', id: c.id })) },
      CHIP_LABEL[c.id] || c.title, el('span', { class: 'n', text: String(c.ids.length) }))));
}
function renderStore() {
  if (!S || typeof tab === 'undefined') return;
  const who = S.account?.username || '';
  if (who !== store.user) {
    stopPageMedia();
    Object.assign(store, { user: who, data: null, map: null, at: 0, error: '', stack: [], view: { kind: 'home' }, q: '', key: '', scrollTo: 0, feat: 0 });
    page = null;
    $('#st-q').value = '';
    drops.checked = false;
  }
  const opened = tab === 'store' && store.shownTab !== 'store';
  store.shownTab = tab;
  if (tab !== 'store' || !S.account || S.offlineMode) { if (page) { page.pauseMedia?.(); setPageTrailer(false); } return; }
  if (opened || (!store.data && !store.loading && !store.error)) loadStore();
  const v = store.view;
  $('#st-back').hidden = !store.stack.length && !store.q;
  const key = JSON.stringify([store.ver, v.kind === 'game' ? 0 : store.lver, v, store.q, store.error, !store.data && !!store.loading,
    v.kind === 'game' ? '' : libraryList().map(a => a.id).join()]);
  if (key !== store.key) {
    store.key = key;
    renderChips();
    stopPageMedia();
    page = null;
    let nodes;
    if (!store.data) {
      nodes = store.loading ? storeSkeleton() : [storeEmpty("Couldn't load the store", store.error || 'Something went wrong.',
        el('button', { class: 'btn', text: 'Try again', onclick: () => loadStore(true) }))];
    } else if (v.kind === 'game') nodes = gamePage(v.id);
    else if (v.kind === 'cat') nodes = catView(v.id);
    else nodes = store.q.trim() ? searchView(store.q) : homeView();
    const view = $('#st-view');
    view.replaceChildren(...nodes.filter(Boolean));
    view.className = v.kind === 'game' ? 'is-game' : '';
    if (!reduceMotion()) { view.classList.remove('st-anim'); void view.offsetWidth; view.classList.add('st-anim'); }
    if (store.scrollTo != null) { storeScroll().scrollTop = store.scrollTo; store.scrollTo = null; }
  } else if (v.kind === 'game') refreshPage();
}

const drops = { checked: false, busy: false };
function maybeShowDrops() {
  if (drops.checked || drops.busy || !S || !revealed || !S.account || S.offlineMode || !S.manifestChecked || S.serverDown || needLogin()) return;
  if (S.settings.newGamesPopup === false) { drops.checked = true; return; }
  drops.busy = true;
  hf.storeDrops().then(async list => {
    const seen = Number(S.settings.dropsSeen) || 0;
    const newer = list.filter(d => Number(d.at) > seen);
    drops.checked = true;
    if (!newer.length) return;
    const newest = Math.max(...newer.map(d => Number(d.at)));
    await loadStore();
    if (!store.map) { setTimeout(() => { drops.checked = false; }, 60000); return; }
    const games = newer.map(d => sGame(d.appId)).filter(g => g && !storeInLib(g));
    if (!games.length) { setS({ dropsSeen: newest }); return; }
    showDrops(games, newest);
  }).catch(() => { drops.checked = true; }).finally(() => { drops.busy = false; });
}
function dropActs(g) {
  const view = el('button', { class: 'btn ghost', onclick: () => { closeModal('drops'); setTab('store'); openStorePage(g.id); } }, el('span', { text: 'View in store' }));
  const p = priceView(g);
  let main;
  if (g.stage === 'soon') {
    main = el('button', { class: `btn${g.wishlisted ? ' on' : ''}` }, el('span', { class: 'btn-ico', html: ICONS[g.wishlisted ? 'bookmarkCheck' : 'bookmark'] }), el('span', { text: g.wishlisted ? 'On your wishlist' : 'Wishlist' }));
    main.disabled = !!g.wishlisted;
    main.addEventListener('click', async () => {
      main.disabled = true;
      const r = await attempt(() => hf.storeWishlist(g.id, true, g.wishlistNotify || 'both'));
      if (!r) { main.disabled = false; return; }
      setWish(g, r);
      main.lastChild.textContent = 'On your wishlist';
      main.firstChild.innerHTML = ICONS.bookmarkCheck;
      toast(`${g.name} is on your wishlist - you'll hear by ${NOTIFY_LABEL[r.notify] || 'email'} when it's out.`, 'ok');
    });
  } else if (p.full > 0 && !g.owned) {
    main = el('button', { class: `btn${p.sale ? ' sale' : ''}`, onclick: () => storeBuy(g) }, el('span', { class: 'btn-ico', html: ICONS.tag }), el('span', { text: `Buy for ${credits(p.now)}` }));
  } else {
    main = el('button', { class: 'btn' }, el('span', { class: 'btn-ico', html: ICONS.plus }), el('span', { text: 'Add to library' }));
    main.addEventListener('click', async () => {
      const r = await storeAdd(g, main);
      if (!r) return;
      main.replaceWith(el('button', { class: 'btn', onclick: () => { closeModal('drops'); setTab('library'); selectApp(r.id); } },
        el('span', { class: 'btn-ico', html: ICONS.library }), el('span', { text: 'Open in library' })));
    });
  }
  return el('div', { class: 'dr-acts' }, view, main);
}
function showDrops(games, newest) {
  const one = games.length === 1;
  const keep = check('Show new games when Hyperfocus opens', '', S.settings.newGamesPopup !== false, v => setS({ newGamesPopup: v }));
  let body;
  if (one) {
    const g = games[0];
    body = el('div', { class: 'dr-one' },
      el('div', { class: 'dr-hero' }, artImg(artOf(g)), el('div', { class: 'dr-shade' }),
        el('div', { class: 'dr-hero-in' },
          el('div', { class: 'feat-kicker' }, el('span', { html: ICONS.sparkles }), el('span', { text: g.stage === 'soon' ? 'Coming soon' : 'New on Hyperfocus' })),
          logoEl(g, 'dr-logo', 'dr-title'))),
      el('div', { class: 'dr-body' },
        el('div', { class: 'dr-id' }, el('span', { class: 'sp-ico' }, iconEl(g)),
          el('div', { class: 'sp-idt' }, el('b', { text: g.name }), el('span', { class: 'sp-by', text: byLine(g) }))),
        el('p', { class: `dr-desc${descOf(g) ? '' : ' muted'}`, text: descOf(g) ? shortText(descOf(g), 320) : 'No description' }),
        el('div', { class: 'dr-meta' }, stageTagEl(g, 'tg'), winOnlyTagEl(g, 'tg'), el('span', { class: 'tg', text: String(g.type || 'Game') }), likesEl(g), el('span', { class: 'grow' }), g.stage === 'soon' ? null : priceEl(g, true)),
        dropActs(g)));
  } else {
    body = el('div', { class: 'dr-many' },
      el('div', { class: 'dr-head' }, el('div', { class: 'st-kicker', text: 'New on Hyperfocus' }), el('div', { class: 'dr-htitle', text: 'New games since you were last here' })),
      el('div', { class: 'dr-grid' }, ...games.map((g, i) => storeCard(g, i, x => { closeModal('drops'); setTab('store'); openStorePage(x.id); }))));
  }
  const back = openModal('drops', one ? 'a new game is out' : `${games.length} new games`, el('div', { class: `drops${one ? ' one' : ''}` }, body,
    el('div', { class: 'dr-foot' }, keep, el('button', { class: 'btn ghost', text: 'Close', onclick: () => closeModal('drops') }))),
  { onclose: () => setS({ dropsSeen: Math.max(newest, Number(S.settings.dropsSeen) || 0) }) });
  back.classList.add('drops-back');
}
