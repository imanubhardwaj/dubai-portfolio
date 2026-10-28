import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  Builder, Colliders, clamp, lerp, smoothstep, mulberry32,
  makeWindowTextures, makeRoadTexture, makeLabelTexture, makeGroundTexture,
} from './util.js';
import {
  buildBurjKhalifa, buildBurjAlArab, buildDubaiFrame, buildMuseum,
  buildCayan, buildAtlantis, buildEmiratesTowers,
} from './landmarks.js';
import { CHECKPOINTS } from './config.js';
import { makeTrafficCarGeometry } from './car.js';

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
    float s = step(0.9984, hash(floor(d*700.0)));
    col += vec3(s) * night * smoothstep(0.02, 0.3, h) * (0.25+0.35*hash(floor(d*700.0)+3.0));
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
  uniform sampler2D landMap;
  uniform vec4 landRect;
  varying vec3 vWorld;
  #include <fog_pars_fragment>
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
  float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
  float hgt(vec2 p){ return vn(p+time*0.06)*0.55 + vn(p*2.3-time*0.09)*0.3 + vn(p*5.1+time*0.14)*0.15 + vn(p*11.0+time*0.2)*0.07; }
  void main(){
    vec2 p = vWorld.xz * 0.05;
    float e = 0.02;
    float h0 = hgt(p);
    float hx = hgt(p+vec2(e,0.)), hz = hgt(p+vec2(0.,e));
    vec3 N = normalize(vec3(-(hx-h0)/e*0.06, 1.0, -(hz-h0)/e*0.06));
    vec3 V = normalize(cameraPosition - vWorld);
    vec2 luv = (vWorld.xz - landRect.xy) / landRect.zw;
    float land = texture2D(landMap, luv).r;
    float sh = smoothstep(0.0, 0.42, land);
    vec3 base = mix(deep, shallow, sh);
    base = mix(base, shallow*1.25 + vec3(0.04,0.08,0.05), smoothstep(0.45, 0.85, land));
    float fres = pow(1.0 - max(dot(N,V),0.0), 4.0);
    vec3 col = mix(base, skyCol, fres*0.7);
    vec3 R = reflect(-V, N);
    float spec = pow(max(dot(R, normalize(sunDir)), 0.0), 260.0);
    col += sunColor * spec * 4.0;
    // foam along every shoreline
    float fn = vn(vWorld.xz*0.35 + time*0.4)*0.6 + vn(vWorld.xz*0.9 - time*0.5)*0.4;
    float foam = smoothstep(0.3, 0.4, land) * (1.0 - smoothstep(0.44, 0.56, land)) * smoothstep(0.35, 0.7, fn);
    col = mix(col, vec3(1.0), foam*0.85);
    col *= mix(0.22, 1.0, light);
    gl_FragColor = vec4(col, 1.0);
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
  const ctx2 = { envMats: [] };

  // materials ----------------------------------------------------
  const glassTex = makeWindowTextures('glass');
  const ribbonTex = makeWindowTextures('ribbon');
  const stoneTex = makeWindowTextures('stone');
  // grounds the base of buildings in shadow and adds a soft height haze
  const baseShade = (mat) => {
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vWY;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWY = (modelMatrix * vec4(transformed, 1.0)).y;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vWY;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mix(0.5, 1.0, smoothstep(0.0, 35.0, vWY));');
    };
    return mat;
  };
  const mkGlass = (tex, rough, metal) => baseShade(new THREE.MeshStandardMaterial({
    map: tex.map, emissiveMap: tex.lit, emissive: 0xffd9a0, emissiveIntensity: 0,
    vertexColors: true, roughness: rough, metalness: metal, envMapIntensity: 1.5,
  }));
  const mats = {
    glass: mkGlass(glassTex, 0.1, 0.55),
    ribbon: mkGlass(ribbonTex, 0.14, 0.45),
    stone: baseShade(new THREE.MeshStandardMaterial({
      map: stoneTex.map, emissiveMap: stoneTex.lit, emissive: 0xffd9a0, emissiveIntensity: 0,
      vertexColors: true, roughness: 0.85, metalness: 0.0,
    })),
    gold: baseShade(new THREE.MeshStandardMaterial({
      color: 0xe2a93a, roughness: 0.28, metalness: 0.85, vertexColors: true, emissive: 0xffb830, emissiveIntensity: 0, envMapIntensity: 1.6,
    })),
    silver: new THREE.MeshStandardMaterial({ color: 0xdfe5ea, roughness: 0.2, metalness: 0.95, vertexColors: true, envMapIntensity: 1.4 }),
    plate: new THREE.MeshStandardMaterial({ color: 0xc4a874, roughness: 1, vertexColors: true }),
    halo: new THREE.MeshBasicMaterial({ color: 0x5fe0d6, vertexColors: true }),
  };
  const reflective = [mats.glass, mats.ribbon, mats.gold, mats.silver];
  const windowMats = [mats.glass, mats.ribbon, mats.stone];

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
    reflective.forEach((m) => { if (!m.envMap) m.needsUpdate = true; m.envMap = envTarget.texture; });
    (ctx2.envMats || []).forEach((m) => { if (!m.envMap) m.needsUpdate = true; m.envMap = envTarget.texture; });
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
      { // paved city fabric vs open sand
        const cin = smoothstep(-215, -170, x) * (1 - smoothstep(985, 1030, x)) * smoothstep(-1130, -1080, z) * (1 - smoothstep(1440, 1490, z));
        if (cin > 0) c.lerp(new THREE.Color(0.36, 0.32, 0.27).multiplyScalar(0.85 + 0.3 * n), cin);
      }
      if (Math.hypot(x - 650, z - 40) < 190) c.lerp(new THREE.Color(0.1, 0.24, 0.07), 1 - smoothstep(150, 190, Math.hypot(x - 650, z - 40)));
      if (x < COAST_X + 30 && x >= COAST_X - 4) c.lerp(new THREE.Color(0.72, 0.6, 0.38), 0.7); // beach
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    const sandTex = makeGroundTexture('#d8c7a4', 0.5, 4, 256, true);
    sandTex.repeat.set(700, 700);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, map: sandTex, roughness: 1 }));
    m.receiveShadow = true;
    root.add(m);
  }

  // sea ----------------------------------------------------------
  const seaUniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    deep: { value: new THREE.Color('#03324a') }, shallow: { value: new THREE.Color('#1fc0c4') },
    sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunColor: { value: new THREE.Color() },
    skyCol: { value: new THREE.Color() }, time: { value: 0 }, light: { value: 1 },
    landMap: { value: null }, landRect: { value: new THREE.Vector4(-2600, -1500, 2950, 3200) },
  }]);
  { // baked land mask → shallow turquoise water + foam
    const MW = 1024, MH = Math.round(1024 * 3200 / 2950);
    const c = document.createElement('canvas'); c.width = MW; c.height = MH;
    const g = c.getContext('2d');
    const sx = MW / 2950, sz = MH / 3200;
    g.fillStyle = '#000'; g.fillRect(0, 0, MW, MH);
    g.filter = 'blur(10px)';
    g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineCap = 'round';
    g.fillRect((COAST_X + 2600) * sx, -20, MW, MH + 40);
    for (const p of PLATES) {
      g.lineWidth = p.r * 2 * sx;
      g.beginPath();
      g.moveTo((p.a[0] + 2600) * sx, (p.a[1] + 1500) * sz);
      g.lineTo((p.b[0] + 2600) * sx, (p.b[1] + 1500) * sz);
      g.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
    seaUniforms.landMap.value = t;
  }
  const seaMat = new THREE.ShaderMaterial({
    uniforms: seaUniforms, vertexShader: SEA_VS, fragmentShader: SEA_FS, fog: true,
  });
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(24000, 24000), seaMat);
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = -0.35;
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

  // road furniture: curbs, sidewalks, verges, intersections, crosswalks, signals, median barrier
  const HROADS = ROADS.filter((r) => r.a[1] === r.b[1]);
  const VROADS = ROADS.filter((r) => r.a[0] === r.b[0]);
  const stripGeo = (cx, cz, sw, h, len, ang) => {
    const g = new THREE.BoxGeometry(sw, h, len);
    g.translate(0, h / 2, 0); g.rotateY(ang); g.translate(cx, 0, cz);
    return g;
  };
  const cutsOf = (r) => {
    const isV = r.a[0] === r.b[0], out = [];
    for (const q of isV ? HROADS : VROADS) {
      const rc = isV ? r.a[0] : r.a[1];
      const q0 = isV ? Math.min(q.a[0], q.b[0]) : Math.min(q.a[1], q.b[1]);
      const q1 = isV ? Math.max(q.a[0], q.b[0]) : Math.max(q.a[1], q.b[1]);
      if (rc < q0 || rc > q1) continue;
      const s = (isV ? q.a[1] : q.a[0]) - (isV ? Math.min(r.a[1], r.b[1]) : Math.min(r.a[0], r.b[0]));
      out.push([s - q.w / 2 - 1, s + q.w / 2 + 1]);
    }
    return out.sort((x, y) => x[0] - y[0]);
  };
  const freeIntervals = (r) => {
    const len = Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]);
    const res = []; let s = 0;
    for (const [c0, c1] of cutsOf(r)) { if (c0 - s > 2) res.push([s, c0]); s = Math.max(s, c1); }
    if (len - s > 2) res.push([s, len]);
    return res;
  };
  const curbG = [], walkG = [], verdG = [], barrG = [];
  for (const r of ROADS) {
    const dx = r.b[0] - r.a[0], dz = r.b[1] - r.a[1], len = Math.hypot(dx, dz);
    const ux = dx / len, uz = dz / len, nx = -uz, nz = ux, ang = Math.atan2(dx, dz);
    for (const [s0, s1] of freeIntervals(r)) {
      const sl = s1 - s0, sm = (s0 + s1) / 2;
      const mx = r.a[0] + ux * sm, mz = r.a[1] + uz * sm;
      for (const side of [-1, 1]) {
        const at = (off) => [mx + nx * side * off, mz + nz * side * off];
        curbG.push(stripGeo(...at(r.w / 2 + 0.25), 0.5, 0.17, sl, ang));
        walkG.push(stripGeo(...at(r.w / 2 + 3.25), 5.5, 0.13, sl, ang));
        verdG.push(stripGeo(...at(r.w / 2 + 10), 8, 0.06, sl, ang));
      }
      if (r.palms) { // median barrier on Sheikh Zayed Road
        barrG.push(stripGeo(mx, mz, 0.7, 0.85, sl, ang));
        colliders.addBox(mx - 0.6, mz - sl / 2, mx + 0.6, mz + sl / 2);
      }
    }
  }
  const furn = (geos, mat, shadow = false) => {
    const m = new THREE.Mesh(mergeGeometries(geos), mat);
    m.receiveShadow = true; m.castShadow = shadow;
    root.add(m);
  };
  const paveTex = makeGroundTexture('#b3ada1', 0.22, 9, 128);
  paveTex.repeat.set(1, 1);
  furn(curbG, new THREE.MeshStandardMaterial({ color: 0xd9d6cf, roughness: 0.8 }));
  furn(walkG, new THREE.MeshStandardMaterial({ map: paveTex, color: 0xcfc8ba, roughness: 0.95 }));
  furn(verdG, new THREE.MeshStandardMaterial({ color: 0x2d5a27, roughness: 1 }));
  if (barrG.length) furn(barrG, new THREE.MeshStandardMaterial({ color: 0xc8c5be, roughness: 0.7 }), true);

  // intersections: asphalt patch + zebra crossings + traffic signals
  {
    const patches = [], zebra = [], poles = [], redH = [], grnH = [];
    for (const V of VROADS) for (const H of HROADS) {
      const x = V.a[0], z = H.a[1];
      if (x < H.a[0] || x > H.b[0] || z < V.a[1] || z > V.b[1]) continue;
      const pg = new THREE.PlaneGeometry(V.w, H.w);
      pg.rotateX(-Math.PI / 2); pg.translate(x, 0.1, z);
      patches.push(pg);
      // zebra stripes
      for (const sx of [-1, 1]) { // across H road, either side of V
        const px = x + sx * (V.w / 2 + 2.6);
        for (let k = -Math.floor((H.w - 2) / 2.4); k <= Math.floor((H.w - 2) / 2.4); k++) zebra.push([px, z + k * 1.2, 3, 0.55]);
      }
      for (const sz of [-1, 1]) { // across V road
        const pz = z + sz * (H.w / 2 + 2.6);
        for (let k = -Math.floor((V.w - 2) / 2.4); k <= Math.floor((V.w - 2) / 2.4); k++) zebra.push([x + k * 1.2, pz, 0.55, 3]);
      }
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const px = x + sx * (V.w / 2 + 3), pz = z + sz * (H.w / 2 + 3);
        poles.push([px, pz, Math.atan2(-sx, -sz)]);
        ((sx * sz > 0) ? redH : grnH).push([px, pz, Math.atan2(-sx, -sz)]);
      }
    }
    const patchMat = new THREE.MeshStandardMaterial({ color: 0x2b2d32, roughness: 0.92 });
    if (patches.length) furn(patches, patchMat);
    const zi = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.02, 1), new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.7 }), zebra.length);
    const d = new THREE.Object3D();
    zebra.forEach((z, i) => { d.position.set(z[0], 0.115, z[1]); d.scale.set(z[2], 1, z[3]); d.rotation.set(0, 0, 0); d.updateMatrix(); zi.setMatrixAt(i, d.matrix); });
    zi.receiveShadow = true; root.add(zi);
    const poleG = new THREE.CylinderGeometry(0.12, 0.15, 6.5, 6); poleG.translate(0, 3.25, 0);
    const pi = new THREE.InstancedMesh(poleG, new THREE.MeshStandardMaterial({ color: 0x4b5057, metalness: 0.6, roughness: 0.5 }), poles.length);
    poles.forEach((p, i) => { d.position.set(p[0], 0, p[1]); d.scale.set(1, 1, 1); d.rotation.set(0, p[2], 0); d.updateMatrix(); pi.setMatrixAt(i, d.matrix); });
    pi.castShadow = true; root.add(pi);
    const head = (lit) => {
      const parts = [];
      const hb = new THREE.BoxGeometry(0.45, 1.3, 0.4); hb.translate(0, 6.2, 0.5);
      parts.push(paintGeo(hb, [0.04, 0.04, 0.04]));
      [[0.4, [3, 0.2, 0.2], 'r'], [0, [3, 2, 0.2], 'a'], [-0.4, [0.2, 3, 0.4], 'g']].forEach(([y, c, k]) => {
        const lb = new THREE.BoxGeometry(0.28, 0.28, 0.1); lb.translate(0, 6.2 + y, 0.74);
        parts.push(paintGeo(lb, k === lit ? c : [0.05, 0.05, 0.05]));
      });
      return mergeGeometries(parts);
    };
    const mkHeads = (list, lit) => {
      const im = new THREE.InstancedMesh(head(lit), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), list.length);
      list.forEach((p, i) => { d.position.set(p[0], 0, p[1]); d.rotation.set(0, p[2], 0); d.updateMatrix(); im.setMatrixAt(i, d.matrix); });
      root.add(im);
    };
    mkHeads(redH, 'r'); mkHeads(grnH, 'g');
  }

  // Dubai Metro viaduct along Sheikh Zayed Road
  const metroTrains = [];
  {
    const MX = 38, Y0 = 9;
    const concrete = new THREE.MeshStandardMaterial({ color: 0xbab6ad, roughness: 0.85 });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(13, 1.5, 3100), concrete);
    deck.position.set(MX, Y0 + 0.75, 50); deck.castShadow = deck.receiveShadow = true; root.add(deck);
    for (const tx of [MX - 3, MX + 3]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.25, 3100), new THREE.MeshStandardMaterial({ color: 0x50545a, metalness: 0.8, roughness: 0.4 }));
      rail.position.set(tx, Y0 + 1.6, 50); root.add(rail);
    }
    const pillars = [];
    for (let z = -1480; z < 1590; z += 30) {
      if (HROADS.some((h) => Math.abs(h.a[1] - z) < h.w / 2 + 3)) continue;
      pillars.push(z);
      colliders.addCircle(MX, z, 1.9);
    }
    const pg = new THREE.BoxGeometry(2.6, Y0, 2.6); pg.translate(0, Y0 / 2, 0);
    const pil = new THREE.InstancedMesh(pg, concrete, pillars.length);
    const d = new THREE.Object3D();
    pillars.forEach((z, i) => { d.position.set(MX, 0, z); d.updateMatrix(); pil.setMatrixAt(i, d.matrix); });
    pil.castShadow = pil.receiveShadow = true; root.add(pil);
    // stations
    const glassM = new THREE.MeshStandardMaterial({ color: 0x9fd3ea, roughness: 0.1, metalness: 0.6, transparent: true, opacity: 0.55 });
    const stationLight = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
    for (const sz of [-950, -150, 650]) {
      const roof = new THREE.Mesh(new THREE.BoxGeometry(18, 0.6, 76), glassM);
      roof.position.set(MX, Y0 + 6.5, sz); root.add(roof);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(18.4, 0.5, 76.4), new THREE.MeshStandardMaterial({ color: 0xd9dde2, metalness: 0.9, roughness: 0.25 }));
      strip.position.set(MX, Y0 + 6.1, sz); root.add(strip);
      const light = new THREE.Mesh(new THREE.BoxGeometry(18.2, 0.15, 76.2), stationLight);
      light.position.set(MX, Y0 + 5.8, sz); root.add(light);
      updaters.push((t, night) => stationLight.color.setRGB(0.1, 0.1, 0.1).lerp(new THREE.Color(0.6, 1.3, 2.2), clamp(night * 1.2, 0, 1)));
      for (const px of [MX - 8.6, MX + 8.6]) for (let k = -3; k <= 3; k++) {
        const col = new THREE.Mesh(new THREE.BoxGeometry(0.5, 6, 0.5), concrete);
        col.position.set(px, Y0 + 4.5, sz + k * 12); root.add(col);
      }
    }
    // trains (red line livery)
    const bodyM = new THREE.MeshStandardMaterial({ color: 0xe9ecef, roughness: 0.25, metalness: 0.7 });
    const winM = new THREE.MeshStandardMaterial({ color: 0x14212e, roughness: 0.1, metalness: 0.8, emissive: 0xffe8b0, emissiveIntensity: 0 });
    const redM = new THREE.MeshStandardMaterial({ color: 0xd22630, roughness: 0.4 });
    updaters.push((t, night) => { winM.emissiveIntensity = night * 1.4; });
    for (const [tx, dir, off] of [[MX - 3, 1, 0], [MX + 3, -1, 900]]) {
      const cars = [];
      for (let i = 0; i < 5; i++) {
        const g = new THREE.Group();
        const b = new THREE.Mesh(new THREE.BoxGeometry(3.1, 3.4, 18), bodyM); b.position.y = 1.9;
        const wd = new THREE.Mesh(new THREE.BoxGeometry(3.14, 1.2, 15.5), winM); wd.position.y = 2.5;
        const st = new THREE.Mesh(new THREE.BoxGeometry(3.16, 0.35, 18.02), redM); st.position.y = 1.15;
        b.castShadow = true;
        g.add(b, wd, st); g.position.set(tx, Y0 + 1.7, 0); root.add(g); cars.push(g);
      }
      metroTrains.push({ cars, dir, z: -1400 + off, tx });
    }
    updaters.push((t, night, dt) => {
      for (const tr of metroTrains) {
        tr.z += tr.dir * 24 * dt;
        if (tr.z > 1650) tr.z = -1600; if (tr.z < -1650) tr.z = 1600;
        tr.cars.forEach((g, i) => { g.position.z = tr.z - tr.dir * i * 18.4; });
      }
    });
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
  roadRects.push({ x0: 26, x1: 50, z0: -1500, z1: 1600 });
  const GLASS_TINTS = [[0.62, 0.78, 0.95], [0.5, 0.78, 0.82], [0.85, 0.9, 0.95], [0.9, 0.74, 0.55], [0.45, 0.55, 0.72], [0.95, 0.95, 0.97]];
  const SAND_TINTS = [[0.85, 0.72, 0.52], [0.8, 0.66, 0.46], [0.9, 0.82, 0.68], [0.75, 0.6, 0.4]];
  const DT = [300, -850], MA = [-40, 1250];

  const CELL = 62;
  const KEYS = ['glass', 'glass', 'ribbon'];
  for (let gx = -190; gx < 990; gx += CELL) {
    for (let gz = -1050; gz < 1420; gz += CELL) {
      const cx = gx + 31 + (rng() - 0.5) * 8, cz = gz + 31 + (rng() - 0.5) * 8;
      let w = 26 + rng() * 22, d = 26 + rng() * 22;
      if (ZONES.some(([zx, zz, zr]) => Math.hypot(cx - zx, cz - zz) < zr)) continue;
      if (roadRects.some((r) => cx + w / 2 + 6 > r.x0 && cx - w / 2 - 6 < r.x1 && cz + d / 2 + 6 > r.z0 && cz - d / 2 - 6 < r.z1)) continue;
      if (cx > 1000 && rng() < 0.7) continue;
      const fD = Math.exp(-((Math.hypot(cx - DT[0], cz - DT[1]) / 650) ** 2));
      const fM = Math.exp(-((Math.hypot(cx - MA[0], cz - MA[1]) / 420) ** 2));
      const fS = Math.exp(-((cx / 260) ** 2));
      const f = Math.max(fD, fM);
      const tower = rng() < 0.06 + 0.85 * f + 0.12 * fS;
      let fw = w, fd = d;
      if (tower) {
        const H = 80 + rng() * 190 * (0.35 + f) + (rng() < 0.12 ? 100 : 0);
        const K = KEYS[Math.floor(rng() * KEYS.length)];
        const col = GLASS_TINTS[Math.floor(rng() * GLASS_TINTS.length)];
        const sand = SAND_TINTS[Math.floor(rng() * SAND_TINTS.length)];
        if (rng() < 0.7) { // podium
          fw = Math.min(w * 1.25, 56); fd = Math.min(d * 1.25, 56);
          B.box('stone', fw, 10 + rng() * 10, fd, cx, 0, cz, { color: sand });
        }
        const style = rng();
        if (style < 0.2) { // round tower with crown ring
          const r = Math.min(w, d) / 2;
          B.cyl(K, r, r, H, 20, cx, 0, cz, { color: col });
          B.cyl('silver', r * 1.02, r * 1.02, 3, 20, cx, H, cz, { tile: false });
          B.cyl(K, r * 0.5, r * 0.3, 40, 12, cx, H + 3, cz, { color: col });
          B.cyl('silver', 0.3, 0.6, 30 + rng() * 30, 6, cx, H + 43, cz, { tile: false });
        } else if (style < 0.5) { // stepped setbacks
          const n = 3 + Math.floor(rng() * 2);
          let y = 0, ww = w, dd = d;
          for (let i = 0; i < n; i++) {
            const hh = (H / n) * (1.25 - i * 0.18);
            B.box(K, ww, hh, dd, cx, y, cz, { color: col });
            y += hh; ww *= 0.8; dd *= 0.8;
          }
          B.box('silver', 1, 30 + rng() * 40, 1, cx, y, cz, { tile: false });
        } else if (style < 0.75) { // slab with crown fins
          B.box(K, w * 0.8, H, d * 0.8, cx, 0, cz, { color: col });
          B.box('silver', w * 0.84, 2.5, d * 0.84, cx, H, cz, { tile: false });
          B.box(K, w * 0.5, 22, d * 0.5, cx, H + 2.5, cz, { color: col });
          B.box('silver', 0.8, 24, 0.8, cx, H + 24, cz, { tile: false });
        } else { // twin towers on shared podium
          B.box(K, w * 0.46, H, d * 0.8, cx - w * 0.26, 0, cz, { color: col });
          B.box(K, w * 0.46, H * 0.82, d * 0.8, cx + w * 0.26, 0, cz, { color: col });
          B.box('silver', w * 0.5, 2, d * 0.84, cx - w * 0.26, H, cz, { tile: false });
        }
      } else {
        const H = 9 + rng() * 30;
        const col = SAND_TINTS[Math.floor(rng() * SAND_TINTS.length)];
        B.box('stone', w, H, d, cx, 0, cz, { color: col });
        B.box('stone', w * 1.02, 1.2, d * 1.02, cx, H, cz, { color: [0.92, 0.88, 0.8], tile: false });
        if (rng() < 0.6) B.box('stone', w * 0.35, 4, d * 0.35, cx + (rng() - 0.5) * 8, H + 1.2, cz + (rng() - 0.5) * 8, { color: col });
      }
      colliders.addBox(cx - fw / 2, cz - fd / 2, cx + fw / 2, cz + fd / 2);
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
      col.setRGB(0.72, 0.64, 0.52).lerp(new THREE.Color(0.55, 0.4, 0.27), v.tint * 0.7);
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
    const free = freeIntervals(r);
    const inFree = (s) => free.some(([a, b]) => s > a + 3 && s < b - 3);
    if (r.palms) { // double-arm lamps + palms down the median, palms on the west verge
      for (let s = 20; s < len; s += 38) if (inFree(s)) lampPos.push([r.a[0] + ux * s, r.a[1] + uz * s, 1, 0], [r.a[0] + ux * s, r.a[1] + uz * s, -1, 0]);
      for (let s = 39; s < len; s += 38) if (inFree(s)) palmPos.push([r.a[0] + ux * s, r.a[1] + uz * s]);
      for (let s = 15; s < len; s += 22) if (inFree(s)) palmPos.push([r.a[0] + ux * s - 33, r.a[1] + uz * s]);
    } else if (r.lamp) {
      for (let s = 30; s < len; s += 55) {
        if (!inFree(s)) continue;
        for (const side of [-1, 1]) {
          const o = r.w / 2 + 3;
          lampPos.push([r.a[0] + ux * s + nx * side * o, r.a[1] + uz * s + nz * side * o, side * nx, side * nz]);
        }
      }
      for (let s = 45; s < len; s += 30) {
        if (!inFree(s)) continue;
        for (const side of [-1, 1]) palmPos.push([r.a[0] + ux * s + nx * side * (r.w / 2 + 10), r.a[1] + uz * s + nz * side * (r.w / 2 + 10)]);
      }
    }
  }
  for (let i = 0; i < 160; i++) { // Zabeel Park
    const a = rng() * Math.PI * 2, rr = Math.sqrt(rng()) * 165;
    palmPos.push([650 + Math.cos(a) * rr, 40 + Math.sin(a) * rr]);
  }
  for (let x = -540; x > -1230; x -= 28) palmPos.push([x, PALM_C[1] + 12], [x, PALM_C[1] - 12]); // palm trunk avenue
  {
    const poleG = new THREE.CylinderGeometry(0.14, 0.24, 11, 8); poleG.translate(0, 5.5, 0);
    const poles = new THREE.InstancedMesh(poleG, new THREE.MeshStandardMaterial({ color: 0x70767b, roughness: 0.5, metalness: 0.7 }), lampPos.length);
    const arm = new THREE.BoxGeometry(0.16, 0.16, 3.2); arm.translate(0, 10.9, 1.5);
    const hd = new THREE.BoxGeometry(0.7, 0.22, 1.5); hd.translate(0, 10.75, 3.0);
    const headG = mergeGeometries([arm, hd]);
    const lampMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
    const heads = new THREE.InstancedMesh(headG, lampMat, lampPos.length);
    const d = new THREE.Object3D();
    lampPos.forEach((l, i) => {
      d.position.set(l[0], 0, l[1]);
      d.rotation.set(0, Math.atan2(-l[2], -l[3]), 0);
      d.updateMatrix();
      poles.setMatrixAt(i, d.matrix); heads.setMatrixAt(i, d.matrix);
    });
    poles.castShadow = true;
    root.add(poles, heads);
    updaters.push((t, night) => lampMat.color.setRGB(0.16, 0.16, 0.16).lerp(new THREE.Color(3.2, 2.2, 1.0), clamp(night * 1.4, 0, 1)));

    // date palm: gently curved trunk + 12 drooping fronds
    const parts = [];
    const paint = (g, c, c2) => {
      const n = g.attributes.position.count, a = new Float32Array(n * 3), pos = g.attributes.position;
      let ymin = Infinity, ymax = -Infinity;
      for (let i = 0; i < n; i++) { ymin = Math.min(ymin, pos.getY(i)); ymax = Math.max(ymax, pos.getY(i)); }
      for (let i = 0; i < n; i++) {
        const t = c2 ? (pos.getY(i) - ymin) / Math.max(0.001, ymax - ymin) : 0;
        const col = c2 ? [lerp(c[0], c2[0], t), lerp(c[1], c2[1], t), lerp(c[2], c2[2], t)] : c;
        a[i * 3] = col[0]; a[i * 3 + 1] = col[1]; a[i * 3 + 2] = col[2];
      }
      g.setAttribute('color', new THREE.BufferAttribute(a, 3));
      return g;
    };
    const trunk = new THREE.CylinderGeometry(0.2, 0.38, 10, 7, 6); trunk.translate(0, 5, 0);
    const tp = trunk.attributes.position;
    for (let i = 0; i < tp.count; i++) { const y = tp.getY(i); tp.setX(i, tp.getX(i) + Math.sin(y * 0.3) * 0.25 + y * y * 0.006); }
    trunk.computeVertexNormals();
    parts.push(paint(trunk, [0.22, 0.14, 0.07], [0.3, 0.2, 0.1]));
    for (let k = 0; k < 12; k++) {
      const L = 4.6 + (k % 3) * 0.5, seg = 8, pos = [], idx = [];
      for (let s = 0; s <= seg; s++) {
        const u = s / seg;
        const wd = 0.6 * Math.pow(1 - u, 0.6) + 0.03;
        const y = 1.6 * u - 2.3 * u * u * (0.5 + (k % 4) * 0.12);
        pos.push(-wd, y, u * L, wd, y, u * L, 0, y + 0.12 * wd * 4, u * L);
      }
      for (let s = 0; s < seg; s++) {
        const a = s * 3, b = a + 3;
        idx.push(a, b, a + 2, a + 2, b, b + 2, a + 1, a + 2, b + 1, a + 2, b + 2, b + 1);
      }
      const fg = new THREE.BufferGeometry();
      fg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      fg.setIndex(idx); fg.computeVertexNormals();
      fg.rotateX(-0.25 - (k % 3) * 0.12);
      fg.rotateY((k / 12) * Math.PI * 2 + (k % 2) * 0.2);
      fg.translate(0.55, 9.9, 0);
      parts.push(paint(fg, [0.08, 0.25, 0.07], [0.22, 0.45, 0.14]));
    }
    // normalise attribute sets (trunk has uv, fronds don't)
    parts.forEach((g) => { g.deleteAttribute('uv'); });
    const palmMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
    const palms = new THREE.InstancedMesh(mergeGeometries(parts.map((g) => (g.index ? g : g))), palmMat, palmPos.length);
    palmPos.forEach((p, i) => {
      const s = 0.85 + rng() * 0.55;
      d.position.set(p[0], 0, p[1]);
      d.rotation.set(0, rng() * 6.28, 0);
      d.scale.set(s, s * (0.9 + rng() * 0.35), s);
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
    const bg = makeTrafficCarGeometry();
    const N = 54;
    const cars = new THREE.InstancedMesh(bg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.6 }), N);
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
    windowMats.forEach((m) => { m.emissiveIntensity = s.night * 1.0; });
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
