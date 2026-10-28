// Downloads OpenStreetMap data for the Dubai corridor in tiles and caches raw JSON in data/raw.
// Usage: node scripts/fetch-osm.mjs [--only=roads|buildings|misc]
import fs from 'node:fs';
import path from 'node:path';

import { BBOX } from './bbox.mjs';
const STEP = 0.03;
const MIRRORS = [
  'https://lz4.overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const RAW = path.resolve('data/raw');
fs.mkdirSync(RAW, { recursive: true });
const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);

const HW = 'motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|residential|unclassified';
const QUERIES = {
  roads: (b) => `way["highway"~"^(${HW})$"](${b});out geom;`,
  buildings: (b) => `way["building"](${b});out geom;`,
  misc: (b) => `(way["natural"="coastline"](${b});way["leisure"~"^(park|garden|pitch|golf_course)$"](${b});way["landuse"~"^(grass|recreation_ground|forest)$"](${b});way["railway"~"^(subway|light_rail|tram)$"]["tunnel"!="yes"](${b});node["railway"="station"](${b}););out geom;`,
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let mirror = parseInt(process.env.MIRROR_START || '0', 10);

async function run(query) {
  let wait = 4000;
  for (let attempt = 0; attempt < 14; attempt++) {
    const url = MIRRORS[mirror % MIRRORS.length];
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'dubai-portfolio-osm-fetch/1.0', Accept: 'application/json' },
        body: 'data=' + encodeURIComponent(`[out:json][timeout:120];${query}`),
        signal: AbortSignal.timeout(100000),
      });
      const text = await res.text();
      if (res.ok && text.trimStart().startsWith('{')) {
        const j = JSON.parse(text);
        if (!j.remark || !/error|timeout/i.test(j.remark)) return j;
      }
      console.log(`  ${new URL(url).host} -> ${res.status} ${text.slice(0, 80).replace(/\s+/g, ' ')}`);
    } catch (e) { console.log(`  ${new URL(url).host} -> ${e.message}`); }
    mirror++;
    await sleep(wait);
    wait = Math.min(wait * 1.6, 40000);
  }
  throw new Error('giving up on query');
}

const tiles = [];
for (let s = BBOX.S; s < BBOX.N - 1e-9; s += STEP)
  for (let w = BBOX.W; w < BBOX.E - 1e-9; w += STEP) tiles.push([s, w, Math.min(s + STEP, BBOX.N), Math.min(w + STEP, BBOX.E)]);

let done = 0;
for (const cat of Object.keys(QUERIES)) {
  if (only && only !== cat) continue;
  for (const [i, t] of tiles.entries()) {
    const file = path.join(RAW, `${cat}_${i}.json`);
    done++;
    if (fs.existsSync(file)) continue;
    const b = t.map((v) => v.toFixed(5)).join(',');
    console.log(`[${cat} ${i + 1}/${tiles.length}] ${b}`);
    const j = await run(QUERIES[cat](b));
    fs.writeFileSync(file, JSON.stringify({ tile: t, elements: j.elements }));
    await sleep(1500);
  }
}
console.log('done');
