import * as THREE from 'three';
import { lerp } from './util.js';

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
  const torso = box(0.44, 0.58, 0.25, shirt, 0, 0.32, 0);
  hips.add(torso);
  hips.add(box(0.42, 0.18, 0.24, pants, 0, 0.02, 0));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.125, 18, 14), skin);
  head.position.y = 0.78; head.castShadow = true;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.133, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hair);
  cap.position.set(0, 0.015, -0.01); head.add(cap);
  hips.add(head);

  const limb = (len, w, mat, upMat) => {
    const grp = new THREE.Group();
    grp.add(box(w, len, w * 1.05, mat, 0, -len / 2, 0));
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

export function createCar(accent) {
  const group = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color: 0xf5f4f0, metalness: 0.55, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.06 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.5, metalness: 0.4 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1b2b3d, roughness: 0.05, metalness: 0.8, transparent: true, opacity: 0.38, depthWrite: false });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xdadfe4, roughness: 0.15, metalness: 1 });

  const body = new THREE.Mesh(sideExtrude([
    [-2.35, 0.3], [-2.46, 0.62], [-2.3, 0.94], [-1.0, 1.02], [0.7, 1.0], [1.5, 0.92], [2.3, 0.74], [2.5, 0.52], [2.44, 0.3],
  ], 1.9), paint);
  body.castShadow = true;
  group.add(body);
  const cabin = new THREE.Mesh(sideExtrude([[-1.2, 1.0], [-0.7, 1.62], [0.35, 1.62], [0.98, 1.02]], 1.6, 0.04), glass);
  group.add(cabin);
  group.add(box(1.5, 0.05, 1.0, paint, 0, 1.655, -0.18));
  // pillars
  for (const sx of [-0.78, 0.78]) {
    group.add(box(0.06, 0.62, 0.06, dark, sx, 1.32, 0.34));
    group.add(box(0.06, 0.62, 0.06, dark, sx, 1.32, -0.74));
  }
  group.add(box(1.92, 0.08, 4.8, dark, 0, 0.28, 0));          // skirt
  group.add(box(1.6, 0.05, 0.42, dark, 0, 1.18, -2.3));       // spoiler
  group.add(box(0.06, 0.2, 0.06, dark, -0.5, 1.07, -2.3));
  group.add(box(0.06, 0.2, 0.06, dark, 0.5, 1.07, -2.3));
  group.add(box(1.1, 0.14, 0.04, dark, 0, 0.55, 2.5));         // grille

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
  for (const sx of [-0.68, 0.68]) {
    group.add(box(0.5, 0.14, 0.08, headMat, sx, 0.72, 2.43));
    group.add(box(0.5, 0.12, 0.08, tailMat, sx, 0.86, -2.43));
  }
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
