'use strict';
const { EventEmitter } = require('events');

const GUIDE = 0x0400;
const ERROR_DEVICE_NOT_CONNECTED = 1167;

const PRODUCTS = {
  '045e:028e': 'Xbox 360 Controller', '045e:028f': 'Xbox 360 Wireless Controller', '045e:0719': 'Xbox 360 Wireless Controller',
  '045e:02d1': 'Xbox One Controller', '045e:02dd': 'Xbox One Controller', '045e:02ea': 'Xbox Wireless Controller',
  '045e:02e0': 'Xbox Wireless Controller', '045e:02fd': 'Xbox Wireless Controller', '045e:0b20': 'Xbox Wireless Controller',
  '045e:02e3': 'Xbox Elite Controller', '045e:0b00': 'Xbox Elite Controller Series 2', '045e:0b05': 'Xbox Elite Controller Series 2',
  '045e:0b22': 'Xbox Elite Controller Series 2', '045e:0b12': 'Xbox Series X|S Controller', '045e:0b13': 'Xbox Series X|S Controller',
  '045e:0b21': 'Xbox Adaptive Controller', '045e:0b0a': 'Xbox Adaptive Controller',
};
const VENDORS = {
  '045e': 'Xbox Controller', '2dc8': '8BitDo Controller', '0e6f': 'PDP Controller', '24c6': 'PowerA Controller',
  '20d6': 'PowerA Controller', '1532': 'Razer Controller', '046d': 'Logitech Controller', '0f0d': 'HORI Controller',
  '0738': 'Mad Catz Controller', '1bad': 'Controller', '2563': 'Controller', '3537': 'GameSir Controller', '0079': 'Controller',
};
const hex = n => Number(n || 0).toString(16).padStart(4, '0');

class XInput extends EventEmitter {
  constructor() {
    super();
    this.ok = false;
    this.slots = [null, null, null, null];
    this.timer = null;
    this.tickN = 0;
    try {
      if (process.platform !== 'win32') throw new Error('not Windows');
      const koffi = require('koffi');
      const lib = koffi.load('xinput1_4.dll');
      koffi.struct('HF_XINPUT_GAMEPAD', { wButtons: 'uint16', bLeftTrigger: 'uint8', bRightTrigger: 'uint8', sThumbLX: 'int16', sThumbLY: 'int16', sThumbRX: 'int16', sThumbRY: 'int16' });
      koffi.struct('HF_XINPUT_STATE', { dwPacketNumber: 'uint32', Gamepad: 'HF_XINPUT_GAMEPAD' });
      koffi.struct('HF_XINPUT_CAPS_EX', { Type: 'uint8', SubType: 'uint8', Flags: 'uint16', Gamepad: 'HF_XINPUT_GAMEPAD', Vibration: 'uint32', VendorId: 'uint16', ProductId: 'uint16', ProductVersion: 'uint16', unk1: 'uint16', unk2: 'uint32' });
      this.getStateEx = lib.func(100, 'uint32', ['uint32', koffi.out(koffi.pointer('HF_XINPUT_STATE'))]);
      try { this.getCapsEx = lib.func(108, 'uint32', ['uint32', 'uint32', 'uint32', koffi.out(koffi.pointer('HF_XINPUT_CAPS_EX'))]); } catch { this.getCapsEx = null; }
      this.ok = true;
    } catch (e) {
      this.error = e.message;
    }
  }

  nameOf(slot) {
    if (!this.getCapsEx) return 'Xbox Controller';
    try {
      const c = {};
      if (this.getCapsEx(1, slot, 0, c) !== 0) return 'Xbox Controller';
      const v = hex(c.VendorId), p = hex(c.ProductId);
      return PRODUCTS[`${v}:${p}`] || VENDORS[v] || 'Xbox-compatible Controller';
    } catch { return 'Xbox Controller'; }
  }

  start() {
    if (!this.ok || this.timer) return;
    this.timer = setInterval(() => this.tick(), 50);
  }
  stop() { clearInterval(this.timer); this.timer = null; }

  tick() {
    this.tickN++;
    for (let slot = 0; slot < 4; slot++) {
      const known = this.slots[slot];
      if (!known && this.tickN % 20 !== slot * 5) continue;
      const st = {};
      let r;
      try { r = this.getStateEx(slot, st); } catch { continue; }
      if (r === 0) {
        if (!known) {
          const name = this.nameOf(slot);
          this.slots[slot] = { name, guide: !!(st.Gamepad.wButtons & GUIDE) };
          this.emit('connect', { slot, name });
          continue;
        }
        const guide = !!(st.Gamepad.wButtons & GUIDE);
        if (guide && !known.guide) this.emit('guide', { slot });
        known.guide = guide;
      } else if (r === ERROR_DEVICE_NOT_CONNECTED && known) {
        this.slots[slot] = null;
        this.emit('disconnect', { slot, name: known.name });
      }
    }
  }

  list() { return this.slots.map((s, slot) => (s ? { slot, name: s.name } : null)).filter(Boolean); }
}

module.exports = { XInput };
