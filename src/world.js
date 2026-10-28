import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  Builder, Colliders, clamp, lerp, smoothstep, mulberry32,
  makeWindowTextures, makeLabelTexture, makeGroundTexture,
} from './util.js';
import {
  buildBurjKhalifa, buildBurjAlArab, buildDubaiFrame, buildMuseum, buildCayan, buildAtlantis,
} from './landmarks.js';
import { createGeoStreamer, createTraffic } from './geo.js';

// ── land mask (filled by createWorld) ─────────────────────────
let GEO = null;
export function canDrive(x, z) {
  if (!GEO) return true;
  const m = GEO.meta.mask;
  const gx = Math.floor((x - m.x0) / m.res), gz = Math.floor((z - m.z0) / m.res);
  if (gx < 1 || gz < 1 || gx >= m.w - 1 || gz >= m.h - 1) return false;
  return GEO.land[gz * m.w + gx] === 1;
}
let STREAMER = null;
export const surfaceH = (x, z, ref = 0) => (STREAMER ? STREAMER.heightAt(x, z, ref) : 0);
export const groundH = () => 0;

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
    vec2 luv = (vWorld.xz - landRect.xy) / landRect.zw; luv.y = 1.0 - luv.y;
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


function paintGeo(g, c) {
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c[0]; a[i * 3 + 1] = c[1]; a[i * 3 + 2] = c[2]; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

// date palm: gently curved trunk + 12 drooping fronds (merged, vertex-coloured)
function makePalmGeometry() {
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
  parts.forEach((g) => g.deleteAttribute('uv'));
  return mergeGeometries(parts);
}

// ──────────────────────────────────────────────────────────────
export function createWorld(scene, renderer, geo, checkpoints) {
  GEO = geo;
  const { meta } = geo;
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
  const towerTex = makeWindowTextures('tower');
  const goldTex = makeWindowTextures('gold');
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
    tower: mkGlass(towerTex, 0.12, 0.65),
    stone: baseShade(new THREE.MeshStandardMaterial({
      map: stoneTex.map, emissiveMap: stoneTex.lit, emissive: 0xffd9a0, emissiveIntensity: 0,
      vertexColors: true, roughness: 0.85, metalness: 0.0,
    })),
    goldglass: baseShade(new THREE.MeshStandardMaterial({
      map: goldTex.map, emissiveMap: goldTex.lit, emissive: 0xffc060, emissiveIntensity: 0,
      vertexColors: true, roughness: 0.2, metalness: 0.9, envMapIntensity: 1.8,
    })),
    gold: baseShade(new THREE.MeshStandardMaterial({
      color: 0xe2a93a, roughness: 0.28, metalness: 0.85, vertexColors: true, emissive: 0xffb830, emissiveIntensity: 0, envMapIntensity: 1.6,
    })),
    silver: new THREE.MeshStandardMaterial({ color: 0xdfe5ea, roughness: 0.2, metalness: 0.95, vertexColors: true, envMapIntensity: 1.4 }),
    plate: new THREE.MeshStandardMaterial({ color: 0xc4a874, roughness: 1, vertexColors: true }),
  };
  const reflective = [mats.glass, mats.ribbon, mats.tower, mats.goldglass, mats.gold, mats.silver];
  const windowMats = [mats.glass, mats.ribbon, mats.tower, mats.goldglass, mats.stone];

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
    ctx2.envMats.forEach((m) => { if (!m.envMap) m.needsUpdate = true; m.envMap = envTarget.texture; });
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

  // land + sea, driven by the OSM coastline mask -------------------------
  const M = meta.mask, MWm = M.w * M.res, MHm = M.h * M.res;
  const maskTex = new THREE.CanvasTexture(geo.maskCanvas);
  maskTex.wrapS = maskTex.wrapT = THREE.ClampToEdgeWrapping;
  maskTex.minFilter = THREE.LinearFilter; maskTex.generateMipmaps = false;
  {
    const PW = MWm + 14000, PH = MHm + 14000;
    const cx = M.x0 + MWm / 2, cz = M.z0 + MHm / 2;
    const sandTex = makeGroundTexture('#d4c3a0', 0.5, 4, 256, true);
    sandTex.repeat.set(PW / 14, PH / 14);
    const alpha = maskTex.clone();
    alpha.needsUpdate = true;
    alpha.repeat.set(PW / MWm, PH / MHm);
    alpha.offset.set((cx - PW / 2 - M.x0) / MWm, 1 - (cz + PH / 2 - M.z0) / MHm);
    const land = new THREE.Mesh(
      new THREE.PlaneGeometry(PW, PH, 96, 96),
      new THREE.MeshStandardMaterial({ map: sandTex, color: 0xd8c294, alphaMap: alpha, alphaTest: 0.5, roughness: 1 })
    );
    land.rotation.x = -Math.PI / 2;
    land.position.set(cx, 0, cz);
    land.receiveShadow = true;
    root.add(land);
  }
  const seaUniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    deep: { value: new THREE.Color('#03324a') }, shallow: { value: new THREE.Color('#1fc0c4') },
    sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunColor: { value: new THREE.Color() },
    skyCol: { value: new THREE.Color() }, time: { value: 0 }, light: { value: 1 },
    landMap: { value: null }, landRect: { value: new THREE.Vector4(M.x0, M.z0, MWm, MHm) },
  }]);
  { // blurred copy → soft shallow-water gradient and foam band
    const c = document.createElement('canvas'); c.width = M.w; c.height = M.h;
    const g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, M.w, M.h);
    g.filter = 'blur(5px)';
    g.drawImage(geo.maskCanvas, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
    seaUniforms.landMap.value = t;
  }
  const seaMat = new THREE.ShaderMaterial({
    uniforms: seaUniforms, vertexShader: SEA_VS, fragmentShader: SEA_FS, fog: true,
  });
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000, 96, 96), seaMat);
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(M.x0 + MWm / 2, -0.9, M.z0 + MHm / 2);
  root.add(sea);

  // landmarks at their real coordinates -------------------------------
  const B = new Builder(rng);
  const ctx = { B, mats, colliders, scene: root, updaters, envMats: ctx2.envMats };
  const LM = {}, FACE = {};
  for (const cp of checkpoints) {
    LM[cp.id] = cp.land;
    FACE[cp.id] = Math.atan2(cp.stop[0] - cp.land[0], cp.stop[1] - cp.land[1]); // landmark → viewer
  }
  buildBurjKhalifa(ctx, ...LM.projects);
  buildBurjAlArab(ctx, ...LM.about, FACE.about);
  buildDubaiFrame(ctx, ...LM.experience, FACE.experience);
  buildMuseum(ctx, ...LM.contact, FACE.contact);
  buildCayan(ctx, ...LM.writing);
  buildAtlantis(ctx, ...LM.skills);
  root.add(B.build(mats));

  // OSM streaming + traffic -------------------------------------------------
  const palmGeo = makePalmGeometry();
  const streamer = createGeoStreamer({ scene, geo, mats, palmGeo, landmarks: meta.landmarks, updaters });
  STREAMER = streamer;
  let player = { x: 0, z: 0 };
  const traffic = createTraffic({ scene, streamer, updaters, getPlayer: () => player });

  // checkpoint beacons ---------------------------------------------------
  const beaconTex = makeLabelTexture((g, w, h) => {
    const gr = g.createLinearGradient(0, h, 0, 0);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }, 4, 128);
  const beacons = checkpoints.map((cp) => {
    const col = new THREE.Color(cp.color);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(7, 7, 160, 24, 1, true),
      new THREE.MeshBasicMaterial({ color: col, alphaMap: beaconTex, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    );
    beam.position.set(cp.stop[0], 80, cp.stop[1]);
    const ring = new THREE.Mesh(new THREE.RingGeometry(11, 13, 48), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(cp.stop[0], 0.4, cp.stop[1]);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(11, 48), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.18, side: THREE.DoubleSide }));
    disc.rotation.x = -Math.PI / 2; disc.position.set(cp.stop[0], 0.38, cp.stop[1]);
    root.add(beam, ring, disc);
    return { cp, beam, ring, disc };
  });
  updaters.push((t) => beacons.forEach((b, i) => { const s = 1 + Math.sin(t * 2.4 + i) * 0.06; b.ring.scale.set(s, s, s); }));

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
    root, colliders, beacons, streamer, traffic,
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
      player = focus;
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
      streamer.update(focus.x, focus.z);
      sunWorld.copy(cur.sunDir).normalize();
      sun.position.set(focus.x + sunWorld.x * 600, focus.y + sunWorld.y * 600, focus.z + sunWorld.z * 600);
      sun.target.position.set(focus.x, 0, focus.z);
      sun.target.updateMatrixWorld();
      sky.position.copy(focus);
    },
    // push probe circle out of anything solid; returns hit normal or null
    resolve(p, r, y) {
      const a = colliders.resolve(p, r, y);
      const b = streamer.resolve(p, r, y);
      return b || a;
    },
    trafficResolve: (p, r, y) => traffic.resolve(p, r, y),
  };
}
