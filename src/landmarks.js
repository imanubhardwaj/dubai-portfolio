import * as THREE from 'three';
import { makeLabelTexture, mulberry32 } from './util.js';

const SILVER = [0.78, 0.86, 0.95];
const TEAL = [0.45, 0.72, 0.78];
const SAND = [0.93, 0.82, 0.66];
const PINK = [0.95, 0.74, 0.6];

// ── Burj Khalifa — Y-plan, rounded wing tips, spiral setbacks, 828 m ───
export function buildBurjKhalifa(ctx, x, z) {
  const { B } = ctx;
  const TH = 24;                       // tier height
  const wingTop = [640, 560, 480];     // each wing steps down in turn → the spiral
  const T = [0.9, 0.95, 1.0];
  for (let k = 0; k < 3; k++) {
    const a = (k * Math.PI * 2) / 3 + 0.5;
    const ca = Math.cos(a), sa = Math.sin(a);
    for (let s = 0; s * TH < wingTop[k]; s++) {
      const ext = 46 - s * 1.55, w = 20 - s * 0.58;
      if (ext < 8 || w < 3) break;
      const half = ext - w / 2;                    // box runs to the centre of the rounded tip
      B.box('tower', half, TH, w, x + ca * half / 2, s * TH, z + sa * half / 2, { ry: -a, color: [T[k], T[k], T[k]] });
      B.cyl('tower', w / 2, w / 2, TH, 14, x + ca * half, s * TH, z + sa * half, { color: [T[k], T[k], T[k]] });
    }
  }
  // hexagonal core, then the stepped mast and spire
  B.cyl('tower', 13, 14, 640, 6, x, 0, z);
  B.cyl('tower', 9, 12.5, 70, 12, x, 640, z);
  B.cyl('silver', 5.5, 8.5, 60, 12, x, 710, z, { tile: false });
  B.cyl('silver', 2.8, 5, 50, 10, x, 770, z, { tile: false });
  B.cyl('silver', 0.4, 2.8, 8, 8, x, 820, z, { tile: false });
  // mechanical-floor bands
  for (const h of [120, 240, 360, 480, 600]) B.cyl('silver', 14.5, 14.5, 3, 6, x, h, z, { tile: false });
  // podium / hotel base
  B.cyl('stone', 54, 58, 9, 32, x, 0, z, { color: [0.85, 0.8, 0.72] });
  B.cyl('glass', 38, 40, 28, 28, x, 9, z);
  ctx.colliders.addCircle(x, z, 46);

  const blink = new THREE.Mesh(new THREE.SphereGeometry(1.6, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff2030 }));
  blink.position.set(x, 830, z);
  ctx.scene.add(blink);
  ctx.updaters.push((t) => { blink.visible = Math.sin(t * 3.2) > -0.2; });

  // Dubai Fountain lake with animated jets
  const lake = new THREE.Mesh(
    new THREE.PlaneGeometry(300, 130),
    new THREE.MeshStandardMaterial({ color: 0x15607f, roughness: 0.06, metalness: 0.5 })
  );
  lake.rotation.x = -Math.PI / 2;
  lake.position.set(x, 0.03, z + 190);
  lake.receiveShadow = true;
  ctx.scene.add(lake);
  const jetMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false });
  const jets = [];
  for (let i = 0; i < 38; i++) {
    const j = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.7, 1, 8, 1, true), jetMat);
    j.position.set(x - 126 + i * 6.8, 0, z + 190 + Math.sin(i * 0.7) * 18);
    ctx.scene.add(j); jets.push(j);
  }
  ctx.updaters.push((t, night) => {
    jets.forEach((j, i) => {
      const h = 3 + (0.5 + 0.5 * Math.sin(t * 1.7 + i * 0.55)) * (12 + 18 * (0.5 + 0.5 * Math.sin(t * 0.4 + i)));
      j.scale.y = h; j.position.y = h / 2;
    });
    jetMat.color.setRGB(1, 1, 1).lerp(new THREE.Color(0.7, 0.9, 1.6), night);
  });
}

// ── Burj Al Arab — billowing sail on its own island ───────────
export function buildBurjAlArab(ctx, x, z, face = 0) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = face + Math.PI + 0.45; // sail faces the road, turned ~25° for a 3/4 view
  const H = 321;

  // sail
  const nu = 30, nv = 48, W0 = 64;
  const pos = [], idx = [], uvs = [];
  for (let j = 0; j <= nv; j++) {
    const v = j / nv;
    const W = W0 * (1 - 0.82 * Math.pow(v, 2.6));
    const bulge = 58 * Math.pow(1 - v, 0.75) + 5;
    for (let i = 0; i <= nu; i++) {
      const u = (i / nu) * 2 - 1;
      pos.push(u * W / 2, 8 + v * (H - 22), 8 - bulge * (1 - u * u));
      uvs.push(i / nu, v * (H - 22) / 11);
    }
  }
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  sg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  sg.setIndex(idx);
  sg.computeVertexNormals();
  const bands = makeLabelTexture((c, w, h) => {
    c.fillStyle = '#eef1f3'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#b9c3cc'; c.fillRect(0, h - 6, w, 6);
    c.fillStyle = 'rgba(120,140,160,0.35)'; c.fillRect(0, 0, w, 3);
    c.fillStyle = 'rgba(255,255,255,0.0)';
  }, 8, 64);
  bands.wrapS = bands.wrapT = THREE.RepeatWrapping;
  const sailMat = new THREE.MeshStandardMaterial({
    map: bands, color: 0xffffff, roughness: 0.6, metalness: 0.0, side: THREE.DoubleSide,
    emissive: 0x2060ff, emissiveIntensity: 0,
  });
  const sail = new THREE.Mesh(sg, sailMat);
  sail.castShadow = sail.receiveShadow = true;
  g.add(sail);

  const steel = new THREE.MeshStandardMaterial({ color: 0x8e99a4, roughness: 0.35, metalness: 0.8 });
  const add = (geo, mat, px, py, pz, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(px, py, pz);
    m.rotation.z = rz;
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  };
  add(new THREE.BoxGeometry(12, H, 14), steel, 0, H / 2, 12);
  // diagonal legs
  const L = Math.hypot(24, H * 0.95), ang = Math.atan(24 / (H * 0.95));
  add(new THREE.BoxGeometry(4, L, 5), steel, -14, H * 0.475, 12, -ang);
  add(new THREE.BoxGeometry(4, L, 5), steel, 14, H * 0.475, 12, ang);
  // atrium podium + mast + helipad
  add(new THREE.BoxGeometry(78, 24, 52), new THREE.MeshStandardMaterial({ color: 0x9ec7d9, roughness: 0.2, metalness: 0.6 }), 0, 12, 4);
  add(new THREE.CylinderGeometry(0.5, 2.4, 70, 8), steel, 0, H + 28, 12);
  const heli = add(new THREE.CylinderGeometry(11, 11, 1.4, 24), steel, 0, 212, -2);
  heli.position.z = 22;
  ctx.scene.add(g);
  ctx.colliders.addBox(x - 44, z - 40, x + 44, z + 40);

  ctx.updaters.push((t, night) => {
    const h = (t * 0.07) % 1;
    sailMat.emissive.setHSL(h, 0.9, 0.5);
    sailMat.emissiveIntensity = night * 0.9;
  });
}

// ── Dubai Frame — 150 m gold-glass picture frame ─────────────
export function buildDubaiFrame(ctx, x, z, face = 0) {
  const { B } = ctx;
  const c = Math.cos(face), s = Math.sin(face);
  const P = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  const part = (key, w, h, d, lx, y, lz, o = {}) => { const [px, pz] = P(lx, lz); B.box(key, w, h, d, px, y, pz, { ry: face, ...o }); };
  const G = [1, 0.95, 0.85];
  part('goldglass', 9, 150, 28, -45, 0, 0, { color: G });
  part('goldglass', 9, 150, 28, 45, 0, 0, { color: G });
  part('goldglass', 99, 12, 30, 0, 138, 0, { color: G });
  part('silver', 99, 1.2, 31, 0, 150, 0, { tile: false });
  part('silver', 99, 1.4, 31, 0, 137, 0, { tile: false });
  part('silver', 1.2, 150, 29, -40.2, 0, 0, { tile: false });
  part('silver', 1.2, 150, 29, 40.2, 0, 0, { tile: false });
  part('stone', 24, 2, 38, -45, 0, 0, { tile: false, color: [0.85, 0.8, 0.7] });
  part('stone', 24, 2, 38, 45, 0, 0, { tile: false, color: [0.85, 0.8, 0.7] });
  for (const sx of [-45, 45]) { const [px, pz] = P(sx, 0); ctx.colliders.addOBB(px, pz, 7, 16, -face); }
}

// ── Museum of the Future — elliptical steel ring on a mound ───
export function buildMuseum(ctx, x, z, face = 0) {
  const outer = new THREE.Shape();
  outer.absellipse(0, 0, 44, 62, 0, Math.PI * 2, false, 0);
  const hole = new THREE.Path();
  hole.absellipse(-2, -8, 17, 40, 0, Math.PI * 2, true, 0);
  outer.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(outer, {
    depth: 52, bevelEnabled: true, bevelThickness: 5, bevelSize: 4, bevelSegments: 4, curveSegments: 56,
  });
  geo.translate(0, 0, -26);
  const p = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) { // polar mapping: lines run around the ring
    const ex = p.getX(i) / 44, ey = p.getY(i) / 62;
    uv.setXY(i, (Math.atan2(ey, ex) / (Math.PI * 2) + 0.5) * 3, Math.min(1, Math.hypot(ex, ey)) * 1.0);
  }

  // calligraphy: dark cut-outs in white steel that glow at night
  const strokes = (g, w, h, col, bg) => {
    const R = mulberry32(77);
    if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
    g.strokeStyle = col; g.lineCap = 'round'; g.lineJoin = 'round';
    const rows = 26;
    for (let r = 0; r < rows; r++) {
      const y = ((r + 0.5) / rows) * h;
      let x = -10;
      while (x < w + 10) {
        const run = 30 + R() * 130;
        g.lineWidth = 4 + R() * 6;
        g.beginPath(); g.moveTo(x, y);
        const k = 3 + Math.floor(R() * 3);
        for (let i = 1; i <= k; i++) {
          const nx = x + (run * i) / k, amp = 5 + R() * 9;
          g.quadraticCurveTo(x + (run * (i - 0.5)) / k, y + (R() < 0.5 ? -amp : amp), nx, y + (R() - 0.5) * 4);
        }
        g.stroke();
        if (R() < 0.35) { g.beginPath(); g.arc(x + run * 0.5, y - 14, 2.5, 0, 7); g.fillStyle = col; g.fill(); }
        x += run + 14 + R() * 26;
      }
    }
  };
  const emi = makeLabelTexture((g, w, h) => strokes(g, w, h, '#fff', '#000'), 1024, 1024);
  const albedo = makeLabelTexture((g, w, h) => strokes(g, w, h, '#1c2026', '#e9edf0'), 1024, 1024);
  albedo.wrapS = THREE.RepeatWrapping;
  const mat = new THREE.MeshStandardMaterial({
    map: albedo, color: 0xffffff, roughness: 0.32, metalness: 0.45, envMapIntensity: 1.2,
    emissive: 0xa8ffe6, emissiveMap: emi, emissiveIntensity: 0.0,
  });
  emi.wrapS = THREE.RepeatWrapping;
  ctx.envMats.push(mat);
  const ring = new THREE.Mesh(geo, mat);
  ring.position.set(x, 78, z);
  ring.rotation.y = face;
  ring.castShadow = ring.receiveShadow = true;
  ctx.scene.add(ring);

  const mound = new THREE.Mesh(
    new THREE.SphereGeometry(78, 40, 16),
    new THREE.MeshStandardMaterial({ color: 0x5f8a4a, roughness: 1 })
  );
  mound.scale.set(1, 0.2, 0.9);
  mound.position.set(x, 0, z);
  mound.receiveShadow = true;
  ctx.scene.add(mound);
  ctx.colliders.addCircle(x, z, 58);
  ctx.updaters.push((t, night) => { mat.emissiveIntensity = 0.15 + night * 2.2; });
}

// ── Cayan Tower — 90° twist over 75 floors ────────────────────
export function buildCayan(ctx, x, z) {
  const { B } = ctx;
  const N = 75, fh = 4.08;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    B.box('glass', 44, fh + 0.05, 30, x, i * fh, z, { ry: t * Math.PI / 2, color: TEAL });
  }
  B.box('glass', 14, 20, 14, x, N * fh, z, { color: TEAL });
  ctx.colliders.addCircle(x, z, 30);
}

// ── Atlantis The Palm — twin wings and a grand arch ───────────
export function buildAtlantis(ctx, x, z) {
  const { B } = ctx;
  // local frame: wings separated along local x, front faces +x(world) -> rotate with ry
  const place = (lx, lz) => [x + lz, z - lx]; // ry = π/2 maps local x→-z, local z→+x
  for (const s of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      const [px, pz] = place(s * 52, 0);
      B.box('stone', 48 - k * 6, 26, 52 - k * 4, px, k * 26, pz, { ry: Math.PI / 2, color: k % 2 ? SAND : PINK });
    }
    ctx.colliders.addBox(...(() => { const [px, pz] = place(s * 52, 0); return [px - 28, pz - 26, px + 28, pz + 26]; })());
  }
  // arch spanning the wings (torus half-ring in the world z–y plane)
  const arch = new THREE.Mesh(
    new THREE.TorusGeometry(52, 8, 10, 32, Math.PI),
    new THREE.MeshStandardMaterial({ color: 0xe6b595, roughness: 0.8 })
  );
  arch.rotation.y = Math.PI / 2;
  arch.position.set(...(() => { const [px, pz] = place(0, 0); return [px, 96, pz]; })());
  arch.castShadow = true;
  ctx.scene.add(arch);
  // sea-facing crown
  const [cx, cz] = place(0, 0);
  B.box('stone', 38, 14, 38, cx, 140, cz, { ry: Math.PI / 2, color: SAND });
}

// ── Emirates Towers — twin triangular-crowned towers ──────────
export function buildEmiratesTowers(ctx, x, z) {
  const { B } = ctx;
  B.cyl('glass', 30, 30, 305, 3, x, 0, z, { color: SILVER });
  B.cyl('glass', 1, 30, 52, 3, x, 305, z, { color: SILVER });
  B.cyl('glass', 24, 24, 230, 3, x + 15, 0, z + 100, { color: SILVER });
  B.cyl('glass', 1, 24, 36, 3, x + 15, 230, z + 100, { color: SILVER });
  ctx.colliders.addCircle(x, z, 26);
  ctx.colliders.addCircle(x + 15, z + 100, 22);
}
