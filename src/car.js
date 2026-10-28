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
  const skin = new THREE.MeshStandardMaterial({ color: 0xd8a27a, roughness: 0.7 });
  const shirt = new THREE.MeshStandardMaterial({ color: new THREE.Color(accent), roughness: 0.6 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x252a35, roughness: 0.8 });
  const hair = new THREE.MeshStandardMaterial({ color: 0x16120f, roughness: 0.9 });
  const shoe = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 });

  const hips = new THREE.Group();
  hips.position.y = 0.92;
  g.add(hips);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.3, 6, 14), shirt);
  torso.scale.z = 0.62; torso.position.y = 0.32; torso.castShadow = true;
  hips.add(torso);
  const pel = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.04, 4, 12), pants);
  pel.scale.z = 0.65; pel.position.y = 0.02; hips.add(pel);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.125, 18, 14), skin);
  head.position.y = 0.78; head.castShadow = true;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.133, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hair);
  cap.position.set(0, 0.015, -0.01); head.add(cap);
  hips.add(head);

  const limb = (len, w, mat) => {
    const grp = new THREE.Group();
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(w * 0.55, Math.max(0.01, len - w * 1.1), 4, 10), mat);
    m.position.y = -len / 2; m.castShadow = true;
    grp.add(m);
    return grp;
  };
  const legs = [], shins = [], arms = [], fores = [];
  for (const s of [-1, 1]) {
    const thigh = limb(0.46, 0.17, pants);
    thigh.position.set(s * 0.11, -0.02, 0);
    const shin = limb(0.46, 0.15, pants);
    shin.position.y = -0.46;
    shin.add(box(0.16, 0.09, 0.28, shoe, 0, -0.5, 0.05));
    thigh.add(shin);
    hips.add(thigh);
    legs.push(thigh); shins.push(shin);

    const arm = limb(0.3, 0.12, shirt);
    arm.position.set(s * 0.285, 0.55, 0);
    const fore = limb(0.28, 0.1, skin);
    fore.position.y = -0.3;
    arm.add(fore);
    hips.add(arm);
    arms.push(arm); fores.push(fore);
  }

  // seat: 0 standing → 1 sitting ; walk: 0..1 amplitude ; phase radians
  const pose = ({ seat = 0, walk = 0, phase = 0, wave = 0 }) => {
    hips.position.y = lerp(0.92, 0.46, seat) + Math.abs(Math.sin(phase)) * 0.03 * walk;
    const s = Math.sin(phase) * walk;
    legs[0].rotation.x = -s * 0.7 - 1.45 * seat;
    legs[1].rotation.x = s * 0.7 - 1.45 * seat;
    shins[0].rotation.x = Math.max(0, s) * 0.9 + 1.45 * seat;
    shins[1].rotation.x = Math.max(0, -s) * 0.9 + 1.45 * seat;
    arms[0].rotation.x = s * 0.6 - 1.0 * seat;
    arms[1].rotation.x = -s * 0.6 - 1.0 * seat;
    fores[0].rotation.x = -0.15 - 0.6 * seat;
    fores[1].rotation.x = -0.15 - 0.6 * seat;
    // right arm wave
    if (wave > 0) {
      arms[1].rotation.x = lerp(arms[1].rotation.x, -2.7, wave);
      arms[1].rotation.z = lerp(0, -0.35, wave) + Math.sin(phase * 1.3) * 0.25 * wave;
      fores[1].rotation.x = lerp(fores[1].rotation.x, -0.5, wave);
    } else arms[1].rotation.z = 0;
    head.rotation.y = 0;
  };
  pose({ seat: 1 });
  return { group: g, pose, head };
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
  const sw = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.022, 8, 20), dark);
  sw.position.set(0.45, 1.1, 0.5); sw.rotation.x = -1.1;
  group.add(sw);
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
      steer.forEach((p) => { p.rotation.y = steerAngle; });
      spin.forEach((w) => { w.rotation.x += spinDelta; });
    },
  };
}
