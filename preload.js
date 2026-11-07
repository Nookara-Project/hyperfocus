'use strict';
const { contextBridge, ipcRenderer } = require('electron');

async function call(channel, ...args) {
  const r = await ipcRenderer.invoke(channel, ...args);
  if (!r || !r.ok) throw new Error(r?.error || 'Something went wrong');
  return r.value;
}

const EVENTS = ['state', 'fx', 'login', 'toast', 'visible', 'confirmClose', 'selectApp',
  'social', 'notify', 'overlay', 'openMail', 'im', 'imEdited', 'imReactions', 'imError', 'typing', 'voice', 'voiceCmd', 'voiceLevels',
  'openProfile', 'openChat', 'shots', 'openShot', 'gameInvite', 'media', 'notifyDismiss', 'groupMessage', 'groupUpdate', 'achievement', 'cloudConflict', 'joinWhich', 'gamePerms', 'gamePermsState', 'storePage'];

if (process.platform === 'darwin') {
  const mark = () => document.documentElement.classList.add('mac');
  if (document.documentElement) mark();
  else new MutationObserver((_m, o) => { if (document.documentElement) { o.disconnect(); mark(); } }).observe(document, { childList: true });
}

contextBridge.exposeInMainWorld('hf', {
  platform: process.platform,
  getState: () => call('state:get'),
  refresh: () => call('state:refresh'),
  setOfflineMode: on => call('offline:set', on),
  install: (id, root) => call('app:install', id, root),
  installWhere: (id, root) => call('install:where', id, root),
  pickInstallFolder: current => call('install:pick', current),
  pause: id => call('app:pause', id),
  cancel: id => call('app:cancel', id),
  launch: id => call('app:launch', id),
  uninstall: id => call('app:uninstall', id),
  openFolder: id => call('app:folder', id),
  setSettings: patch => call('settings:set', patch),
  pickFolder: kind => call('settings:pickFolder', kind),

  communityRemove: id => call('community:remove', id),

  storeGet: () => call('store:get'),
  storeLike: (id, on) => call('store:like', id, on),
  storeWishlist: (id, on, notify) => call('store:wishlist', id, on, notify),
  storeDrops: () => call('store:drops'),
  libraryAdd: id => call('library:add', id),
  libraryRemove: id => call('library:remove', id),

  betaRefresh: () => call('beta:refresh'),
  betaJoin: id => call('beta:join', id),
  betaLeave: id => call('beta:leave', id),
  betaRedeem: code => call('beta:redeem', code),
  redeemCode: code => call('code:redeem', code),
  betaChoose: (appId, betaId) => call('beta:choose', appId, betaId),
  betaInstall: appId => call('beta:install', appId),
  betaLaunch: appId => call('beta:launch', appId),
  betaUninstall: appId => call('beta:uninstall', appId),

  mediaGet: () => call('media:get'),
  mediaCmd: cmd => call('media:cmd', cmd),

  inviteState: () => call('invite:state'),
  inviteSend: name => call('invite:send', name),
  inviteJoin: (appId, code, from) => call('invite:join', appId, code, from),

  shotsList: id => call('shots:list', id),
  shotThumb: file => call('shots:thumb', file),
  shotView: file => call('shots:view', file),
  shotOpen: file => call('shots:open', file),
  shotReveal: file => call('shots:reveal', file),
  shotFolder: id => call('shots:folder', id),
  shotUpload: file => call('shots:upload', file),
  login: () => call('auth:login'),
  reopenLogin: () => call('auth:reopen'),
  cancelLogin: () => call('auth:cancel'),
  logout: () => call('auth:logout'),
  accountCenter: () => call('auth:center'),
  openUrl: url => call('open:url', url),
  resolveMusic: url => call('music:resolve', url),
  updateLauncher: () => call('launcher:update'),
  setLauncherChannel: beta => call('launcher:channel', beta),
  focusLauncher: () => call('launcher:show'),

  social: () => call('social:get'),
  imConversations: () => call('im:conversations'),
  imThread: (name, before) => call('im:thread', name, before),
  imRead: name => call('im:read', name),
  imSend: (to, message) => call('im:send', to, message),
  dmStatus: () => call('dm:status'),
  dmUnlock: value => call('dm:unlock', value),
  dmRecovery: code => call('dm:recovery', code),
  dmLink: () => call('dm:link'),
  dmFile: (dataUrl, name, mime) => call('dm:file', dataUrl, name, mime),
  imFind: id => call('im:find', id),
  groups: () => call('groups:list'),
  groupMessages: room => call('groups:messages', room),
  groupSend: (room, message) => call('groups:send', room, message),
  groupCreate: (name, members) => call('groups:create', name, members),
  groupAdd: (room, name) => call('groups:add', room, name),
  groupRemove: (room, name) => call('groups:remove', room, name),
  groupRename: (room, name) => call('groups:rename', room, name),
  groupDelete: room => call('groups:delete', room),
  openMessages: mailId => call('messages:open', mailId),
  openPanel: (kind, arg) => call('panel:open', kind, arg),
  chatTyping: (to, typing) => call('chat:typing', to, typing),
  mediaUpload: dataUrl => call('media:upload', dataUrl),

  voiceCmd: cmd => call('voice:cmd', cmd),
  voiceGet: () => call('voice:get'),
  voiceState: state => call('voice:state', state),
  voiceLevels: levels => call('voice:levels', levels),
  voiceInvite: (to, room) => call('voice:invite', to, room),
  voiceToken: () => call('voice:token'),
  cloudCheck: (id, force) => call('cloud:check', id, force),
  cloudResolve: (reqId, choice) => call('cloud:resolve', reqId, choice),
  joinResolve: (reqId, choice) => call('join:resolve', reqId, choice),
  gamePermsResolve: (reqId, choice) => call('gameperms:resolve', reqId, choice),
  gamePermsCancel: () => call('gameperms:cancel'),
  gameLoginForget: id => call('gamelogin:forget', id),
  cloudToggle: (id, on) => call('cloud:toggle', id, on),
  cloudOpen: id => call('cloud:open', id),
  cloudBackups: id => call('cloud:backups', id),
  achDone: () => call('ach:done'),
  achStats: game => call('ach:stats', game),
  ownerStats: () => call('owner:stats'),
  devTool: (name, arg) => call('dev:tool', name, arg),
  voiceCallEvent: ev => call('voice:callEvent', ev),

  profile: name => call('people:profile', name),
  profilePage: name => call('people:page', name),
  joinFriend: name => call('friend:join', name),
  showProfile: name => call('people:show', name),
  friendRequests: () => call('people:requests'),
  userInfo: name => call('user:info', name),
  addFriend: name => call('friend:add', name),
  acceptFriend: id => call('friend:accept', id),
  declineFriend: id => call('friend:decline', id),
  removeFriend: name => call('friend:remove', name),
  openChat: name => call('messages:chat', name),

  overlayHide: () => call('overlay:hide'),
  closeGame: id => call('app:close', id),
  setConsole: on => call('console:set', on),
  padSeen: info => call('pad:seen', info),
  padGuide: () => call('pad:guide'),
  notifMouse: inside => call('notif:mouse', inside),
  notifEmpty: () => call('notif:empty'),
  notifClick: action => call('notif:click', action),

  selfMin: () => call('self:min'),
  selfClose: () => call('self:close'),

  win: {
    drag: () => call('win:drag'),
    dragEnd: () => call('win:dragEnd'),
    minimize: () => call('win:min'),
    close: force => call('win:close', force),
  },
  on: (event, cb) => {
    if (!EVENTS.includes(event)) return;
    ipcRenderer.on('hf:' + event, (_e, data) => cb(data));
  },
});
