'use strict';
// Stroke icons, 24x24, currentColor.
(() => {
  const sv = (d, extra = '') =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
  const dot = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="currentColor" stroke="none"/>`;

  window.ICONS = {
    user: sv('<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c1.2-3.6 4-5.4 7.5-5.4s6.3 1.8 7.5 5.4"/>'),
    gear: sv('<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>'),
    min: sv('<path d="M6.5 12h11"/>'),
    max: sv('<path d="M9 4.5H4.5V9M15 4.5h4.5V9M9 19.5H4.5V15M15 19.5h4.5V15"/>'),
    restore: sv('<path d="M4.5 9H9V4.5M19.5 9H15V4.5M4.5 15H9v4.5M19.5 15H15v4.5"/>'),
    close: sv('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>'),
    camera: sv('<path d="M4 8h3l1.6-2.5h6.8L17 8h3v11H4z"/><circle cx="12" cy="13.2" r="3.4"/>'),
    upload: sv('<path d="M12 15V4.5M7.5 9L12 4.5 16.5 9"/><path d="M4.5 15v4.5h15V15"/>'),
    clock: sv('<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>'),
    sparkles: sv('<path d="M10.5 4l1.9 5.1 5.1 1.9-5.1 1.9-1.9 5.1-1.9-5.1L3.5 11l5.1-1.9z"/><path d="M18.5 15v5M16 17.5h5"/>'),
    calendar: sv('<rect x="4.5" y="5.5" width="15" height="14" rx="1"/><path d="M4.5 10h15M9 3.5v4M15 3.5v4"/>'),
    prev: sv('<path d="M6.5 5.5v13"/><path d="M18 6.2l-8.5 5.8 8.5 5.8z" fill="currentColor"/>'),
    next: sv('<path d="M17.5 5.5v13"/><path d="M6 6.2l8.5 5.8L6 17.8z" fill="currentColor"/>'),
    music: sv('<path d="M9 17.5V6l10-2v11.5"/><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="15.5" r="2.5"/>'),
    left: sv('<path d="M14.5 6l-6 6 6 6"/>'),
    right: sv('<path d="M9.5 6l6 6-6 6"/>'),
    menu: sv('<path d="M5 7.5h14M5 12h14M5 16.5h14"/>'),
    play: sv('<circle cx="12" cy="12" r="9"/><path d="M10.2 8.6v6.8l5.4-3.4z" fill="currentColor"/>'),
    download: sv('<circle cx="12" cy="12" r="9"/><path d="M12 7.5v8M8.5 12.5 12 16l3.5-3.5"/>'),
    update: sv('<circle cx="12" cy="12" r="9"/><path d="M15.6 10.2a4 4 0 1 0 .3 3.4M15.9 7.4v2.9H13"/>'),
    pause: sv('<circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/>'),
    spinner: sv('<circle cx="12" cy="12" r="9" opacity=".25"/><path d="M21 12a9 9 0 0 0-9-9"/>', 'class="spin"'),
    lock: sv('<rect x="6" y="10.5" width="12" height="9" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>'),
    windows: sv('<rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/>'),
    grid: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="7" height="7" rx="1.6"/><rect x="13" y="4" width="7" height="7" rx="1.6"/><rect x="4" y="13" width="7" height="7" rx="1.6"/><rect x="13" y="13" width="7" height="7" rx="1.6"/></svg>',
    trailer: sv('<path d="M7.5 4.8v14.4L19.2 12z" fill="currentColor"/>'),
    video: sv('<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="M10.5 9.5v5l4-2.5z" fill="currentColor"/>'),
    image: sv('<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="m20.5 16-5-5-8 7.5"/>'),
    vol: sv('<path d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
    volOff: sv('<path d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>'),
    folder: sv('<path d="M3.5 7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>'),
    repair: sv('<path d="M14.5 4.5a4.5 4.5 0 0 0-4.2 6.1L4.6 16.3a2.1 2.1 0 0 0 3 3l5.7-5.7a4.5 4.5 0 0 0 6.1-4.2l-2.7 2.7-2.6-.5-.5-2.6z"/>'),
    trash: sv('<path d="M4.5 7h15M9.5 7V5h5v2M6.5 7l1 12.5h9l1-12.5"/>'),
    refresh: sv('<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4"/>'),
    xcircle: sv('<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>'),
    external: sv('<path d="M13.5 4.5h6v6M19.5 4.5l-8 8M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>'),
    logout: sv('<path d="M14 4.5h4.5a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5H14M10 8l-4 4 4 4M6 12h10"/>'),
    users: sv('<circle cx="9" cy="8" r="3.3"/><path d="M2.5 19.5c1-3.2 3.5-4.9 6.5-4.9s5.5 1.7 6.5 4.9"/><path d="M15.5 5a3.2 3.2 0 0 1 0 6.2M17.5 14.9c2 .7 3.3 2.2 4 4.6"/>'),
    userPlus: sv('<circle cx="10" cy="8" r="3.6"/><path d="M3 20c1.1-3.4 3.8-5.2 7-5.2 1.5 0 2.9.4 4 1.1M18 13v6M15 16h6"/>'),
    mic: sv('<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5"/>'),
    micOff: sv('<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5M4 4l16 16"/>'),
    headphones: sv('<path d="M4.5 16v-3a7.5 7.5 0 0 1 15 0v3"/><rect x="3.5" y="14" width="4" height="6" rx="1.5"/><rect x="16.5" y="14" width="4" height="6" rx="1.5"/>'),
    headphonesOff: sv('<path d="M4.5 16v-3a7.5 7.5 0 0 1 15 0v3"/><rect x="3.5" y="14" width="4" height="6" rx="1.5"/><rect x="16.5" y="14" width="4" height="6" rx="1.5"/><path d="M4 4l16 16"/>'),
    eye: sv('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>'),
    eyeOff: sv('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><path d="M4 4l16 16"/>'),
    cloud: sv('<path d="M7.5 18.5h9.5a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7 9.6 4.5 4.5 0 0 0 7.5 18.5z"/>'),
    copy: sv('<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>'),
    pin: sv('<path d="M9 3.5h6M10 3.5v5.5l-3 3.5h10l-3-3.5V3.5M12 12.5v8"/>'),
    mail: sv('<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m4.5 7 7.5 6 7.5-6"/>'),
    send: sv('<path d="M20.5 3.5 10 14M20.5 3.5 14 20.5l-4-6.5-6.5-4z"/>'),
    reply: sv('<path d="M9.5 6.5 4.5 11.5l5 5"/><path d="M4.5 11.5h9a6 6 0 0 1 6 6v1"/>'),
    edit: sv('<path d="M4.5 19.5h4l10-10a2.8 2.8 0 0 0-4-4l-10 10z"/><path d="m13.5 6.5 4 4"/>'),
    idcard: sv('<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><circle cx="9" cy="11" r="2"/><path d="M6 16c.6-1.5 1.7-2.2 3-2.2s2.4.7 3 2.2M14.5 10h3.5M14.5 13.5h3.5"/>'),
    warn: sv('<path d="M12 4 21 19.5H3z"/><path d="M12 10v4.2"/>' + dot(12, 16.9, 1)),
    flask: sv('<path d="M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2"/><path d="M6.453 15h11.094M8.5 2h7"/>'),
    heart: sv('<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z"/>'),
    bookmark: sv('<path d="M18.5 20.5 12 16.5l-6.5 4V5A1.5 1.5 0 0 1 7 3.5h10A1.5 1.5 0 0 1 18.5 5z"/>'),
    bookmarkCheck: sv('<path d="M18.5 20.5 12 16.5l-6.5 4V5A1.5 1.5 0 0 1 7 3.5h10A1.5 1.5 0 0 1 18.5 5z"/><path d="m9 9.5 2 2 4-4"/>'),
    search: sv('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.4-4.4"/>'),
    store: sv('<path d="M6 3 3.5 6.5v12.5A1.5 1.5 0 0 0 5 20.5h14a1.5 1.5 0 0 0 1.5-1.5V6.5L18 3z"/><path d="M3.5 6.5h17M15.5 10a3.5 3.5 0 0 1-7 0"/>'),
    library: sv('<path d="M4.5 4v16M8.5 7v13M12.5 7v13"/><path d="m15.5 7.5 4 12.5"/>'),
    tag: sv('<path d="M12.6 3.1a1.5 1.5 0 0 0-1.1-.4H4.2a1.5 1.5 0 0 0-1.5 1.5v7.3a1.5 1.5 0 0 0 .4 1.1l8.7 8.7a2 2 0 0 0 2.8 0l6.7-6.7a2 2 0 0 0 0-2.8z"/>' + dot(7.6, 7.6, 1.3)),
    check: sv('<path d="M19.5 6.5 9.5 17l-5-5"/>'),
    key: sv('<circle cx="7.5" cy="15.5" r="4"/><path d="m10.4 12.6 9.1-9.1M16.5 6.5l2.5 2.5M14 9l2 2"/>'),
    plus: sv('<path d="M12 5v14M5 12h14"/>'),
    arrowLeft: sv('<path d="M19.5 12h-15M11 5.5 4.5 12l6.5 6.5"/>'),
    trophy: sv('<path d="M7 4.5h10V10a5 5 0 0 1-10 0z"/><path d="M7 6.5H4.5a2.5 2.5 0 0 0 3 3.6M17 6.5h2.5a2.5 2.5 0 0 1-3 3.6M12 15v3.5M8 20.5h8"/>'),
    flame: sv('<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4.1 2-6 .5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>'),
    bell: sv('<path d="M6 8.5a6 6 0 0 1 12 0c0 6.5 2.5 8.5 2.5 8.5h-17S6 15 6 8.5"/><path d="M10.3 20.5a2 2 0 0 0 3.4 0"/>'),
    activity: sv('<path d="M21.5 12h-4l-3 8.5-5-17-3 8.5h-4"/>'),
    drive: sv('<path d="M21.5 12.5h-19M5.6 5.4 2.5 12.5v5A1.5 1.5 0 0 0 4 19h16a1.5 1.5 0 0 0 1.5-1.5v-5l-3.1-7.1A1.5 1.5 0 0 0 17 4.5H7a1.5 1.5 0 0 0-1.4.9z"/>' + dot(6.5, 15.8, 1) + dot(10, 15.8, 1)),
    hyperfocusLogo: '<svg class="hf-logo" viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true"><rect x="5" y="5" width="10" height="10" fill="currentColor"/><rect x="49" y="5" width="10" height="10" fill="currentColor"/><rect x="5" y="16" width="10" height="10" fill="currentColor"/><rect x="49" y="16" width="10" height="10" fill="currentColor"/><rect x="5" y="27" width="10" height="10" fill="#9d8ad1"/><rect x="16" y="27" width="10" height="10" fill="#9d8ad1"/><rect x="27" y="27" width="10" height="10" fill="#9d8ad1"/><rect x="38" y="27" width="10" height="10" fill="#9d8ad1"/><rect x="49" y="27" width="10" height="10" fill="#9d8ad1"/><rect x="5" y="38" width="10" height="10" fill="currentColor"/><rect x="49" y="38" width="10" height="10" fill="currentColor"/><rect x="5" y="49" width="10" height="10" fill="currentColor"/><rect x="49" y="49" width="10" height="10" fill="currentColor"/></svg>',
    veloraLogo: '<svg class="vl-logo" viewBox="0 0 100 100" aria-hidden="true">'
      + '<rect class="vlm-a" x="20" y="20" width="60" height="16" fill="#9d8ad1"/>'
      + '<rect class="vlm-b" x="20" y="42" width="60" height="16" fill="#8a8a92"/>'
      + '<rect class="vlm-c" x="20" y="64" width="60" height="16" fill="#8a8a92" fill-opacity="0.5"/></svg>',
    newspaper: sv('<path d="M5.5 4.5h11v15h-11A1.5 1.5 0 0 1 4 18V6a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M16.5 8.5h3V18a1.5 1.5 0 0 1-3 0M7.5 8h6M7.5 11.5h6M7.5 15h4"/>'),
    controller: sv('<path d="M7.2 7h9.6a4.2 4.2 0 0 1 4.1 3.4l.9 4.8a2.6 2.6 0 0 1-4.5 2.2L15.6 15.5H8.4l-1.7 1.9a2.6 2.6 0 0 1-4.5-2.2l.9-4.8A4.2 4.2 0 0 1 7.2 7z"/><path d="M7.5 10.2v3M6 11.7h3"/>' + dot(15.6, 10.6, 0.9) + dot(17.6, 12.6, 0.9)),
    globe: sv('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>'),
    logIn: sv('<path d="M14.5 4.5h4a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-4M10 16.5l4.5-4.5L10 7.5M14.5 12H4"/>'),
    messageSquare: sv('<path d="M20.5 15a1.5 1.5 0 0 1-1.5 1.5H8l-4.5 4V5A1.5 1.5 0 0 1 5 3.5h14A1.5 1.5 0 0 1 20.5 5z"/>'),
    userCheck: sv('<circle cx="10" cy="8" r="3.6"/><path d="M3 20c1.1-3.4 3.8-5.2 7-5.2 1.5 0 2.9.4 4 1.1M15.5 17l2 2 4-4"/>'),
    more: sv(dot(5.5, 12, 1.5) + dot(12, 12, 1.5) + dot(18.5, 12, 1.5)),
    social: {
      website: sv('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>'),
      discord: sv('<path d="M8.5 6.5c-1.6.3-3 .9-4 1.6-1.4 2.3-2 4.9-1.8 8 1.3 1 2.8 1.7 4.3 2.1l1-1.8M15.5 6.5c1.6.3 3 .9 4 1.6 1.4 2.3 2 4.9 1.8 8-1.3 1-2.8 1.7-4.3 2.1l-1-1.8M7 16.3c3.2 1.3 6.8 1.3 10 0M8.3 7.6c2.4-.6 5-.6 7.4 0"/>' + dot(9.3, 12.4, 1.25) + dot(14.7, 12.4, 1.25)),
      reddit: sv('<ellipse cx="12" cy="14.2" rx="7.6" ry="5.3"/><path d="M12 8.9l1.3-4.7 3.9.9"/><circle cx="18.6" cy="5.3" r="1.5"/><circle cx="4.9" cy="10.7" r="1.7"/><circle cx="19.1" cy="10.7" r="1.7"/><path d="M9.4 16.8c1.6 1 3.6 1 5.2 0"/>' + dot(9.3, 13.7, 1) + dot(14.7, 13.7, 1)),
      youtube: sv('<rect x="2.5" y="6" width="19" height="12" rx="3.5"/><path d="M10.3 9.4v5.2l4.4-2.6z" fill="currentColor"/>'),
      x: sv('<path d="M5 4.5h3.8L19 19.5h-3.8z"/><path d="M18.5 4.5l-5.3 6M5.5 19.5l5.4-6.1"/>'),
      github: sv('<path d="M9 19c-4 1.3-4-2-5.5-2.5M15 21v-3.4c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.7 4.7 0 0 0-1.3-3.2 4.4 4.4 0 0 0-.1-3.2s-1-.3-3.4 1.3a11.6 11.6 0 0 0-6.2 0C6.6 2.9 5.6 3.2 5.6 3.2a4.4 4.4 0 0 0-.1 3.2A4.7 4.7 0 0 0 4.2 9.6c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/>'),
      tiktok: sv('<path d="M14 4v10.5a3.5 3.5 0 1 1-3.5-3.5M14 4c.4 2.6 2.1 4.3 5 4.6"/>'),
      instagram: sv('<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/>' + dot(17.2, 6.8, 0.9)),
      twitch: sv('<path d="M5 3.5 3.5 7v12h4.5v2.5h2.5L13 19h3.5l4-4V3.5z"/><path d="M11 8v4.5M15.5 8v4.5"/>'),
      bluesky: sv('<path d="M12 11c-1.6-3.2-5.3-6.8-7.5-6.8-1.5 0-1.5 1.6-1.5 2.6 0 1.3.8 4.6 1.3 5.3 1.3 2 3.8 1.9 5.2 1.6-2.7.6-4.6 2.3-2.6 4.4 2.6 2.7 4.3-.4 5.1-2.6.8 2.2 2.5 5.3 5.1 2.6 2-2.1.1-3.8-2.6-4.4 1.4.3 3.9.4 5.2-1.6.5-.7 1.3-4 1.3-5.3 0-1 0-2.6-1.5-2.6-2.2 0-5.9 3.6-7.5 6.8z"/>'),
      fluxer: sv('<path stroke-width="2.3" d="M4.5 10.6C5.2 8.4 6.5 7.3 8.1 7.3c2.6 0 3.9 3.3 6.9 3.3 2 0 3.6-1.3 4.5-3.3M4.5 17.1c.7-2.2 2-3.3 3.6-3.3 2.6 0 3.9 3.3 6.9 3.3 2 0 3.6-1.3 4.5-3.3"/>'),
      velora: sv('<path d="M5 5.5 12 19l7-13.5"/><path d="M18.5 15.5v4M16.5 17.5h4"/>'),
      kofi: sv('<path d="M4.5 8h12v6a4.5 4.5 0 0 1-4.5 4.5H9A4.5 4.5 0 0 1 4.5 14z"/><path d="M16.5 9.5h1.5a2.5 2.5 0 0 1 0 5h-1.5"/><path d="M10.5 15s-2.5-1.6-2.5-3.1c0-.9 1.2-1.5 2.5-.4 1.3-1.1 2.5-.5 2.5.4 0 1.5-2.5 3.1-2.5 3.1z"/>'),
      mail: sv('<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="m4.5 7 7.5 6 7.5-6"/>'),
      link: sv('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
    },
  };
  window.ICONS.social.twitter = window.ICONS.social.x;
  window.ICONS.social.web = window.ICONS.social.website;
})();

(function () {
  function apply(hex) {
    if (!/^#[0-9a-f]{6}$/i.test(String(hex || ''))) return;
    var n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    var st = document.documentElement.style;
    st.setProperty('--vl', hex);
    st.setProperty('--vl-dim', 'rgba(' + r + ', ' + g + ', ' + b + ', .14)');
    st.setProperty('--vl-glow', 'rgba(' + r + ', ' + g + ', ' + b + ', .35)');
    st.setProperty('--vl-ink', (r * 299 + g * 587 + b * 114) / 1000 > 140 ? '#16141c' : '#ffffff');
  }
  try { apply(localStorage.getItem('hf-vl-accent')); } catch (e) {  }
  window.addEventListener('storage', function (e) { if (e.key === 'hf-vl-accent') apply(e.newValue); });
})();

(function () {
  var root = document.documentElement;
  function animOff() { try { return localStorage.getItem('hf-anim') === 'off'; } catch (e) { return false; } }
  root.classList.toggle('no-anim', animOff());
  window.addEventListener('storage', function (e) { if (e.key === 'hf-anim') root.classList.toggle('no-anim', e.newValue === 'off'); });
})();
