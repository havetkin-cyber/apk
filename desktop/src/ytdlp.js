// yt-dlp: stiahne sa z GitHubu pri prvom spustení a potom sa sám aktualizuje.
const { app, net } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const RELEASES = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/';
const UPDATE_EVERY_MS = 6 * 60 * 60 * 1000;

function assetName() {
  if (process.platform === 'win32') return 'yt-dlp.exe';
  if (process.platform === 'darwin') return 'yt-dlp_macos';
  if (process.arch === 'arm64') return 'yt-dlp_linux_aarch64';
  return 'yt-dlp_linux';
}

function binDir() {
  const d = path.join(app.getPath('userData'), 'bin');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function binPath() {
  return path.join(binDir(), process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
}

function stampPath() {
  return path.join(binDir(), 'last-update.txt');
}

async function downloadTo(url, dest, onProgress) {
  const res = await net.fetch(url, { headers: { 'User-Agent': 'AlexiaLiveTapeta/2.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const tmp = dest + '.part';
  const out = fs.createWriteStream(tmp);
  let done = 0;
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done: end, value } = await reader.read();
      if (end) break;
      done += value.length;
      if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
      if (total && onProgress) onProgress(Math.round((done * 100) / total));
    }
  } finally {
    await new Promise((r) => out.end(r));
  }
  fs.renameSync(tmp, dest);
  return { contentType: res.headers.get('content-type') || '' };
}

function run(args, onLine) {
  return new Promise((resolve) => {
    const p = spawn(binPath(), args, { windowsHide: true });
    let out = '';
    const handle = (buf) => {
      const text = buf.toString();
      out += text;
      if (onLine) text.split(/\r?\n|\r/).forEach((l) => l && onLine(l));
    };
    p.stdout.on('data', handle);
    p.stderr.on('data', handle);
    p.on('error', (e) => resolve({ code: -1, out: out + '\n' + e.message }));
    p.on('close', (code) => resolve({ code, out }));
  });
}

async function version() {
  if (!fs.existsSync(binPath())) return null;
  const r = await run(['--version']);
  return r.code === 0 ? r.out.trim() : null;
}

/** Zabezpečí yt-dlp a skontroluje aktualizáciu. Vráti novú verziu alebo null. */
async function ensureUpdated(force = false) {
  const bin = binPath();
  if (!fs.existsSync(bin)) {
    await downloadTo(RELEASES + assetName(), bin);
    if (process.platform !== 'win32') fs.chmodSync(bin, 0o755);
    fs.writeFileSync(stampPath(), String(Date.now()));
    return await version();
  }
  let last = 0;
  try { last = Number(fs.readFileSync(stampPath(), 'utf8')) || 0; } catch {}
  if (!force && Date.now() - last < UPDATE_EVERY_MS) return null;

  const before = await version();
  const r = await run(['-U']);
  fs.writeFileSync(stampPath(), String(Date.now()));
  const after = await version();
  if (r.code !== 0 && before === after) {
    // samo-aktualizácia zlyhala (napr. práva) – stiahneme znova
    await downloadTo(RELEASES + assetName(), bin);
    if (process.platform !== 'win32') fs.chmodSync(bin, 0o755);
    const fresh = await version();
    return fresh !== before ? fresh : null;
  }
  return after !== before ? after : null;
}

/**
 * Stiahne video cez yt-dlp do priečinka. Len obraz (bez zvuku) = jeden súbor,
 * netreba FFmpeg. Max. 4K.
 */
async function download(url, dir, baseName, onProgress) {
  if (!fs.existsSync(binPath())) await ensureUpdated(true);
  const format = [
    'bv*[height<=2160][width<=3840][vcodec^=vp09]',
    'bv*[height<=2160][width<=3840][vcodec^=vp9]',
    'bv*[height<=2160][width<=3840][vcodec^=avc]',
    'bv*[height<=2160][width<=3840]',
    'b[height<=2160]',
    'b',
  ].join('/');
  const args = [
    '-f', format,
    '--no-playlist', '--no-mtime', '--newline',
    '--max-filesize', '1G',
    '-o', path.join(dir, baseName + '.%(ext)s'),
    url,
  ];
  let lastError = '';
  const r = await run(args, (line) => {
    const m = line.match(/\[download\]\s+([\d.]+)%/);
    if (m && onProgress) onProgress(Math.round(parseFloat(m[1])));
    if (line.includes('ERROR')) lastError = line;
  });
  const files = fs.readdirSync(dir)
    .filter((f) => f.startsWith(baseName + '.') && !/\.(part|ytdl|temp)$/.test(f))
    .map((f) => path.join(dir, f));
  if (r.code !== 0 || files.length === 0) {
    files.forEach((f) => fs.rmSync(f, { force: true }));
    throw new Error(lastError || 'yt-dlp nič nestiahol');
  }
  return files.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];
}

module.exports = { ensureUpdated, version, download, downloadTo };
