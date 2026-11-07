'use strict';

let user32 = null, dwmRect = null, koffiRef = null;
try {
  if (process.platform !== 'win32') throw new Error('not Windows');
  const koffi = require('koffi');
  koffiRef = koffi;
  const lib = koffi.load('user32.dll');
  koffi.struct('RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
  user32 = {
    GetForegroundWindow: lib.func('void * __stdcall GetForegroundWindow()'),
    SetForegroundWindow: lib.func('bool __stdcall SetForegroundWindow(void *hWnd)'),
    IsWindow: lib.func('bool __stdcall IsWindow(void *hWnd)'),
    GetAsyncKeyState: lib.func('int16 __stdcall GetAsyncKeyState(int vKey)'),
    keybd_event: lib.func('void __stdcall keybd_event(uint8 bVk, uint8 bScan, uint32 dwFlags, uintptr dwExtraInfo)'),
    ShowWindow: lib.func('bool __stdcall ShowWindow(void *hWnd, int nCmdShow)'),
    GetWindowRect: lib.func('bool __stdcall GetWindowRect(void *hWnd, _Out_ RECT *lpRect)'),
  };
  try { dwmRect = koffi.load('dwmapi.dll').func('long __stdcall DwmGetWindowAttribute(void *hwnd, uint32 attr, _Out_ RECT *pv, uint32 cb)'); } catch {}
} catch {
}

function foregroundWindow() {
  try { return user32 ? user32.GetForegroundWindow() : null; } catch { return null; }
}
function focusWindow(hwnd) {
  try { return !!(user32 && hwnd && user32.IsWindow(hwnd) && user32.SetForegroundWindow(hwnd)); } catch { return false; }
}
function windowRect(hwnd) {
  if (!user32 || !hwnd) return null;
  try {
    const r = {};
    let ok = false;
    if (dwmRect) ok = dwmRect(hwnd, 9 , r, 16) === 0;
    if (!ok) ok = user32.GetWindowRect(hwnd, r);
    if (!ok || r.right <= r.left || r.bottom <= r.top) return null;
    return { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top };
  } catch { return null; }
}

function leftButtonDown() {
  if (!user32) return null;
  try { return (user32.GetAsyncKeyState(1) & 0x8000) !== 0; } catch { return null; }
}

function forceForeground(handleBuf) {
  if (!user32 || !koffiRef || !handleBuf) return false;
  try {
    const hwnd = koffiRef.decode(handleBuf, 'void *');
    user32.keybd_event(0x12, 0, 0, 0);
    user32.keybd_event(0x12, 0, 0x0002, 0);
    user32.ShowWindow(hwnd, 5);
    return !!user32.SetForegroundWindow(hwnd);
  } catch { return false; }
}

module.exports = { foregroundWindow, focusWindow, windowRect, leftButtonDown, forceForeground };
