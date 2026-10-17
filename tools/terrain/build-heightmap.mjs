// Fetch GSI DEM tiles (出典：国土地理院) and resample them into a local metric heightmap.
// Usage: node tools/terrain/build-heightmap.mjs [resortId]
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const RESORTS = {
  iwappara: {
    // Centre of the OSM "岩原スキー場" area (bbox 36.932–36.955N, 138.836–138.849E), with margin.
    centerLat: 36.9435,
    centerLon: 138.8420,
    sizeM: 4096, // square extent in metres
    cellM: 4, // grid spacing in metres -> 1025 x 1025 samples
  },
};

const id = process.argv[2] ?? 'iwappara';
const cfg = RESORTS[id];
if (!cfg) throw new Error(`unknown resort: ${id}`);

const CACHE = path.resolve('tools/terrain/cache');
const OUT = path.resolve('public/data', id);
fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const SOURCES = [
  { name: 'dem5a', zoom: 15 },
  { name: 'dem5b', zoom: 15 },
  { name: 'dem', zoom: 14 }, // 10m fallback
];

const tileCache = new Map();

async function loadTile(src, z, x, y) {
  const key = `${src}/${z}/${x}/${y}`;
  if (tileCache.has(key)) return tileCache.get(key);
  const file = path.join(CACHE, `${src}_${z}_${x}_${y}.png`);
  let buf = null;
  if (fs.existsSync(file)) {
    buf = fs.readFileSync(file);
  } else {
    const res = await fetch(`https://cyberjapandata.gsi.go.jp/xyz/${src}_png/${z}/${x}/${y}.png`);
    if (res.ok) {
      buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(file, buf);
    } else if (res.status === 404) {
      fs.writeFileSync(file, Buffer.alloc(0));
    } else {
      throw new Error(`${key}: HTTP ${res.status}`);
    }
  }
  let heights = null;
  if (buf && buf.length > 0) {
    const png = PNG.sync.read(buf);
    heights = new Float32Array(256 * 256);
    for (let i = 0; i < 256 * 256; i++) {
      const r = png.data[i * 4], g = png.data[i * 4 + 1], b = png.data[i * 4 + 2];
      const v = (r << 16) | (g << 8) | b;
      // GSI encoding: 2^23 = no data, >2^23 = negative
      heights[i] = v === 0x800000 ? NaN : (v > 0x800000 ? v - 0x1000000 : v) * 0.01;
    }
  }
  tileCache.set(key, heights);
  return heights;
}

// Web-Mercator pixel coordinate at zoom z (256px tiles)
function lonLatToPixel(lon, lat, z) {
  const n = 256 * 2 ** z;
  const x = ((lon + 180) / 360) * n;
  const s = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
  return [x, y];
}

async function samplePixel(src, z, px, py) {
  const tx = Math.floor(px / 256), ty = Math.floor(py / 256);
  const t = await loadTile(src, z, tx, ty);
  if (!t) return NaN;
  return t[(Math.floor(py) - ty * 256) * 256 + (Math.floor(px) - tx * 256)];
}

async function sampleBilinear(src, z, lon, lat) {
  const [fx, fy] = lonLatToPixel(lon, lat, z);
  const x0 = Math.floor(fx - 0.5), y0 = Math.floor(fy - 0.5);
  const dx = fx - 0.5 - x0, dy = fy - 0.5 - y0;
  const h00 = await samplePixel(src, z, x0, y0);
  const h10 = await samplePixel(src, z, x0 + 1, y0);
  const h01 = await samplePixel(src, z, x0, y0 + 1);
  const h11 = await samplePixel(src, z, x0 + 1, y0 + 1);
  return (h00 * (1 - dx) + h10 * dx) * (1 - dy) + (h01 * (1 - dx) + h11 * dx) * dy;
}

async function sample(lon, lat) {
  for (const s of SOURCES) {
    const h = await sampleBilinear(s.name, s.zoom, lon, lat);
    if (Number.isFinite(h)) return h;
  }
  return NaN;
}

// Local tangent plane: +x = east, +z = south (Three.js convention: -z is north)
const R = 6378137;
const mPerDegLat = (Math.PI / 180) * R;
const mPerDegLon = mPerDegLat * Math.cos((cfg.centerLat * Math.PI) / 180);
const n = Math.round(cfg.sizeM / cfg.cellM) + 1;
const half = cfg.sizeM / 2;
const heights = new Float32Array(n * n);
let missing = 0;

console.log(`${id}: ${n}x${n} samples @ ${cfg.cellM}m`);
for (let j = 0; j < n; j++) {
  const zM = -half + j * cfg.cellM;
  const lat = cfg.centerLat - zM / mPerDegLat;
  for (let i = 0; i < n; i++) {
    const xM = -half + i * cfg.cellM;
    const lon = cfg.centerLon + xM / mPerDegLon;
    const h = await sample(lon, lat);
    if (!Number.isFinite(h)) missing++;
    heights[j * n + i] = h;
  }
  if (j % 128 === 0) console.log(`  row ${j}/${n}`);
}

// Fill any remaining holes with the nearest valid neighbour along the row
for (let j = 0; j < n; j++) {
  let last = NaN;
  for (let i = 0; i < n; i++) {
    const k = j * n + i;
    if (Number.isFinite(heights[k])) last = heights[k];
    else if (Number.isFinite(last)) heights[k] = last;
  }
}

let min = Infinity, max = -Infinity;
for (const h of heights) if (Number.isFinite(h)) { min = Math.min(min, h); max = Math.max(max, h); }

fs.writeFileSync(path.join(OUT, 'heightmap.bin'), Buffer.from(heights.buffer));
const meta = {
  resolution: n,
  cellM: cfg.cellM,
  sizeM: cfg.sizeM,
  centerLat: cfg.centerLat,
  centerLon: cfg.centerLon,
  minElevation: min,
  maxElevation: max,
  attribution: '出典：国土地理院 (GSI DEM tiles)',
};
fs.writeFileSync(path.join(OUT, 'heightmap.json'), JSON.stringify(meta, null, 2));
console.log(`done: elevation ${min.toFixed(1)}–${max.toFixed(1)} m, ${missing} missing samples`);
