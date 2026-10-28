import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
export const angDiff = (a, b) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

export function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Window textures ───────────────────────────────────────────
// One texture covers 8 columns x 16 rows = 24m x 64m of facade.
export const TEX_W = 24;
export const TEX_H = 64;

export function makeWindowTextures(kind) {
  const cols = 8, rows = 16, S = 32;
  const mk = () => {
    const c = document.createElement('canvas');
    c.width = cols * S; c.height = rows * S;
    return c;
  };
  const mapC = mk(), litC = mk();
  const m = mapC.getContext('2d'), l = litC.getContext('2d');
  const R = mulberry32(kind === 'glass' ? 11 : kind === 'ribbon' ? 17 : 23);
  l.fillStyle = '#000';
  l.fillRect(0, 0, litC.width, litC.height);
  const lit = (x, y, w, h) => {
    l.fillStyle = R() < 0.6 ? '#ffcf86' : R() < 0.5 ? '#fff1d0' : '#bcdcff';
    l.globalAlpha = 0.35 + R() * 0.5;
    l.fillRect(x, y, w, h);
    l.globalAlpha = 1;
  };
  if (kind === 'glass') { // curtain wall: dark reflective panes, light aluminium mullions
    m.fillStyle = '#aab4bf';
    m.fillRect(0, 0, mapC.width, mapC.height);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = c * S, y = r * S;
      const g = m.createLinearGradient(x, y, x + S, y + S);
      const t = R();
      g.addColorStop(0, `rgb(${20 + t * 14},${46 + t * 22},${72 + t * 26})`);
      g.addColorStop(1, `rgb(${10 + t * 8},${28 + t * 14},${48 + t * 18})`);
      m.fillStyle = g;
      m.fillRect(x + 2, y + 2, S - 3, S - 3);
      if (R() < 0.26) lit(x + 2, y + 2, S - 3, S - 3);
    }
  } else if (kind === 'ribbon') { // horizontal ribbon windows with spandrel bands
    m.fillStyle = '#d4d6d8';
    m.fillRect(0, 0, mapC.width, mapC.height);
    for (let r = 0; r < rows; r++) {
      const y = r * S;
      const g = m.createLinearGradient(0, y, 0, y + S);
      g.addColorStop(0, '#2f5f7d'); g.addColorStop(1, '#14303f');
      m.fillStyle = g;
      m.fillRect(0, y + 8, mapC.width, S - 8);
      m.fillStyle = 'rgba(210,225,235,0.35)';
      for (let c = 0; c < cols; c++) m.fillRect(c * S, y + 8, 1.5, S - 8);
      for (let c = 0; c < cols; c++) if (R() < 0.3) lit(c * S + 1, y + 9, S - 2, S - 10);
    }
  } else if (kind === 'tower') { // silver fins, narrow blue panes, spandrel bands (Burj-style cladding)
    m.fillStyle = '#cdd6df';
    m.fillRect(0, 0, mapC.width, mapC.height);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = c * S, y = r * S;
      const g = m.createLinearGradient(x, y, x, y + S);
      g.addColorStop(0, '#6f9bbd'); g.addColorStop(1, '#3a6183');
      m.fillStyle = g;
      m.fillRect(x + 8, y + 3, S - 16, S - 6);
      if (r % 4 === 3) { m.fillStyle = '#f0f4f8'; m.fillRect(x, y + S - 5, S, 5); }
      if (R() < 0.3) lit(x + 8, y + 3, S - 16, S - 6);
    }
  } else if (kind === 'gold') { // bronze-gold glass with dark vertical window strips
    m.fillStyle = '#d4a845';
    m.fillRect(0, 0, mapC.width, mapC.height);
    for (let c = 0; c < cols; c++) {
      const g = m.createLinearGradient(0, 0, 0, mapC.height);
      g.addColorStop(0, '#5a4216'); g.addColorStop(0.5, '#3a2a0c'); g.addColorStop(1, '#5a4216');
      m.fillStyle = g;
      m.fillRect(c * S + 9, 0, 14, mapC.height);
      m.fillStyle = 'rgba(255,235,170,0.22)';
      for (let r = 0; r < rows; r++) m.fillRect(c * S, r * S, S, 1.5);
    }
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (R() < 0.35) lit(c * S + 9, r * S + 2, 14, S - 4);
  } else { // residential stone with recessed windows and balcony lines
    m.fillStyle = '#e1cfaf';
    m.fillRect(0, 0, mapC.width, mapC.height);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = c * S, y = r * S;
      m.fillStyle = '#c9b48f';
      m.fillRect(x, y + S - 5, S, 5);               // balcony slab
      m.fillStyle = R() < 0.5 ? '#3d4b5c' : '#566878';
      m.fillRect(x + 7, y + 6, S - 14, S - 14);
      m.fillStyle = 'rgba(0,0,0,0.25)';
      m.fillRect(x + 7, y + 6, S - 14, 3);
      if (R() < 0.3) lit(x + 7, y + 6, S - 14, S - 14);
    }
  }
  const tex = (c) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };
  return { map: tex(mapC), lit: tex(litC) };
}

// Tileable noisy ground texture (sand, concrete…).
export function makeGroundTexture(base, vary, seed = 3, size = 256, streaks = false) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const R = mulberry32(seed);
  g.fillStyle = base; g.fillRect(0, 0, size, size);
  for (let i = 0; i < size * size * 0.35; i++) {
    const v = (R() - 0.5) * vary;
    g.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`;
    g.fillRect(R() * size, R() * size, 1 + R() * 2, 1 + R() * 2);
  }
  if (streaks) { // wind ripples
    for (let i = 0; i < 40; i++) {
      g.strokeStyle = `rgba(0,0,0,${0.03 + R() * 0.05})`; g.lineWidth = 1 + R() * 2;
      const y = R() * size, a = R() * 6;
      g.beginPath();
      for (let x = 0; x <= size; x += 8) g.lineTo(x, y + Math.sin(x * 0.05 + a) * 4);
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const _roadCache = new Map();
export function roadTexture(lanes, oneway) {
  lanes = Math.max(1, Math.min(8, lanes));
  const key = `${lanes}${oneway ? 'o' : 't'}`;
  if (_roadCache.has(key)) return _roadCache.get(key);
  const LW = 112, W = lanes * LW, H = 512;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#4b4d53'; g.fillRect(0, 0, W, H);
  const R = mulberry32(lanes * 7 + (oneway ? 1 : 2));
  for (let i = 0; i < 9000; i++) { const v = 62 + Math.floor(R() * 28); g.fillStyle = `rgb(${v},${v + 1},${v + 3})`; g.fillRect(R() * W, R() * H, 2, 2); }
  for (let l = 0; l < lanes; l++) { // tyre-wear darkening in each lane
    for (const o of [0.3, 0.7]) { g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(l * LW + LW * o - 9, 0, 18, H); }
  }
  const line = (x, w, col, dash) => {
    g.fillStyle = col;
    if (!dash) { g.fillRect(x - w / 2, 0, w, H); return; }
    for (let y = 0; y < H; y += 256) g.fillRect(x - w / 2, y, w, 128);
  };
  line(7, 8, '#ececec'); line(W - 7, 8, '#ececec');
  if (oneway) { for (let l = 1; l < lanes; l++) line(l * LW, 6, '#ececec', true); }
  else if (lanes === 2) line(W / 2, 6, '#ececec', true);
  else {
    line(W / 2 - 6, 5, '#f2c230'); line(W / 2 + 6, 5, '#f2c230');
    for (let l = 1; l < lanes / 2; l++) { line(l * LW, 6, '#ececec', true); line(W - l * LW, 6, '#ececec', true); }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  _roadCache.set(key, t);
  return t;
}

export function makeRoadTexture(kind) {
  const W = kind === 'r2' ? 256 : kind === 'r4' ? 512 : 1024;
  const H = 512;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#2c2e33';
  g.fillRect(0, 0, W, H);
  const R = mulberry32(5);
  for (let i = 0; i < 9000; i++) {
    const v = 34 + Math.floor(R() * 30);
    g.fillStyle = `rgb(${v},${v + 1},${v + 4})`;
    g.fillRect(R() * W, R() * H, 2, 2);
  }
  const line = (x, w, col, dash) => {
    w *= 1.6;
    g.fillStyle = col;
    if (!dash) { g.fillRect(x - w / 2, 0, w, H); return; }
    for (let y = 0; y < H; y += 256) g.fillRect(x - w / 2, y, w, 128);
  };
  const edge = W * 0.03;
  if (kind === 'r2') {
    line(edge, 4, '#e8e8e8'); line(W - edge, 4, '#e8e8e8');
    line(W / 2, 4, '#e8e8e8', true);
  } else if (kind === 'r4') {
    line(edge, 5, '#e8e8e8'); line(W - edge, 5, '#e8e8e8');
    line(W / 2 - 5, 4, '#f2c230'); line(W / 2 + 5, 4, '#f2c230');
    line(W / 4, 4, '#e8e8e8', true); line(W * 0.75, 4, '#e8e8e8', true);
  } else { // r6: two carriageways + median
    const med = W * 0.09;
    g.fillStyle = '#8c8a82';
    g.fillRect(W / 2 - med / 2, 0, med, H);
    g.fillStyle = '#6f8f55';
    g.fillRect(W / 2 - med / 2 + 6, 0, med - 12, H);
    line(edge, 6, '#e8e8e8'); line(W - edge, 6, '#e8e8e8');
    const half = (W - med) / 2;
    for (const o of [0, W / 2 + med / 2]) {
      line(o + half / 3, 4, '#e8e8e8', true);
      line(o + (half * 2) / 3, 4, '#e8e8e8', true);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function tileBox(g, w, h, d, rng) {
  const uv = g.attributes.uv;
  const spans = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  const ou = rng(), ov = Math.floor(rng() * 16) / 16;
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      if (f === 2 || f === 3) uv.setXY(i, 0.003, 0.003);
      else uv.setXY(i, uv.getX(i) * spans[f][0] / TEX_W + ou, uv.getY(i) * spans[f][1] / TEX_H + ov);
    }
  }
}

function tileCyl(g, circ, h, seg, rng) {
  const uv = g.attributes.uv;
  const side = (seg + 1) * 2;
  const ou = rng(), ov = Math.floor(rng() * 16) / 16;
  for (let i = 0; i < uv.count; i++) {
    if (i < side) uv.setXY(i, uv.getX(i) * circ / TEX_W + ou, uv.getY(i) * h / TEX_H + ov);
    else uv.setXY(i, 0.003, 0.003);
  }
}

// Collects tinted geometry per material key and merges it into one mesh each.
export class Builder {
  constructor(rng) { this.rng = rng; this.parts = {}; }

  _push(key, g, color) {
    const n = g.attributes.position.count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { c[i * 3] = color[0]; c[i * 3 + 1] = color[1]; c[i * 3 + 2] = color[2]; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    (this.parts[key] ||= []).push(g);
  }

  raw(key, g, color = [1, 1, 1]) { this._push(key, g, color); }

  // base-aligned box
  box(key, w, h, d, x, y, z, { ry = 0, color = [1, 1, 1], tile = true } = {}) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (tile) tileBox(g, w, h, d, this.rng);
    g.translate(0, h / 2, 0);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    this._push(key, g, color);
  }

  // centre-aligned box with free rotation
  boxC(key, w, h, d, x, y, z, { rx = 0, ry = 0, rz = 0, color = [1, 1, 1], tile = false } = {}) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (tile) tileBox(g, w, h, d, this.rng);
    if (rx) g.rotateX(rx);
    if (rz) g.rotateZ(rz);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    this._push(key, g, color);
  }

  cyl(key, rTop, rBot, h, seg, x, y, z, { color = [1, 1, 1], tile = true } = {}) {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1);
    if (tile) tileCyl(g, Math.PI * (rTop + rBot), h, seg, this.rng);
    g.translate(0, h / 2, 0);
    g.translate(x, y, z);
    this._push(key, g, color);
  }

  build(mats, { cast = true, receive = true } = {}) {
    const group = new THREE.Group();
    for (const key of Object.keys(this.parts)) {
      const geo = mergeGeometries(this.parts[key], false);
      const mesh = new THREE.Mesh(geo, mats[key]);
      mesh.castShadow = cast;
      mesh.receiveShadow = receive;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
      this.parts[key].forEach((g) => g.dispose());
    }
    this.parts = {};
    return group;
  }
}

// Spatial-hash collision world (axis-aligned boxes and circles in the xz plane).
export class Colliders {
  constructor(cell = 64) { this.cell = cell; this.g = new Map(); }
  _k(i, j) { return (i + 8192) * 16384 + (j + 8192); }
  _insert(c, x0, z0, x1, z1) {
    const s = this.cell;
    for (let i = Math.floor(x0 / s); i <= Math.floor(x1 / s); i++)
      for (let j = Math.floor(z0 / s); j <= Math.floor(z1 / s); j++) {
        const k = this._k(i, j);
        let a = this.g.get(k);
        if (!a) this.g.set(k, (a = []));
        a.push(c);
      }
  }
  addBox(x0, z0, x1, z1) { this._insert({ t: 0, x0, z0, x1, z1 }, x0, z0, x1, z1); }
  addCircle(x, z, r, yc) { this._insert({ t: 1, x, z, r, yc }, x - r, z - r, x + r, z + r); }
  // oriented box: centre, half extents, rotation of local x axis (radians in the xz plane)
  addOBB(cx, cz, hx, hz, ang, yc) {
    const c = Math.cos(ang), s = Math.sin(ang);
    const ex = Math.abs(c) * hx + Math.abs(s) * hz, ez = Math.abs(s) * hx + Math.abs(c) * hz;
    this._insert({ t: 2, cx, cz, hx, hz, c, s, yc }, cx - ex, cz - ez, cx + ex, cz + ez);
  }
  test(x, z, r) { const p = { x, z }; return !!this.resolve(p, r); }

  // pushes p {x,z} out of any collider; returns penetration normal or null
  // y = height of the mover: elevated colliders (yc set) only apply on their own level
  resolve(p, r, y) {
    const s = this.cell;
    let hit = null;
    const i0 = Math.floor((p.x - r) / s), i1 = Math.floor((p.x + r) / s);
    const j0 = Math.floor((p.z - r) / s), j1 = Math.floor((p.z + r) / s);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const a = this.g.get(this._k(i, j));
        if (!a) continue;
        for (const c of a) {
          if (y !== undefined && (c.yc === undefined ? y > 4 : Math.abs(y - c.yc) > 4)) continue;
          let dx, dz, d, rr;
          if (c.t === 2) {
            const ox = p.x - c.cx, oz = p.z - c.cz;
            const lx = ox * c.c + oz * c.s, lz = -ox * c.s + oz * c.c;
            const qx = clamp(lx, -c.hx, c.hx), qz = clamp(lz, -c.hz, c.hz);
            const ddx = lx - qx, ddz = lz - qz, dd = Math.hypot(ddx, ddz);
            if (dd >= r) continue;
            let nlx, nlz, push;
            if (dd < 1e-5) {
              const ax = c.hx - Math.abs(lx), az = c.hz - Math.abs(lz);
              if (ax < az) { nlx = lx < 0 ? -1 : 1; nlz = 0; push = ax + r; } else { nlx = 0; nlz = lz < 0 ? -1 : 1; push = az + r; }
            } else { nlx = ddx / dd; nlz = ddz / dd; push = r - dd; }
            const wx = nlx * c.c - nlz * c.s, wz = nlx * c.s + nlz * c.c;
            p.x += wx * push; p.z += wz * push;
            hit = { x: wx, z: wz };
            continue;
          }
          if (c.t === 0) {
            const cx = clamp(p.x, c.x0, c.x1), cz = clamp(p.z, c.z0, c.z1);
            dx = p.x - cx; dz = p.z - cz; d = Math.hypot(dx, dz); rr = r;
            if (d >= rr) continue;
            if (d < 1e-5) { // centre inside: push along shallowest axis
              const l = p.x - c.x0, rgt = c.x1 - p.x, t = p.z - c.z0, b = c.z1 - p.z;
              const m = Math.min(l, rgt, t, b);
              if (m === l) { dx = -1; dz = 0; d = 0; rr = r + l; }
              else if (m === rgt) { dx = 1; dz = 0; d = 0; rr = r + rgt; }
              else if (m === t) { dx = 0; dz = -1; d = 0; rr = r + t; }
              else { dx = 0; dz = 1; d = 0; rr = r + b; }
              p.x += dx * (rr - d); p.z += dz * (rr - d);
              hit = { x: dx, z: dz };
              continue;
            }
          } else {
            dx = p.x - c.x; dz = p.z - c.z; d = Math.hypot(dx, dz); rr = r + c.r;
            if (d >= rr || d < 1e-5) continue;
          }
          const nx = dx / d, nz = dz / d;
          p.x += nx * (rr - d); p.z += nz * (rr - d);
          hit = { x: nx, z: nz };
        }
      }
    }
    return hit;
  }
}

export function makeLabelTexture(draw, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
