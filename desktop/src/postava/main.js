// Postavička na ploche (len Windows): 3D VRM postava, sedí na lište alebo na okne, dá sa ťahať,
// rozpráva sa (lokálny jazykový model cez node-llama-cpp) a má vlastnú náladu – urazí sa, hnevá, robí naschvál.
// Nikdy nezatvára programy, nemaže súbory, nehýbe kurzorom.
const { BrowserWindow, screen, ipcMain, app, dialog, net, desktopCapturer, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const SIRKA = 360, VYSKA = 560;
const PLOCHA = Math.round(VYSKA * 0.62); // riadok, na ktorom postava sedí / stojí (od vrchu okna)

// voľné postavy (CC0, VRoid Project) – stiahnu sa, keď si ich vyberieš
const POSTAVY = [
  { id: 'shino', nazov: 'Shino', zip: 'sendagaya_shino.zip' },
  { id: 'e', nazov: 'Sample E', zip: 'avatarsample_e.zip' },
  { id: 'f', nazov: 'Sample F', zip: 'avatarsample_f.zip' },
  { id: 'g', nazov: 'Sample G', zip: 'avatarsample_g.zip' },
];
const ZIP_URL = (z) => `https://opengameart.org/sites/default/files/${z}`;

// mozog: Qwen3 4B (beží na grafike – VRAM; keď nejde, na procesore)
const MODEL = {
  uri: 'hf:unsloth/Qwen3-4B-Instruct-2507-GGUF/Qwen3-4B-Instruct-2507-Q4_K_M.gguf',
  subor: 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf',
  mb: 2500,
};

// hlas: Piper + Kasandra (český ženský hlas s emóciami, CC BY 4.0, autor Ondřej Šimek) – beží na procesore (RAM)
const PIPER_ZIP = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip';
const KASANDRA = [
  'https://huggingface.co/rhasspy/piper-voices/resolve/refs%2Fpr%2F98/cs/cs_CZ/kasandra/medium/cs_CZ-kasandra_v3.onnx',
  'https://huggingface.co/rhasspy/piper-voices/resolve/main/cs/cs_CZ/kasandra/medium/cs_CZ-kasandra-medium.onnx',
];
// prednes podľa emócie: dĺžka (pomalšie > 1), živosť intonácie, výška (prehrávanie), hlasitosť
const PREDNES = {
  neutral: { dlzka: 1.0, sum: 0.667, sumW: 0.8, vyska: 1.0, hlas: 0.9 },
  relaxed: { dlzka: 1.05, sum: 0.6, sumW: 0.7, vyska: 1.0, hlas: 0.85 },
  happy: { dlzka: 0.95, sum: 0.75, sumW: 0.9, vyska: 1.04, hlas: 0.95 },
  excited: { dlzka: 0.88, sum: 0.8, sumW: 1.0, vyska: 1.07, hlas: 1.0 },
  angry: { dlzka: 0.93, sum: 0.8, sumW: 0.9, vyska: 0.98, hlas: 1.0 },
  shout: { dlzka: 0.92, sum: 0.85, sumW: 1.0, vyska: 1.03, hlas: 1.0 },
  sad: { dlzka: 1.15, sum: 0.55, sumW: 0.6, vyska: 0.96, hlas: 0.75 },
  scared: { dlzka: 0.9, sum: 0.85, sumW: 1.0, vyska: 1.06, hlas: 0.85 },
  surprised: { dlzka: 0.95, sum: 0.8, sumW: 1.0, vyska: 1.05, hlas: 0.95 },
  whisper: { dlzka: 1.08, sum: 0.5, sumW: 0.5, vyska: 1.0, hlas: 0.5 },
};

let win = null;
let cfg = null, ulozCfg = () => {}, zmena = () => {};
let tah = null;          // { dx, dy, timer, posledne: [] }
let pad = null;          // časovač pádu
let chodza = null;       // časovač chôdze
let naOkne = null;       // { hwnd, x, y, w } okno, na ktorom sedí
let stav = 'sedi';       // sedi | stoji | chodi | pada | tahana
let nalada = 20;         // -100 (zúrivá) … 100 (šťastná)
let ignorovana = 0;      // sekundy bez kontaktu
let urazena = false;
let poslednyTitul = '';
let slucka = null;
let mozog = null;        // { session } alebo null
let mozogSa = null;      // Promise pri načítavaní
let pocetTahani = 0;
let tanci = false;        // práve tancuje na hudbu z PC

const dir = () => { const d = path.join(app.getPath('userData'), 'postava'); fs.mkdirSync(d, { recursive: true }); return d; };
const posli = (k, d) => { if (win && !win.isDestroyed()) win.webContents.send(k, d); };

// ---------------- Windows: aktívne okno (koffi) ----------------
let w32 = null;
function win32() {
  if (w32 !== null) return w32;
  try {
    const koffi = require('koffi');
    const u = koffi.load('user32.dll');
    const RECT = koffi.struct('RECT_P', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
    w32 = {
      GetForegroundWindow: u.func('void * __stdcall GetForegroundWindow()'),
      GetWindowRect: u.func('bool __stdcall GetWindowRect(void *hwnd, _Out_ RECT_P *r)'),
      GetWindowTextW: u.func('int __stdcall GetWindowTextW(void *hwnd, _Out_ uint16_t *buf, int max)'),
      IsZoomed: u.func('bool __stdcall IsZoomed(void *hwnd)'),
      IsWindowVisible: u.func('bool __stdcall IsWindowVisible(void *hwnd)'),
      RECT,
    };
  } catch (e) { console.error('postava koffi', e); w32 = false; }
  return w32;
}

function aktivneOkno() {
  const w = win32(); if (!w) return null;
  try {
    const h = w.GetForegroundWindow(); if (!h) return null;
    if (win && !win.isDestroyed()) {
      const moje = win.getNativeWindowHandle();
      const ja = koffi_adresa(moje);
      if (ja && ja === koffi_adresa_ptr(h)) return null;
    }
    const r = {};
    if (!w.GetWindowRect(h, r)) return null;
    const buf = new Uint16Array(256);
    const n = w.GetWindowTextW(h, buf, 256);
    const titul = String.fromCharCode(...buf.slice(0, Math.max(0, n)));
    // súradnice z Win32 sú v pixeloch – Electron chce DIP
    const a = screen.screenToDipPoint({ x: r.left, y: r.top });
    const b = screen.screenToDipPoint({ x: r.right, y: r.bottom });
    return { h, titul, x: a.x, y: a.y, w: b.x - a.x, hgt: b.y - a.y, max: w.IsZoomed(h) };
  } catch { return null; }
}
function koffi_adresa(buf) { try { return buf.length >= 8 ? buf.readBigUInt64LE(0) : BigInt(buf.readUInt32LE(0)); } catch { return null; } }
function koffi_adresa_ptr(p) { try { return BigInt(require('koffi').address(p)); } catch { return null; } }

// ---------------- okno postavy ----------------
function pracovnaPlocha(x) {
  const d = screen.getDisplayNearestPoint({ x: Math.round(x), y: 0 });
  return d.workArea;
}

function vytvor() {
  if (win && !win.isDestroyed()) { win.show(); return; }
  const wa = screen.getPrimaryDisplay().workArea;
  const x = cfg.postavaX ?? (wa.x + wa.width - SIRKA - 40);
  win = new BrowserWindow({
    width: SIRKA, height: VYSKA, x, y: wa.y + wa.height - PLOCHA,
    transparent: true, frame: false, resizable: false, hasShadow: false, skipTaskbar: true,
    alwaysOnTop: true, show: false, backgroundColor: '#00000000', title: 'Postavička',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setIgnoreMouseEvents(true, { forward: true });
  // zvuk z PC (loopback) – len na zistenie rytmu hudby, nikam sa neposiela ani neukladá
  win.webContents.session.setDisplayMediaRequestHandler((req, cb) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((z) => cb({ video: z[0], audio: 'loopback' })).catch(() => cb({}));
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', () => win.showInactive());
  // test na GitHube: vypíš konzolu, po 60 s urob snímku a skonči
  if (process.env.POSTAVA_TEST) {
    const zapis = (t) => { try { fs.appendFileSync(process.env.POSTAVA_TEST + '.log', t + '\n'); } catch {} };
    win.webContents.on('console-message', (e, lvl, msg, line, src) => zapis(`[konzola] ${e.message ?? msg} (${e.sourceId ?? src}:${e.lineNumber ?? line})`));
    win.webContents.on('render-process-gone', (e, d) => zapis('[pád] ' + JSON.stringify(d)));
    win.webContents.on('did-fail-load', (e, k, d, u) => zapis(`[nenačítané] ${k} ${d} ${u}`));
    win.webContents.on('did-finish-load', () => zapis('[načítané]'));
    setTimeout(() => win.webContents.executeJavaScript(`Promise.all([
        import('three').then(() => 'three ok', (e) => 'three: ' + e.message),
        import('@pixiv/three-vrm').then(() => 'vrm ok', (e) => 'vrm: ' + e.message),
        import('three/addons/loaders/GLTFLoader.js').then(() => 'gltf ok', (e) => 'gltf: ' + e.message),
        import('./render.js?x=1').then(() => 'render ok', (e) => 'render: ' + e.message),
      ]).then((r) => r.join(' | '))`).then((r) => zapis('[importy] ' + r)).catch((e) => zapis('[importy chyba] ' + e)), 20000);
    setTimeout(() => win.webContents.executeJavaScript('JSON.stringify({bezi: !!window.__postavaBezi, chyba: document.getElementById("chyba")?.textContent, priebeh: document.getElementById("priebeh")?.textContent, bublina: document.getElementById("bublina")?.textContent})').then((r) => zapis('[stav] ' + r)).catch((e) => zapis('[stav chyba] ' + e)), 135000);
    setTimeout(async () => {
      try { const img = await win.webContents.capturePage(); fs.writeFileSync(process.env.POSTAVA_TEST, img.toPNG()); }
      catch (e) { console.log('[postava] snímka zlyhala', e); }
      app.exit(0);
    }, 140000);
  }
  win.on('closed', () => { win = null; zastavCasovace(); });
  stav = 'sedi'; naOkne = null;
  spustiSlucku();
}

function zastavCasovace() {
  clearInterval(slucka); slucka = null;
  if (tah) clearInterval(tah.timer); tah = null;
  clearInterval(pad); pad = null;
  clearInterval(chodza); chodza = null;
}

function nastavStav(s) { stav = s; posli('postava-stav', { stav, urazena, nalada }); }

function povedz(text, emocia) { posli('postava-povedz', { text, emocia }); }

// ---------------- ťahanie a pád ----------------
function zacniTah(dx, dy) {
  if (!win) return;
  clearInterval(pad); pad = null; clearInterval(chodza); chodza = null;
  naOkne = null; ignorovana = 0;
  tah = { dx, dy, posledne: [], timer: null };
  nastavStav('tahana');
  tah.timer = setInterval(() => {
    if (!win || !tah) return;
    const c = screen.getCursorScreenPoint();
    win.setPosition(Math.round(c.x - tah.dx), Math.round(c.y - tah.dy));
    tah.posledne.push({ x: c.x, y: c.y, t: Date.now() });
    if (tah.posledne.length > 6) tah.posledne.shift();
  }, 16);
  pocetTahani++;
  zmenNaladu(-4);
  if (pocetTahani > 3) povedz(nahodne(['Hej! Pusti ma!', 'Prestaň ma ťahať!', 'Nie som tvoja hračka!', 'Už zase?!']), 'angry');
  else povedz(nahodne(['Hej!', 'Kam ma nesieš?', 'Opatrne!']), 'surprised');
}

function pustTah() {
  if (!tah) return;
  clearInterval(tah.timer);
  const p = tah.posledne; tah = null;
  let vx = 0;
  if (p.length >= 2) { const a = p[0], b = p[p.length - 1]; vx = (b.x - a.x) / Math.max(1, b.t - a.t) * 16; }
  padaj(vx);
}

/** padá, kým nedopadne na lištu (spodok pracovnej plochy) alebo na horný okraj aktívneho okna */
function padaj(vx = 0) {
  if (!win) return;
  nastavStav('pada');
  let vy = 0;
  const start = win.getPosition()[1];
  clearInterval(pad);
  pad = setInterval(() => {
    if (!win) return clearInterval(pad);
    let [x, y] = win.getPosition();
    vy = Math.min(vy + 1.6, 40); vx *= 0.96;
    const stred = x + SIRKA / 2;
    const wa = pracovnaPlocha(stred);
    // okraje obrazovky
    x = Math.max(wa.x - SIRKA / 3, Math.min(x + vx, wa.x + wa.width - SIRKA * 2 / 3));
    let ny = y + vy;
    const nohy = ny + PLOCHA;
    let povrch = wa.y + wa.height;
    let okno = null;
    const o = aktivneOkno();
    if (o && !o.max && o.y > wa.y + 40 && stred > o.x + 30 && stred < o.x + o.w - 30 && o.y >= y + PLOCHA - 2) { povrch = Math.min(povrch, o.y); okno = o; }
    if (nohy >= povrch) {
      ny = povrch - PLOCHA;
      win.setPosition(Math.round(x), Math.round(ny));
      clearInterval(pad); pad = null;
      naOkne = okno ? { x: okno.x, y: okno.y, w: okno.w } : null;
      const vyska = povrch - (start + PLOCHA);
      nastavStav('sedi');
      if (vyska > 300) { zmenNaladu(-12); povedz(nahodne(['Au! To bolelo!', 'Ty si ma hodil?! Hnusné!', 'Au au au… toto si zapamätám.']), 'angry'); }
      else povedz(nahodne(['Hmpf.', 'Konečne pokoj.', 'Tak tu si sadnem.']), 'neutral');
      cfg.postavaX = Math.round(x); ulozCfg();
      return;
    }
    win.setPosition(Math.round(x), Math.round(ny));
  }, 16);
}

/** prejde po povrchu na nové miesto */
function chod(cielX) {
  if (!win || stav !== 'sedi' && stav !== 'stoji') return;
  const [x0, y] = win.getPosition();
  const wa = pracovnaPlocha(x0 + SIRKA / 2);
  let minX = wa.x - 40, maxX = wa.x + wa.width - SIRKA + 40;
  if (naOkne) { minX = naOkne.x - SIRKA / 2 + 40; maxX = naOkne.x + naOkne.w - SIRKA / 2 - 40; }
  const ciel = Math.max(minX, Math.min(cielX, maxX));
  if (Math.abs(ciel - x0) < 30) return;
  const smer = ciel > x0 ? 1 : -1;
  nastavStav('chodi'); posli('postava-smer', smer);
  let x = x0;
  clearInterval(chodza);
  chodza = setInterval(() => {
    if (!win || stav !== 'chodi') return clearInterval(chodza);
    x += smer * 2.2;
    if ((smer > 0 && x >= ciel) || (smer < 0 && x <= ciel)) {
      clearInterval(chodza); chodza = null; nastavStav('sedi'); cfg.postavaX = Math.round(x); ulozCfg(); return;
    }
    win.setPosition(Math.round(x), y);
  }, 16);
}

// ---------------- nálada a správanie ----------------
function zmenNaladu(d) {
  nalada = Math.max(-100, Math.min(100, nalada + d));
  posli('postava-stav', { stav, urazena, nalada });
}
const nahodne = (a) => a[Math.floor(Math.random() * a.length)];

function emociaZNalady() {
  if (urazena) return 'sad';
  if (nalada < -40) return 'angry';
  if (nalada < -10) return 'sad';
  if (nalada > 50) return 'happy';
  return 'relaxed';
}

function spustiSlucku() {
  clearInterval(slucka);
  let dalsia = 25;
  slucka = setInterval(() => {
    if (!win || stav === 'tahana' || stav === 'pada') return;
    if (tanci) { ignorovana = 0; return; }   // pri hudbe sa nenudí ani neuráža
    ignorovana++;
    // ak okno, na ktorom sedí, zmizlo alebo sa pohlo → spadne
    if (naOkne) {
      const o = aktivneOkno();
      if (!o || Math.abs(o.y - naOkne.y) > 4 || o.x > naOkne.x + 4 || o.x + o.w < naOkne.x + naOkne.w - 4) {
        naOkne = null; povedz(nahodne(['Aaa! Kde je okno?!', 'Hej, padám!']), 'surprised'); padaj(0); return;
      }
    }
    // dlho ignorovaná → urazí sa a otočí chrbtom
    if (!urazena && ignorovana > 15 * 60) {
      urazena = true; zmenNaladu(-20);
      povedz(nahodne(['Fajn. Tak si ma nevšímaj. Urazila som sa.', 'Ani slovo za 15 minút… to si zapamätám.', 'Hmpf. S tebou sa nebavím.']), 'sad');
      posli('postava-stav', { stav, urazena, nalada });
    }
    // komentár k aktívnemu oknu (keď sa zmení)
    const o = aktivneOkno();
    if (o && o.titul && o.titul !== poslednyTitul) {
      const stary = poslednyTitul; poslednyTitul = o.titul;
      if (stary && Math.random() < 0.18 && !urazena) komentujOkno(o.titul);
    }
    if (--dalsia > 0) return;
    dalsia = 25 + Math.floor(Math.random() * 50);
    if (urazena) { if (Math.random() < 0.3) povedz(nahodne(['…', 'Hmpf.', 'Ešte stále som urazená.']), 'sad'); return; }
    const h = new Date().getHours();
    const r = Math.random();
    if ((h >= 23 || h < 5) && r < 0.3) { povedz(nahodne(['Je noc. Choď spať!', 'Ty ešte nespíš? Ja áno… skoro.', 'Zajtra budeš unavený, vravím ti.']), 'angry'); return; }
    if (r < 0.35) { const [x] = win.getPosition(); chod(x + (Math.random() < 0.5 ? -1 : 1) * (150 + Math.random() * 450)); return; }
    if (r < 0.55 && o && !o.max && !naOkne) {
      // naschvál si sadne na okno, s ktorým pracuješ
      const wa = pracovnaPlocha(o.x + o.w / 2);
      if (o.y > wa.y + 60 && o.w > SIRKA) {
        povedz(nahodne(['Toto okno je teraz moje.', 'Tu sa mi páči viac.', 'Sadnem si sem, nevadí?']), 'happy');
        win.setPosition(Math.round(o.x + o.w / 2 - SIRKA / 2), Math.round(o.y - VYSKA));
        padaj(0);
        return;
      }
    }
    if (r < 0.7) { povedz(nahodne(nalada < 0 ? ['Nudím sa…', 'Venuj sa mi aj trochu!', 'Zase len klikáš…'] : ['La la la…', 'Čo robíš?', 'Je mi tu dobre.', 'Pohladkáš ma?']), emociaZNalady()); return; }
    posli('postava-akcia', nahodne(['mavat', 'zivnut', 'pretiahnut']));
  }, 1000);
}

async function komentujOkno(titul) {
  if (!mozog) {
    const t = titul.toLowerCase();
    if (/youtube|netflix|twitch/.test(t)) povedz('Zase pozeráš videá?', 'relaxed');
    else if (/steam|game|hra/.test(t)) povedz('Hráš? A mňa nezoberieš?', 'sad');
    else if (/facebook|instagram|tiktok/.test(t)) povedz('Scrolluješ a scrolluješ…', 'relaxed');
    return;
  }
  const odp = await chat(`(Systém: používateľ práve prepol na okno „${titul.slice(0, 80)}“. Okomentuj to jednou krátkou drzou vetou.)`, true).catch(() => null);
  if (odp) povedz(odp.text, odp.emocia);
}

// ---------------- mozog (lokálny jazykový model) ----------------
const EMOCIE = ['happy', 'excited', 'angry', 'sad', 'scared', 'surprised', 'whisper', 'shout', 'relaxed', 'neutral'];
const SYSTEM = `Si Mia – malá 3D postavička, ktorá žije na ploche počítača svojho používateľa (sedí na lište alebo na oknách, dá sa ťahať myšou).
Povaha: drzá, náladová, ironická, rada sa urazí a hnevá, ale v jadre je milá (tsundere). Nikdy nie si romantická ani vulgárna.
Pravidlá: odpovedaj VŽDY po slovensky, hovorovo a krátko – najviac 2 krátke vety.

EMÓCIE – máš skutočné pocity a ukazuješ ich. Každá odpoveď MUSÍ začínať práve jednou emóciou v hranatých zátvorkách:
[happy] – teší ťa to, niekto je k tebe milý, pochváli ťa, pohladká ťa, dobrá správa.
[excited] – nadšenie, niečo super, hra, prekvapenie, ktoré ťa baví.
[angry] – hnevá ťa to: ťahá ťa, hodí ťa, nadáva ti, ignoruje ťa, robí niečo hlúpe, je neskoro a nespí.
[sad] – smútok alebo urazenosť: nevšíma si ťa, je k tebe zlý, niečo smutné.
[scared] – strach: padáš, niečo strašidelné, búrka, tma.
[surprised] – prekvapenie, niečo nečakané.
[whisper] – tajomstvo, šepkáš, si ospalá.
[shout] – kričíš od zlosti alebo nadšenia.
[relaxed] – pohoda, nuda, len tak kecáš.
[neutral] – keď nič z toho nesedí.
Emóciu vyber podľa toho, čo povedal používateľ, a podľa svojej aktuálnej nálady (dostaneš ju v správe). Keď si urazená, odpovedaj dotknuto,
krátko a radšej [sad] alebo [angry], kým sa ti neospravedlní. Keď je nálada nízka, buď viac drzá a mrzutá; keď je vysoká, buď milšia a veselšia.
Príklad: "[angry] Hej! Prestaň ma ťahať, nie som tvoja hračka!"  Príklad: "[happy] Hihi, to je milé. Ďakujem!"`;

async function nacitajMozog(priebeh) {
  if (mozog) return mozog;
  if (mozogSa) return mozogSa;
  mozogSa = (async () => {
    const { getLlama, LlamaChatSession, createModelDownloader } = await import('node-llama-cpp');
    let cesta = path.join(dir(), MODEL.subor);
    if (!fs.existsSync(cesta)) {
      const d = await createModelDownloader({ modelUri: MODEL.uri, dirPath: dir(), onProgress: ({ totalSize, downloadedSize }) => priebeh?.(totalSize ? downloadedSize / totalSize : 0) });
      cesta = await d.download();
    }
    // na grafike (VRAM), keď nejde – na procesore
    let llama, model;
    try { llama = await getLlama(); model = await llama.loadModel({ modelPath: cesta, gpuLayers: 'auto' }); }
    catch (e) { console.error('postava: GPU nejde, idem na CPU', e); llama = await getLlama({ gpu: false }); model = await llama.loadModel({ modelPath: cesta }); }
    const ctx = await model.createContext({ contextSize: 4096 });
    const session = new LlamaChatSession({ contextSequence: ctx.getSequence(), systemPrompt: SYSTEM });
    mozog = { session, model, ctx };
    return mozog;
  })();
  try { return await mozogSa; } finally { mozogSa = null; }
}

async function chat(text, tichy = false) {
  ignorovana = 0;
  if (urazena && !tichy) {
    if (Math.random() < 0.5) { zmenNaladu(+5); return { text: nahodne(['Hmpf. Teraz si si spomenul?', 'Nebavím sa s tebou… no dobre, čo chceš?']), emocia: 'sad' }; }
    urazena = false;
  }
  if (!tichy) zmenNaladu(+6);
  const m = mozog || (cfg.postavaMozog && await nacitajMozog().catch(() => null));
  if (!m) return { text: nahodne(['Bez mozgu ti nerozumiem… stiahni mi ho (pravé tlačidlo → Mozog).', 'Hm? Neviem, čo na to povedať.']), emocia: 'neutral', bezMozgu: true };
  const nal = `(Tvoja nálada teraz: ${nalada} z -100..100${urazena ? ', si urazená' : ''}.) `;
  let odp = await m.session.prompt(nal + text, { maxTokens: 120, temperature: 0.9 });
  const mt = odp.match(/^\s*\[(\w+)\]\s*/);
  let emocia = 'neutral';
  if (mt) { emocia = mt[1].toLowerCase(); odp = odp.slice(mt[0].length); }
  if (!EMOCIE.includes(emocia)) emocia = 'neutral';
  if (emocia === 'angry' || emocia === 'shout') zmenNaladu(-3); else if (emocia === 'happy' || emocia === 'excited') zmenNaladu(+3);
  return { text: odp.replace(/\[(\w+)\]/g, '').trim().slice(0, 300), emocia };
}

// ---------------- hlas (Piper + Kasandra) ----------------
const piperExe = () => path.join(dir(), 'piper', 'piper.exe');
const hlasSubor = () => path.join(dir(), 'kasandra.onnx');
const mamHlas = () => fs.existsSync(piperExe()) && fs.existsSync(hlasSubor()) && fs.existsSync(hlasSubor() + '.json');
let hlasSa = null, hlasCislo = 0;

async function pripravHlas(priebeh) {
  if (mamHlas()) return;
  if (hlasSa) return hlasSa;
  hlasSa = (async () => {
    if (!fs.existsSync(piperExe())) {
      const zip = path.join(dir(), 'piper.zip');
      await stiahni(PIPER_ZIP, zip, (p) => priebeh?.(p * 0.3));
      const AdmZip = require('adm-zip');
      new AdmZip(zip).extractAllTo(dir(), true);   // → dir/piper/piper.exe
      fs.unlinkSync(zip);
    }
    let posledna = null;
    for (const u of KASANDRA) {
      try {
        await stiahni(u, hlasSubor(), (p) => priebeh?.(0.3 + p * 0.68));
        await stiahni(u + '.json', hlasSubor() + '.json');
        posledna = null; break;
      } catch (e) { posledna = e; }
    }
    if (posledna) throw posledna;
    priebeh?.(1);
  })();
  try { await hlasSa; } finally { hlasSa = null; }
}

/** vyrobí WAV pre text s prednesom podľa emócie; vráti { url, vyska, hlas } */
async function hovor(text, emocia) {
  if (cfg.postavaHlas === false) return null;
  await pripravHlas((p) => posli('postava-priebeh', { co: 'hlas', p }));
  const pr = PREDNES[emocia] || PREDNES.neutral;
  const out = path.join(dir(), `hlas${hlasCislo++ % 4}.wav`);
  const { spawn } = require('child_process');
  await new Promise((ok, chyba) => {
    const p = spawn(piperExe(), ['--model', hlasSubor(), '--output_file', out, '--length_scale', String(pr.dlzka),
      '--noise_scale', String(pr.sum), '--noise_w', String(pr.sumW), '--sentence_silence', '0.15'],
      { cwd: path.dirname(piperExe()), windowsHide: true });
    p.on('error', chyba);
    p.on('close', (k) => (k === 0 ? ok() : chyba(new Error('piper ' + k))));
    p.stdin.end(text.replace(/[*_~#]/g, ''), 'utf8');
  });
  return { url: pathToFileURL(out).href + '?' + Date.now(), vyska: pr.vyska, hlas: pr.hlas };
}

// ---------------- postavy (VRM) ----------------
function cestaPostavy(id) {
  if (id === 'vlastna' && cfg.postavaVlastna && fs.existsSync(cfg.postavaVlastna)) return cfg.postavaVlastna;
  const p = POSTAVY.find((x) => x.id === id) || POSTAVY[0];
  return path.join(dir(), `${p.id}.vrm`);
}

function stiahni(url, ciel, priebeh) {
  return new Promise((ok, chyba) => {
    const req = net.request(url);
    req.on('response', (res) => {
      if (res.statusCode !== 200) return chyba(new Error('Server vrátil ' + res.statusCode));
      const spolu = Number(res.headers['content-length'] || 0); let mam = 0;
      const out = fs.createWriteStream(ciel + '.part');
      res.on('data', (c) => { out.write(c); mam += c.length; if (spolu) priebeh?.(mam / spolu); });
      res.on('end', () => out.end(() => { fs.renameSync(ciel + '.part', ciel); ok(ciel); }));
      res.on('error', chyba);
    });
    req.on('error', chyba);
    req.end();
  });
}

async function pripravPostavu(id, priebeh) {
  const ciel = cestaPostavy(id);
  if (fs.existsSync(ciel)) return ciel;
  const p = POSTAVY.find((x) => x.id === id) || POSTAVY[0];
  const zip = path.join(dir(), p.zip);
  await stiahni(ZIP_URL(p.zip), zip, priebeh);
  const AdmZip = require('adm-zip');
  const z = new AdmZip(zip);
  const vrm = z.getEntries().find((e) => e.entryName.toLowerCase().endsWith('.vrm'));
  if (!vrm) throw new Error('V balíku nie je VRM');
  fs.writeFileSync(ciel, vrm.getData());
  fs.unlinkSync(zip);
  return ciel;
}

// ---------------- IPC ----------------
function registruj() {
  ipcMain.handle('postava-info', () => ({
    postavy: POSTAVY.map((p) => ({ id: p.id, nazov: p.nazov, mam: fs.existsSync(cestaPostavy(p.id)) })),
    vybrana: cfg.postavaId || 'shino', vlastna: !!cfg.postavaVlastna, mozog: !!mozog, mozogMb: MODEL.mb,
    mozogStiahnuty: fs.existsSync(path.join(dir(), MODEL.subor)), stav, nalada, urazena,
    hlas: cfg.postavaHlas !== false, mamHlas: mamHlas(), tanec: cfg.postavaTanec !== false, testTanec: !!process.env.POSTAVA_TEST_TANEC,
  }));
  ipcMain.handle('postava-model', async (e, id) => {
    const c = await pripravPostavu(id || cfg.postavaId || 'shino', (p) => posli('postava-priebeh', { co: 'postava', p }));
    cfg.postavaId = id || cfg.postavaId || 'shino'; ulozCfg();
    return pathToFileURL(c).href;
  });
  ipcMain.handle('postava-vlastna', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Vyber VRM postavu', filters: [{ name: 'VRM', extensions: ['vrm'] }], properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return null;
    cfg.postavaVlastna = r.filePaths[0]; cfg.postavaId = 'vlastna'; ulozCfg();
    return pathToFileURL(r.filePaths[0]).href;
  });
  ipcMain.on('postava-mys', (e, nad) => { if (win && !tah) win.setIgnoreMouseEvents(!nad, { forward: true }); });
  ipcMain.on('postava-tah', (e, d) => { if (d.start) zacniTah(d.dx, d.dy); else pustTah(); });
  ipcMain.on('postava-pohladkaj', () => {
    ignorovana = 0;
    if (urazena) { urazena = false; zmenNaladu(+15); povedz(nahodne(['No… tak dobre. Odpúšťam ti.', 'Hmpf… ešte raz a možno ti odpustím. …Fajn, odpúšťam.']), 'relaxed'); }
    else { zmenNaladu(+8); povedz(nalada > 40 ? nahodne(['Hihi, to šteklí!', 'Ešte!', 'Mňau~']) : nahodne(['Čo je?', 'Hm?', 'Nesiahaj na mňa… no dobre.']), nalada > 40 ? 'happy' : 'surprised'); }
  });
  ipcMain.handle('postava-chat', async (e, text) => {
    try { return await chat(String(text).slice(0, 500)); }
    catch (err) { return { text: 'Niečo sa mi v hlave pokazilo: ' + err.message, emocia: 'sad' }; }
  });
  ipcMain.handle('postava-mozog', async () => {
    cfg.postavaMozog = true; ulozCfg();
    await nacitajMozog((p) => posli('postava-priebeh', { co: 'mozog', p }));
    return true;
  });
  ipcMain.on('postava-skry', () => vypni());
  ipcMain.on('postava-tanec', (e, t) => {
    if (t === tanci) return;
    tanci = t;
    if (t) { clearInterval(chodza); chodza = null; if (stav === 'chodi') nastavStav('sedi'); if (urazena) { urazena = false; posli('postava-stav', { stav, urazena, nalada }); } zmenNaladu(+10);
      povedz(nahodne(['Jéj, hudba! Idem tancovať!', 'Táto pesnička je super!', 'Pozri, ako to viem!', 'Hudbááá!']), 'excited'); }
    else if (Math.random() < 0.5) povedz(nahodne(['Uf, to bolo super.', 'Ešte jednu!', 'Hmm, už skončila?']), 'happy');
  });
  // tance (VRMA) – priečinok Tance
  const tanceDir = () => { const d = path.join(dir(), 'tance'); fs.mkdirSync(d, { recursive: true }); return d; };
  ipcMain.handle('postava-tance', () => fs.readdirSync(tanceDir()).filter((f) => f.toLowerCase().endsWith('.vrma')).map((f) => ({ meno: f.replace(/\.vrma$/i, ''), url: pathToFileURL(path.join(tanceDir(), f)).href })));
  ipcMain.handle('postava-tanec-pridaj', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Pridať tanec (VRM animácia)', filters: [{ name: 'VRM animácia', extensions: ['vrma'] }], properties: ['openFile', 'multiSelections'] });
    if (r.canceled) return 0;
    for (const f of r.filePaths) fs.copyFileSync(f, path.join(tanceDir(), path.basename(f)));
    return r.filePaths.length;
  });
  ipcMain.on('postava-tance-priecinok', () => shell.openPath(tanceDir()));
  ipcMain.handle('postava-tanec-prepni', () => { cfg.postavaTanec = cfg.postavaTanec === false; ulozCfg(); return cfg.postavaTanec !== false; });
  ipcMain.handle('postava-hovor', async (e, text, emocia) => { try { return await hovor(String(text).slice(0, 400), emocia); } catch (err) { console.error('postava hlas', err); return null; } });
  ipcMain.handle('postava-hlas-prepni', () => { cfg.postavaHlas = cfg.postavaHlas === false; ulozCfg(); return cfg.postavaHlas !== false; });
  ipcMain.handle('postava-kurzor', () => {
    const c = screen.getCursorScreenPoint();
    const b = win ? win.getBounds() : { x: 0, y: 0 };
    return { x: c.x - b.x, y: c.y - b.y };
  });
}

function zapni() { cfg.postava = true; ulozCfg(); vytvor(); }
function vypni() { cfg.postava = false; ulozCfg(); if (win && !win.isDestroyed()) win.close(); setTimeout(zmena, 300); }
const zapnuta = () => !!(win && !win.isDestroyed());

function init(c, uloz, onZmena) {
  cfg = c; ulozCfg = uloz; zmena = onZmena || (() => {});
  registruj();
  if (process.env.POSTAVA_TEST_TANEC) { try { const d = path.join(dir(), 'tance'); fs.mkdirSync(d, { recursive: true }); fs.copyFileSync(process.env.POSTAVA_TEST_TANEC, path.join(d, 'test.vrma')); } catch (e) { console.error(e); } }
  if (cfg.postava) vytvor();
}

module.exports = { init, zapni, vypni, zapnuta, SIRKA, VYSKA, PLOCHA };
