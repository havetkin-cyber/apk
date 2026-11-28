// Postavička – 3D VRM vykreslenie, pózy (sedí / chodí / visí), mimika, bublina, chat.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation';

const P = window.postava;
window.__postavaBezi = true;
const W = innerWidth, H = innerHeight;
const PLOCHA = Math.round(H * 0.62);        // riadok povrchu (rovnako ako v main.js)
const VYSKA_SVETA = 2.8;                     // m na výšku okna
const M = H / VYSKA_SVETA;                   // px na meter
const hore = (PLOCHA) / M, dole = (H - PLOCHA) / M;

const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(W, H);
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const sirka = W / M;
const camera = new THREE.OrthographicCamera(-sirka / 2, sirka / 2, hore, -dole, 0.1, 20);
// kamera mierne zhora (nie spod sukne)
const SKLON = 18 * Math.PI / 180;
camera.position.set(0, Math.sin(SKLON) * 5, Math.cos(SKLON) * 5);
camera.lookAt(0, 0, 0);
scene.add(new THREE.AmbientLight(0xffffff, 0.9));
const svetlo = new THREE.DirectionalLight(0xffffff, 1.6);
svetlo.position.set(1, 2, 3);
scene.add(svetlo);

const ciel = new THREE.Object3D();
scene.add(ciel);

let vrm = null;
let stav = 'sedi', smer = 0, urazena = false, nalada = 20;
let emocia = 'relaxed', emociaDo = 0;
let hovori = 0;            // do kedy hýbe ústami
let akcia = null, akciaOd = 0;
let otocenie = 0;          // aktuálne otočenie tela (rad)
let vyskaBokov = 0.9;
let f = 1, zaklad = 0;     // f = -1 keď je model otočený dozadu (−Z): osi X a Z kostí sú zrkadlené

// ---------------- načítanie VRM ----------------
const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));
const loaderAnim = new GLTFLoader();
loaderAnim.register((parser) => new VRMAnimationLoaderPlugin(parser));

// ---------------- tance z VRMA súborov (priečinok Tance) ----------------
let mixer = null, akciaTanca = null, tanecDo = 0, menoTanca = '';
const animacie = new Map();   // url → VRMAnimation
async function zacniVrmaTanec() {
  const zoznam = await P.tance().catch(() => []);
  if (!zoznam.length || !vrm) return false;
  const t = zoznam[Math.floor(Math.random() * zoznam.length)];
  try {
    if (!animacie.has(t.url)) { const g = await loaderAnim.loadAsync(t.url); animacie.set(t.url, g.userData.vrmAnimations?.[0]); }
    const va = animacie.get(t.url); if (!va) return false;
    const clip = createVRMAnimationClip(va, vrm);
    if (!mixer || mixer.getRoot() !== vrm.scene) mixer = new THREE.AnimationMixer(vrm.scene);
    const nova = mixer.clipAction(clip);
    nova.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(0.4).play();
    if (akciaTanca && akciaTanca !== nova) akciaTanca.fadeOut(0.4);
    akciaTanca = nova; menoTanca = t.meno;
    tanecDo = performance.now() + 20000;
    return true;
  } catch (e) { console.error('tanec', t.meno, e); return false; }
}
function zastavVrmaTanec() {
  if (mixer) mixer.stopAllAction();
  akciaTanca = null;
}

async function nacitaj(url) {
  const gltf = await loader.loadAsync(url);
  const novy = gltf.userData.vrm;
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.combineSkeletons?.(gltf.scene);
  VRMUtils.rotateVRM0(novy);
  novy.scene.traverse((o) => { o.frustumCulled = false; });
  if (vrm) { scene.remove(vrm.scene); VRMUtils.deepDispose(vrm.scene); }
  vrm = novy;
  scene.add(vrm.scene);
  if (vrm.lookAt) vrm.lookAt.target = ciel;
  // výška bokov v pokoji (na sadnutie presne na okraj)
  vrm.humanoid.resetNormalizedPose();
  vrm.scene.rotation.set(0, 0, 0);          // smer meriame v priestore modelu (rotateVRM0 by to skreslil)
  vrm.scene.updateMatrixWorld(true);
  // ktorým smerom je model otočený: ľavá noha postavy má byť pri pohľade spredu vpravo (+X)
  const lx = new THREE.Vector3().setFromMatrixPosition(vrm.humanoid.getNormalizedBoneNode('leftUpperLeg').matrixWorld).x;
  const rx = new THREE.Vector3().setFromMatrixPosition(vrm.humanoid.getNormalizedBoneNode('rightUpperLeg').matrixWorld).x;
  f = lx >= rx ? 1 : -1; zaklad = f > 0 ? 0 : Math.PI;
  const boky = vrm.humanoid.getNormalizedBoneNode('hips');
  vyskaBokov = boky ? new THREE.Vector3().setFromMatrixPosition(boky.matrixWorld).y : 0.9;
  // veľmi veľké / malé modely zmenšiť na ~1,55 m
  const box = new THREE.Box3().setFromObject(vrm.scene);
  const v = box.max.y - box.min.y;
  const k = v > 0.5 ? Math.min(1.2, 1.55 / v) : 1;
  vrm.scene.scale.setScalar(k);
  vyskaBokov *= k;
}

async function startModel(id) {
  const priebeh = document.getElementById('priebeh');
  priebeh.style.display = 'block'; priebeh.textContent = 'Pripravujem postavu…';
  try { await nacitaj(await P.model(id)); povedz('Ahoj! Tak tu teraz bývam.', 'happy'); }
  catch (e) { povedz('Postavu sa nepodarilo načítať: ' + e.message, 'sad'); }
  priebeh.style.display = 'none';
}

// ---------------- bublina a reč ----------------
const bublina = document.getElementById('bublina');
let skryBublinu = null;
function povedz(text, em) {
  if (!text) return;
  bublina.textContent = text;
  bublina.classList.add('vidno');
  nastavEmociu(em || 'neutral', 4000 + text.length * 60);
  clearTimeout(skryBublinu);
  skryBublinu = setTimeout(() => bublina.classList.remove('vidno'), 3500 + text.length * 70);
  if (text === '…') return;
  hovori = performance.now() + Math.min(6000, 300 + text.length * 55);  // kým nepríde hlas, aspoň hýbe ústami
  hlas(text, em);
}

// hlas Kasandra (Piper) – ústa sa hýbu podľa hlasitosti zvuku
let audio = null, actx = null, analyzer = null, hlasitost = 0, poradie = 0;
async function hlas(text, em) {
  const moje = ++poradie;
  const r = await P.hovor(text, em || 'neutral').catch(() => null);
  if (!r || moje !== poradie) return;
  try {
    if (audio) { audio.pause(); }
    audio = new Audio(r.url);
    audio.preservesPitch = false; audio.playbackRate = r.vyska; audio.volume = r.hlas;
    if (!actx) actx = new AudioContext();
    const src = actx.createMediaElementSource(audio);
    analyzer = actx.createAnalyser(); analyzer.fftSize = 512;
    src.connect(analyzer); analyzer.connect(actx.destination);
    hovori = 0;
    audio.onended = () => { analyzer = null; hlasitost = 0; };
    await audio.play();
  } catch (e) { console.error(e); }
}
const buf = new Uint8Array(512);
function hlasitostZvuku() {
  if (!analyzer) return 0;
  analyzer.getByteTimeDomainData(buf);
  let s = 0; for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; s += v * v; }
  return Math.min(1, Math.sqrt(s / buf.length) * 6);
}

// emócie z modelu → výraz tváre (VRM má happy / angry / sad / surprised / relaxed)
const TVAR = { happy: 'happy', excited: 'happy', angry: 'angry', shout: 'angry', sad: 'sad', scared: 'surprised', surprised: 'surprised', whisper: 'relaxed', relaxed: 'relaxed', neutral: 'neutral' };
function nastavEmociu(e, ms) {
  emocia = TVAR[e] || 'neutral';
  emociaDo = performance.now() + ms;
}

P.on('postava-povedz', (d) => povedz(d.text, d.emocia));
P.on('postava-stav', (d) => { stav = d.stav; urazena = d.urazena; nalada = d.nalada; });
P.on('postava-smer', (s) => { smer = s; });
P.on('postava-akcia', (a) => { akcia = a; akciaOd = performance.now(); });
P.on('postava-priebeh', (d) => {
  const el = document.getElementById('priebeh');
  el.style.display = d.p >= 1 ? 'none' : 'block';
  el.textContent = ({ mozog: 'Sťahujem mozog', hlas: 'Sťahujem hlas Kasandra' }[d.co] || 'Sťahujem postavu') + ` ${Math.round(d.p * 100)} %`;
});

// ---------------- myš: priechodnosť, ťahanie, pohladkanie, menu ----------------
const pole = document.getElementById('pole'), vstup = document.getElementById('vstup');
const menu = document.getElementById('menu');
let nadPostavou = false, dole_ = null;

function jeNaPostave(x, y) {
  const gl = renderer.getContext();
  const px = new Uint8Array(4);
  const r = devicePixelRatio;
  gl.readPixels(Math.round(x * r), Math.round((H - y) * r), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return px[3] > 20;
}
function nadUI(t) { return t && (t.closest('#pole') || t.closest('#menu')); }

addEventListener('mousemove', (e) => {
  const nad = jeNaPostave(e.clientX, e.clientY) || nadUI(e.target) || pole.classList.contains('vidno') || menu.classList.contains('vidno');
  if (nad !== nadPostavou) { nadPostavou = !!nad; P.mys(nadPostavou); }
  if (dole_ && !dole_.tahame && Math.hypot(e.screenX - dole_.sx, e.screenY - dole_.sy) > 6) {
    dole_.tahame = true;
    P.tah({ start: true, dx: dole_.x, dy: dole_.y });
  }
});
addEventListener('mousedown', (e) => {
  if (e.button !== 0 || nadUI(e.target)) return;
  if (!jeNaPostave(e.clientX, e.clientY)) return;
  zavriMenu();
  dole_ = { x: e.clientX, y: e.clientY, sx: e.screenX, sy: e.screenY, tahame: false };
});
addEventListener('mouseup', () => {
  if (!dole_) return;
  if (dole_.tahame) P.tah({ start: false }); else P.pohladkaj();
  dole_ = null;
});
addEventListener('dblclick', (e) => { if (jeNaPostave(e.clientX, e.clientY)) otvorChat(); });
addEventListener('contextmenu', (e) => { if (jeNaPostave(e.clientX, e.clientY)) { e.preventDefault(); otvorMenu(e.clientX, e.clientY); } });
addEventListener('keydown', (e) => { if (e.key === 'Escape') { zavriChat(); zavriMenu(); } });

function otvorChat() { pole.classList.add('vidno'); P.mys(true); vstup.focus(); }
function zavriChat() { pole.classList.remove('vidno'); vstup.value = ''; }
async function posli() {
  const t = vstup.value.trim(); if (!t) return;
  vstup.value = '';
  povedz('…', 'neutral');
  const o = await P.chat(t);
  povedz(o.text, o.emocia);
}
document.getElementById('posli').onclick = posli;
vstup.addEventListener('keydown', (e) => { if (e.key === 'Enter') posli(); });

function zavriMenu() { menu.classList.remove('vidno'); }
async function otvorMenu(x, y) {
  const i = await P.info();
  menu.innerHTML = '';
  const tl = (text, f) => { const b = document.createElement('button'); b.textContent = text; b.onclick = () => { zavriMenu(); f(); }; menu.appendChild(b); };
  const nad = (t) => { const d = document.createElement('div'); d.className = 'nadpis'; d.textContent = t; menu.appendChild(d); };
  tl('💬 Rozprávať sa', otvorChat);
  nad('Postava');
  for (const p of i.postavy) tl(`${p.id === i.vybrana ? '● ' : ''}${p.nazov}${p.mam ? '' : ' (stiahnuť)'}`, () => startModel(p.id));
  tl(`${i.vybrana === 'vlastna' ? '● ' : ''}Vlastný VRM…`, async () => { const u = await P.vlastna(); if (u) { await nacitaj(u); povedz('Nový vzhľad! Ako vyzerám?', 'happy'); } });
  nad('Mozog (chat)');
  if (i.mozog) tl('✔ Mozog je načítaný', () => {});
  else tl(i.mozogStiahnuty ? 'Načítať mozog' : `Stiahnuť mozog (~${(i.mozogMb / 1000).toFixed(1)} GB)`, async () => {
    povedz('Chvíľu strpenie, zapínam si mozog…', 'neutral');
    try { await P.mozog(); povedz('Tak, už rozmýšľam. Čo chceš?', 'happy'); } catch (e) { povedz('Mozog sa nepodarilo zapnúť: ' + e.message, 'sad'); }
  });
  nad('Tanec');
  tl(i.tanec ? '💃 Tancuje pri hudbe' : '🪑 Pri hudbe netancuje', async () => { tanecPovoleny = await P.tanecPrepni(); povedz(tanecPovoleny ? 'Pusti nejakú pesničku!' : 'Dobre, budem len sedieť.', tanecPovoleny ? 'excited' : 'relaxed'); });
  tl('➕ Pridať tanec (.vrma)…', async () => { const n = await P.tanecPridaj(); if (n) povedz(n > 1 ? `Naučila som sa ${n} nové tance!` : 'Nový tanec! Pusti hudbu!', 'excited'); });
  tl('📁 Priečinok s tancami', () => P.tancePriecinok());
  nad('Hlas (Kasandra)');
  tl(i.hlas ? '🔊 Hlas zapnutý' : '🔇 Hlas vypnutý', async () => { const z = await P.hlasPrepni(); povedz(z ? 'Tak, zase hovorím.' : 'Dobre, budem ticho… hmpf.', z ? 'happy' : 'sad'); });
  nad('');
  tl('🙈 Schovať postavičku', () => P.skry());
  menu.classList.add('vidno');
  menu.style.left = Math.min(x, W - 200) + 'px';
  menu.style.top = Math.max(8, Math.min(y, H - menu.offsetHeight - 8)) + 'px';
  P.mys(true);
}

// ---------------- tanec: počúva zvuk z PC a hľadá rytmus ----------------
let tanci = false, uderOd = 0, interval = 0.5, uderov = 0, tanecPovoleny = true;
let hudbaOd = 0, tichoOd = 0;
async function spustiUcho() {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: { width: 1, height: 1, frameRate: 1 } });
    stream.getVideoTracks().forEach((t) => t.stop());
    if (!stream.getAudioTracks().length) return;
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser(); an.fftSize = 1024; an.smoothingTimeConstant = 0.2;
    src.connect(an);                      // nie do reproduktorov – len počúvame
    const f = new Uint8Array(an.frequencyBinCount);
    const hz = ctx.sampleRate / an.fftSize;
    const basOd = Math.floor(40 / hz), basDo = Math.ceil(160 / hz);
    let priemer = 0, posledny = 0, celk = 0;
    const intervaly = [];
    setInterval(() => {
      an.getByteFrequencyData(f);
      let b = 0; for (let i = basOd; i <= basDo; i++) b += f[i]; b /= (basDo - basOd + 1);
      let c = 0; for (let i = 0; i < f.length; i++) c += f[i]; c /= f.length;
      celk = celk * 0.95 + c * 0.05;
      priemer = priemer * 0.92 + b * 0.08;
      const teraz = performance.now() / 1000;
      // úder: basy výrazne nad priemerom
      if (b > priemer * 1.35 && b > 90 && teraz - posledny > 0.28) {
        const d = teraz - posledny; posledny = teraz;
        if (d > 0.28 && d < 1.2) { intervaly.push(d); if (intervaly.length > 12) intervaly.shift(); }
        const zor = [...intervaly].sort((x, y) => x - y);
        if (zor.length >= 4) interval = zor[Math.floor(zor.length / 2)];
        uderOd = teraz; uderov++;
      }
      // hudba hrá, keď je zvuk stály a má údery; vlastný hlas postavičky sa nepočíta
      // pravidelnosť úderov (hudba má stály rytmus, šum nie)
      let pravidelne = false;
      if (intervaly.length >= 6) {
        const p = intervaly.reduce((a, x) => a + x, 0) / intervaly.length;
        const odch = Math.sqrt(intervaly.reduce((a, x) => a + (x - p) ** 2, 0) / intervaly.length);
        pravidelne = odch / p < 0.35;
      }
      const hra = celk > 25 && pravidelne && teraz - posledny < 2.5 && !analyzer;
      if (hra) { tichoOd = 0; if (!hudbaOd) hudbaOd = teraz; } else { hudbaOd = 0; if (!tichoOd) tichoOd = teraz; }
      const ma = tanecPovoleny && hudbaOd && teraz - hudbaOd > 2.5;
      const prestan = tichoOd && teraz - tichoOd > 3;
      if (ma && !tanci) { tanci = true; P.tanec(true); zacniVrmaTanec(); }
      if (tanci && (prestan || !tanecPovoleny)) { tanci = false; P.tanec(false); zastavVrmaTanec(); }
    }, 20);
  } catch (e) { console.error('ucho', e); }
}

// ---------------- pózy ----------------
const kost = (n) => vrm?.humanoid.getNormalizedBoneNode(n);
function rot(n, x = 0, y = 0, z = 0) { const b = kost(n); if (b) b.rotation.set(x * f, y, z * f); }

function poza(t) {
  const s = Math.sin, d = 0.6; // d – sila pohybu
  vrm.humanoid.resetNormalizedPose();
  // ruky dole (normalizované kosti: ľavá ruka smeruje na +X)
  let lRuka = -1.15, pRuka = 1.15;
  const dych = s(t * 1.6) * 0.02;
  rot('spine', dych, 0, 0);
  rot('chest', dych, 0, 0);

  const moznoTancit = tanci && (stav === 'sedi' || stav === 'stoji');
  if (moznoTancit) {
    // tanec do rytmu: fáza 0..1 medzi údermi, každých 8 úderov iný pohyb
    const teraz = performance.now() / 1000;
    const faza = Math.min(1, (teraz - uderOd) / Math.max(0.3, interval));
    const u = uderov % 2 ? 1 : -1;
    const pohyb = Math.floor(uderov / 8) % 4;
    const odraz = Math.sin(faza * Math.PI);           // 0→1→0 medzi údermi
    rot('hips', 0, u * 0.15 * odraz, u * 0.08 * odraz);
    rot('spine', 0.05 * odraz, 0, -u * 0.06 * odraz);
    rot('head', -0.12 * odraz, u * 0.1, u * 0.08 * odraz);
    rot('leftUpperLeg', -0.25 * (u > 0 ? odraz : 0), 0, 0.05); rot('rightUpperLeg', -0.25 * (u < 0 ? odraz : 0), 0, -0.05);
    rot('leftLowerLeg', 0.5 * (u > 0 ? odraz : 0), 0, 0); rot('rightLowerLeg', 0.5 * (u < 0 ? odraz : 0), 0, 0);
    if (pohyb === 0) { // ruky hore, striedavo
      rot('leftUpperArm', 0, 0, u > 0 ? 2.4 : 1.2); rot('rightUpperArm', 0, 0, u < 0 ? -2.4 : -1.2);
      rot('leftLowerArm', 0, 0, 0.4); rot('rightLowerArm', 0, 0, -0.4);
    } else if (pohyb === 1) { // ruky v bok, vlní sa
      rot('leftUpperArm', 0.3, 0, -0.9); rot('rightUpperArm', 0.3, 0, 0.9); rot('leftLowerArm', 0, -1.6, 0); rot('rightLowerArm', 0, 1.6, 0);
      rot('hips', 0, 0, u * 0.18 * odraz);
    } else if (pohyb === 2) { // tlieskanie nad hlavou
      const k = odraz * 0.35;
      rot('leftUpperArm', -0.3, 0, 2.3 - k); rot('rightUpperArm', -0.3, 0, -2.3 + k); rot('leftLowerArm', 0, -0.8, 0); rot('rightLowerArm', 0, 0.8, 0);
    } else { // pumpovanie päsťou
      rot('leftUpperArm', -0.6 - odraz * 0.6, 0, -1.0); rot('rightUpperArm', 0.2, 0, 1.1);
      rot('leftLowerArm', 0, -1.4 + odraz * 0.6, 0);
    }
  } else if (stav === 'sedi' || stav === 'stoji') {
    // sedí na okraji, nohy visia a hompáľajú sa
    rot('leftUpperLeg', -1.5, 0, -0.04);      // kolená k sebe
    rot('rightUpperLeg', -1.5, 0, 0.04);
    rot('leftLowerLeg', 1.35 + s(t * 2.1) * 0.22, 0, 0);
    rot('rightLowerLeg', 1.35 + s(t * 2.1 + 2.2) * 0.22, 0, 0);
    // ruky v lone
    rot('leftUpperArm', -0.35, 0, -1.2); rot('rightUpperArm', -0.35, 0, 1.2);
    rot('leftLowerArm', 0, -1.1, 0); rot('rightLowerArm', 0, 1.1, 0);
    if (urazena) { rot('leftUpperArm', 0.9, 0.6, -1.0); rot('rightUpperArm', 0.9, -0.6, 1.0); rot('leftLowerArm', 0, -1.9, 0); rot('rightLowerArm', 0, 1.9, 0); } // ruky prekrížené
    if (nalada < -40 && !urazena) rot('head', -0.05, 0, s(t * 0.7) * 0.05);
  } else if (stav === 'chodi') {
    const k = t * 7;
    rot('leftUpperLeg', s(k) * d, 0, 0); rot('rightUpperLeg', -s(k) * d, 0, 0);
    rot('leftLowerLeg', Math.max(0, -s(k)) * 0.9, 0, 0); rot('rightLowerLeg', Math.max(0, s(k)) * 0.9, 0, 0);
    rot('leftUpperArm', -s(k) * 0.4, 0, lRuka); rot('rightUpperArm', s(k) * 0.4, 0, pRuka);
    rot('hips', 0, 0, s(k) * 0.03);
  } else {
    // visí / padá – ruky hore, nohy kopú
    rot('leftUpperArm', 0, 0, 0.9 + s(t * 9) * 0.15); rot('rightUpperArm', 0, 0, -0.9 - s(t * 9) * 0.15);
    rot('leftUpperLeg', s(t * 8) * 0.35, 0, 0.05); rot('rightUpperLeg', -s(t * 8) * 0.35, 0, -0.05);
    rot('leftLowerLeg', 0.4 + s(t * 8) * 0.3, 0, 0); rot('rightLowerLeg', 0.4 - s(t * 8) * 0.3, 0, 0);
  }

  // krátke akcie
  const a = akcia ? (performance.now() - akciaOd) / 1000 : 99;
  if (a < 2.5) {
    if (akcia === 'mavat') { rot('rightUpperArm', 0, 0, -1.1); rot('rightLowerArm', 0, 0, -0.6 + s(a * 12) * 0.5); }
    if (akcia === 'pretiahnut') { rot('leftUpperArm', 0, 0, 2.6); rot('rightUpperArm', 0, 0, -2.6); rot('chest', -0.15, 0, 0); }
    if (akcia === 'zivnut') { rot('head', -0.25, 0, 0); rot('rightUpperArm', -0.4, 0, 2.2); rot('rightLowerArm', 0, 2.2, 0); }
  } else akcia = null;

  // telo: chrbtom keď je urazená, bokom pri chôdzi
  let cielOtocenia = urazena && !tanci ? Math.PI : stav === 'chodi' ? smer * Math.PI / 2 : 0;
  if (moznoTancit && Math.floor(uderov / 8) % 4 === 1) cielOtocenia = Math.sin(performance.now() / 1000 * Math.PI / Math.max(0.3, interval) / 4) * 0.5;
  otocenie += (cielOtocenia - otocenie) * 0.08;
  vrm.scene.rotation.y = zaklad + otocenie;

  // výška: sedí boky na povrchu, inak nohy na povrchu
  const sedi = (stav === 'sedi' || stav === 'stoji') && !moznoTancit;
  vrm.scene.position.y = sedi ? -vyskaBokov + 0.06 : 0;
  if (moznoTancit) vrm.scene.position.y = -Math.abs(Math.sin(Math.min(1, (performance.now() / 1000 - uderOd) / Math.max(0.3, interval)) * Math.PI)) * 0.04;
  vrm.scene.position.z = 0;
}

let zmrk = 0, dalsieZmrk = 2;
function mimika(t, dt) {
  const em = vrm.expressionManager; if (!em) return;
  for (const e of ['happy', 'angry', 'sad', 'surprised', 'relaxed', 'aa', 'blink']) em.setValue(e, 0);
  let e = performance.now() < emociaDo ? emocia : (urazena ? 'sad' : nalada < -40 ? 'angry' : nalada > 50 ? 'happy' : 'relaxed');
  if (stav === 'tahana' || stav === 'pada') e = nalada < -20 ? 'angry' : 'surprised';
  else if (tanci && performance.now() >= emociaDo) e = 'happy';
  if (e !== 'neutral') em.setValue(e, e === 'relaxed' ? 0.5 : 0.85);
  // ústa pri reči
  hlasitost += (hlasitostZvuku() - hlasitost) * 0.5;
  if (analyzer) em.setValue('aa', Math.min(1, hlasitost * 1.3));
  else if (performance.now() < hovori) em.setValue('aa', (Math.sin(t * 18) * 0.5 + 0.5) * 0.7);
  // žmurkanie
  dalsieZmrk -= dt;
  if (dalsieZmrk <= 0) { zmrk = 0.15; dalsieZmrk = 2 + Math.random() * 4; }
  if (zmrk > 0) { zmrk -= dt; if (e !== 'happy') em.setValue('blink', 1); }
}

// pohľad za kurzorom
let kurzor = { x: W / 2, y: H / 3 };
setInterval(async () => { try { kurzor = await P.kurzor(); } catch {} }, 80);

const hodiny = new THREE.Clock();
function slucka() {
  requestAnimationFrame(slucka);
  const dt = Math.min(hodiny.getDelta(), 0.1), t = hodiny.elapsedTime;
  if (vrm) {
    const vrmaTanec = akciaTanca && tanci && (stav === 'sedi' || stav === 'stoji');
    if (vrmaTanec) {
      // nahraný tanec: kosti riadi animácia, postava stojí na povrchu a pozerá na nás
      if (performance.now() > tanecDo) { tanecDo = performance.now() + 20000; zacniVrmaTanec(); }
      mixer.update(dt);
      vrm.scene.position.set(0, 0, 0);
      vrm.scene.rotation.y = zaklad;
    } else {
      if (akciaTanca && !tanci) zastavVrmaTanec();
      poza(t);
    }
    mimika(t, dt);
    ciel.position.set((kurzor.x - W / 2) / M, hore - kurzor.y / M, 2);
    vrm.update(dt);
    // bublina nad hlavou
    const hlava = kost('head');
    if (hlava) {
      const p = new THREE.Vector3().setFromMatrixPosition(hlava.matrixWorld).project(camera);
      const y = (1 - p.y) / 2 * H;
      bublina.style.top = Math.max(4, y - 70 - bublina.offsetHeight) + 'px';
    }
  }
  renderer.render(scene, camera);
}
slucka();

// štart
P.info().then(async (i) => {
  tanecPovoleny = i.tanec;
  await startModel(i.vybrana === 'vlastna' ? 'vlastna' : i.vybrana);
  if (i.testTanec) { tanci = true; console.log('test tanca: ' + await zacniVrmaTanec()); return; }
  spustiUcho();
});
