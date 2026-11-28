// Postavička – 3D VRM vykreslenie, pózy (sedí / chodí / visí), mimika, bublina, chat.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

const P = window.postava;
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
camera.position.set(0, 0, 5);
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

// ---------------- načítanie VRM ----------------
const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));

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
  vrm.scene.updateMatrixWorld(true);
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
  hovori = performance.now() + Math.min(6000, 300 + text.length * 55);
  clearTimeout(skryBublinu);
  skryBublinu = setTimeout(() => bublina.classList.remove('vidno'), 3500 + text.length * 70);
  hlas(text);
}
function hlas(text) {
  try {
    const hlasy = speechSynthesis.getVoices();
    const sk = hlasy.find((v) => v.lang?.toLowerCase().startsWith('sk')) || hlasy.find((v) => v.lang?.toLowerCase().startsWith('cs'));
    if (!sk) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.voice = sk; u.lang = sk.lang; u.pitch = 1.35; u.rate = 1.05;
    speechSynthesis.speak(u);
  } catch {}
}
function nastavEmociu(e, ms) {
  emocia = ['happy', 'angry', 'sad', 'surprised', 'relaxed', 'neutral'].includes(e) ? e : 'neutral';
  emociaDo = performance.now() + ms;
}

P.on('postava-povedz', (d) => povedz(d.text, d.emocia));
P.on('postava-stav', (d) => { stav = d.stav; urazena = d.urazena; nalada = d.nalada; });
P.on('postava-smer', (s) => { smer = s; });
P.on('postava-akcia', (a) => { akcia = a; akciaOd = performance.now(); });
P.on('postava-priebeh', (d) => {
  const el = document.getElementById('priebeh');
  el.style.display = d.p >= 1 ? 'none' : 'block';
  el.textContent = (d.co === 'mozog' ? 'Sťahujem mozog' : 'Sťahujem postavu') + ` ${Math.round(d.p * 100)} %`;
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
  nad('');
  tl('🙈 Schovať postavičku', () => P.skry());
  menu.classList.add('vidno');
  menu.style.left = Math.min(x, W - 200) + 'px';
  menu.style.top = Math.max(8, Math.min(y, H - menu.offsetHeight - 8)) + 'px';
  P.mys(true);
}

// ---------------- pózy ----------------
const kost = (n) => vrm?.humanoid.getNormalizedBoneNode(n);
function rot(n, x = 0, y = 0, z = 0) { const b = kost(n); if (b) b.rotation.set(x, y, z); }

function poza(t) {
  const s = Math.sin, d = 0.6; // d – sila pohybu
  vrm.humanoid.resetNormalizedPose();
  // ruky dole (normalizované kosti: ľavá ruka smeruje na +X)
  let lRuka = -1.15, pRuka = 1.15;
  const dych = s(t * 1.6) * 0.02;
  rot('spine', dych, 0, 0);
  rot('chest', dych, 0, 0);

  if (stav === 'sedi' || stav === 'stoji') {
    // sedí na okraji, nohy visia a hompáľajú sa
    rot('leftUpperLeg', -1.5, 0.05, 0.08);
    rot('rightUpperLeg', -1.5, -0.05, -0.08);
    rot('leftLowerLeg', 1.35 + s(t * 2.1) * 0.22, 0, 0);
    rot('rightLowerLeg', 1.35 + s(t * 2.1 + 2.2) * 0.22, 0, 0);
    // ruky opreté vedľa seba
    rot('leftUpperArm', 0.35, 0, -1.25); rot('rightUpperArm', 0.35, 0, 1.25);
    rot('leftLowerArm', 0, -0.3, 0); rot('rightLowerArm', 0, 0.3, 0);
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
  let cielOtocenia = urazena ? Math.PI : stav === 'chodi' ? smer * Math.PI / 2 : 0;
  otocenie += (cielOtocenia - otocenie) * 0.08;
  vrm.scene.rotation.y = otocenie;

  // výška: sedí boky na povrchu, inak nohy na povrchu
  const sedi = stav === 'sedi' || stav === 'stoji';
  vrm.scene.position.y = sedi ? -vyskaBokov + 0.06 : 0;
  vrm.scene.position.z = 0;
}

let zmrk = 0, dalsieZmrk = 2;
function mimika(t, dt) {
  const em = vrm.expressionManager; if (!em) return;
  for (const e of ['happy', 'angry', 'sad', 'surprised', 'relaxed', 'aa', 'blink']) em.setValue(e, 0);
  let e = performance.now() < emociaDo ? emocia : (urazena ? 'sad' : nalada < -40 ? 'angry' : nalada > 50 ? 'happy' : 'relaxed');
  if (stav === 'tahana' || stav === 'pada') e = nalada < -20 ? 'angry' : 'surprised';
  if (e !== 'neutral') em.setValue(e, e === 'relaxed' ? 0.5 : 0.85);
  // ústa pri reči
  if (performance.now() < hovori) em.setValue('aa', (Math.sin(t * 18) * 0.5 + 0.5) * 0.7);
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
    poza(t);
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
P.info().then((i) => startModel(i.vybrana === 'vlastna' ? 'vlastna' : i.vybrana));
speechSynthesis.getVoices();
