import * as THREE from 'three';
import { createWorld, canDrive, surfaceH, TOD_ORDER, COAST_X } from './world.js';
import { createCar } from './car.js';
import { CHECKPOINTS, START } from './config.js';
import { clamp, lerp, damp, smoothstep, angDiff } from './util.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
const setBar = (p) => { $('#bar i').style.width = `${p}%`; };

// ── renderer / scene ─────────────────────────────────────────
const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.5, 12000);
scene.add(camera);

// post: MSAA HDR target → bloom → vignette/grade → tone-map + sRGB
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.3, 0.75, 0.95);
composer.addPass(bloom);
composer.addPass(new ShaderPass({
  uniforms: { tDiffuse: { value: null }, amount: { value: 0.38 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float amount; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv); vec2 d = vUv - 0.5;
      float v = smoothstep(0.95, 0.25, length(d) * 1.25);
      c.rgb *= mix(1.0 - amount, 1.0, v);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, 1.1);
      gl_FragColor = c; }`,
}));
composer.addPass(new OutputPass());

const keys = {};
const V3 = THREE.Vector3;
const S = { x: START.pos[0], z: START.pos[1], h: START.heading, v: 0, steer: 0, y: 0, pitch: 0, roll: 0 };
let state = 'loading';
let world, car, person;
const visited = new Set();
const armed = Object.fromEntries(CHECKPOINTS.map((c) => [c.id, true]));
let target = null;       // manually selected route target (cp id)
let active = null;       // checkpoint whose panel is open
let camYaw = 0, dragging = false, lastDrag = 0, shake = 0;
const camPos = new V3(), camLook = new V3();
let fadeBusy = false;

// ── audio ────────────────────────────────────────────────────
let audio = null, muted = false;
function initAudio() {
  if (audio) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  const ctx = new AC();
  const master = ctx.createGain(); master.gain.value = muted ? 0 : 0.5; master.connect(ctx.destination);
  const o1 = ctx.createOscillator(); o1.type = 'sawtooth';
  const o2 = ctx.createOscillator(); o2.type = 'square';
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400;
  const eg = ctx.createGain(); eg.gain.value = 0;
  o1.connect(lp); o2.connect(lp); lp.connect(eg); eg.connect(master);
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const ns = ctx.createBufferSource(); ns.buffer = buf; ns.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.5;
  const wg = ctx.createGain(); wg.gain.value = 0;
  ns.connect(bp); bp.connect(wg); wg.connect(master);
  o1.start(); o2.start(); ns.start();
  audio = { ctx, master, o1, o2, lp, eg, wg };
}
function chime(freqs = [660, 880, 1320]) {
  if (!audio || muted) return;
  const { ctx, master } = audio;
  freqs.forEach((f, i) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = f;
    const t0 = ctx.currentTime + i * 0.09;
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.14, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9);
    o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + 1);
  });
}
function updateAudio(throttle) {
  if (!audio) return;
  const { ctx, o1, o2, lp, eg, wg } = audio;
  const f = clamp(Math.abs(S.v) / 70, 0, 1.2);
  const driving = state === 'driving' || state === 'parking';
  const now = ctx.currentTime;
  o1.frequency.setTargetAtTime(40 + f * 150 + throttle * 12, now, 0.08);
  o2.frequency.setTargetAtTime(60 + f * 220, now, 0.08);
  lp.frequency.setTargetAtTime(260 + f * 1200 + throttle * 300, now, 0.1);
  eg.gain.setTargetAtTime(driving ? 0.05 + 0.05 * throttle + 0.05 * f : 0.012, now, 0.12);
  wg.gain.setTargetAtTime(driving ? f * f * 0.22 : 0, now, 0.15);
}

// ── geometry helpers ─────────────────────────────────────────
const fwd = (h) => new V3(Math.sin(h), 0, Math.cos(h));
const left = (h) => new V3(Math.cos(h), 0, -Math.sin(h));
const cpById = (id) => CHECKPOINTS.find((c) => c.id === id);
const dist2D = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

// ── UI: checkpoint list, pins ─────────────────────────────────
const list = $('#cp-list');
const pinsEl = $('#pins');
CHECKPOINTS.forEach((cp, i) => {
  const b = document.createElement('button');
  b.className = 'cp'; b.style.setProperty('--c', cp.color); b.dataset.id = cp.id;
  b.innerHTML = `<div class="ic">${cp.icon}</div><div><div class="n">${esc(cp.title)}</div><div class="l">${esc(cp.landmark)}</div></div><div class="k">${i + 1}</div>`;
  b.addEventListener('click', (e) => (e.shiftKey ? setTarget(cp.id) : teleportTo(cp)));
  list.appendChild(b);
  const pin = document.createElement('div');
  pin.className = 'pin'; pin.style.setProperty('--c', cp.color); pin.dataset.id = cp.id;
  pin.innerHTML = `<i>${cp.icon}</i>${esc(cp.landmark)}<small></small>`;
  pinsEl.appendChild(pin);
});
function setTarget(id) { target = target === id ? null : id; refreshList(); }
let listKey = '';
function refreshList() {
  const tid = currentTarget()?.id;
  const key = `${tid}|${[...visited].join()}`;
  if (key === listKey) return;
  listKey = key;
  document.querySelectorAll('.cp').forEach((el) => {
    el.classList.toggle('visited', visited.has(el.dataset.id));
    el.classList.toggle('target', el.dataset.id === tid);
    el.querySelector('.k').textContent = visited.has(el.dataset.id) ? '✓' : String(CHECKPOINTS.findIndex((c) => c.id === el.dataset.id) + 1);
  });
}
function currentTarget() {
  if (target) return cpById(target);
  if (visited.size === 0) return cpById('projects');
  let best = null, bd = Infinity;
  for (const c of CHECKPOINTS) {
    if (visited.has(c.id) && visited.size < CHECKPOINTS.length) continue;
    const d = dist2D(S.x, S.z, c.stop[0], c.stop[1]);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

function renderPanel(cp) {
  $('#panel').style.setProperty('--accent', cp.color);
  $('#p-kick').textContent = cp.kicker;
  $('#p-title').textContent = cp.headline;
  $('#p-where').innerHTML = `<span style="color:${cp.color}">${cp.icon}</span> ${esc(cp.landmark)} · ${esc(cp.title)}`;
  let i = 0;
  const blk = (inner) => `<div class="blk" style="--i:${i++}">${inner}</div>`;
  $('#p-body').innerHTML = cp.blocks.map((b) => {
    switch (b.t) {
      case 'text': return blk(`<p>${esc(b.v)}</p>`);
      case 'stats': return blk(`<div class="stats">${b.v.map(([n, l]) => `<div><b>${esc(n)}</b><span>${esc(l)}</span></div>`).join('')}</div>`);
      case 'chips': return blk(`<div class="chips">${b.v.map((c) => `<span>${esc(c)}</span>`).join('')}</div>`);
      case 'bars': return blk(`<div class="bars">${b.v.map(([n, p]) => `<div class="bar"><div class="r"><span>${esc(n)}</span><span>${p}%</span></div><div class="tr"><i style="--w:${p}%"></i></div></div>`).join('')}</div>`);
      case 'cards': return blk(`<div class="cards">${b.v.map((c) => `<a class="card" href="${esc(c.link || '#')}" target="_blank" rel="noopener"><h5>${esc(c.title)}<span>↗</span></h5><p>${esc(c.text)}</p><div class="tg">${c.tags.map((t) => `<i>${esc(t)}</i>`).join('')}</div></a>`).join('')}</div>`);
      case 'timeline': return blk(`<div class="tl">${b.v.map((e) => `<div><small>${esc(e.when)}</small><h5>${esc(e.what)}</h5><p>${esc(e.text)}</p></div>`).join('')}</div>`);
      case 'links': return blk(`<div class="links">${b.v.map(([n, v, h]) => `<a href="${esc(h)}" target="_blank" rel="noopener"><b>${esc(n)}</b><span>${esc(v)}</span></a>`).join('')}</div>`);
      default: return '';
    }
  }).join('');
  $('#p-body').scrollTop = 0;
}

// ── minimap ──────────────────────────────────────────────────
const MM = { x0: -1450, z0: -1280, s: 380 / 2600 };
const mm = $('#mm'), mmc = mm.getContext('2d');
let mmStatic = null;
function buildMinimap() {
  const c = document.createElement('canvas');
  c.width = mm.width; c.height = mm.height;
  const g = c.getContext('2d');
  const P = (x, z) => [(x - MM.x0) * MM.s, (z - MM.z0) * MM.s];
  g.fillStyle = '#10465d'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#d3bd92';
  const [lx] = P(COAST_X, 0);
  g.fillRect(lx, 0, c.width - lx, c.height);
  g.lineCap = 'round'; g.strokeStyle = '#d3bd92';
  for (const p of world.PLATES) {
    const [ax, ay] = P(...p.a), [bx, by] = P(...p.b);
    g.lineWidth = Math.max(2, p.r * 2 * MM.s);
    g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
  }
  g.strokeStyle = '#6f7480';
  for (const r of [...world.ROADS, ...world.PALM_ROADS]) {
    const [ax, ay] = P(...r.a), [bx, by] = P(...r.b);
    g.lineWidth = Math.max(1.2, r.w * MM.s * 0.9);
    g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
  }
  mmStatic = c;
}
function drawMinimap() {
  if (!mmStatic) return;
  mmc.drawImage(mmStatic, 0, 0);
  const P = (x, z) => [(x - MM.x0) * MM.s, (z - MM.z0) * MM.s];
  const tid = currentTarget()?.id;
  for (const cp of CHECKPOINTS) {
    const [x, y] = P(...cp.stop);
    mmc.beginPath(); mmc.arc(x, y, cp.id === tid ? 9 : 6.5, 0, 7);
    mmc.fillStyle = cp.color; mmc.fill();
    mmc.lineWidth = 2; mmc.strokeStyle = '#0b1220'; mmc.stroke();
    if (cp.id === tid) { mmc.beginPath(); mmc.arc(x, y, 14 + Math.sin(performance.now() / 250) * 3, 0, 7); mmc.strokeStyle = cp.color; mmc.lineWidth = 2; mmc.stroke(); }
  }
  const [cx, cy] = P(S.x, S.z);
  mmc.save(); mmc.translate(cx, cy); mmc.rotate(Math.PI - S.h);
  mmc.beginPath(); mmc.moveTo(0, -10); mmc.lineTo(7, 8); mmc.lineTo(0, 4); mmc.lineTo(-7, 8); mmc.closePath();
  mmc.fillStyle = '#fff'; mmc.fill(); mmc.strokeStyle = '#0b1220'; mmc.lineWidth = 2; mmc.stroke();
  mmc.restore();
}

// ── state machine ────────────────────────────────────────────
const exit = { t: 0, S0: new V3(), D: new V3(), E: new V3(), fd: new V3(), L: new V3(), focus: new V3(), panel: false };
const ret = { t: 0, P0: new V3(), D: new V3(), yaw0: 0 };
let infoT = 0, parkT = 0, panelAmt = 0, walkPhase = 0, personYaw = 0;

function setFade(on) { $('#fade').classList.toggle('on', on); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function placeCarOnSurface() {
  S.y = surfaceH(S.x, S.z);
  car.group.position.set(S.x, S.y, S.z);
  car.group.rotation.set(0, S.h, 0);
}

function seatPersonImmediately() {
  car.group.add(person.group);
  person.group.position.copy(car.SEAT);
  person.group.rotation.set(0, 0, 0);
  person.pose({ seat: 1 });
}

async function teleportTo(cp) {
  if (fadeBusy || state === 'loading' || state === 'teleport' || state === 'exiting' && !exit.panel) return;
  fadeBusy = true;
  initAudio();
  const prev = state;
  state = 'teleport';
  closePanel();
  setFade(true);
  await sleep(600);
  if (prev === 'info' || prev === 'exiting' || prev === 'returning') seatPersonImmediately();
  const L = new V3(cp.land[0], 0, cp.land[1]);
  S.x = cp.stop[0]; S.z = cp.stop[1];
  S.h = Math.atan2(L.x - S.x, L.z - S.z);
  S.v = 0; S.steer = 0; camYaw = 0;
  placeCarOnSurface();
  snapChaseCamera();
  armed[cp.id] = false;
  await sleep(250);
  setFade(false);
  await sleep(450);
  fadeBusy = false;
  beginExit(cp);
}

function snapChaseCamera() {
  const f = fwd(S.h);
  camPos.set(S.x - f.x * 11, S.y + 4.5, S.z - f.z * 11);
  camLook.set(S.x + f.x * 6, S.y + 1.4, S.z + f.z * 6);
  camera.position.copy(camPos);
}

function beginExit(cp) {
  active = cp;
  state = 'exiting';
  exit.t = 0; infoT = 0; exit.panel = false;
  car.group.updateMatrixWorld(true);
  scene.attach(person.group);
  exit.S0.copy(person.group.position);
  const f = fwd(S.h), l = left(S.h);
  exit.L.set(cp.land[0], 0, cp.land[1]);
  exit.fd.set(exit.L.x - S.x, 0, exit.L.z - S.z).normalize();
  exit.D.set(S.x + l.x * 1.45, S.y, S.z + l.z * 1.45);
  exit.E.set(S.x + l.x * 4.2 + f.x * 7.5, 0, S.z + l.z * 4.2 + f.z * 7.5);
  exit.E.y = surfaceH(exit.E.x, exit.E.z);
  exit.focus.set(exit.L.x + cp.focus[0], cp.focus[1], exit.L.z + cp.focus[2]);
  chime();
  document.body.classList.add('cine');
  $('#sign').classList.add('hide');
  $('#park').classList.remove('on');
  visited.add(cp.id);
  refreshList();
}

function openPanel() {
  renderPanel(active);
  $('#panel').classList.add('open');
  exit.panel = true;
}
function closePanel() {
  $('#panel').classList.remove('open');
}

function startReturn() {
  if (state !== 'info' && !(state === 'exiting' && exit.panel)) return;
  closePanel();
  state = 'returning';
  ret.t = 0;
  ret.P0.copy(person.group.position);
  ret.yaw0 = personYaw;
  ret.D.set(exit.D.x, S.y, exit.D.z);
}

// ── input ─────────────────────────────────────────────────────
const KEYMAP = { KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', Space: 'space', ShiftLeft: 'shift', ShiftRight: 'shift' };
window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = KEYMAP[e.code];
  if (k) { keys[k] = true; if (k === 'space' || e.code.startsWith('Arrow')) e.preventDefault(); }
  if (state === 'loading') return;
  if (e.code === 'Escape' || ((k === 'up') && (state === 'info'))) startReturn();
  if (/^Digit[1-9]$/.test(e.code)) { const cp = CHECKPOINTS[+e.code.slice(5) - 1]; if (cp) teleportTo(cp); }
  if (e.code === 'KeyN') cycleTod();
  if (e.code === 'KeyM') toggleMute();
  if (e.code === 'KeyH') $('#hint').classList.toggle('hide');
  if (state === 'intro' && (k === 'up' || e.code === 'Enter')) go();
});
window.addEventListener('keyup', (e) => { const k = KEYMAP[e.code]; if (k) keys[k] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

canvas.addEventListener('pointerdown', (e) => { dragging = true; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', (e) => { if (dragging && state === 'driving') { camYaw = clamp(camYaw - e.movementX * 0.006, -Math.PI, Math.PI); lastDrag = performance.now(); } });
const endDrag = () => { dragging = false; };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

if (matchMedia('(pointer: coarse)').matches) {
  document.body.classList.add('touch');
  const map = { left: 'left', right: 'right', gas: 'up', brake: 'down' };
  document.querySelectorAll('#touch button').forEach((b) => {
    const k = map[b.dataset.k];
    b.addEventListener('pointerdown', (e) => { keys[k] = true; if (state === 'intro') go(); e.preventDefault(); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, () => { keys[k] = false; }));
  });
}

$('#btn-tod').addEventListener('click', cycleTod);
$('#btn-snd').addEventListener('click', toggleMute);
$('#btn-help').addEventListener('click', () => $('#hint').classList.toggle('hide'));
$('#p-back').addEventListener('click', startReturn);

function cycleTod() {
  const i = TOD_ORDER.indexOf(world.timeOfDay);
  const n = TOD_ORDER[(i + 1) % TOD_ORDER.length];
  world.setTimeOfDay(n);
  $('#btn-tod').textContent = { day: '☀', sunset: '◐', night: '☾' }[n];
}
function toggleMute() {
  muted = !muted;
  initAudio();
  if (audio) audio.master.gain.value = muted ? 0 : 0.5;
  $('#btn-snd').style.opacity = muted ? 0.45 : 1;
  $('#btn-snd').textContent = muted ? '×' : '♪';
}
function go() {
  if (state !== 'intro') return;
  startDriving();
  $('#loader').classList.add('hide');
  $('#sign').classList.remove('hide');
  document.body.classList.remove('cine');
}
function startDriving() {
  if (state !== 'intro') return;
  initAudio();
  if (audio?.ctx.state === 'suspended') audio.ctx.resume();
  state = 'driving';
  $('#sign').classList.remove('hide');
  document.body.classList.remove('cine');
}

// ── update ────────────────────────────────────────────────────
function driveUpdate(dt, allowInput = true) {
  const up = allowInput && keys.up, dn = allowInput && keys.down;
  const lf = allowInput && keys.left, rt = allowInput && keys.right;
  const brake = allowInput && keys.space, boost = allowInput && keys.shift;
  const maxV = boost ? 80 : 56;
  const prev = S.v;
  let a = 0;
  if (up) a += boost ? 44 : 30;
  if (dn) a -= S.v > 1 ? 58 : 20;
  if (!up && !dn) a -= Math.sign(S.v) * 7;
  if (brake) a -= Math.sign(S.v) * 75;
  S.v += a * dt;
  if (!dn && prev > 0 && S.v < 0) S.v = 0;
  if (!up && prev < 0 && S.v > 0) S.v = 0;
  if (S.v > maxV) S.v = damp(S.v, maxV, 3, dt);
  S.v = clamp(S.v, -16, 90);

  const inp = (lf ? 1 : 0) - (rt ? 1 : 0);
  const maxS = 0.62 / (1 + Math.abs(S.v) * 0.045);
  S.steer = damp(S.steer, inp * maxS, 7, dt);
  S.h += (S.v / 3.1) * Math.tan(S.steer) * dt * (brake && Math.abs(S.v) > 12 ? 1.45 : 1);

  const nx = S.x + Math.sin(S.h) * S.v * dt, nz = S.z + Math.cos(S.h) * S.v * dt;
  if (canDrive(nx, nz)) { S.x = nx; S.z = nz; }
  else if (canDrive(nx, S.z)) { S.x = nx; S.v *= 0.96; }
  else if (canDrive(S.x, nz)) { S.z = nz; S.v *= 0.96; }
  else { S.v *= -0.25; shake = 0.5; }

  const hit = world.colliders.resolve(S, 2.3);
  if (hit) {
    const into = -(Math.sin(S.h) * hit.x + Math.cos(S.h) * hit.z) * Math.sign(S.v || 1);
    S.v *= into > 0.3 ? 0.88 : 0.985;
    if (into > 0.3 && Math.abs(S.v) > 12) shake = Math.min(1, Math.abs(S.v) / 40);
  }
  const tc = world.trafficHit(S);
  if (tc) {
    const dx = (S.x - tc.x) / 2.3, dz = (S.z - tc.z) / 4.4;
    if (Math.abs(dx) > Math.abs(dz)) S.x += Math.sign(dx) * 0.4; else S.z += Math.sign(dz) * 0.4;
    S.v *= 0.92; shake = Math.max(shake, 0.35);
  }
  poseCar(dt);
}

function poseCar(dt) {
  const f = fwd(S.h);
  const yf = surfaceH(S.x + f.x * 2.2, S.z + f.z * 2.2), yb = surfaceH(S.x - f.x * 2.2, S.z - f.z * 2.2);
  S.y = damp(S.y, (yf + yb) / 2, 14, dt);
  S.pitch = damp(S.pitch, Math.atan2(yf - yb, 4.4), 10, dt);
  S.roll = damp(S.roll, S.steer * Math.abs(S.v) * 0.0028, 6, dt);
  car.group.position.set(S.x, S.y, S.z);
  car.group.rotation.set(-S.pitch, S.h, S.roll, 'YXZ');
  car.setWheels(S.steer, (S.v * dt) / 0.38);
}

function cameraDriving(dt, t) {
  if (!dragging && performance.now() - lastDrag > 1400) camYaw = damp(camYaw, 0, 2.2, dt);
  const sp = Math.abs(S.v);
  const dist = 10.5 + sp * 0.085, height = 4.1 + sp * 0.02;
  const ang = S.h + Math.PI + camYaw;
  const want = new V3(S.x + Math.sin(ang) * dist, S.y + height, S.z + Math.cos(ang) * dist);
  const k = state === 'driving' ? 6 : 4;
  camPos.x = damp(camPos.x, want.x, k, dt); camPos.y = damp(camPos.y, want.y, k, dt); camPos.z = damp(camPos.z, want.z, k, dt);
  const f = fwd(S.h);
  const look = new V3(S.x + f.x * (6 + sp * 0.1), S.y + 1.4, S.z + f.z * (6 + sp * 0.1));
  camLook.x = damp(camLook.x, look.x, 9, dt); camLook.y = damp(camLook.y, look.y, 9, dt); camLook.z = damp(camLook.z, look.z, 9, dt);
  const ground = surfaceH(camPos.x, camPos.z) + 1.4;
  const cp = camPos.clone();
  if (cp.y < ground) cp.y = ground;
  if (shake > 0.001) { cp.x += (Math.random() - 0.5) * shake * 0.5; cp.y += (Math.random() - 0.5) * shake * 0.4; shake *= Math.exp(-6 * dt); }
  camera.position.copy(cp);
  camera.lookAt(camLook);
  const fovT = 62 + clamp(sp / 56, 0, 1.45) * 15;
  camera.fov = damp(camera.fov, fovT, 4, dt);
}

function cameraIntro(t) {
  const a = Math.PI / 2 + Math.sin(t * 0.12) * 0.95;
  const R = 200, c = new V3(S.x, S.y, S.z);
  camera.position.set(c.x + Math.cos(a) * R, 105 + Math.sin(t * 0.2) * 12, c.z + Math.sin(a) * R * 0.9);
  camLook.set(c.x, 36, c.z - 40);
  camera.lookAt(camLook);
  camPos.copy(camera.position);
  camera.fov = 58;
}

function cameraRig(dt, t) {
  const { E, fd, focus } = exit;
  const right = new V3(-fd.z, 0, fd.x);
  const want = new V3(E.x - fd.x * 8.5 + right.x * 1.7, E.y + 2.0, E.z - fd.z * 8.5 + right.z * 1.7);
  const sway = Math.sin(t * 0.35) * 0.9;
  want.x += right.x * sway; want.z += right.z * sway;
  camPos.x = damp(camPos.x, want.x, 2.2, dt); camPos.y = damp(camPos.y, want.y, 2.2, dt); camPos.z = damp(camPos.z, want.z, 2.2, dt);
  const u = smoothstep(1.2, 6.5, exit.t) * 0.62;
  const a = new V3(E.x + fd.x * 3, E.y + 1.25, E.z + fd.z * 3);
  const look = a.lerp(focus, u);
  camLook.x = damp(camLook.x, look.x, 3, dt); camLook.y = damp(camLook.y, look.y, 3, dt); camLook.z = damp(camLook.z, look.z, 3, dt);
  camera.position.copy(camPos);
  camera.lookAt(camLook);
  camera.fov = damp(camera.fov, 58, 3, dt);
}

const ease = (x) => x * x * (3 - 2 * x);
const lerpAngle = (a, b, t) => a + angDiff(a, b) * t;

function exitUpdate(dt, t) {
  exit.t += dt;
  const A = 0.9, T = 3.6;
  const p = person;
  const yawFace = Math.atan2(exit.fd.x, exit.fd.z);
  if (exit.t < A) {
    const e = ease(exit.t / A);
    p.group.position.lerpVectors(exit.S0, exit.D, e);
    p.group.position.y = lerp(exit.S0.y, exit.D.y, e) + Math.sin(e * Math.PI) * 0.35;
    personYaw = lerp(S.h, S.h + Math.PI / 2, e);
    p.pose({ seat: 1 - e, walk: 0, phase: 0 });
  } else if (exit.t < T) {
    const e = (exit.t - A) / (T - A);
    p.group.position.lerpVectors(exit.D, exit.E, ease(e));
    p.group.position.y = lerp(exit.D.y, exit.E.y, e);
    const walkYaw = Math.atan2(exit.E.x - exit.D.x, exit.E.z - exit.D.z);
    personYaw = lerpAngle(lerpAngle(S.h + Math.PI / 2, walkYaw, smoothstep(0, 0.15, e)), yawFace, smoothstep(0.72, 1, e));
    walkPhase += dt * 9;
    p.pose({ seat: 0, walk: 1 - smoothstep(0.85, 1, e), phase: walkPhase });
  } else {
    p.group.position.copy(exit.E);
    state = 'info';
    infoT = 0;
  }
  if (exit.t > 2.3 && !exit.panel) openPanel();
  p.group.rotation.y = personYaw;
  poseCar(dt);
  cameraRig(dt, t);
}

function infoUpdate(dt, t) {
  exit.t += dt; infoT += dt;
  const wave = smoothstep(0.2, 0.7, infoT) * (1 - smoothstep(2.6, 3.3, infoT));
  walkPhase += dt * 6;
  person.pose({ seat: 0, walk: 0, phase: walkPhase, wave });
  const faceCam = Math.atan2(-exit.fd.x, -exit.fd.z);
  const yawFace = Math.atan2(exit.fd.x, exit.fd.z);
  personYaw = yawFace + angDiff(yawFace, faceCam) * wave * 0.6;
  person.group.rotation.y = personYaw;
  car.setWheels(0, 0);
  cameraRig(dt, t);
}

function returnUpdate(dt, t) {
  ret.t += dt;
  const W = 2.2, Sx = 0.8;
  const p = person;
  if (ret.t < W) {
    const e = ease(ret.t / W);
    p.group.position.lerpVectors(ret.P0, ret.D, e);
    p.group.position.y = lerp(ret.P0.y, ret.D.y, e);
    const dir = Math.atan2(ret.D.x - ret.P0.x, ret.D.z - ret.P0.z);
    personYaw = ret.yaw0 + angDiff(ret.yaw0, dir) * smoothstep(0, 0.2, e);
    walkPhase += dt * 9;
    p.pose({ seat: 0, walk: 1 - smoothstep(0.85, 1, e), phase: walkPhase });
  } else if (ret.t < W + Sx) {
    const e = ease((ret.t - W) / Sx);
    const seatW = car.group.localToWorld(car.SEAT.clone());
    p.group.position.lerpVectors(ret.D, seatW, e);
    p.group.position.y = lerp(ret.D.y, seatW.y, e) + Math.sin(e * Math.PI) * 0.35;
    const d0 = Math.atan2(ret.D.x - ret.P0.x, ret.D.z - ret.P0.z);
    personYaw = lerpAngle(d0, S.h, e);
    p.pose({ seat: e, walk: 0, phase: 0 });
  } else {
    seatPersonImmediately();
    state = 'driving';
    active = null;
    document.body.classList.remove('cine');
    $('#sign').classList.remove('hide');
    return;
  }
  p.group.rotation.y = personYaw;
  poseCar(dt);
  cameraRig(dt, t);
  // blend camera back to chase through the end of the return
  if (ret.t > W) {
    const k = smoothstep(W, W + Sx, ret.t);
    const f = fwd(S.h);
    const want = new V3(S.x - f.x * 11, S.y + 4.5, S.z - f.z * 11);
    camera.position.lerp(want, k * 0.15);
  }
}

function parkingUpdate(dt, t) {
  parkT += dt;
  S.v = damp(S.v, 0, 5, dt);
  driveUpdate(dt, false);
  cameraDriving(dt, t);
  if (parkT > 0.9 && Math.abs(S.v) < 1.5) { S.v = 0; beginExit(parkCp); }
}
let parkCp = null;

function checkArrival() {
  let near = null, nd = Infinity;
  for (const cp of CHECKPOINTS) {
    const d = dist2D(S.x, S.z, cp.stop[0], cp.stop[1]);
    if (d > 80) armed[cp.id] = true;
    if (d < nd) { nd = d; near = cp; }
  }
  const parkEl = $('#park');
  if (near && armed[near.id] && nd < 95) {
    if (nd < 30 && Math.abs(S.v) < 26) {
      parkCp = near; parkT = 0; state = 'parking'; armed[near.id] = false;
      parkEl.classList.remove('on');
      return;
    }
    parkEl.classList.toggle('on', nd < 70 && Math.abs(S.v) >= 26);
  } else parkEl.classList.remove('on');
}

function updateSign() {
  const el = $('#sign');
  const cp = currentTarget();
  if (!cp) return;
  const dx = cp.stop[0] - S.x, dz = cp.stop[1] - S.z;
  const d = Math.hypot(dx, dz);
  const rel = angDiff(S.h, Math.atan2(dx, dz));
  $('#sign .arrow').style.transform = `rotate(${(-rel * 180 / Math.PI).toFixed(1)}deg)`;
  $('#sign-t').textContent = cp.landmark;
  $('#sign-s').textContent = cp.title;
  $('#sign-d').innerHTML = d >= 1000 ? `${(d / 1000).toFixed(1)}<small>km</small>` : `${Math.round(d / 10) * 10}<small>m</small>`;
  el.style.setProperty('--c', cp.color);
}

const proj = new V3();
function updatePins() {
  const show = state === 'driving' || state === 'intro' || state === 'parking';
  const w = innerWidth, h = innerHeight;
  pinsEl.querySelectorAll('.pin').forEach((el) => {
    const cp = cpById(el.dataset.id);
    proj.set(cp.land[0], cp.pin, cp.land[1]).project(camera);
    const d = dist2D(camera.position.x, camera.position.z, cp.land[0], cp.land[1]);
    const ok = show && proj.z < 1 && Math.abs(proj.x) < 0.88 && Math.abs(proj.y) < 0.9 && d > 90;
    el.style.opacity = ok ? 1 : 0;
    if (ok) {
      el.style.transform = `translate(${((proj.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-proj.y * 0.5 + 0.5) * h).toFixed(1)}px) translate(-50%, -50%)`;
      el.querySelector('small').textContent = d > 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d / 10) * 10} m`;
    }
  });
}

function updateBeacons() {
  for (const b of world.beacons) {
    const d = dist2D(S.x, S.z, b.cp.stop[0], b.cp.stop[1]);
    const hidden = active === b.cp && state !== 'driving';
    b.beam.visible = !hidden;
    b.beam.material.opacity = 0.55 * smoothstep(20, 80, d);
    b.ring.visible = b.disc.visible = !hidden;
  }
}

// ── main loop ─────────────────────────────────────────────────
const clock = new THREE.Clock();
let tAbs = 0;
function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  tAbs += dt;
  const t = tAbs;
  const throttle = keys.up ? 1 : 0;

  switch (state) {
    case 'intro': poseCar(dt); cameraIntro(t); break;
    case 'driving': driveUpdate(dt); cameraDriving(dt, t); checkArrival(); break;
    case 'parking': parkingUpdate(dt, t); break;
    case 'teleport': poseCar(dt); camera.position.copy(camPos); camera.lookAt(camLook); break;
    case 'exiting': exitUpdate(dt, t); break;
    case 'info': infoUpdate(dt, t); break;
    case 'returning': returnUpdate(dt, t); break;
    default: break;
  }

  // composition shift so the subject sits right of the info panel
  const want = (state === 'info' || (state === 'exiting' && exit.panel)) ? 1 : 0;
  panelAmt = damp(panelAmt, want, 2.5, dt);
  const w = innerWidth, h = innerHeight;
  if (panelAmt > 0.002 && w > 900) camera.setViewOffset(w, h, -Math.min(440, w * 0.4) * 0.5 * panelAmt, 0, w, h);
  else camera.clearViewOffset();
  camera.updateProjectionMatrix();

  world.update(dt, t, new V3(S.x, S.y, S.z));
  car.setNight(world.night);
  updateAudio(throttle);
  updateBeacons();
  if (state === 'driving' || state === 'parking') { updateSign(); refreshList(); }
  $('#kmh').textContent = String(Math.round(Math.abs(S.v) * 3.6));
  drawMinimap();
  updatePins();
  if (window.__camOverride) { const o = window.__camOverride; camera.clearViewOffset(); camera.position.set(...o.pos); camera.lookAt(...o.look); camera.fov = o.fov || 55; camera.updateProjectionMatrix(); }
  bloom.strength = 0.26 + world.night * 0.55;
  composer.render();
  requestAnimationFrame(tick);
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// ── boot ──────────────────────────────────────────────────────
(async function boot() {
  resize();
  setBar(8);
  await nextFrame(); await nextFrame();
  world = createWorld(scene, renderer);
  setBar(70);
  await nextFrame();
  car = createCar('#4cc9f0');
  person = car.person;
  scene.add(car.group);
  placeCarOnSurface();
  buildMinimap();
  setBar(100);
  refreshList();
  state = 'intro';
  tick();
  await sleep(300);
  const btn = $('#start');
  $('#bar').style.display = 'none';
  btn.style.display = 'block';
  btn.addEventListener('click', go);
  document.body.classList.add('cine');
  // expose for debugging / screenshots
  window.__dubai = { S, go, teleportTo, cps: CHECKPOINTS, get state() { return state; }, world, camera };
})();
