'use strict';
/* global hf, ICONS, VoiceUI */
const btnMin = document.querySelector('#btn-min');
const btnClose = document.querySelector('#btn-close');
btnMin.innerHTML = ICONS.min;
btnClose.innerHTML = ICONS.close;
btnMin.onclick = () => hf.selfMin();
btnClose.onclick = () => hf.selfClose();
VoiceUI.mount(document.querySelector('#voice-root'));
