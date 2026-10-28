import * as THREE from 'three';
import { makeLabelTexture, mulberry32 } from './util.js';

const SILVER = [0.78, 0.86, 0.95];
const TEAL = [0.45, 0.72, 0.78];
const SAND = [0.93, 0.82, 0.66];
const PINK = [0.95, 0.74, 0.6];

// ── Burj Khalifa — Y-shaped, spiral setbacks, 828 m ───────────
export function buildBurjKhalifa(ctx, x, z) {
  const { B } = ctx;
  const wingTop = [560, 470, 385];
  for (let k = 0; k < 3; k++) {
    const a = (k * Math.PI * 2) / 3 + 0.5;
    for (let s = 0; s * 46 < wingTop[k]; s++) {
      const ext = 40 - s * 2.9, w = 18 - s * 1.1;
      if (ext < 7) break;
      B.box('glass', ext, 46, w, x + Math.cos(a) * ext / 2, s * 46, z + Math.sin(a) * ext / 2, { ry: -a, color: SILVER });
    }
  }
  B.cyl('glass', 11, 13, 650, 14, x, 0, z, { color: SILVER });
  B.cyl('silver', 0.5, 6, 180, 10, x, 648, z, { tile: false });
  B.cyl('stone', 52, 58, 10, 28, x, 0, z, { color: [0.85, 0.8, 0.72] });
  ctx.colliders.addCircle(x, z, 46);

  const blink = new THREE.Mesh(
    new THREE.SphereGeometry(1.6, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xff2030 })
  );
  blink.position.set(x, 830, z);
  ctx.scene.add(blink);
  ctx.updaters.push((t) => { blink.visible = Math.sin(t * 3.2) > -0.2; });

  // reflecting pool in front (south) — Dubai Fountain lake
  const lake = new THREE.Mesh(
    new THREE.PlaneGeometry(300, 130),
    new THREE.MeshStandardMaterial({ color: 0x1b6f93, roughness: 0.08, metalness: 0.4 })
  );
  lake.rotation.x = -Math.PI / 2;
  lake.position.set(x, 0.03, z + 190);
  lake.receiveShadow = true;
  ctx.scene.add(lake);
}

// ── Burj Al Arab — billowing sail on its own island ───────────
export function buildBurjAlArab(ctx, x, z) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = -Math.PI / 2 + 0.45; // sail faces the causeway, turned ~25° for a 3/4 view
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

// ── Dubai Frame — 150 m golden picture frame ──────────────────
export function buildDubaiFrame(ctx, x, z) {
  const { B } = ctx;
  B.box('gold', 8, 150, 26, x - 45, 0, z, { tile: false });
  B.box('gold', 8, 150, 26, x + 45, 0, z, { tile: false });
  B.box('gold', 98, 11, 28, x, 139, z, { tile: false });
  B.box('gold', 98, 3, 30, x, 136, z, { tile: false, color: [0.7, 0.7, 0.7] });
  // base planters
  B.box('stone', 22, 2, 36, x - 45, 0, z, { tile: false });
  B.box('stone', 22, 2, 36, x + 45, 0, z, { tile: false });
  ctx.colliders.addBox(x - 51, z - 15, x - 39, z + 15);
  ctx.colliders.addBox(x + 39, z - 15, x + 51, z + 15);
}

// ── Museum of the Future — elliptical steel ring on a mound ───
export function buildMuseum(ctx, x, z) {
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
  for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + 48) / 96, (p.getY(i) + 66) / 132);

  // glowing calligraphy-style strokes
  const R = mulberry32(77);
  const emi = makeLabelTexture((g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#fff'; g.lineCap = 'round';
    for (let i = 0; i < 26; i++) {
      g.lineWidth = 4 + R() * 9;
      const y0 = R() * h, x0 = R() * w * 0.4;
      g.beginPath();
      g.moveTo(x0, y0);
      g.bezierCurveTo(x0 + w * 0.3, y0 + (R() - 0.5) * 120, x0 + w * 0.5, y0 + (R() - 0.5) * 160, x0 + w * (0.5 + R() * 0.5), y0 + (R() - 0.5) * 80);
      g.stroke();
    }
  }, 512, 512);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xcfd6dc, roughness: 0.22, metalness: 0.95,
    emissive: 0x9fffe8, emissiveMap: emi, emissiveIntensity: 0.0,
  });
  const ring = new THREE.Mesh(geo, mat);
  ring.position.set(x, 78, z);
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
