// Alexia Live Tapeta – PC (Windows) a Linux
const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, screen, net, nativeImage, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const ytdlp = require('./ytdlp');

const IS_WIN = process.platform === 'win32';
const IS_LINUX = process.platform === 'linux';

// Linux: X11 režim (aj cez XWayland), lebo len tam ide okno "pod ikony"
if (IS_LINUX) app.commandLine.appendSwitch('ozone-platform', 'x11');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

const VIDEO_EXT = ['mp4', 'webm', 'mkv', 'mov', 'm4v'];
const IMAGE_EXT = ['gif', 'webp', 'png', 'jpg', 'jpeg', 'apng'];

let controlWin = null;
let tray = null;
let wallpaperWins = [];
let paused = false;
let quitting = false;

// ---------------- nastavenia a knižnica ----------------

const dataDir = () => app.getPath('userData');
const libraryDir = () => {
  const d = path.join(dataDir(), 'library');
  fs.mkdirSync(d, { recursive: true });
  return d;
};
const configPath = () => path.join(dataDir(), 'config.json');

const DEFAULT_LINKS = [
  'https://vm.tiktok.com/ZN8mkYNFT/',
  'https://vm.tiktok.com/ZN8mhhvnH/',
  'https://vm.tiktok.com/ZN8mhuQKC/',
  'https://vm.tiktok.com/ZN8mhrtjf/',
  'https://vm.tiktok.com/ZN8mhUkoK/',
];

let config = { current: null, mute: true, fill: true, autostart: false, links: DEFAULT_LINKS };

function loadConfig() {
  try {
    config = { ...config, ...JSON.parse(fs.readFileSync(configPath(), 'utf8')) };
  } catch {}
}
function saveConfig() {
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
}

const extOf = (f) => path.extname(f).slice(1).toLowerCase();
const isVideoFile = (f) => VIDEO_EXT.includes(extOf(f));

function library() {
  return fs.readdirSync(libraryDir())
    .filter((f) => VIDEO_EXT.includes(extOf(f)) || IMAGE_EXT.includes(extOf(f)))
    .map((f) => path.join(libraryDir(), f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    .map((p) => ({
      path: p,
      url: pathToFileURL(p).href,
      isVideo: isVideoFile(p),
      sizeMb: Math.max(1, Math.round(fs.statSync(p).size / 1048576)),
      current: p === config.current,
    }));
}

function mediaState() {
  const p = config.current && fs.existsSync(config.current) ? config.current : null;
  return {
    url: p ? pathToFileURL(p).href : null,
    isVideo: p ? isVideoFile(p) : false,
    mute: config.mute,
    fill: config.fill,
    paused,
  };
}

function setCurrent(p) {
  config.current = p;
  saveConfig();
  broadcastMedia();
}

/** Podľa prvých bajtov určí príponu (keď server nepovie, čo posiela). */
function sniffExt(file) {
  const fd = fs.openSync(file, 'r');
  const b = Buffer.alloc(12);
  fs.readSync(fd, b, 0, 12, 0);
  fs.closeSync(fd);
  const s = b.toString('latin1');
  if (s.startsWith('GIF8')) return 'gif';
  if (s.startsWith('\x89PNG')) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpg';
  if (s.startsWith('RIFF') && s.slice(8, 12) === 'WEBP') return 'webp';
  if (s.slice(4, 8) === 'ftyp') return 'mp4';
  if (b[0] === 0x1a && b[1] === 0x45) return 'webm';
  return null;
}

// ---------------- okná tapety ----------------

function createWallpaperWindows() {
  wallpaperWins.forEach((w) => !w.isDestroyed() && w.destroy());
  wallpaperWins = [];
  for (const display of screen.getAllDisplays()) {
    const b = display.bounds;
    const win = new BrowserWindow({
      x: b.x, y: b.y, width: b.width, height: b.height,
      frame: false,
      show: false,
      skipTaskbar: true,
      focusable: false,
      resizable: false,
      movable: false,
      hasShadow: false,
      enableLargerThanScreen: true,
      backgroundColor: '#000000',
      type: IS_LINUX ? 'desktop' : undefined,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        backgroundThrottling: false,
      },
    });
    win.loadFile(path.join(__dirname, 'wallpaper.html'));
    win.once('ready-to-show', () => {
      win.setBounds(b);
      if (IS_WIN) {
        try {
          const phys = screen.dipToScreenRect(null, b);
          require('./wallpaper-win').attach(win.getNativeWindowHandle(), phys);
        } catch (e) {
          console.error('WorkerW zlyhal', e);
        }
      }
      if (IS_LINUX) {
        win.setIgnoreMouseEvents(true);
        win.setVisibleOnAllWorkspaces(true);
      }
      win.showInactive();
      win.webContents.send('media', mediaState());
    });
    wallpaperWins.push(win);
  }
}

function broadcastMedia() {
  const st = mediaState();
  wallpaperWins.forEach((w) => !w.isDestroyed() && w.webContents.send('media', st));
  sendToControl('state-changed');
  updateTrayMenu();
}

function sendToControl(channel, payload) {
  if (controlWin && !controlWin.isDestroyed()) controlWin.webContents.send(channel, payload);
}

// ---------------- ovládacie okno + tray ----------------

function createControlWindow(show = true) {
  if (controlWin && !controlWin.isDestroyed()) {
    controlWin.show();
    controlWin.focus();
    return;
  }
  controlWin = new BrowserWindow({
    width: 1000,
    height: 760,
    minWidth: 640,
    minHeight: 520,
    show,
    backgroundColor: '#0E0B1A',
    title: 'Alexia Live Tapeta',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  controlWin.loadFile(path.join(__dirname, 'index.html'));
  controlWin.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  controlWin.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      controlWin.hide(); // beží ďalej v lište
    }
  });
}

function updateTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Otvoriť Alexia Live Tapeta', click: () => createControlWindow(true) },
    {
      label: paused ? '▶ Spustiť tapetu' : '⏸ Pozastaviť tapetu',
      click: () => { paused = !paused; broadcastMedia(); },
    },
    { type: 'separator' },
    { label: 'Ukončiť', click: () => { quitting = true; app.quit(); } },
  ]));
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'tray.png')));
  tray.setToolTip('Alexia Live Tapeta');
  tray.on('click', () => createControlWindow(true));
  updateTrayMenu();
}

// ---------------- automatické spustenie ----------------

function applyAutostart() {
  if (IS_WIN) {
    app.setLoginItemSettings({ openAtLogin: config.autostart, args: ['--hidden'] });
  } else if (IS_LINUX) {
    const dir = path.join(os.homedir(), '.config', 'autostart');
    const file = path.join(dir, 'alexia-live-tapeta.desktop');
    if (config.autostart) {
      fs.mkdirSync(dir, { recursive: true });
      const exe = process.env.APPIMAGE || process.execPath;
      fs.writeFileSync(file, [
        '[Desktop Entry]', 'Type=Application', 'Name=Alexia Live Tapeta',
        `Exec="${exe}" --hidden`, 'X-GNOME-Autostart-enabled=true', '',
      ].join('\n'));
    } else {
      fs.rmSync(file, { force: true });
    }
  }
}

// ---------------- sťahovanie ----------------

const MEDIA_URL = /\.(gif|webp|mp4|webm|mkv|mov)(\?.*)?$/i;

let stampCounter = 0;
const uniqueBase = () => `${Date.now()}-${stampCounter++}`;

async function downloadDirect(url, onProgress) {
  const base = uniqueBase();
  const tmp = path.join(libraryDir(), base + '.download');
  const { contentType } = await ytdlp.downloadTo(url, tmp, onProgress);
  if (contentType.startsWith('text/html')) {
    fs.rmSync(tmp, { force: true });
    throw new Error('Odkaz vedie na stránku, nie na video');
  }
  const ext = sniffExt(tmp) || (contentType.includes('gif') ? 'gif' : 'mp4');
  const final = path.join(libraryDir(), `${base}.${ext}`);
  fs.renameSync(tmp, final);
  return final;
}

const tikAbs = (u) => (u.startsWith('/') ? 'https://www.tikwm.com' + u : u);

async function tikTokData(url) {
  const res = await net.fetch('https://www.tikwm.com/api/?hd=1&url=' + encodeURIComponent(url));
  const json = await res.json();
  if (json.code !== 0) throw new Error('TikTok: ' + (json.msg || 'nenájdené'));
  return json.data || {};
}

const tikImages = (d) => (Array.isArray(d.images) ? d.images.filter(Boolean).map(tikAbs) : []);

async function resolveTikTok(url) {
  const d = await tikTokData(url);
  const u = tikImages(d)[0] || d.hdplay || d.play || d.wmplay;
  if (!u) throw new Error('V TikTok príspevku nie je video');
  return tikAbs(u);
}

/** Vráti zoznam stiahnutých súborov (TikTok fotkový príspevok = všetky fotky). */
async function downloadAny(rawUrl, onProgress) {
  let url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  if (MEDIA_URL.test(new URL(url).pathname)) return [await downloadDirect(url, onProgress)];

  if (/tiktok\.com/i.test(url)) {
    let images = [];
    try { images = tikImages(await tikTokData(url)); } catch {}
    if (images.length) {
      const files = [];
      for (let i = 0; i < images.length; i++) {
        try {
          files.push(await downloadDirect(images[i], (p) => onProgress(Math.round((i * 100 + p) / images.length))));
        } catch (e) {
          if (images.length === 1) throw e;
        }
      }
      if (files.length) return files;
    }
  }
  try {
    return [await ytdlp.download(url, libraryDir(), uniqueBase(), onProgress)];
  } catch (e) {
    if (/tiktok\.com/i.test(url)) return [await downloadDirect(await resolveTikTok(url), onProgress)];
    throw e;
  }
}

// ---------------- Galéria 4K (Wikimedia Commons) ----------------

async function commonsSearch(query, offset) {
  const url = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2' +
    `&generator=search&gsrnamespace=6&gsrlimit=30&gsroffset=${offset}` +
    '&gsrsearch=' + encodeURIComponent(query) +
    '&prop=videoinfo&viprop=url%7Csize%7Cmime%7Cderivatives&viurlwidth=480';
  const res = await net.fetch(url, { headers: { 'User-Agent': 'AlexiaLiveTapeta/2.0 (github.com/havetkin-cyber/APK)' } });
  const json = await res.json();
  const next = json.continue ? json.continue.gsroffset : null;
  const pages = ((json.query && json.query.pages) || []).sort((a, b) => a.index - b.index);
  const items = [];
  for (const p of pages) {
    const vi = (p.videoinfo || p.imageinfo || [])[0];
    if (!vi) continue;
    if (vi.mime === 'image/gif' || vi.mime === 'image/webp') {
      items.push({ label: `GIF · ${vi.width}×${vi.height}`, thumb: vi.thumburl, url: vi.url });
      continue;
    }
    if (!vi.mime.startsWith('video/') && vi.mime !== 'application/ogg') continue;
    let best = null;
    for (const d of vi.derivatives || []) {
      if (!/^video\/(webm|mp4)/.test(d.type)) continue;
      const short = Math.min(d.width, d.height);
      if (!short || short > 2160) continue;
      const score = short * 10 + (d.type.includes('vp9') ? 1 : 0);
      if (!best || score > best.score) best = { score, short, src: d.src };
    }
    if (!best && (vi.mime === 'video/webm' || vi.mime === 'video/mp4')) {
      best = { short: Math.min(vi.width, vi.height), src: vi.url };
    }
    if (!best) continue;
    const res = best.short >= 2160 ? '4K' : best.short >= 1440 ? '1440p' : `${best.short}p`;
    items.push({ label: `▶ ${res}`, thumb: vi.thumburl, url: best.src });
  }
  return { items, next };
}

// ---------------- aktualizácia appky ----------------

let availableUpdate = null;

function isNewer(remote, local) {
  const r = remote.split('.').map((x) => parseInt(x, 10) || 0);
  const l = local.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    if ((r[i] || 0) !== (l[i] || 0)) return (r[i] || 0) > (l[i] || 0);
  }
  return false;
}

async function checkAppUpdate() {
  const res = await net.fetch('https://api.github.com/repos/havetkin-cyber/apk/releases/latest', {
    headers: { 'User-Agent': 'AlexiaLiveTapeta', Accept: 'application/vnd.github+json' },
  });
  const json = await res.json();
  const version = String(json.tag_name || '').replace(/^v/, '');
  if (version && isNewer(version, app.getVersion())) {
    availableUpdate = { version, url: json.html_url };
    sendToControl('app-update', availableUpdate);
  } else {
    availableUpdate = null;
  }
  return availableUpdate;
}

// ---------------- IPC ----------------

function registerIpc() {
  ipcMain.handle('get-state', async () => ({
    library: library(),
    config,
    media: mediaState(),
    platform: process.platform,
    appUpdate: availableUpdate,
  }));

  ipcMain.handle('ytdlp-version', () => ytdlp.version());

  ipcMain.handle('app-version', () => app.getVersion());
  ipcMain.handle('check-app-update', () => checkAppUpdate());
  ipcMain.handle('open-update', () => availableUpdate && shell.openExternal(availableUpdate.url));

  ipcMain.handle('ytdlp-update', async () => {
    const updated = await ytdlp.ensureUpdated(true);
    return { updated, version: await ytdlp.version() };
  });

  ipcMain.handle('pick-file', async () => {
    const r = await dialog.showOpenDialog(controlWin, {
      properties: ['openFile'],
      filters: [{ name: 'GIF / video', extensions: [...IMAGE_EXT, ...VIDEO_EXT] }],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const src = r.filePaths[0];
    const dest = path.join(libraryDir(), `${Date.now()}.${extOf(src) || 'mp4'}`);
    fs.copyFileSync(src, dest);
    setCurrent(dest);
    return dest;
  });

  ipcMain.handle('download', async (_e, url) => {
    try {
      const files = await downloadAny(url, (pct) => sendToControl('progress', pct));
      // prvá fotka navrchu v galérii (najnovší čas úpravy)
      const now = Date.now() / 1000;
      files.forEach((f, i) => { try { fs.utimesSync(f, now - i, now - i); } catch {} });
      config.links = [url.trim(), ...config.links.filter((l) => l !== url.trim())].slice(0, 50);
      setCurrent(files[0]);
      return { ok: true, count: files.length };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  });

  ipcMain.handle('select', (_e, p) => {
    if (p && p.startsWith(libraryDir()) && fs.existsSync(p)) setCurrent(p);
  });

  ipcMain.handle('delete', (_e, p) => {
    if (!p || !p.startsWith(libraryDir())) return;
    fs.rmSync(p, { force: true });
    if (config.current === p) setCurrent(null);
    else sendToControl('state-changed');
  });

  ipcMain.handle('set-option', (_e, key, value) => {
    if (!['mute', 'fill', 'autostart'].includes(key)) return;
    config[key] = !!value;
    saveConfig();
    if (key === 'autostart') applyAutostart();
    broadcastMedia();
  });

  ipcMain.handle('set-paused', (_e, value) => {
    paused = !!value;
    broadcastMedia();
  });

  ipcMain.handle('remove-link', (_e, link) => {
    config.links = config.links.filter((l) => l !== link);
    saveConfig();
  });

  ipcMain.handle('commons', (_e, query, offset) => commonsSearch(query, offset || 0));

  ipcMain.handle('open-folder', () => shell.openPath(libraryDir()));
}

// ---------------- štart ----------------

app.on('second-instance', () => createControlWindow(true));

app.whenReady().then(() => {
  loadConfig();
  registerIpc();
  createTray();
  createWallpaperWindows();
  createControlWindow(!process.argv.includes('--hidden'));

  let rebuild = null;
  const rebuildLater = () => {
    clearTimeout(rebuild);
    rebuild = setTimeout(createWallpaperWindows, 800);
  };
  screen.on('display-added', rebuildLater);
  screen.on('display-removed', rebuildLater);
  screen.on('display-metrics-changed', (_e, _d, changed) => {
    if (changed.includes('bounds') || changed.includes('scaleFactor')) rebuildLater();
  });

  // yt-dlp: stiahnuť / aktualizovať z GitHubu
  ytdlp.ensureUpdated(false)
    .then((v) => v && sendToControl('toast', `yt-dlp aktualizovaný na ${v}`))
    .catch((e) => console.error('yt-dlp update', e));
  // kontrola novej verzie appky v GitHub Releases
  checkAppUpdate().catch(() => {});
  // a potom každých 6 hodín, kým appka beží
  setInterval(() => {
    checkAppUpdate().catch(() => {});
    ytdlp.ensureUpdated(false)
      .then((v) => v && sendToControl('toast', `yt-dlp aktualizovaný na ${v}`))
      .catch(() => {});
  }, 60 * 60 * 1000);
});

app.on('window-all-closed', (e) => {
  // necháme bežať v lište
  if (!quitting) e.preventDefault();
});

app.on('before-quit', () => {
  quitting = true;
  if (IS_WIN) {
    try { require('./wallpaper-win').restoreDesktop(); } catch {}
  }
});
