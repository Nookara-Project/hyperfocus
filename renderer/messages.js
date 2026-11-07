'use strict';
/* global hf, ICONS, MailUI */

const btnMin = document.querySelector('#btn-min');
const btnClose = document.querySelector('#btn-close');
btnMin.innerHTML = ICONS.min;
btnClose.innerHTML = ICONS.close;
btnMin.onclick = () => hf.selfMin();
btnClose.onclick = () => hf.selfClose();

const ui = MailUI.mount(document.querySelector('#mail-root'));
const first = new URLSearchParams(location.search).get('mail');
if (first) ui.openMail(first, { reply: true });
hf.on('openMail', id => ui.openMail(id, { reply: true }));
const chatTo = new URLSearchParams(location.search).get('chat');
if (chatTo) ui.chatWith(chatTo);
hf.on('openChat', name => ui.chatWith(name));
hf.on('state', s => document.body.classList.toggle('still', s.settings?.videoBackgrounds === false));
