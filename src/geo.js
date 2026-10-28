// Streams real OpenStreetMap-derived chunks (roads, buildings, parks, rail) around the player.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Colliders, mulberry32, clamp, roadTexture, makeGroundTexture } from './util.js';
import { makeTrafficCarGeometry } from './car.js';

const TEX_W = 24, TEX_H = 64;
const ROAD_Y = [0.12, 0.11, 0.1, 0.09, 0.08, 0.115, 0.07];   // by road class; layer adds more
const glassTints = [[0.62, 0.78, 0.95], [0.5, 0.78, 0.82], [0.85, 0.9, 0.95], [0.9, 0.78, 0.6], [0.5, 0.6, 0.78], [0.95, 0.95, 0.97]];
const sandTints = [[0.85, 0.72, 0.52], [0.8, 0.66, 0.46], [0.92, 0.84, 0.7], [0.75, 0.6, 0.4], [0.9, 0.88, 0.82]];
const hash = (n) => { n = (n ^ 61) ^ (n >>> 16); n = (n + (n << 3)) | 0; n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); n ^= n >>> 15; return (n >>> 0) / 4294967296; };

// ── mask / meta loading ──────────────────────────────────────
export async function loadGeo() {
  const meta = await (await fetch('/data/meta.json')).json();
  const img = new Image();
  img.src = '/data/land.png';
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const land = new Uint8Array(c.width * c.height);
  for (let i = 0; i < land.length; i++) land[i] = d[i * 4] > 127 ? 1 : 0;
  return { meta, land, maskCanvas: c };
}

// ── geometry accumulators ───────────────────────────────────
class Acc {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.col = []; this.idx = []; }
  get n() { return this.pos.length / 3; }
  build(extra) {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.col.length) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.idx.length) g.setIndex(this.idx);
    return g;
  }
}

// ribbon along polyline p (flat [x,z,...]); off = lateral offset (+ = right of travel)
function ribbon(acc, p, halfW, off, y, vScale, hs) {
  const n = p.length / 2;
  if (n < 2) return;
  const base = acc.n;
  const nx = [], nz = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = p[i * 2 + 2] - p[i * 2], dz = p[i * 2 + 3] - p[i * 2 + 1], l = Math.hypot(dx, dz) || 1;
    nx.push(-dz / l); nz.push(dx / l);
  }
  let cum = 0;
  for (let i = 0; i < n; i++) {
    let mx, mz, sc = 1;
    if (i === 0) { mx = nx[0]; mz = nz[0]; }
    else if (i === n - 1) { mx = nx[n - 2]; mz = nz[n - 2]; }
    else {
      mx = nx[i - 1] + nx[i]; mz = nz[i - 1] + nz[i];
      const l = Math.hypot(mx, mz) || 1; mx /= l; mz /= l;
      sc = Math.min(2.2, 1 / Math.max(0.45, mx * nx[i] + mz * nz[i]));
    }
    const cx = p[i * 2] + mx * off, cz = p[i * 2 + 1] + mz * off;
    if (i > 0) cum += Math.hypot(p[i * 2] - p[i * 2 - 2], p[i * 2 + 1] - p[i * 2 - 1]);
    const v = cum / vScale;
    const yy = hs ? Math.max(0.03, y + hs[i]) : y;
    acc.pos.push(cx - mx * sc * halfW, yy, cz - mz * sc * halfW, cx + mx * sc * halfW, yy, cz + mz * sc * halfW);
    acc.nor.push(0, 1, 0, 0, 1, 0);
    acc.uv.push(0, v, 1, v);
  }
  for (let i = 0; i < n - 1; i++) {
    const a = base + i * 2, c = a + 2;
    acc.idx.push(a, a + 1, c, a + 1, c + 1, c);
  }
}

// vertical strip along a polyline at lateral offset off, from yA to yB above the road surface
function wall(acc, p, hs, off, yA, yB, y, minY = 0.03, from = 0) {
  const n = p.length / 2;
  for (let i = 0; i < n - 1; i++) {
    if (hs && Math.min(hs[i], hs[i + 1]) < from) continue;
    const dx = p[i * 2 + 2] - p[i * 2], dz = p[i * 2 + 3] - p[i * 2 + 1], l = Math.hypot(dx, dz);
    if (l < 0.05) continue;
    const rx = -dz / l, rz = dx / l, sg = Math.sign(off) || 1;
    const ax = p[i * 2] + rx * off, az = p[i * 2 + 1] + rz * off, bx = p[i * 2 + 2] + rx * off, bz = p[i * 2 + 3] + rz * off;
    const ha = hs ? hs[i] : 0, hb = hs ? hs[i + 1] : 0;
    const base = acc.n;
    acc.pos.push(ax, Math.max(minY, y + ha + yA), az, bx, Math.max(minY, y + hb + yA), bz, bx, y + hb + yB, bz, ax, y + ha + yB, az);
    for (let k = 0; k < 4; k++) acc.nor.push(rx * sg, 0, rz * sg);
    acc.uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    acc.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

function disc(acc, x, z, r, y, seg = 14) {
  const base = acc.n;
  acc.pos.push(x, y, z); acc.nor.push(0, 1, 0); acc.uv.push(0.5, 0.5);
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    acc.pos.push(x + Math.cos(a) * r, y, z + Math.sin(a) * r); acc.nor.push(0, 1, 0); acc.uv.push(0.5, 0.5);
  }
  for (let i = 0; i < seg; i++) acc.idx.push(base, base + 1 + ((i + 1) % seg), base + 1 + i);
}

function triangulate(poly) { // poly: [[x,z],...] → index triples
  try {
    const tri = THREE.ShapeUtils.triangulateShape(poly.map(([x, z]) => new THREE.Vector2(x, z)), []);
    return tri;
  } catch (e) { return []; }
}

function flatPolygon(acc, poly, y, color) {
  const base = acc.n;
  for (const [x, z] of poly) { acc.pos.push(x, y, z); acc.nor.push(0, 1, 0); acc.uv.push(0.003, 0.003); acc.col.push(...color); }
  for (const t of triangulate(poly)) {
    const [a, b, c] = t;
    const ax = poly[b][0] - poly[a][0], az = poly[b][1] - poly[a][1], bx = poly[c][0] - poly[a][0], bz = poly[c][1] - poly[a][1];
    const ny = az * bx - ax * bz;
    if (ny >= 0) acc.idx.push(base + a, base + b, base + c); else acc.idx.push(base + a, base + c, base + b);
  }
}

// extruded prism with outward walls (windows UV-tiled) and a roof
function prism(acc, poly, y0, y1, color, uOff, vOff, roofColor) {
  const n = poly.length, H = y1 - y0;
  let along = 0;
  for (let i = 0; i < n; i++) {
    const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % n];
    const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz);
    if (l < 0.25) continue;
    const nx = dz / l, nz = -dx / l;
    const u0 = along / TEX_W + uOff, u1 = (along + l) / TEX_W + uOff;
    const v0 = vOff + y0 / TEX_H, v1 = v0 + H / TEX_H;
    const base = acc.n;
    acc.pos.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az);
    for (let k = 0; k < 4; k++) { acc.nor.push(nx, 0, nz); acc.col.push(...color); }
    acc.uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    acc.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    along += l;
  }
  flatPolygon(acc, poly, y1, roofColor || color);
}

function obbOf(poly) {
  let bi = 0, bl = 0;
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length];
    const l = Math.hypot(bx - ax, bz - az);
    if (l > bl) { bl = l; bi = i; }
  }
  const [ax, az] = poly[bi], [bx, bz] = poly[(bi + 1) % poly.length];
  const ang = Math.atan2(bz - az, bx - ax), c = Math.cos(ang), s = Math.sin(ang);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of poly) {
    const lx = x * c + z * s, lz = -x * s + z * c;
    x0 = Math.min(x0, lx); x1 = Math.max(x1, lx); z0 = Math.min(z0, lz); z1 = Math.max(z1, lz);
  }
  const lcx = (x0 + x1) / 2, lcz = (z0 + z1) / 2;
  return { cx: lcx * c - lcz * s, cz: lcx * s + lcz * c, hx: (x1 - x0) / 2, hz: (z1 - z0) / 2, ang, area: (x1 - x0) * (z1 - z0) };
}
const polyArea = (p) => { let a = 0; for (let i = 0; i < p.length; i++) { const j = (i + 1) % p.length; a += p[i][0] * p[j][1] - p[j][0] * p[i][1]; } return Math.abs(a / 2); };

// ──────────────────────────────────────────────────────────────
export function createGeoStreamer({ scene, geo, mats, palmGeo, landmarks, updaters }) {
  const { meta } = geo;
  const CH = meta.chunk;
  const loaded = new Map();       // key -> chunk record
  const pending = new Set();
  const failed = new Set();
  const have = new Set(meta.chunks);
  const root = new THREE.Group();
  scene.add(root);
  const parkMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide });
  const pave = makeGroundTexture('#b3ada1', 0.22, 9, 128);
  const walkMat = new THREE.MeshStandardMaterial({ map: pave, color: 0xcfc8ba, roughness: 0.95, side: THREE.DoubleSide });
  const curbMat = new THREE.MeshStandardMaterial({ color: 0xd9d6cf, roughness: 0.8, side: THREE.DoubleSide });
  const patchMat = new THREE.MeshStandardMaterial({ color: 0x4b4d53, roughness: 0.92, side: THREE.DoubleSide });
  const concrete = new THREE.MeshStandardMaterial({ color: 0xbab6ad, roughness: 0.85 });
  const deckMat = new THREE.MeshStandardMaterial({ color: 0xaaa69d, roughness: 0.9, side: THREE.DoubleSide });
  const lampPoleG = new THREE.CylinderGeometry(0.14, 0.24, 11, 8); lampPoleG.translate(0, 5.5, 0);
  const lampArm = new THREE.BoxGeometry(0.16, 0.16, 3.2); lampArm.translate(0, 10.9, 1.5);
  const lampHd = new THREE.BoxGeometry(0.7, 0.22, 1.5); lampHd.translate(0, 10.75, 3.0);
  const lampHeadG = mergeGeometries([lampArm, lampHd]);
  const lampPoleMat = new THREE.MeshStandardMaterial({ color: 0x70767b, roughness: 0.5, metalness: 0.7 });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
  updaters.push((t, night) => lampMat.color.setRGB(0.16, 0.16, 0.16).lerp(new THREE.Color(3.2, 2.2, 1.0), clamp(night * 1.4, 0, 1)));
  const palmMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });

  const lmList = Object.values(landmarks);
  const nearLandmark = (x, z, extra = 0) => lmList.some((l) => Math.hypot(x - l.x, z - l.z) < l.r + extra);

  function build(key, data, ring) {
    const [cx, cz] = key.split('_').map(Number);
    const rng = mulberry32(cx * 7919 + cz * 104729 + 17);
    const group = new THREE.Group();
    const cols = new Colliders(32);
    const rec = { key, group, cols, ring, detail: ring <= 2, traffic: [], roads: data.roads, geos: [], inst: [] };

    // ---- roads, sidewalks, junctions
    const roadAcc = new Map();       // texture key -> Acc
    const walkAcc = new Acc(), curbAcc = new Acc(), patchAcc = new Acc();
    const nodes = new Map();
    const segGrid = new Map();
    const addSegToGrid = (ax, az, bx, bz, hw) => {
      const mx = Math.floor((ax + bx) / 2 / 40), mz = Math.floor((az + bz) / 2 / 40);
      for (let i = mx - 1; i <= mx + 1; i++) for (let j = mz - 1; j <= mz + 1; j++) {
        const k = i * 100003 + j; let a = segGrid.get(k); if (!a) segGrid.set(k, (a = [])); a.push([ax, az, bx, bz, hw]);
      }
    };
    const deckAcc = new Acc(), pilGeos = [], hGrid = new Map();
    const addH = (ax, az, bx, bz, ha, hb, hw) => {
      const mx = Math.floor((ax + bx) / 2 / 40), mz = Math.floor((az + bz) / 2 / 40);
      for (let i = mx - 1; i <= mx + 1; i++) for (let j = mz - 1; j <= mz + 1; j++) {
        const k = i * 100003 + j; let a = hGrid.get(k); if (!a) hGrid.set(k, (a = [])); a.push([ax, az, bx, bz, ha, hb, hw]);
      }
    };
    for (const r of data.roads) {
      const lanes = Math.max(1, Math.round(r.w / 3.5));
      const tk = `${lanes}${r.o ? 'o' : 't'}`;
      let acc = roadAcc.get(tk); if (!acc) roadAcc.set(tk, (acc = new Acc()));
      const hs = r.h || null;
      const maxH = hs ? Math.max(...hs) : 0;
      const y = ROAD_Y[r.k] + (hs ? r.l * 0.02 : r.l * 0.16);
      r.maxH = maxH;
      ribbon(acc, r.p, r.w / 2, 0, y, 24, hs);
      if (rec.detail && r.k <= 4 && maxH < 0.3) {
        ribbon(walkAcc, r.p, 1.9, r.w / 2 + 2.0, 0.03, 4); ribbon(walkAcc, r.p, 1.9, -(r.w / 2 + 2.0), 0.03, 4);
        ribbon(curbAcc, r.p, 0.3, r.w / 2 + 0.2, 0.035, 8); ribbon(curbAcc, r.p, 0.3, -(r.w / 2 + 0.2), 0.035, 8);
      }
      if (hs && maxH > 0.3) {
        // flyover structure: slab underside, girder sides, parapets, columns
        const hw = r.w / 2 + 0.3;
        ribbon(deckAcc, r.p, hw, 0, y - 1.15, 24, hs);
        for (const side of [-1, 1]) {
          wall(deckAcc, r.p, hs, side * hw, -1.15, 0.0, y, 0.03, 0.3);
          wall(deckAcc, r.p, hs, side * (r.w / 2 + 0.15), 0.0, 0.95, y, 0.03, 1.0);
          if (maxH > 1.0) ribbon(deckAcc, r.p, 0.22, side * (r.w / 2 + 0.15), y + 0.95, 6, hs);
        }
        let acc2 = 14;
        for (let i = 0; i + 3 < r.p.length; i += 2) {
          const ax = r.p[i], az = r.p[i + 1], bx = r.p[i + 2], bz = r.p[i + 3], ha = hs[i / 2], hb = hs[i / 2 + 1];
          const l = Math.hypot(bx - ax, bz - az); if (l < 0.5) continue;
          addH(ax, az, bx, bz, ha, hb, r.w / 2);
          if (Math.min(ha, hb) > 1.0) { // parapet colliders on the deck level
            const rx = -(bz - az) / l, rz = (bx - ax) / l, ang = Math.atan2(bz - az, bx - ax), yc = (ha + hb) / 2;
            for (const side of [-1, 1]) cols.addOBB((ax + bx) / 2 + rx * side * (r.w / 2 + 0.15), (az + bz) / 2 + rz * side * (r.w / 2 + 0.15), l / 2 + 0.2, 0.3, ang, yc);
          }
          acc2 += l;
          if (acc2 > 34 && Math.min(ha, hb) > 2.5) {
            acc2 = 0;
            const hh = hb - 1.15;
            const pg = new THREE.BoxGeometry(2.4, hh, 2.4); pg.translate(bx, hh / 2, bz); pilGeos.push(pg);
            cols.addCircle(bx, bz, 1.7);
          }
        }
      }
      for (let i = 0; i < r.p.length; i += 2) {
        const nk = `${Math.round(r.p[i] * 2)},${Math.round(r.p[i + 1] * 2)}`;
        const ny = y + (hs ? hs[i / 2] : 0);
        let e = nodes.get(nk); if (!e) nodes.set(nk, (e = { x: r.p[i], z: r.p[i + 1], ids: new Set(), w: 0, y: 0 }));
        e.ids.add(r.id); e.w = Math.max(e.w, r.w); e.y = Math.max(e.y, ny);
        if (i > 0) addSegToGrid(r.p[i - 2], r.p[i - 1], r.p[i], r.p[i + 1], r.w / 2);
      }
    }
    rec.hGrid = hGrid;
    for (const e of nodes.values()) if (e.ids.size >= 2) disc(patchAcc, e.x, e.z, e.w * 0.52, e.y + 0.012);
    const mk = (acc, mat, shadow = false) => {
      const g = acc.build(); if (!g) return;
      const m = new THREE.Mesh(g, mat); m.receiveShadow = true; m.castShadow = shadow; group.add(m); rec.geos.push(g);
    };
    for (const [tk, acc] of roadAcc) {
      const lanes = parseInt(tk, 10), mat = roadMatCache(lanes, tk.endsWith('o'));
      mk(acc, mat);
    }
    mk(walkAcc, walkMat); mk(curbAcc, curbMat); mk(patchAcc, patchMat);
    if (deckAcc.n) mk(deckAcc, deckMat, true);
    if (pilGeos.length) { const g = mergeGeometries(pilGeos); const m = new THREE.Mesh(g, concrete); m.castShadow = m.receiveShadow = true; group.add(m); rec.geos.push(g); }

    const nearRoad = (x, z, pad) => {
      const a = segGrid.get(Math.floor(x / 40) * 100003 + Math.floor(z / 40));
      if (!a) return false;
      for (const [ax, az, bx, bz, hw] of a) {
        const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
        const t = l2 ? clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1) : 0;
        if (Math.hypot(x - (ax + dx * t), z - (az + dz * t)) < hw + pad) return true;
      }
      return false;
    };

    // ---- buildings
    const bAcc = { glass: new Acc(), ribbon: new Acc(), tower: new Acc(), stone: new Acc() };
    for (const b of data.buildings) {
      const poly = []; for (let i = 0; i < b.p.length; i += 2) poly.push([b.p[i], b.p[i + 1]]);
      const mxx = poly.reduce((s, q) => s + q[0], 0) / poly.length, mzz = poly.reduce((s, q) => s + q[1], 0) / poly.length;
      if (nearLandmark(mxx, mzz)) continue;
      const r1 = hash(b.id | 0), r2 = hash((b.id | 0) + 99), r3 = hash((b.id | 0) + 7);
      const distC = Math.hypot(mxx, mzz);
      let h = b.h;
      if (!h) {
        if (b.a < 120) h = 3.6 + r1 * 4;
        else if (b.a < 700) h = 7 + r1 * 22;
        else if (b.a < 2500) h = 18 + r1 * 55;
        else h = 40 + r1 * 100;
        if (b.a > 400 && distC < 4500) h *= 1 + (1 - distC / 4500) * 0.9;
      }
      h = Math.min(h, 480);
      if (!rec.detail && h < 35 && b.a < 1500) continue;
      const tall = h >= 42;
      const key = tall ? (r2 < 0.5 ? 'glass' : r2 < 0.8 ? 'ribbon' : 'tower') : 'stone';
      const tint = tall ? glassTints[Math.floor(r3 * glassTints.length)] : sandTints[Math.floor(r3 * sandTints.length)];
      const uOff = r1, vOff = Math.floor(r2 * 16) / 16;
      const acc = bAcc[key];
      if (h > 110 && poly.length <= 12) { // setback crown
        const sc = 0.8, cx0 = mxx, cz0 = mzz;
        prism(acc, poly, 0, h * 0.78, tint, uOff, vOff, [0.5, 0.52, 0.55]);
        prism(acc, poly.map(([x, z]) => [cx0 + (x - cx0) * sc, cz0 + (z - cz0) * sc]), h * 0.78, h, tint, uOff, vOff, [0.5, 0.52, 0.55]);
      } else prism(acc, poly, 0, h, tint, uOff, vOff, tall ? [0.5, 0.52, 0.55] : [0.88, 0.85, 0.8]);
      // collision
      const ob = obbOf(poly);
      if (ob.area > polyArea(poly) * 1.7 && poly.length >= 5) {
        for (let i = 0; i < poly.length; i++) {
          const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length];
          const l = Math.hypot(bx - ax, bz - az); if (l < 0.5) continue;
          cols.addOBB((ax + bx) / 2, (az + bz) / 2, l / 2 + 0.3, 0.7, Math.atan2(bz - az, bx - ax));
        }
      } else cols.addOBB(ob.cx, ob.cz, Math.max(0.5, ob.hx), Math.max(0.5, ob.hz), ob.ang);
    }
    for (const k of Object.keys(bAcc)) {
      const g = bAcc[k].build(); if (!g) continue;
      const m = new THREE.Mesh(g, mats[k]); m.castShadow = rec.ring <= 1; m.receiveShadow = true; group.add(m); rec.geos.push(g);
    }

    // ---- parks / green
    if (rec.detail && data.parks.length) {
      const pa = new Acc();
      for (const pk of data.parks) {
        const poly = []; for (let i = 0; i < pk.p.length; i += 2) poly.push([pk.p[i], pk.p[i + 1]]);
        if (poly.length < 3) continue;
        const c = pk.t === 'pitch' ? [0.1, 0.32, 0.12] : pk.t === 'golf_course' ? [0.12, 0.3, 0.1] : [0.1, 0.24, 0.07];
        flatPolygon(pa, poly, 0.02, c);
      }
      mk(pa, parkMat);
    }

    // ---- rail (Dubai Metro viaduct) + stations
    if (data.rails.length) {
      const deckG = [], pilG = [];
      for (const r of data.rails) {
        const elevated = r.b || r.k === 'subway' || r.k === 'light_rail';
        const Y0 = elevated ? 9 : 0;
        let acc = 0;
        for (let i = 0; i + 3 < r.p.length; i += 2) {
          const ax = r.p[i], az = r.p[i + 1], bx = r.p[i + 2], bz = r.p[i + 3];
          const l = Math.hypot(bx - ax, bz - az); if (l < 0.5) continue;
          const g = new THREE.BoxGeometry(elevated ? 8 : 2.4, elevated ? 1.5 : 0.25, l + 0.3);
          g.rotateY(Math.atan2(bx - ax, bz - az)); g.translate((ax + bx) / 2, Y0 + (elevated ? 0.75 : 0.12), (az + bz) / 2);
          deckG.push(g);
          acc += l;
          if (elevated && acc > 30) {
            acc = 0;
            const pg = new THREE.BoxGeometry(2.6, Y0, 2.6); pg.translate(bx, Y0 / 2, bz); pilG.push(pg);
            cols.addCircle(bx, bz, 1.9);
          }
        }
      }
      if (deckG.length) { const g = mergeGeometries(deckG); const m = new THREE.Mesh(g, concrete); m.castShadow = m.receiveShadow = true; group.add(m); rec.geos.push(g); }
      if (pilG.length) { const g = mergeGeometries(pilG); const m = new THREE.Mesh(g, concrete); m.castShadow = true; group.add(m); rec.geos.push(g); }
    }
    for (const [sx, sz] of data.stations) {
      const roof = new THREE.Mesh(new THREE.BoxGeometry(18, 0.6, 76), new THREE.MeshStandardMaterial({ color: 0x9fd3ea, roughness: 0.1, metalness: 0.6, transparent: true, opacity: 0.6 }));
      roof.position.set(sx, 15.5, sz); group.add(roof); rec.geos.push(roof.geometry);
    }

    // ---- roadside props: palms and lamps
    if (rec.detail) {
      const palms = [], lamps = [];
      for (const r of data.roads) {
        if (r.k > 3 || r.b || r.maxH > 0.3) continue;
        let acc = 20, next = 20 + rng() * 10;
        for (let i = 0; i + 3 < r.p.length; i += 2) {
          const ax = r.p[i], az = r.p[i + 1], bx = r.p[i + 2], bz = r.p[i + 3];
          const l = Math.hypot(bx - ax, bz - az); if (l < 1) continue;
          const ux = (bx - ax) / l, uz = (bz - az) / l, rx = -uz, rz = ux;
          while (acc < l) {
            const px = ax + ux * acc, pz = az + uz * acc;
            for (const side of [-1, 1]) {
              const o = r.w / 2 + 6.5;
              const qx = px + rx * side * o, qz = pz + rz * side * o;
              if (nearRoad(qx, qz, 3) || cols.test(qx, qz, 2.5)) continue;
              if (rng() < 0.75) palms.push([qx, qz]);
            }
            if (r.k <= 3 && rng() < 0.55) {
              const side = rng() < 0.5 ? -1 : 1, o = r.w / 2 + 2.8;
              const qx = px + rx * side * o, qz = pz + rz * side * o;
              if (!nearRoad(qx, qz, 1.5) && !cols.test(qx, qz, 1.5)) lamps.push([qx, qz, Math.atan2(-rx * side, -rz * side)]);
            }
            acc += 30 + rng() * 14;
          }
          acc -= l;
        }
      }
      const d = new THREE.Object3D();
      if (palms.length) {
        const im = new THREE.InstancedMesh(palmGeo, palmMat, palms.length);
        palms.forEach((p, i) => {
          const s = 0.85 + rng() * 0.55;
          d.position.set(p[0], 0, p[1]); d.rotation.set(0, rng() * 6.28, 0); d.scale.set(s, s * (0.9 + rng() * 0.35), s); d.updateMatrix();
          im.setMatrixAt(i, d.matrix); cols.addCircle(p[0], p[1], 0.6 * s);
        });
        im.castShadow = rec.ring <= 1; group.add(im); rec.inst.push(im);
      }
      if (lamps.length) {
        const poles = new THREE.InstancedMesh(lampPoleG, lampPoleMat, lamps.length);
        const heads = new THREE.InstancedMesh(lampHeadG, lampMat, lamps.length);
        lamps.forEach((l, i) => {
          d.position.set(l[0], 0, l[1]); d.rotation.set(0, l[2], 0); d.scale.set(1, 1, 1); d.updateMatrix();
          poles.setMatrixAt(i, d.matrix); heads.setMatrixAt(i, d.matrix); cols.addCircle(l[0], l[1], 0.38);
        });
        group.add(poles, heads); rec.inst.push(poles, heads);
      }
    }

    root.add(group);
    return rec;
  }

  const matCache = new Map();
  function roadMatCache(lanes, oneway) {
    const k = `${lanes}${oneway ? 'o' : 't'}`;
    let m = matCache.get(k);
    if (!m) matCache.set(k, (m = new THREE.MeshStandardMaterial({ map: roadTexture(lanes, oneway), roughness: 0.9, side: THREE.DoubleSide })));
    return m;
  }

  function dispose(rec) {
    root.remove(rec.group);
    rec.geos.forEach((g) => g.dispose());
    rec.inst.forEach((im) => im.dispose());
  }

  const ringOf = (cx, cz, pcx, pcz) => Math.max(Math.abs(cx - pcx), Math.abs(cz - pcz));
  let busy = false;
  async function load(key, ring) {
    pending.add(key);
    try {
      const data = await (await fetch(`/data/c_${key}.json`)).json();
      const [cx, cz] = key.split('_').map(Number);
      // the player may have moved on while loading
      loaded.set(key, build(key, data, ring));
    } catch (e) { failed.add(key); console.error('chunk', key, e); }
    pending.delete(key);
  }

  const R_LOAD = 3, R_KEEP = 4;
  const api = {
    root, loaded,
    update(px, pz) {
      const pcx = Math.floor(px / CH), pcz = Math.floor(pz / CH);
      // unload far
      for (const [k, rec] of loaded) {
        const [cx, cz] = k.split('_').map(Number);
        const ring = ringOf(cx, cz, pcx, pcz);
        if (ring > R_KEEP) { dispose(rec); loaded.delete(k); }
        else if (ring <= 2 && !rec.detail && !busy) { // upgrade detail
          busy = true; dispose(rec); loaded.delete(k);
          load(k, ring).then(() => { busy = false; });
        }
      }
      if (pending.size >= 2) return;
      // nearest missing chunk first
      let best = null, bd = Infinity;
      for (let i = -R_LOAD; i <= R_LOAD; i++) for (let j = -R_LOAD; j <= R_LOAD; j++) {
        const k = `${pcx + i}_${pcz + j}`;
        if (!have.has(k) || loaded.has(k) || pending.has(k) || failed.has(k)) continue;
        const d = i * i + j * j;
        if (d < bd) { bd = d; best = [k, Math.max(Math.abs(i), Math.abs(j))]; }
      }
      if (best) load(best[0], best[1]);
    },
    async preload(px, pz, radius = 1) {
      const pcx = Math.floor(px / CH), pcz = Math.floor(pz / CH), jobs = [];
      for (let i = -radius; i <= radius; i++) for (let j = -radius; j <= radius; j++) {
        const k = `${pcx + i}_${pcz + j}`;
        if (have.has(k) && !loaded.has(k) && !pending.has(k)) jobs.push(load(k, Math.max(Math.abs(i), Math.abs(j))));
      }
      await Promise.all(jobs);
    },
    // push p out of buildings/props in nearby chunks
    resolve(p, r, y) {
      const pcx = Math.floor(p.x / CH), pcz = Math.floor(p.z / CH);
      let hit = null;
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const rec = loaded.get(`${pcx + i}_${pcz + j}`);
        if (!rec) continue;
        const h = rec.cols.resolve(p, r, y);
        if (h) hit = h;
      }
      return hit;
    },
    // surface height at (x,z): ground, or the flyover/ramp deck closest to the mover's current level
    heightAt(x, z, ref = 0) {
      const pcx = Math.floor(x / CH), pcz = Math.floor(z / CH);
      let best = 0, bd = Math.abs(ref);
      const ck = Math.floor(x / 40) * 100003 + Math.floor(z / 40);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const rec = loaded.get(`${pcx + i}_${pcz + j}`);
        const a = rec && rec.hGrid && rec.hGrid.get(ck);
        if (!a) continue;
        for (const [ax, az, bx, bz, ha, hb, hw] of a) {
          const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
          const t = l2 ? clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1) : 0;
          if (Math.hypot(x - (ax + dx * t), z - (az + dz * t)) > hw + 0.3) continue;
          const h = ha + (hb - ha) * t, d = Math.abs(h - ref);
          if (d < bd) { bd = d; best = h; }
        }
      }
      return best;
    },
    // road pieces near a point, for traffic spawning / minimap
    roadsNear(x, z, rad, maxK = 4) {
      const out = [];
      const pcx = Math.floor(x / CH), pcz = Math.floor(z / CH);
      const c = Math.ceil(rad / CH);
      for (let i = -c; i <= c; i++) for (let j = -c; j <= c; j++) {
        const rec = loaded.get(`${pcx + i}_${pcz + j}`);
        if (!rec) continue;
        for (const r of rec.roads) if (r.k <= maxK) out.push(r);
      }
      return out;
    },
  };
  return api;
}

// ── ambient traffic that follows the real road polylines ──────────────
export function createTraffic({ scene, streamer, updaters, getPlayer }) {
  const N = 70;
  const geom = makeTrafficCarGeometry();
  const mesh = new THREE.InstancedMesh(geom, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.6 }), N);
  mesh.frustumCulled = false; mesh.castShadow = false;
  const lg = [];
  const paint = (g, c) => { const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c[0]; a[i * 3 + 1] = c[1]; a[i * 3 + 2] = c[2]; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
  for (const sx of [-0.7, 0.7]) {
    const h = new THREE.BoxGeometry(0.4, 0.2, 0.1); h.translate(sx, 0.75, 2.25);
    const t = new THREE.BoxGeometry(0.4, 0.2, 0.1); t.translate(sx, 0.8, -2.25);
    lg.push(paint(h, [3, 3, 2.6]), paint(t, [3, 0.15, 0.15]));
  }
  const lights = new THREE.InstancedMesh(mergeGeometries(lg), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), N);
  lights.frustumCulled = false;
  scene.add(mesh, lights);
  const palette = [0xf2f2f2, 0xf2f2f2, 0x1c1f24, 0x7a7f86, 0xb8bcc2, 0xc22a2a, 0x234a8f, 0xe0b04a, 0x2a2d33, 0xf2f2f2];
  const rng = mulberry32(99);
  const cars = [];
  for (let i = 0; i < N; i++) {
    cars.push({ road: null, seg: 0, t: 0, dir: 1, v: 0, off: 0, x: 0, z: 0, y: 0, h: 0, vx: 0, vz: 0, active: false });
    mesh.setColorAt(i, new THREE.Color(palette[Math.floor(rng() * palette.length)]));
  }
  const hideM = new THREE.Matrix4().makeScale(0, 0, 0);
  const d = new THREE.Object3D();

  function spawn(c) {
    const pl = getPlayer();
    const roads = streamer.roadsNear(pl.x, pl.z, 1100, 3);
    if (!roads.length) { c.active = false; return; }
    for (let tries = 0; tries < 12; tries++) {
      const r = roads[Math.floor(rng() * roads.length)];
      const nSeg = r.p.length / 2 - 1; if (nSeg < 1) continue;
      const seg = Math.floor(rng() * nSeg);
      const x = r.p[seg * 2], z = r.p[seg * 2 + 1];
      const dd = Math.hypot(x - pl.x, z - pl.z);
      if (dd < 140 || dd > 900) continue;
      const lanes = Math.max(1, Math.round(r.w / 3.5));
      c.road = r; c.seg = seg; c.t = rng();
      c.dir = r.o ? 1 : (rng() < 0.5 ? 1 : -1);
      c.off = r.o ? ((Math.floor(rng() * lanes) + 0.5) - lanes / 2) * 3.5 : r.w / 4;
      c.v = 12 + rng() * 14 + (r.k <= 1 ? 8 : 0);
      c.active = true;
      return;
    }
    c.active = false;
  }
  function step(c, dt) {
    const r = c.road, p = r.p;
    let adv = c.v * dt;
    for (;;) {
      const i = c.seg * 2;
      const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3];
      const l = Math.hypot(bx - ax, bz - az) || 1;
      const rem = c.dir > 0 ? (1 - c.t) * l : c.t * l;
      if (adv <= rem) { c.t += (c.dir * adv) / l; break; }
      adv -= rem;
      c.seg += c.dir;
      if (c.seg < 0 || c.seg >= p.length / 2 - 1) { c.active = false; return; }
      c.t = c.dir > 0 ? 0 : 1;
    }
    const i = c.seg * 2;
    const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3];
    const l = Math.hypot(bx - ax, bz - az) || 1;
    const fx = ((bx - ax) / l) * c.dir, fz = ((bz - az) / l) * c.dir;
    const rx = -fz, rz = fx; // right of travel
    c.x = ax + (bx - ax) * c.t + rx * c.off;
    c.z = az + (bz - az) * c.t + rz * c.off;
    c.h = Math.atan2(fx, fz);
    c.y = r.h ? r.h[c.seg] + (r.h[c.seg + 1] - r.h[c.seg]) * c.t : 0;
    c.vx = fx * c.v; c.vz = fz * c.v;
  }
  let spawnT = 0;
  updaters.push((t, night, dt) => {
    const pl = getPlayer();
    spawnT += dt;
    for (let i = 0; i < N; i++) {
      const c = cars[i];
      if (c.active) {
        step(c, dt);
        if (Math.hypot(c.x - pl.x, c.z - pl.z) > 1000) c.active = false;
      }
      if (!c.active) {
        if (spawnT > 0.05) { spawn(c); if (c.active) step(c, 0); }
      }
      if (c.active) { d.position.set(c.x, c.y + 0.1, c.z); d.rotation.set(0, c.h, 0); d.scale.set(1, 1, 1); d.updateMatrix(); mesh.setMatrixAt(i, d.matrix); lights.setMatrixAt(i, d.matrix); }
      else { mesh.setMatrixAt(i, hideM); lights.setMatrixAt(i, hideM); }
    }
    if (spawnT > 0.05) spawnT = 0;
    mesh.instanceMatrix.needsUpdate = true; lights.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return {
    cars,
    // push probe circle out of oriented car boxes; returns {x,z,car:{vx,vz}}
    resolve(p, r, y = 0) {
      for (const c of cars) {
        if (!c.active || Math.abs(c.y - y) > 3) continue;
        const dx = p.x - c.x, dz = p.z - c.z;
        if (Math.abs(dx) > 8 || Math.abs(dz) > 8) continue;
        const sn = Math.sin(c.h), cs = Math.cos(c.h);
        const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;       // lx along car-left, lz along car-forward
        const ex = 1.0 + r, ez = 2.45 + r;
        if (Math.abs(lx) < ex && Math.abs(lz) < ez) {
          const px = ex - Math.abs(lx), pz = ez - Math.abs(lz);
          let nlx = 0, nlz = 0, push;
          if (px < pz) { nlx = lx < 0 ? -1 : 1; push = px; } else { nlz = lz < 0 ? -1 : 1; push = pz; }
          const wx = nlx * cs + nlz * sn, wz = -nlx * sn + nlz * cs;
          p.x += wx * push; p.z += wz * push;
          return { x: wx, z: wz, car: c };
        }
      }
      return null;
    },
  };
}
