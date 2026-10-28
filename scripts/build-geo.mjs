// Turns raw OSM tiles (data/raw) into streamable chunks + land mask in public/data.
// Usage: node scripts/build-geo.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { BBOX } from './bbox.mjs';

const RAW = path.resolve('data/raw');
const OUT = path.resolve('public/data');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const LAT0 = 25.1972, LON0 = 55.2744;               // Burj Khalifa = world origin
const KX = 111320 * Math.cos((LAT0 * Math.PI) / 180), KZ = 110540;
const proj = (lat, lon) => [(lon - LON0) * KX, -(lat - LAT0) * KZ];
const CH = 1000;
const r1 = (v) => Math.round(v * 10) / 10;

// ── load ───────────────────────────────────────────────────────
const ways = { roads: new Map(), buildings: new Map(), misc: new Map() };
const stations = new Map();
for (const f of fs.readdirSync(RAW)) {
  const m = f.match(/^(roads|buildings|misc)_\d+\.json$/);
  if (!m) continue;
  const j = JSON.parse(fs.readFileSync(path.join(RAW, f)));
  for (const e of j.elements) {
    if (e.type === 'way' && e.geometry) ways[m[1]].set(e.id, e);
    else if (e.type === 'node' && e.tags?.railway === 'station') stations.set(e.id, e);
  }
}
console.log('loaded', Object.fromEntries(Object.entries(ways).map(([k, v]) => [k, v.size])), 'stations', stations.size);
const pts = (e) => e.geometry.filter((g) => g && g.lat !== undefined).map((g) => proj(g.lat, g.lon));

// ── helpers ────────────────────────────────────────────────────
const chunks = new Map();
const chunk = (x, z) => {
  const k = `${Math.floor(x / CH)}_${Math.floor(z / CH)}`;
  let c = chunks.get(k);
  if (!c) chunks.set(k, (c = { roads: [], buildings: [], parks: [], rails: [], stations: [] }));
  return c;
};
function splitByChunk(p, cb) { // split polyline so each piece lives in one chunk (pieces share endpoints)
  let cur = [p[0]], key = null;
  for (let i = 1; i < p.length; i++) {
    const mx = (p[i - 1][0] + p[i][0]) / 2, mz = (p[i - 1][1] + p[i][1]) / 2;
    const k = `${Math.floor(mx / CH)}_${Math.floor(mz / CH)}`;
    if (key !== null && k !== key) { cb(cur, key); cur = [p[i - 1]]; }
    key = k; cur.push(p[i]);
  }
  if (cur.length > 1) cb(cur, key);
}
const flat = (p) => p.flatMap(([x, z]) => [r1(x), r1(z)]);
function dp(p, tol) { // Douglas–Peucker
  if (p.length < 3) return p;
  const keep = new Uint8Array(p.length); keep[0] = keep[p.length - 1] = 1;
  const st = [[0, p.length - 1]];
  while (st.length) {
    const [a, b] = st.pop();
    let md = 0, mi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = segDist(p[i], p[a], p[b]);
      if (d > md) { md = d; mi = i; }
    }
    if (md > tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return p.filter((_, i) => keep[i]);
}
function segDist(q, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
  const t = l2 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dz) / l2)) : 0;
  return Math.hypot(q[0] - (a[0] + dx * t), q[1] - (a[1] + dz * t));
}

// ── roads (with flyover heights) ───────────────────────────────
const KIND = { motorway: 0, motorway_link: 5, trunk: 1, trunk_link: 5, primary: 2, primary_link: 5, secondary: 3, secondary_link: 5, tertiary: 4, tertiary_link: 5, residential: 6, unclassified: 6 };
const DEF_LANES = { 0: 3, 1: 3, 2: 2, 3: 2, 4: 2, 5: 1, 6: 1 };
const nk = (q) => `${q[0].toFixed(2)},${q[1].toFixed(2)}`;
const roadWays = [];
for (const e of ways.roads.values()) {
  const t = e.tags || {};
  if (t.tunnel === 'yes' || t.tunnel === 'building_passage') continue;
  const k = KIND[t.highway];
  if (k === undefined) continue;
  const p = pts(e);
  if (p.length < 2) continue;
  const oneway = t.oneway === 'yes' || t.oneway === '1' || t.highway.startsWith('motorway') ? 1 : 0;
  let lanes = parseInt(t.lanes, 10);
  if (!lanes) lanes = oneway ? DEF_LANES[k] : Math.max(2, DEF_LANES[k] * 2 - (k >= 4 ? 2 : 0));
  const w = Math.max(5, Math.min(40, lanes * 3.5));
  const bridge = !!(t.bridge && t.bridge !== 'no');
  const layer = parseInt(t.layer, 10) || (bridge ? 1 : 0);
  let len = 0; for (let i = 1; i < p.length; i++) len += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  roadWays.push({ id: e.id, p, k, oneway, w, bridge, layer, len });
}
// deck heights: bridge nodes sit at 6.5 m per layer; connecting roads ramp down at a 5 % grade
const Hn = new Map(), adj = new Map();
for (const r of roadWays) {
  for (let i = 1; i < r.p.length; i++) {
    const a = nk(r.p[i - 1]), b = nk(r.p[i]), l = Math.hypot(r.p[i][0] - r.p[i - 1][0], r.p[i][1] - r.p[i - 1][1]);
    (adj.get(a) || adj.set(a, []).get(a)).push([b, l]);
    (adj.get(b) || adj.set(b, []).get(b)).push([a, l]);
  }
  if (r.bridge && r.len >= 40) {
    const sh = Math.min(3, r.layer || 1) * 6.5;
    for (const q of r.p) { const k = nk(q); Hn.set(k, Math.max(Hn.get(k) || 0, sh)); }
  }
}
{
  const heap = [];
  const push = (h, k) => { heap.push([h, k]); let i = heap.length - 1; while (i > 0) { const par = (i - 1) >> 1; if (heap[par][0] >= heap[i][0]) break; [heap[par], heap[i]] = [heap[i], heap[par]]; i = par; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { let l = i * 2 + 1, r = l + 1, m = i; if (l < heap.length && heap[l][0] > heap[m][0]) m = l; if (r < heap.length && heap[r][0] > heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  for (const [k, h] of Hn) push(h, k);
  while (heap.length) {
    const [h, k] = pop();
    if (h < Hn.get(k) - 1e-6) continue;
    for (const [n, l] of adj.get(k) || []) {
      const nh = h - 0.05 * l;
      if (nh > (Hn.get(n) || 0) + 0.01) { Hn.set(n, nh); push(nh, n); }
    }
  }
}
const allRoadPts = [];
let nRoads = 0, nElev = 0;
for (const r of roadWays) {
  splitByChunk(r.p, (piece, key) => {
    const [cx, cz] = key.split('_').map(Number);
    const hs = piece.map((q) => { const h = Hn.get(nk(q)) || 0; return h < 0.05 ? 0 : Math.round(h * 10) / 10; });
    const rec = { id: r.id, p: flat(piece), w: r.w, k: r.k, l: r.layer, o: r.oneway, b: r.bridge ? 1 : 0 };
    if (hs.some((h) => h > 0)) { rec.h = hs; nElev++; }
    chunk(cx * CH + 1, cz * CH + 1).roads.push(rec);
    nRoads++;
  });
  for (const q of r.p) if ((Hn.get(nk(q)) || 0) < 0.5) allRoadPts.push([q[0], q[1], r.k, r.w]);
}
console.log('road pieces', nRoads, 'with elevation', nElev);

// ── buildings ──────────────────────────────────────────────────
const area = (p) => { let a = 0; for (let i = 0; i < p.length; i++) { const j = (i + 1) % p.length; a += p[i][0] * p[j][1] - p[j][0] * p[i][1]; } return a / 2; };
let nB = 0;
for (const e of ways.buildings.values()) {
  let p = pts(e);
  if (p.length < 4) continue;
  const f = e.geometry[0], l = e.geometry[e.geometry.length - 1];
  if (!f || !l || f.lat !== l.lat || f.lon !== l.lon) continue;
  p = dp(p.slice(0, -1), 0.7);
  if (p.length < 3) continue;
  const a = area(p);
  if (Math.abs(a) < 25) continue;
  if (a < 0) p.reverse();
  const t = e.tags || {};
  let h = parseFloat(t.height) || (parseFloat(t['building:levels']) ? parseFloat(t['building:levels']) * 3.4 : 0);
  if (t['building:part'] && !t.building) continue;
  const cx = p.reduce((s, q) => s + q[0], 0) / p.length, cz = p.reduce((s, q) => s + q[1], 0) / p.length;
  chunk(cx, cz).buildings.push({ id: e.id, p: flat(p), h: Math.round(h), a: Math.round(Math.abs(a)) });
  nB++;
}

// ── parks, rail, stations ────────────────────────────────────────────
const coast = [];
let nP = 0, nR = 0;
for (const e of ways.misc.values()) {
  const t = e.tags || {};
  const p = pts(e);
  if (t.natural === 'coastline') { coast.push(p); continue; }
  if (t.railway) {
    splitByChunk(p, (piece, key) => {
      const [cx, cz] = key.split('_').map(Number);
      chunk(cx * CH + 1, cz * CH + 1).rails.push({ id: e.id, p: flat(piece), b: t.bridge && t.bridge !== 'no' ? 1 : 0, k: t.railway });
      nR++;
    });
    continue;
  }
  if ((t.leisure || t.landuse) && p.length >= 4) {
    const q = dp(p.slice(0, -1), 1.0);
    if (q.length < 3) continue;
    const cx = q.reduce((s, v) => s + v[0], 0) / q.length, cz = q.reduce((s, v) => s + v[1], 0) / q.length;
    chunk(cx, cz).parks.push({ p: flat(area(q) < 0 ? q.reverse() : q), t: t.leisure || t.landuse });
    nP++;
  }
}
for (const s of stations.values()) {
  const [x, z] = proj(s.lat, s.lon);
  chunk(x, z).stations.push([r1(x), r1(z), s.tags?.name || '']);
}
console.log({ nRoads, nB, nP, nR, coast: coast.length });

// ── land mask: rasterise coastline, flood-fill the sea ─────────────────
const [bx0, bz1] = proj(BBOX.S, BBOX.W), [bx1, bz0] = proj(BBOX.N, BBOX.E);
const RES = 8, PAD = 200;
const mx0 = bx0 - PAD, mz0 = bz0 - PAD;
const MW = Math.ceil((bx1 - bx0 + 2 * PAD) / RES), MH = Math.ceil((bz1 - bz0 + 2 * PAD) / RES);
const bar = new Uint8Array(MW * MH);
const plot = (gx, gz) => {
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const x = gx + dx, z = gz + dz;
    if (x >= 0 && z >= 0 && x < MW && z < MH) bar[z * MW + x] = 1;
  }
};
for (const p of coast) {
  for (let i = 1; i < p.length; i++) {
    let x0 = (p[i - 1][0] - mx0) / RES, z0 = (p[i - 1][1] - mz0) / RES, x1 = (p[i][0] - mx0) / RES, z1 = (p[i][1] - mz0) / RES;
    const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0)) * 2) + 1;
    for (let s = 0; s <= n; s++) plot(Math.round(x0 + ((x1 - x0) * s) / n), Math.round(z0 + ((z1 - z0) * s) / n));
  }
}
const sea = new Uint8Array(MW * MH);
{
  const seed = (() => { // north-west corner is open Gulf
    const [sx, sz] = proj(BBOX.N - 0.004, BBOX.W + 0.004);
    return [Math.round((sx - mx0) / RES), Math.round((sz - mz0) / RES)];
  })();
  const q = new Int32Array(MW * MH); let h = 0, t = 0;
  const push = (x, z) => { const i = z * MW + x; if (!bar[i] && !sea[i]) { sea[i] = 1; q[t++] = i; } };
  push(seed[0], seed[1]);
  while (h < t) {
    const i = q[h++], x = i % MW, z = (i / MW) | 0;
    if (x > 0) push(x - 1, z); if (x < MW - 1) push(x + 1, z); if (z > 0) push(x, z - 1); if (z < MH - 1) push(x, z + 1);
  }
}
let landPx = 0;
const land = new Uint8Array(MW * MH);
for (let i = 0; i < land.length; i++) { land[i] = sea[i] ? 0 : 255; if (!sea[i]) landPx++; }
console.log(`mask ${MW}x${MH}, land ${(landPx / land.length * 100).toFixed(1)}%`);

function png(gray, w, h) {
  const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunkB = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w + 1)] = 0; Buffer.from(gray.buffer, y * w, w).copy(raw, y * (w + 1) + 1); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunkB('IHDR', ihdr), chunkB('IDAT', zlib.deflateSync(raw, { level: 9 })), chunkB('IEND', Buffer.alloc(0))]);
}
fs.writeFileSync(path.join(OUT, 'land.png'), png(land, MW, MH));

// ── landmarks: real positions + road-snapped parking spot ───────────────
const LM = {
  projects: { lat: 25.19720, lon: 55.27439, r: 150, stand: 420 },    // Burj Khalifa
  about: { lat: 25.14126, lon: 55.18530, r: 140, stand: 250 },       // Burj Al Arab
  skills: { lat: 25.13050, lon: 55.11710, r: 140, stand: 300 },      // Atlantis, The Palm
  experience: { lat: 25.23500, lon: 55.30010, r: 130, stand: 270 },  // Dubai Frame
  contact: { lat: 25.21940, lon: 55.28150, r: 120, stand: 220 },     // Museum of the Future
  writing: { lat: 25.08882, lon: 55.14518, r: 70, stand: 190 },      // Cayan Tower
};
const landmarks = {};
for (const [id, l] of Object.entries(LM)) {
  const [x, z] = proj(l.lat, l.lon);
  let best = null, bs = Infinity;
  for (const [px, pz, k] of allRoadPts) {
    const d = Math.hypot(px - x, pz - z);
    if (d < l.r * 0.8) continue;
    const s = Math.abs(d - l.stand) + (k > 4 ? 120 : k * 12);
    if (s < bs) { bs = s; best = [px, pz]; }
  }
  landmarks[id] = { x: r1(x), z: r1(z), r: l.r, stop: best ? [r1(best[0]), r1(best[1])] : [r1(x), r1(z + l.stand)] };
}
// start: Sheikh Zayed Road near Emirates Towers
let start = { x: 0, z: 0, h: Math.PI };
{
  const [sx, sz] = proj(25.2125, 55.2740);
  let bd = Infinity, bi = -1;
  for (let i = 0; i < allRoadPts.length; i++) {
    const [px, pz, k] = allRoadPts[i];
    if (k > 1) continue;
    const d = Math.hypot(px - sx, pz - sz);
    if (d < bd) { bd = d; bi = i; }
  }
  const [px, pz] = allRoadPts[bi];
  start = { x: r1(px), z: r1(pz), h: 0 };
}

// ── write chunks ────────────────────────────────────────────────────
const keys = [];
for (const [k, c] of chunks) {
  keys.push(k);
  fs.writeFileSync(path.join(OUT, `c_${k}.json`), JSON.stringify(c));
}
fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify({
  origin: { lat: LAT0, lon: LON0 }, kx: KX, kz: KZ, chunk: CH,
  bounds: { x0: r1(bx0), x1: r1(bx1), z0: r1(bz0), z1: r1(bz1) },
  mask: { x0: mx0, z0: mz0, res: RES, w: MW, h: MH },
  landmarks, start, chunks: keys,
}));
const size = fs.readdirSync(OUT).reduce((s, f) => s + fs.statSync(path.join(OUT, f)).size, 0);
console.log(`wrote ${keys.length} chunks, ${(size / 1e6).toFixed(1)} MB`, landmarks, start);
