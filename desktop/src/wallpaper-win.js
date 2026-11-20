// Windows: vloží okno s videom za ikony na ploche (trik s oknom WorkerW).
const koffi = require('koffi');

const user32 = koffi.load('user32.dll');

const EnumWindowsProc = koffi.proto('bool __stdcall EnumWindowsProc(void *hwnd, intptr_t lparam)');
const FindWindowW = user32.func('void * __stdcall FindWindowW(str16 cls, str16 name)');
const FindWindowExW = user32.func('void * __stdcall FindWindowExW(void *parent, void *after, str16 cls, str16 name)');
const SendMessageTimeoutW = user32.func(
  'intptr_t __stdcall SendMessageTimeoutW(void *hwnd, uint32_t msg, uintptr_t wp, intptr_t lp, uint32_t flags, uint32_t timeout, _Out_ uintptr_t *result)'
);
const EnumWindows = user32.func('bool __stdcall EnumWindows(EnumWindowsProc *cb, intptr_t lparam)');
const SetParent = user32.func('void * __stdcall SetParent(void *child, void *parent)');
const SetWindowPos = user32.func(
  'bool __stdcall SetWindowPos(void *hwnd, void *after, int x, int y, int cx, int cy, uint32_t flags)'
);
const GetSystemMetrics = user32.func('int __stdcall GetSystemMetrics(int index)');
const SystemParametersInfoW = user32.func('bool __stdcall SystemParametersInfoW(uint32_t action, uint32_t param, void *pv, uint32_t winini)');

const SWP_NOZORDER = 0x0004;
const SWP_NOACTIVATE = 0x0010;
const SWP_SHOWWINDOW = 0x0040;
const SM_XVIRTUALSCREEN = 76;
const SM_YVIRTUALSCREEN = 77;

function findDesktopHost() {
  const progman = FindWindowW('Progman', null);
  if (!progman) return null;
  const out = [0];
  // požiada Explorer, aby vytvoril WorkerW za ikonami
  SendMessageTimeoutW(progman, 0x052c, 0xd, 0x1, 0, 1000, out);
  SendMessageTimeoutW(progman, 0x052c, 0, 0, 0, 1000, out);

  let worker = null;
  const cb = koffi.register((hwnd) => {
    const defView = FindWindowExW(hwnd, null, 'SHELLDLL_DefView', null);
    if (defView) {
      const w = FindWindowExW(null, hwnd, 'WorkerW', null);
      if (w) worker = w;
    }
    return true;
  }, koffi.pointer(EnumWindowsProc));
  try {
    EnumWindows(cb, 0);
  } finally {
    koffi.unregister(cb);
  }
  // Windows 11 24H2+: WorkerW je priamo pod Progman
  if (!worker) worker = FindWindowExW(progman, null, 'WorkerW', null);
  return worker || progman;
}

/**
 * @param {Buffer} handleBuf  win.getNativeWindowHandle()
 * @param {{x:number,y:number,width:number,height:number}} physRect  fyzické pixely
 */
function attach(handleBuf, physRect) {
  const hwnd = koffi.decode(handleBuf, 'void *');
  const host = findDesktopHost();
  if (!host) return false;
  SetParent(hwnd, host);
  const vx = GetSystemMetrics(SM_XVIRTUALSCREEN);
  const vy = GetSystemMetrics(SM_YVIRTUALSCREEN);
  SetWindowPos(
    hwnd, null,
    physRect.x - vx, physRect.y - vy, physRect.width, physRect.height,
    SWP_NOZORDER | SWP_NOACTIVATE | SWP_SHOWWINDOW
  );
  return true;
}

/** Po skončení znova nakreslí pôvodnú tapetu Windows. */
function restoreDesktop() {
  try {
    const buf = Buffer.alloc(1040);
    if (SystemParametersInfoW(0x0073 /* SPI_GETDESKWALLPAPER */, 520, buf, 0)) {
      SystemParametersInfoW(0x0014 /* SPI_SETDESKWALLPAPER */, 0, buf, 0x01 | 0x02);
    }
  } catch {}
}

module.exports = { attach, restoreDesktop };
