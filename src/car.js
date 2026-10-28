import * as THREE from 'three';
import { lerp } from './util.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const box = (w, h, d, mat, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
};

// Extrude a side profile [[z,y],...] across the car's width (x), forward = +z.
function sideExtrude(points, width, bevel = 0.06) {
  const s = new THREE.Shape();
  points.forEach(([z, y], i) => (i ? s.lineTo(z, y) : s.moveTo(z, y)));
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3 });
  g.rotateY(-Math.PI / 2);
  g.translate(width / 2 - bevel, 0, 0);
  return g;
}

// Smooth hull from cross-sections [{z, w, top, bot}] using superellipse rings.
function loft(secs, n = 3, ring = 32) {
  const pos = [], idx = [];
  const sg = (v) => (v < 0 ? -1 : 1);
  secs.forEach((s) => {
    for (let i = 0; i < ring; i++) {
      const th = (i / ring) * Math.PI * 2, cs = Math.cos(th), sn = Math.sin(th);
      const x = s.w * sg(cs) * Math.pow(Math.abs(cs), 2 / n);
      const y = (s.top + s.bot) / 2 + ((s.top - s.bot) / 2) * sg(sn) * Math.pow(Math.abs(sn), 2 / n);
      pos.push(x, y, s.z);
    }
  });
  for (let j = 0; j < secs.length - 1; j++) {
    for (let i = 0; i < ring; i++) {
      const a = j * ring + i, b = j * ring + ((i + 1) % ring), c = a + ring, d = b + ring;
      idx.push(a, c, b, b, c, d);
    }
  }
  // caps
  const addCap = (j, flip) => {
    const ci = pos.length / 3;
    const s = secs[j];
    pos.push(0, (s.top + s.bot) / 2, s.z);
    for (let i = 0; i < ring; i++) {
      const a = j * ring + i, b = j * ring + ((i + 1) % ring);
      idx.push(ci, flip ? b : a, flip ? a : b);
    }
  };
  addCap(0, false); addCap(secs.length - 1, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function createPerson(accent = '#4cc9f0') {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xc98f66, roughness: 0.62 });
  const jacket = new THREE.MeshStandardMaterial({ color: new THREE.Color(accent), roughness: 0.55 });
  const under = new THREE.MeshStandardMaterial({ color: 0xf1efe8, roughness: 0.7 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x23262e, roughness: 0.75 });
  const hairM = new THREE.MeshStandardMaterial({ color: 0x14100d, roughness: 0.85 });
  const shoeM = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.5 });
  const sole = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.9 });
  const glassM = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.05, metalness: 0.9 });

  const mesh = (geo, mat, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.castShadow = true;
    return m;
  };
  const cap = (r, len, mat, x = 0, y = 0, z = 0) => mesh(new THREE.CapsuleGeometry(r, len, 6, 14), mat, x, y, z);

  const hips = new THREE.Group(); hips.position.y = 0.92; g.add(hips);
  const pelvis = cap(0.17, 0.06, pants, 0, 0, 0); pelvis.scale.z = 0.7; hips.add(pelvis);
  const spine = new THREE.Group(); spine.position.y = 0.06; hips.add(spine);
  const chest = cap(0.19, 0.3, jacket, 0, 0.27, 0); chest.scale.z = 0.66; spine.add(chest);
  const shirt = cap(0.07, 0.06, under, 0, 0.48, 0.1); shirt.scale.set(0.9, 0.8, 0.4); spine.add(shirt);
  const neck = mesh(new THREE.CylinderGeometry(0.05, 0.058, 0.1, 12), skin, 0, 0.58, 0); spine.add(neck);
  const headG = new THREE.Group(); headG.position.set(0, 0.7, 0); spine.add(headG);
  const head = mesh(new THREE.SphereGeometry(0.118, 22, 18), skin, 0, 0.03, 0); head.scale.set(0.92, 1.1, 1); headG.add(head);
  const hair = mesh(new THREE.SphereGeometry(0.126, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.52), hairM, 0, 0.05, -0.012); hair.scale.set(0.95, 1.05, 1.02); headG.add(hair);
  const nose = mesh(new THREE.SphereGeometry(0.018, 8, 8), skin, 0, 0.02, 0.118); headG.add(nose);
  headG.add(mesh(new THREE.BoxGeometry(0.2, 0.038, 0.03), glassM, 0, 0.055, 0.1));   // sunglasses
  for (const sx of [-1, 1]) headG.add(mesh(new THREE.SphereGeometry(0.022, 8, 8), skin, sx * 0.108, 0.03, 0));

  const limb = (len, r, mat) => {
    const grp = new THREE.Group();
    grp.add(cap(r, Math.max(0.01, len - r * 2), mat, 0, -len / 2, 0));
    return grp;
  };
  const arms = [], fores = [], legs = [], shins = [];
  for (const s of [-1, 1]) {
    const arm = limb(0.3, 0.05, jacket); arm.position.set(s * 0.245, 0.5, 0); spine.add(arm);
    const fore = limb(0.27, 0.043, jacket); fore.position.y = -0.3; arm.add(fore);
    fore.add(mesh(new THREE.SphereGeometry(0.046, 10, 10), skin, 0, -0.29, 0.01));
    arms.push(arm); fores.push(fore);
    const leg = limb(0.45, 0.075, pants); leg.position.set(s * 0.1, -0.03, 0); hips.add(leg);
    const shin = limb(0.43, 0.06, pants); shin.position.y = -0.45; leg.add(shin);
    const shoe = mesh(new THREE.BoxGeometry(0.11, 0.07, 0.28), shoeM, 0, -0.45, 0.06);
    shoe.geometry.translate(0, 0, 0);
    shin.add(shoe, mesh(new THREE.BoxGeometry(0.115, 0.02, 0.285), sole, 0, -0.49, 0.06));
    legs.push(leg); shins.push(shin);
  }

  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const clock = () => performance.now() / 1000;
  let blendSeat = 1;

  // seat 0..1 · walk 0..1 · phase (radians) · wave/point 0..1 · look: head yaw offset
  const pose = ({ seat = 0, walk = 0, phase = 0, wave = 0, point = 0, look = 0 }) => {
    const t = clock(), s = Math.sin(phase), c = Math.cos(phase);
    blendSeat = seat;
    // posture
    hips.position.y = lerp(0.92, 0.47, seat) - 0.02 * walk + (1 - Math.abs(s)) * 0.035 * walk;
    hips.position.x = Math.sin(t * 0.7) * 0.012 * (1 - walk) * (1 - seat) + c * 0.018 * walk;
    hips.rotation.set(0, s * 0.12 * walk, c * 0.04 * walk);
    spine.rotation.set(0.05 * walk + Math.sin(t * 1.3) * 0.012 * (1 - seat), -s * 0.17 * walk, -c * 0.035 * walk);
    chest.scale.set(1 + Math.sin(t * 1.4) * 0.012, 1, 0.66 + Math.sin(t * 1.4) * 0.01);
    // legs
    const hipFlex = -1.5 * seat;
    legs[0].rotation.set(hipFlex - s * 0.55 * walk, 0, 0.02 * seat);
    legs[1].rotation.set(hipFlex + s * 0.55 * walk, 0, -0.02 * seat);
    shins[0].rotation.x = 1.45 * seat + Math.max(0, c) * 0.85 * walk;
    shins[1].rotation.x = 1.45 * seat + Math.max(0, -c) * 0.85 * walk;
    // arms: swing against legs, elbows soften; seated → hands on wheel
    const sw = 0.5 * walk;
    arms[0].rotation.set(lerp(s * sw, -1.05, seat), 0, lerp(0.05, 0.16, seat));
    arms[1].rotation.set(lerp(-s * sw, -1.05, seat), 0, lerp(-0.05, -0.16, seat));
    fores[0].rotation.set(lerp(-0.2 - Math.max(0, -s) * 0.5 * walk, -0.75, seat), 0, 0);
    fores[1].rotation.set(lerp(-0.2 - Math.max(0, s) * 0.5 * walk, -0.75, seat), 0, 0);
    // gestures (right arm)
    if (wave > 0) {
      arms[1].rotation.x = lerp(arms[1].rotation.x, -2.55, wave);
      arms[1].rotation.z = lerp(arms[1].rotation.z, -0.5, wave) + Math.sin(t * 9) * 0.18 * wave;
      fores[1].rotation.x = lerp(fores[1].rotation.x, -0.55 + Math.sin(t * 9) * 0.25, wave);
    }
    if (point > 0) {
      arms[1].rotation.x = lerp(arms[1].rotation.x, -1.45, point);
      arms[1].rotation.z = lerp(arms[1].rotation.z, -0.12, point);
      fores[1].rotation.x = lerp(fores[1].rotation.x, -0.08, point);
    }
    // head: stabilises against spine twist, idle glances
    const idle = (1 - seat) * (Math.sin(t * 0.43) * 0.22 + Math.sin(t * 0.17) * 0.12);
    headG.rotation.set(Math.sin(t * 0.31) * 0.03, -spine.rotation.y * 0.8 + look + idle, 0);
  };

  // driving: hands follow the wheel, body leans with g-forces, glances at mirrors
  const drive = ({ steer = 0, lat = 0, acc = 0, speed = 0, t = 0 }) => {
    pose({ seat: 1 });
    const sv = Math.min(1, Math.abs(speed) / 25);
    arms[0].rotation.z = 0.16 - steer * 0.28; arms[1].rotation.z = -0.16 - steer * 0.28;
    arms[0].rotation.x = -1.05 + steer * 0.18; arms[1].rotation.x = -1.05 - steer * 0.18;
    spine.rotation.z = Math.max(-0.22, Math.min(0.22, lat * 0.008));
    spine.rotation.x = -Math.max(-0.2, Math.min(0.2, acc * 0.006)) + Math.sin(t * 38) * 0.003 * sv;
    spine.rotation.y = steer * 0.12;
    const gl = Math.max(0, Math.sin(t * 0.6 + 1) - 0.93) * 14;
    headG.rotation.y = steer * 0.6 + gl * 0.5 * (Math.sin(t * 0.3) > 0 ? 1 : -1);
    headG.rotation.x = -acc * 0.003 + Math.sin(t * 31) * 0.004 * sv;
    headG.rotation.z = -spine.rotation.z * 0.8;
  };
  pose({ seat: 1 });
  return { group: g, pose, drive, head: headG };
}

// Merged low-poly body for ambient traffic (vertex-coloured: body white, glass dark).
export function makeTrafficCarGeometry() {
  const body = loft([
    { z: -2.5, w: 0.5, top: 0.74, bot: 0.46 }, { z: -2.35, w: 0.86, top: 0.92, bot: 0.36 },
    { z: -1.7, w: 0.95, top: 0.98, bot: 0.3 }, { z: 0.4, w: 0.92, top: 0.88, bot: 0.3 },
    { z: 1.6, w: 0.86, top: 0.72, bot: 0.3 }, { z: 2.4, w: 0.66, top: 0.55, bot: 0.33 }, { z: 2.55, w: 0.4, top: 0.47, bot: 0.37 },
  ], 4.6, 16);
  const cab = loft([
    { z: -1.3, w: 0.6, top: 1.0, bot: 0.9 }, { z: -0.9, w: 0.76, top: 1.36, bot: 0.9 }, { z: -0.2, w: 0.8, top: 1.56, bot: 0.9 },
    { z: 0.4, w: 0.78, top: 1.5, bot: 0.9 }, { z: 1.0, w: 0.74, top: 1.0, bot: 0.9 },
  ], 2.6, 16);
  const skirt = new THREE.BoxGeometry(1.9, 0.34, 4.4); skirt.translate(0, 0.2, 0);
  const paint = (g, c) => {
    const n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c[0]; a[i * 3 + 1] = c[1]; a[i * 3 + 2] = c[2]; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    g.deleteAttribute('uv');
    return g;
  };
  const gs = [paint(body, [1, 1, 1]), paint(cab, [0.12, 0.15, 0.2]), paint(skirt, [0.06, 0.06, 0.06])];
  return mergeGeometries(gs);
}

export function createCar(accent) {
  const group = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color: 0xf5f4f0, metalness: 0.55, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.06 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.5, metalness: 0.4 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0f1a26, roughness: 0.04, metalness: 0.9, transparent: true, opacity: 0.62, depthWrite: false });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xdadfe4, roughness: 0.15, metalness: 1 });

  const body = new THREE.Mesh(loft([
    { z: -2.5, w: 0.5, top: 0.74, bot: 0.46 },
    { z: -2.35, w: 0.86, top: 0.92, bot: 0.36 },
    { z: -1.7, w: 0.99, top: 0.98, bot: 0.3 },
    { z: -0.7, w: 0.96, top: 0.88, bot: 0.3 },
    { z: 0.4, w: 0.94, top: 0.86, bot: 0.3 },
    { z: 1.3, w: 0.91, top: 0.77, bot: 0.3 },
    { z: 2.0, w: 0.83, top: 0.67, bot: 0.3 },
    { z: 2.42, w: 0.68, top: 0.55, bot: 0.33 },
    { z: 2.58, w: 0.42, top: 0.47, bot: 0.37 },
  ], 4.6), paint);
  body.castShadow = true;
  paint.side = THREE.DoubleSide;
  group.add(body);
  const cabin = new THREE.Mesh(loft([
    { z: -1.35, w: 0.6, top: 1.0, bot: 0.9 },
    { z: -1.0, w: 0.76, top: 1.36, bot: 0.9 },
    { z: -0.3, w: 0.8, top: 1.58, bot: 0.9 },
    { z: 0.35, w: 0.78, top: 1.55, bot: 0.9 },
    { z: 0.85, w: 0.76, top: 1.25, bot: 0.9 },
    { z: 1.15, w: 0.74, top: 0.98, bot: 0.9 },
  ], 2.6), glass);
  glass.side = THREE.DoubleSide;
  group.add(cabin);
  for (const sx of [-0.98, 0.98]) { // side mirrors
    group.add(box(0.14, 0.1, 0.22, paint, sx * 1.0, 1.02, 0.7));
  }
  group.add(box(1.92, 0.07, 4.8, dark, 0, 0.27, 0));             // skirt
  group.add(box(1.5, 0.04, 0.3, dark, 0, 1.12, -2.3));           // wing
  group.add(box(0.05, 0.16, 0.06, dark, -0.5, 1.03, -2.3));
  group.add(box(0.05, 0.16, 0.06, dark, 0.5, 1.03, -2.3));
  group.add(box(1.0, 0.12, 0.05, dark, 0, 0.5, 2.52));           // grille
  for (const sx of [-0.4, 0.4]) { // exhausts
    const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.2, 10), chrome);
    ex.rotation.x = Math.PI / 2; ex.position.set(sx, 0.42, -2.55);
    group.add(ex);
  }

  // wheels
  const spin = [], steer = [];
  const tireG = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 24); tireG.rotateZ(Math.PI / 2);
  const rimG = new THREE.CylinderGeometry(0.25, 0.25, 0.32, 16); rimG.rotateZ(Math.PI / 2);
  for (const [sx, sz] of [[-1, 1.5], [1, 1.5], [-1, -1.45], [1, -1.45]]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.97, 0.38, sz);
    const sp = new THREE.Group();
    const tire = new THREE.Mesh(tireG, dark); tire.castShadow = true;
    sp.add(tire, new THREE.Mesh(rimG, chrome));
    for (let i = 0; i < 5; i++) {
      const spoke = box(0.33, 0.05, 0.46, dark);
      spoke.rotation.x = (i / 5) * Math.PI;
      sp.add(spoke);
    }
    pivot.add(sp);
    group.add(pivot);
    spin.push(sp);
    if (sz > 0) steer.push(pivot);
  }

  // lights
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2c8, emissiveIntensity: 0.6 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x661010, emissive: 0xff1a1a, emissiveIntensity: 0.6 });
  for (const sx of [-0.52, 0.52]) group.add(box(0.5, 0.07, 0.1, headMat, sx, 0.6, 2.4));
  group.add(box(1.5, 0.07, 0.08, tailMat, 0, 0.84, -2.42));
  const spots = [];
  for (const sx of [-0.7, 0.7]) {
    const sp = new THREE.SpotLight(0xfff0d0, 0, 120, 0.5, 0.6, 1.2);
    sp.position.set(sx, 0.75, 2.3);
    sp.target.position.set(sx * 1.4, 0, 30);
    group.add(sp, sp.target);
    spots.push(sp);
  }

  // dashboard + wheel
  group.add(box(1.5, 0.12, 0.35, dark, 0, 1.02, 0.68));
  const swPivot = new THREE.Group();
  swPivot.position.set(0.45, 1.08, 0.52); swPivot.rotation.x = -1.1;
  const sw = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.022, 10, 24), dark);
  sw.add(box(0.28, 0.02, 0.02, dark), box(0.02, 0.14, 0.02, dark, 0, -0.07, 0));
  swPivot.add(sw);
  group.add(swPivot);
  // seat
  group.add(box(0.5, 0.1, 0.5, dark, 0.45, 0.5, -0.2));
  group.add(box(0.5, 0.55, 0.1, dark, 0.45, 0.78, -0.5));
  group.add(box(0.5, 0.1, 0.5, dark, -0.45, 0.5, -0.2));
  group.add(box(0.5, 0.55, 0.1, dark, -0.45, 0.78, -0.5));

  const person = createPerson(accent);
  const SEAT = new THREE.Vector3(0.45, 0.2, -0.15);
  person.group.position.copy(SEAT);
  group.add(person.group);

  return {
    group, person, SEAT,
    setNight(n) {
      headMat.emissiveIntensity = 0.6 + n * 3;
      tailMat.emissiveIntensity = 0.6 + n * 1.6;
      spots.forEach((s) => { s.intensity = n * 900; });
    },
    setWheels(steerAngle, spinDelta) {
      sw.rotation.z = -steerAngle * 5;
      steer.forEach((p) => { p.rotation.y = steerAngle; });
      spin.forEach((w) => { w.rotation.x += spinDelta; });
    },
  };
}
