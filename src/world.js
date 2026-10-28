import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  Builder, Colliders, clamp, lerp, smoothstep, mulberry32,
  makeWindowTextures, makeRoadTexture, makeLabelTexture,
} from './util.js';
import {
  buildBurjKhalifa, buildBurjAlArab, buildDubaiFrame, buildMuseum,
  buildCayan, buildAtlantis, buildEmiratesTowers,
} from './landmarks.js';
import { CHECKPOINTS } from './config.js';

// ── Geography ─────────────────────────────────────────────────
export const COAST_X = -250;
export const PALM_C = [-760, 500];
export const PALM_R = 520;

const ROADS = [
  { a: [0, -1500], b: [0, 1600], w: 46, kind: 'r6', y: 0.075, lamp: true, palms: true },
  { a: [-210, -1100], b: [-210, 1400], w: 18, kind: 'r2', y: 0.06, lamp: true },
  { a: [520, -1100], b: [520, 1300], w: 24, kind: 'r4', y: 0.06, lamp: true },
  { a: [1000, -1100], b: [1000, 1300], w: 18, kind: 'r2', y: 0.06 },
  { a: [-210, -1000], b: [1000, -1000], w: 20, kind: 'r2', y: 0.05, lamp: true },
  { a: [-210, -440], b: [1000, -440], w: 26, kind: 'r4', y: 0.05, lamp: true },
  { a: [-210, 300], b: [1000, 300], w: 26, kind: 'r4', y: 0.05, lamp: true },
  { a: [-210, 760], b: [1000, 760], w: 26, kind: 'r4', y: 0.05, lamp: true },
  { a: [-210, 1200], b: [1000, 1200], w: 20, kind: 'r2', y: 0.05, lamp: true },
];

// Land "plates" — capsules (a→b, radius r) used for the Palm, island and causeway.
const PLATES = [];
const PALM_ROADS = [];
(function buildPalmLayout() {
  const [cx, cz] = PALM_C;
  // trunk
  PLATES.push({ a: [-228, cz], b: [cx - PALM_R + 12, cz], r: 24 });
  PALM_ROADS.push({ a: [-228, cz], b: [cx - PALM_R + 12, cz], w: 16, kind: 'r2' });
  // 16 fronds fanning west
  for (const side of [-1, 1]) {
    for (let i = 0; i < 8; i++) {
      const sx = -540 - i * 56;
      const ang = 0.04 + i * 0.1;
      const dx = -Math.sin(ang), dz = side * Math.cos(ang);
      let t = 0;
      while (t < 700 && Math.hypot(sx + dx * t - cx, cz + dz * t - cz) < PALM_R - 100) t += 6;
      const a = [sx, cz], b = [sx + dx * t, cz + dz * t];
      PLATES.push({ a, b, r: 21, frond: { a, b, dx, dz, t } });
      PALM_ROADS.push({ a, b, w: 12, kind: 'r2' });
      PLATES.push({ a: b, b, r: 27 }); // bulb tip
    }
  }
  // crescent breakwater
  const N = 30, p0 = Math.PI / 2 + 0.26, p1 = (3 * Math.PI) / 2 - 0.26;
  let prev = null;
  for (let i = 0; i <= N; i++) {
    const ph = lerp(p0, p1, i / N);
    const p = [cx + Math.cos(ph) * PALM_R, cz + Math.sin(ph) * PALM_R];
    if (prev) {
      PLATES.push({ a: prev, b: p, r: 34, crescent: true });
      PALM_ROADS.push({ a: prev, b: p, w: 18, kind: 'r4' });
    }
    prev = p;
  }
  // Burj Al Arab island + causeway
  PLATES.push({ a: [-545, -330], b: [-545, -330], r: 84 });
  PLATES.push({ a: [-232, -330], b: [-545, -330], r: 12 });
  PALM_ROADS.push({ a: [-232, -330], b: [-545, -330], w: 12, kind: 'r2' });
})();

function distSeg(px, pz, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  const t = l2 < 1e-6 ? 0 : clamp(((px - a[0]) * dx + (pz - a[1]) * dz) / l2, 0, 1);
  return Math.hypot(px - (a[0] + dx * t), pz - (a[1] + dz * t));
}
function onPlate(x, z, shrink = 0) {
  if (x > COAST_X + shrink) return true;
  for (const p of PLATES) if (distSeg(x, z, p.a, p.b) < p.r - shrink) return true;
  return false;
}
export const canDrive = (x, z) => onPlate(x, z, 2.5) && x < 2700 && x > -1700 && Math.abs(z) < 2400;

function duneNoise(x, z) {
  const ridge = Math.abs(Math.sin(x * 0.0045 + 1.3 * Math.sin(z * 0.0032)));
  return 26 * ridge + 7 * Math.sin(z * 0.011 + x * 0.002) + 5 * Math.sin(x * 0.013 + z * 0.007) + 12;
}
export function groundH(x, z) {
  let h = 0;
  if (x < COAST_X) h = -Math.min(9, (COAST_X - x) * 0.14);
  if (x > 1100) h = smoothstep(1100, 1500, x) * duneNoise(x, z);
  return h;
}
export function surfaceH(x, z) {
  if (x > COAST_X) return groundH(x, z);
  return onPlate(x, z) ? 0 : groundH(x, z);
}

// ── Time-of-day presets ───────────────────────────────────────
const C = (h) => new THREE.Color(h);
const PRESETS = {
  day: {
    top: C('#2b7bd0'), horizon: C('#d9e6ef'), bottom: C('#e2d6c0'), fog: C('#d5e2eb'),
    sunDir: new THREE.Vector3(-0.62, 0.52, 0.42), sunColor: C('#fff0d4'), sunI: 2.5,
    hemiSky: C('#bcd8ff'), hemiGround: C('#8c7a58'), hemiI: 0.6, night: 0, exposure: 0.9, env: 0.5, haze: 0.00021,
  },
  sunset: {
    top: C('#27468a'), horizon: C('#ffb36b'), bottom: C('#c98a5a'), fog: C('#eab98c'),
    sunDir: new THREE.Vector3(-0.92, 0.16, 0.18), sunColor: C('#ff9440'), sunI: 2.3,
    hemiSky: C('#ffc08a'), hemiGround: C('#6b4630'), hemiI: 0.5, night: 0.35, exposure: 0.9, env: 0.45, haze: 0.00026,
  },
  night: {
    top: C('#020615'), horizon: C('#162545'), bottom: C('#0a1224'), fog: C('#0f1a33'),
    sunDir: new THREE.Vector3(0.4, 0.55, -0.45), sunColor: C('#7d9ae0'), sunI: 0.55,
    hemiSky: C('#20305a'), hemiGround: C('#0b0e18'), hemiI: 0.5, night: 1, exposure: 1.05, env: 0.28, haze: 0.00022,
  },
};
export const TOD_ORDER = ['day', 'sunset', 'night'];

function cloneState(p) {
  const o = {};
  for (const k in p) o[k] = p[k] && p[k].clone ? p[k].clone() : p[k];
  return o;
}

// ── Shaders ───────────────────────────────────────────────────
const SKY_VS = /* glsl */`
  varying vec3 vDir;
  void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
`;
const SKY_FS = /* glsl */`
  uniform vec3 top, horizon, bottom, sunDir, sunColor;
  uniform float night, time;
  varying vec3 vDir;
  float hash(vec3 p){ p = fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
  float hash2(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
  float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
    return mix(mix(hash2(i),hash2(i+vec2(1,0)),f.x), mix(hash2(i+vec2(0,1)),hash2(i+vec2(1,1)),f.x), f.y); }
  void main(){
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col = mix(horizon, top, pow(clamp(h,0.0,1.0), 0.45));
    col = mix(col, bottom, smoothstep(0.0,-0.25,h));
    float sd = max(dot(d, normalize(sunDir)), 0.0);
    float sunAmt = 1.0 - night*0.9;
    col += sunColor * (pow(sd, 1400.0)*6.0 + pow(sd, 40.0)*0.35 + pow(sd, 6.0)*0.18) * mix(1.0, 0.55, night);
    // thin high clouds
    if (h > 0.02) {
      vec2 cp = d.xz / (h + 0.25) * 2.2 + time*0.004;
      float cl = vnoise(cp*1.5)*0.6 + vnoise(cp*3.7)*0.3 + vnoise(cp*8.0)*0.1;
      cl = smoothstep(0.55, 0.95, cl) * smoothstep(0.02, 0.25, h);
      col = mix(col, mix(horizon, vec3(1.0), 0.55) * mix(1.0, 0.1, night), cl*0.45);
    }
    // stars
    float s = step(0.9972, hash(floor(d*240.0)));
    col += vec3(s) * night * smoothstep(0.02, 0.3, h) * (0.5+0.5*hash(floor(d*240.0)+3.0));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
const SEA_VS = /* glsl */`
  varying vec3 vWorld;
  #include <fog_pars_vertex>
  void main(){
    vec4 wp = modelMatrix * vec4(position,1.0);
    vWorld = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;
const SEA_FS = /* glsl */`
  uniform vec3 deep, shallow, sunDir, sunColor, skyCol;
  uniform float time, light;
  varying vec3 vWorld;
  #include <fog_pars_fragment>
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
  float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
  float hgt(vec2 p){ return vn(p+time*0.06)*0.55 + vn(p*2.3-time*0.09)*0.3 + vn(p*5.1+time*0.14)*0.15; }
  void main(){
    vec2 p = vWorld.xz * 0.045;
    float e = 0.02;
    float h0 = hgt(p);
    float hx = hgt(p+vec2(e,0.)), hz = hgt(p+vec2(0.,e));
    vec3 N = normalize(vec3(-(hx-h0)/e*0.07, 1.0, -(hz-h0)/e*0.07));
    vec3 V = normalize(cameraPosition - vWorld);
    float fres = pow(1.0 - max(dot(N,V),0.0), 3.0);
    vec3 base = mix(deep, shallow, smoothstep(0.35,0.75,h0)*0.5);
    vec3 col = mix(base, skyCol, fres*0.75);
    vec3 R = reflect(-V, N);
    float spec = pow(max(dot(R, normalize(sunDir)), 0.0), 220.0);
    col += sunColor * spec * 3.0;
    col *= mix(0.25, 1.0, light);
    gl_FragColor = vec4(col, 0.84);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

// ──────────────────────────────────────────────────────────────
export function createWorld(scene, renderer) {
  const rng = mulberry32(2025);
  const colliders = new Colliders(64);
  const updaters = [];
  const root = new THREE.Group();
  scene.add(root);

  // materials ----------------------------------------------------
  const glassTex = makeWindowTextures('glass');
  const stoneTex = makeWindowTextures('stone');
  const mats = {
    glass: new THREE.MeshStandardMaterial({
      map: glassTex.map, emissiveMap: glassTex.lit, emissive: 0xffd9a0, emissiveIntensity: 0,
      vertexColors: true, roughness: 0.3, metalness: 0.45,
    }),
    stone: new THREE.MeshStandardMaterial({
      map: stoneTex.map, emissiveMap: stoneTex.lit, emissive: 0xffd9a0, emissiveIntensity: 0,
      vertexColors: true, roughness: 0.85, metalness: 0.0,
    }),
    gold: new THREE.MeshStandardMaterial({
      color: 0xf2c45a, roughness: 0.32, metalness: 0.65, vertexColors: true, emissive: 0xffb830, emissiveIntensity: 0,
    }),
    silver: new THREE.MeshStandardMaterial({ color: 0xdfe5ea, roughness: 0.25, metalness: 0.9, vertexColors: true }),
    plate: new THREE.MeshStandardMaterial({ color: 0xc4a874, roughness: 1, vertexColors: true }),
    halo: new THREE.MeshBasicMaterial({ color: 0x5fe0d6, vertexColors: true }),
  };
  const lightMats = { windows: [mats.glass, mats.stone], gold: mats.gold };

  // sky ----------------------------------------------------------
  const skyUniforms = {
    top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, bottom: { value: new THREE.Color() },
    sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunColor: { value: new THREE.Color() },
    night: { value: 0 }, time: { value: 0 },
  };
  const skyMat = new THREE.ShaderMaterial({
    uniforms: skyUniforms, vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(7000, 32, 16), skyMat);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  scene.add(sky);
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMat));
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envTarget = null;
  const rebuildEnv = () => {
    if (envTarget) envTarget.dispose();
    envTarget = pmrem.fromScene(envScene, 0, 0.1, 100);
    scene.environment = envTarget.texture;
  };

  // lights -------------------------------------------------------
  const hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -230; sc.right = 230; sc.top = 230; sc.bottom = -230; sc.near = 10; sc.far = 1400;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.8;
  scene.add(sun, sun.target);
  scene.fog = new THREE.FogExp2(0xd5e2eb, 0.00021);

  // terrain ------------------------------------------------------
  {
    const SZ = 9000, SEG = 360;
    const g = new THREE.PlaneGeometry(SZ, SZ, SEG, SEG);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    const col = new Float32Array(p.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const h = groundH(x, z);
      p.setY(i, h);
      const n = 0.5 + 0.5 * Math.sin(x * 0.017) * Math.sin(z * 0.013) + 0.2 * Math.sin(x * 0.05 + z * 0.04);
      if (x < COAST_X) c.setRGB(0.5, 0.42, 0.28).multiplyScalar(0.55 + 0.45 * smoothstep(-9, 0, h)); // seabed
      else if (x > 1100) c.setRGB(0.55, 0.28, 0.1).lerp(new THREE.Color(0.7, 0.4, 0.17), clamp(h / 40, 0, 1)); // dunes
      else c.setRGB(0.48, 0.36, 0.2).multiplyScalar(0.9 + 0.1 * n);
      if (Math.hypot(x - 650, z - 40) < 190) c.lerp(new THREE.Color(0.1, 0.24, 0.07), 1 - smoothstep(150, 190, Math.hypot(x - 650, z - 40)));
      if (x < COAST_X + 30 && x >= COAST_X - 4) c.lerp(new THREE.Color(0.72, 0.6, 0.38), 0.7); // beach
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    m.receiveShadow = true;
    root.add(m);
  }

  // sea ----------------------------------------------------------
  const seaUniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    deep: { value: new THREE.Color('#06556e') }, shallow: { value: new THREE.Color('#1aa5b5') },
    sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunColor: { value: new THREE.Color() },
    skyCol: { value: new THREE.Color() }, time: { value: 0 }, light: { value: 1 },
  }]);
  const seaMat = new THREE.ShaderMaterial({
    uniforms: seaUniforms, vertexShader: SEA_VS, fragmentShader: SEA_FS, fog: true, transparent: true, depthWrite: false,
  });
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(24000, 24000), seaMat);
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = -0.35;
  sea.renderOrder = 2;
  root.add(sea);

  // roads --------------------------------------------------------
  const roadTex = { r2: makeRoadTexture('r2'), r4: makeRoadTexture('r4'), r6: makeRoadTexture('r6') };
  const roadMats = {};
  for (const k in roadTex) roadMats[k] = new THREE.MeshStandardMaterial({ map: roadTex[k], roughness: 0.9 });
  const roadGeos = { r2: [], r4: [], r6: [] };
  const addRoad = (a, b, w, kind, y) => {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz), ang = Math.atan2(dx, dz);
    const g = new THREE.PlaneGeometry(w, len);
    g.rotateX(-Math.PI / 2);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * len / 24);
    g.rotateY(ang);
    g.translate((a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2);
    roadGeos[kind].push(g);
  };
  ROADS.forEach((r) => addRoad(r.a, r.b, r.w, r.kind, r.y));
  PALM_ROADS.forEach((r) => addRoad(r.a, r.b, r.w, r.kind, 0.06));
  for (const k in roadGeos) {
    if (!roadGeos[k].length) continue;
    const m = new THREE.Mesh(mergeGeometries(roadGeos[k]), roadMats[k]);
    m.receiveShadow = true;
    root.add(m);
  }

  // palm / island plates (+ shallow-water halos) --------------------
  {
    const P = new Builder(rng);
    const capsule = (key, a, b, r, top, thick, color) => {
      const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
      if (len > 0.5) {
        const g = new THREE.BoxGeometry(2 * r, thick, len);
        g.translate(0, top - thick / 2, 0);
        g.rotateY(Math.atan2(dx, dz));
        g.translate((a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2);
        P.raw(key, g, color);
      }
      for (const e of [a, b]) {
        const c = new THREE.CylinderGeometry(r, r, thick, 24);
        c.translate(e[0], top - thick / 2, e[1]);
        P.raw(key, c, color);
      }
    };
    for (const p of PLATES) {
      capsule('plate', p.a, p.b, p.r, -0.02, 9.2, [1, 1, 1]);
      capsule('halo', p.a, p.b, p.r + 28, -0.62, 0.1, [0.42, 0.88, 0.84]);
    }
    root.add(P.build(mats));
  }

  // beacons are added by createBeacons (below)

  // city ---------------------------------------------------------
  const B = new Builder(rng);
  const ctx = { B, mats, colliders, scene: root, updaters };

  // landmarks
  const LM = {};
  for (const cp of CHECKPOINTS) LM[cp.id] = cp.land;
  buildBurjKhalifa(ctx, ...LM.projects);
  buildBurjAlArab(ctx, ...LM.about);
  buildDubaiFrame(ctx, ...LM.experience);
  buildMuseum(ctx, ...LM.contact);
  buildCayan(ctx, ...LM.writing);
  buildAtlantis(ctx, ...LM.skills);
  buildEmiratesTowers(ctx, 140, -170);

  // exclusion zones for the random city
  const ZONES = [
    [LM.projects[0], LM.projects[1] + 90, 240], [LM.experience[0], LM.experience[1], 200],
    [LM.contact[0], LM.contact[1], 130], [LM.writing[0], LM.writing[1], 90], [140, -120, 90],
  ];
  const roadRects = ROADS.map((r) => ({
    x0: Math.min(r.a[0], r.b[0]) - r.w / 2 - 7, x1: Math.max(r.a[0], r.b[0]) + r.w / 2 + 7,
    z0: Math.min(r.a[1], r.b[1]) - r.w / 2 - 7, z1: Math.max(r.a[1], r.b[1]) + r.w / 2 + 7,
  }));
  const GLASS_TINTS = [[0.62, 0.78, 0.95], [0.5, 0.78, 0.82], [0.85, 0.9, 0.95], [0.9, 0.74, 0.55], [0.45, 0.55, 0.72], [0.95, 0.95, 0.97]];
  const SAND_TINTS = [[0.85, 0.72, 0.52], [0.8, 0.66, 0.46], [0.9, 0.82, 0.68], [0.75, 0.6, 0.4]];
  const DT = [300, -850], MA = [-40, 1250];

  const CELL = 62;
  for (let gx = -190; gx < 990; gx += CELL) {
    for (let gz = -1050; gz < 1420; gz += CELL) {
      const cx = gx + 31 + (rng() - 0.5) * 8, cz = gz + 31 + (rng() - 0.5) * 8;
      let w = 26 + rng() * 22, d = 26 + rng() * 22;
      const hw = w / 2, hd = d / 2;
      if (ZONES.some(([zx, zz, zr]) => Math.hypot(cx - zx, cz - zz) < zr)) continue;
      if (roadRects.some((r) => cx + hw > r.x0 && cx - hw < r.x1 && cz + hd > r.z0 && cz - hd < r.z1)) continue;
      if (cx > 1000 && rng() < 0.7) continue;
      // density fields
      const fD = Math.exp(-(((Math.hypot(cx - DT[0], cz - DT[1])) / 650) ** 2));
      const fM = Math.exp(-(((Math.hypot(cx - MA[0], cz - MA[1])) / 420) ** 2));
      const fS = Math.exp(-((cx / 260) ** 2));
      const f = Math.max(fD, fM);
      const pTower = 0.06 + 0.85 * f + 0.25 * fS * 0.5;
      const tower = rng() < pTower;
      let H;
      if (tower) {
        H = 70 + rng() * 170 * (0.35 + f) + (rng() < 0.12 ? 90 : 0);
        const col = GLASS_TINTS[Math.floor(rng() * GLASS_TINTS.length)];
        const style = rng();
        if (style < 0.22) {
          const r = Math.min(w, d) / 2;
          B.cyl('glass', r, r, H, 16, cx, 0, cz, { color: col });
          B.cyl('glass', r * 0.55, r * 0.55, 26, 12, cx, H, cz, { color: col });
          w = d = r * 2;
        } else if (style < 0.6) {
          B.box('glass', w, H, d, cx, 0, cz, { color: col });
          B.box('glass', w * 0.62, 28, d * 0.62, cx, H, cz, { color: col });
          B.box('silver', 1.2, 36 + rng() * 40, 1.2, cx, H + 28, cz, { tile: false });
        } else if (style < 0.82) {
          B.box('glass', w, H * 0.72, d, cx, 0, cz, { color: col });
          B.box('glass', w * 0.7, H * 0.28, d * 0.7, cx, H * 0.72, cz, { color: col });
          B.box('glass', w * 0.4, H * 0.12, d * 0.4, cx, H * 0.98, cz, { color: col });
        } else {
          B.box('glass', w, H, d, cx, 0, cz, { color: col });
        }
      } else {
        H = 9 + rng() * 34;
        const col = SAND_TINTS[Math.floor(rng() * SAND_TINTS.length)];
        B.box('stone', w, H, d, cx, 0, cz, { color: col });
        if (rng() < 0.5) B.box('stone', w * 0.5, 4, d * 0.5, cx + (rng() - 0.5) * 6, H, cz, { color: col });
      }
      colliders.addBox(cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2);
    }
  }

  // palm villas and crescent apartments (instanced)
  {
    const villas = [];
    const addVilla = (x, z, ry, w, h, d, tint) => villas.push({ x, z, ry, w, h, d, tint });
    for (const p of PLATES) {
      if (p.frond) {
        const { a, dx, dz, t } = p.frond;
        const ry = Math.atan2(dx, dz);
        for (let s = 40; s < t - 30; s += 15) {
          for (const side of [-1, 1]) {
            const nx = -dz * side, nz = dx * side;
            addVilla(a[0] + dx * s + nx * 15.5, a[1] + dz * s + nz * 15.5, ry, 9, 5.5 + rng() * 2, 11, rng());
          }
        }
      }
    }
    // trunk-side hotels
    for (let x = -300; x > -520; x -= 38) {
      for (const sd of [-1, 1]) addVilla(x, PALM_C[1] + sd * 17, 0, 28, 24 + rng() * 40, 16, rng());
    }
    // crescent apartments
    for (let i = 1; i < 28; i++) {
      const ph = lerp(Math.PI / 2 + 0.26, (3 * Math.PI) / 2 - 0.26, i / 28);
      if (Math.abs(ph - Math.PI) < 0.1) continue; // keep Atlantis clear
      const R = PALM_R + 22;
      addVilla(PALM_C[0] + Math.cos(ph) * R, PALM_C[1] + Math.sin(ph) * R, -ph, 24, 24 + rng() * 40, 22, rng());
    }
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.8 }), villas.length);
    const dummy = new THREE.Object3D(), col = new THREE.Color();
    villas.forEach((v, i) => {
      dummy.position.set(v.x, v.h / 2, v.z);
      dummy.rotation.set(0, v.ry, 0);
      dummy.scale.set(v.w, v.h, v.d);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
      col.setRGB(0.93, 0.88, 0.8).lerp(new THREE.Color(0.78, 0.62, 0.45), v.tint * 0.6);
      inst.setColorAt(i, col);
      const r = Math.max(v.w, v.d) / 2;
      colliders.addCircle(v.x, v.z, r * 0.92);
    });
    inst.castShadow = inst.receiveShadow = true;
    root.add(inst);
  }

  root.add(B.build(mats));

  // street lamps + palm trees (instanced) ----------------------------
  const lampPos = [], palmPos = [];
  for (const r of ROADS) {
    const dx = r.b[0] - r.a[0], dz = r.b[1] - r.a[1], len = Math.hypot(dx, dz);
    const ux = dx / len, uz = dz / len, nx = -uz, nz = ux;
    if (r.lamp) {
      for (let s = 30; s < len; s += 60) {
        for (const side of [-1, 1]) {
          const ox = nx * side * (r.w / 2 + 3), oz = nz * side * (r.w / 2 + 3);
          lampPos.push([r.a[0] + ux * s + ox, r.a[1] + uz * s + oz, side * nx, side * nz]);
        }
      }
    }
    if (r.palms) {
      for (let s = 12; s < len; s += 26) palmPos.push([r.a[0] + ux * s, r.a[1] + uz * s]);
    }
    if (r.lamp) {
      for (let s = 45; s < len; s += 38) {
        for (const side of [-1, 1]) palmPos.push([r.a[0] + ux * s + nx * side * (r.w / 2 + 8), r.a[1] + uz * s + nz * side * (r.w / 2 + 8)]);
      }
    }
  }
  for (let i = 0; i < 160; i++) { // Zabeel Park
    const a = rng() * Math.PI * 2, rr = Math.sqrt(rng()) * 165;
    palmPos.push([650 + Math.cos(a) * rr, 40 + Math.sin(a) * rr]);
  }
  for (let x = -540; x > -1230; x -= 28) palmPos.push([x, PALM_C[1] + 12], [x, PALM_C[1] - 12]); // palm trunk avenue
  {
    const pole = new THREE.CylinderGeometry(0.16, 0.22, 9, 6); pole.translate(0, 4.5, 0);
    const poles = new THREE.InstancedMesh(pole, new THREE.MeshStandardMaterial({ color: 0x6d7378, roughness: 0.6, metalness: 0.6 }), lampPos.length);
    const headG = new THREE.BoxGeometry(0.7, 0.25, 1.6); headG.translate(0, 9.1, 1.1);
    const lampMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    const heads = new THREE.InstancedMesh(headG, lampMat, lampPos.length);
    const d = new THREE.Object3D();
    lampPos.forEach((l, i) => {
      d.position.set(l[0], 0, l[1]);
      d.rotation.set(0, Math.atan2(-l[2], -l[3]) , 0);
      d.updateMatrix();
      poles.setMatrixAt(i, d.matrix); heads.setMatrixAt(i, d.matrix);
    });
    poles.castShadow = true;
    root.add(poles, heads);
    updaters.push((t, night) => lampMat.color.setRGB(0.07, 0.07, 0.07).lerp(new THREE.Color(1.6, 1.25, 0.7), clamp(night * 1.4, 0, 1)));

    // palm tree: trunk + 7 drooping fronds merged
    const parts = [];
    const trunk = new THREE.CylinderGeometry(0.22, 0.42, 9, 6); trunk.translate(0, 4.5, 0);
    const paint = (g, c) => {
      const n = g.attributes.position.count, a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { a[i * 3] = c[0]; a[i * 3 + 1] = c[1]; a[i * 3 + 2] = c[2]; }
      g.setAttribute('color', new THREE.BufferAttribute(a, 3));
      return g;
    };
    parts.push(paint(trunk, [0.45, 0.33, 0.2]));
    for (let i = 0; i < 7; i++) {
      const f = new THREE.BoxGeometry(0.9, 0.08, 5.2);
      f.translate(0, 0, 2.6);
      f.rotateX(0.5);
      f.rotateY((i / 7) * Math.PI * 2);
      f.translate(0, 9, 0);
      parts.push(paint(f, [0.18, 0.42, 0.16]));
    }
    const palmMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
    const palms = new THREE.InstancedMesh(mergeGeometries(parts), palmMat, palmPos.length);
    palmPos.forEach((p, i) => {
      const s = 0.8 + rng() * 0.6;
      d.position.set(p[0], 0, p[1]);
      d.rotation.set(0, rng() * 6.28, 0);
      d.scale.set(s, s * (0.9 + rng() * 0.3), s);
      d.updateMatrix();
      palms.setMatrixAt(i, d.matrix);
    });
    palms.castShadow = true;
    root.add(palms);
  }

  // gantry road signs over Sheikh Zayed Road ---------------------------
  const arrowFor = (rel) => {
    const a = Math.abs(rel);
    if (a < 0.45) return '↑';
    if (a < 1.2) return rel > 0 ? '↗' : '↖';
    if (a < 2.0) return rel > 0 ? '→' : '←';
    return '↓';
  };
  const signMats = [];
  for (let gz = -1250; gz <= 1450; gz += 360) {
    for (const dir of [-1, 1]) { // dir -1 = northbound (heading -z) on x>0 side
      const fx = 0, fz = dir, rx = -fz, rz = fx;
      const list = CHECKPOINTS.map((c) => {
        const dx = c.stop[0] - 0, dz = c.stop[1] - gz;
        const dist = Math.hypot(dx, dz);
        const rel = Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
        return { c, dist, rel };
      }).sort((a, b) => a.dist - b.dist).slice(0, 3);
      const tex = makeLabelTexture((g, w, h) => {
        g.fillStyle = '#0a6b3c'; g.fillRect(0, 0, w, h);
        g.strokeStyle = '#fff'; g.lineWidth = 8; g.strokeRect(10, 10, w - 20, h - 20);
        g.fillStyle = '#fff'; g.textBaseline = 'middle';
        list.forEach((e, i) => {
          const y = 62 + i * 68;
          g.font = 'bold 40px Arial, sans-serif'; g.textAlign = 'left';
          g.fillText(e.c.landmark, 36, y);
          g.font = '28px Arial, sans-serif'; g.fillStyle = '#c9ffe0';
          g.fillText(e.c.title.toUpperCase(), 36, y + 28 - 2);
          g.fillStyle = '#fff'; g.font = 'bold 54px Arial, sans-serif'; g.textAlign = 'right';
          g.fillText(arrowFor(e.rel), w - 160, y + 6);
          g.font = 'bold 34px Arial, sans-serif';
          g.fillText(`${(e.dist / 1000).toFixed(1)} km`, w - 34, y + 6);
        });
      }, 768, 280);
      const m = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.25, roughness: 0.5 });
      signMats.push(m);
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(21, 7.6), m);
      panel.position.set(-dir * 12.5, 8.8, gz);
      if (dir === 1) panel.rotation.y = Math.PI;
      panel.castShadow = true;
      root.add(panel);
    }
    const steel = new THREE.MeshStandardMaterial({ color: 0x8c9399, metalness: 0.7, roughness: 0.4 });
    const beam = new THREE.Mesh(new THREE.BoxGeometry(54, 1.1, 1.3), steel);
    beam.position.set(0, 13, gz);
    root.add(beam);
    for (const sx of [-26, 26]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(1, 13, 1), steel);
      post.position.set(sx, 6.5, gz);
      root.add(post);
    }
    colliders.addBox(-27, gz - 0.6, -25, gz + 0.6);
    colliders.addBox(25, gz - 0.6, 27, gz + 0.6);
  }
  updaters.push((t, night) => signMats.forEach((m) => { m.emissiveIntensity = 0.25 + night * 0.9; }));

  // traffic on Sheikh Zayed Road ---------------------------------------
  const traffic = [];
  {
    const body = new THREE.BoxGeometry(1.9, 0.75, 4.5); body.translate(0, 0.65, 0);
    const cab = new THREE.BoxGeometry(1.6, 0.6, 2.3); cab.translate(0, 1.3, -0.2);
    const bg = mergeGeometries([body, cab]);
    const N = 54;
    const cars = new THREE.InstancedMesh(bg, new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0.6 }), N);
    const lg = [];
    for (const sx of [-0.7, 0.7]) {
      const h = new THREE.BoxGeometry(0.4, 0.2, 0.1); h.translate(sx, 0.75, 2.25);
      const t = new THREE.BoxGeometry(0.4, 0.2, 0.1); t.translate(sx, 0.8, -2.25);
      lg.push(paintGeo(h, [3, 3, 2.6]), paintGeo(t, [3, 0.15, 0.15]));
    }
    const lights = new THREE.InstancedMesh(mergeGeometries(lg), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), N);
    const palette = [0xf2f2f2, 0xf2f2f2, 0x1c1f24, 0x7a7f86, 0xb8bcc2, 0xc22a2a, 0x234a8f, 0xe0b04a, 0x2a2d33, 0xf2f2f2];
    const laneX = [6.33, 13, 19.67], laneV = [22, 28, 34];
    let n = 0;
    for (const dir of [-1, 1]) {
      for (let l = 0; l < 3; l++) {
        const per = 9;
        for (let k = 0; k < per; k++) {
          traffic.push({ x: -dir * laneX[l], z: -1450 + (k + rng() * 0.6) * (3000 / per), v: laneV[l], dir }); // dir -1 (north) drives on x>0
          cars.setColorAt(n, new THREE.Color(palette[Math.floor(rng() * palette.length)]));
          n++;
        }
      }
    }
    cars.castShadow = true;
    root.add(cars, lights);
    const d = new THREE.Object3D();
    traffic.forEach((c, i) => {
      c.i = i;
      c.mesh = null;
    });
    updaters.push((t, night, dt) => {
      traffic.forEach((c, i) => {
        c.z += c.dir * c.v * dt;
        if (c.z > 1550) c.z -= 3050;
        if (c.z < -1500) c.z += 3050;
        d.position.set(c.x, 0.05, c.z);
        d.rotation.set(0, c.dir < 0 ? Math.PI : 0, 0);
        d.updateMatrix();
        cars.setMatrixAt(i, d.matrix); lights.setMatrixAt(i, d.matrix);
      });
      cars.instanceMatrix.needsUpdate = true; lights.instanceMatrix.needsUpdate = true;
    });
  }

  // checkpoint beacons ---------------------------------------------------
  const beaconTex = makeLabelTexture((g, w, h) => {
    const gr = g.createLinearGradient(0, h, 0, 0);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }, 4, 128);
  const beacons = CHECKPOINTS.map((cp) => {
    const col = new THREE.Color(cp.color);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(7, 7, 160, 24, 1, true),
      new THREE.MeshBasicMaterial({ color: col, alphaMap: beaconTex, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    );
    beam.position.set(cp.stop[0], 80, cp.stop[1]);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(11, 13, 48),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(cp.stop[0], 0.25, cp.stop[1]);
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(11, 48),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.18, side: THREE.DoubleSide })
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(cp.stop[0], 0.22, cp.stop[1]);
    root.add(beam, ring, disc);
    return { cp, beam, ring, disc };
  });
  updaters.push((t) => beacons.forEach((b, i) => {
    const s = 1 + Math.sin(t * 2.4 + i) * 0.06;
    b.ring.scale.set(s, s, s);
  }));

  // time of day ---------------------------------------------------------
  let cur = cloneState(PRESETS.day), from = cur, to = PRESETS.day, prog = 1, dur = 2.5, curName = 'day';
  const sunWorld = new THREE.Vector3();
  const applyState = (s) => {
    skyUniforms.top.value.copy(s.top); skyUniforms.horizon.value.copy(s.horizon); skyUniforms.bottom.value.copy(s.bottom);
    skyUniforms.sunDir.value.copy(s.sunDir).normalize(); skyUniforms.sunColor.value.copy(s.sunColor);
    skyUniforms.night.value = s.night;
    scene.fog.color.copy(s.fog); scene.fog.density = s.haze;
    hemi.color.copy(s.hemiSky); hemi.groundColor.copy(s.hemiGround); hemi.intensity = s.hemiI;
    sun.color.copy(s.sunColor); sun.intensity = s.sunI;
    renderer.toneMappingExposure = s.exposure;
    scene.environmentIntensity = s.env;
    seaUniforms.sunDir.value.copy(s.sunDir).normalize(); seaUniforms.sunColor.value.copy(s.sunColor);
    seaUniforms.skyCol.value.copy(s.horizon).lerp(s.top, 0.35);
    seaUniforms.light.value = 1 - s.night * 0.85;
    mats.glass.emissiveIntensity = mats.stone.emissiveIntensity = s.night * 1.7;
    mats.gold.emissiveIntensity = s.night * 0.35;
  };
  const mix = (a, b, t, out) => {
    for (const k in a) {
      if (a[k] && a[k].isColor) out[k].copy(a[k]).lerp(b[k], t);
      else if (a[k] && a[k].isVector3) out[k].copy(a[k]).lerp(b[k], t);
      else out[k] = lerp(a[k], b[k], t);
    }
  };
  applyState(cur);
  rebuildEnv();

  return {
    root, colliders, ROADS, PLATES, PALM_ROADS, traffic, beacons,
    get night() { return cur.night; },
    get timeOfDay() { return curName; },
    setTimeOfDay(name, instant = false) {
      curName = name;
      from = cloneState(cur);
      to = PRESETS[name];
      prog = instant ? 1 : 0;
      dur = 2.5;
      if (instant) { mix(from, to, 1, cur); applyState(cur); rebuildEnv(); }
    },
    update(dt, t, focus) {
      if (prog < 1) {
        prog = Math.min(1, prog + dt / dur);
        const e = prog * prog * (3 - 2 * prog);
        mix(from, to, e, cur);
        applyState(cur);
        if (prog >= 1) rebuildEnv();
      }
      skyUniforms.time.value = t;
      seaUniforms.time.value = t;
      updaters.forEach((u) => u(t, cur.night, dt));
      sunWorld.copy(cur.sunDir).normalize();
      sun.position.set(focus.x + sunWorld.x * 600, focus.y + sunWorld.y * 600, focus.z + sunWorld.z * 600);
      sun.target.position.set(focus.x, 0, focus.z);
      sun.target.updateMatrixWorld();
      sky.position.copy(focus);
    },
    skyFollow(p) { sky.position.copy(p); },
    // bump player out of traffic; returns true on contact
    trafficHit(p) {
      for (const c of traffic) {
        if (Math.abs(p.x - c.x) < 2.3 && Math.abs(p.z - c.z) < 4.4) {
          return c;
        }
      }
      return null;
    },
  };
}

function paintGeo(g, c) {
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c[0]; a[i * 3 + 1] = c[1]; a[i * 3 + 2] = c[2]; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
