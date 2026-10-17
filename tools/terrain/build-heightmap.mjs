// Fetch GSI DEM tiles (出典：国土地理院) and resample them into a local metric heightmap.
// Usage: node tools/terrain/build-heightmap.mjs [resortId]
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { fetchGsiTile, forEachCell, lonLatToPixel, resortConfig } from './common.mjs';

const id = process.argv[2] ?? 'iwappara';
const cfg = resortConfig(id);
const OUT = path.resolve('public/data', id);
fs.mkdirSync(OUT, { recursive: true });

const SOURCES = [
  { layer: 'dem5a_png', zoom: 15 },
  { layer: 'dem5b_png', zoom: 15 },
  { layer: 'dem_png', zoom: 14 }, // 10m fallback
];

const tileCache = new Map();

async function loadTile(layer, z, x, y) {
  const key = `${layer}/${z}/${x}/${y}`;
  if (tileCache.has(key)) return tileCache.get(key);
  const buf = await fetchGsiTile(layer, z, x, y, 'png');
  let heights = null;
  if (buf) {
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

async function samplePixel(layer, z, px, py) {
  const tx = Math.floor(px / 256), ty = Math.floor(py / 256);
  const t = await loadTile(layer, z, tx, ty);
  if (!t) return NaN;
  return t[(Math.floor(py) - ty * 256) * 256 + (Math.floor(px) - tx * 256)];
}

async function sampleBilinear(layer, z, lon, lat) {
  const [fx, fy] = lonLatToPixel(lon, lat, z);
  const x0 = Math.floor(fx - 0.5), y0 = Math.floor(fy - 0.5);
  const dx = fx - 0.5 - x0, dy = fy - 0.5 - y0;
  const h00 = await samplePixel(layer, z, x0, y0);
  const h10 = await samplePixel(layer, z, x0 + 1, y0);
  const h01 = await samplePixel(layer, z, x0, y0 + 1);
  const h11 = await samplePixel(layer, z, x0 + 1, y0 + 1);
  return (h00 * (1 - dx) + h10 * dx) * (1 - dy) + (h01 * (1 - dx) + h11 * dx) * dy;
}

async function sample(lon, lat, sources) {
  for (const s of sources) {
    const h = await sampleBilinear(s.layer, s.zoom, lon, lat);
    if (Number.isFinite(h)) return h;
  }
  return NaN;
}

async function buildGrid(grid, sources, name) {
  const n = Math.round(grid.sizeM / grid.cellM) + 1;
  const heights = new Float32Array(n * n);
  let missing = 0;
  console.log(`${name}: ${n}x${n} samples @ ${grid.cellM}m`);
  await forEachCell({ ...cfg, ...grid }, async (i, j, lon, lat) => {
    const h = await sample(lon, lat, sources);
    if (!Number.isFinite(h)) missing++;
    heights[j * n + i] = h;
  });

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
  fs.writeFileSync(path.join(OUT, `${name}.bin`), Buffer.from(heights.buffer));
  console.log(`  elevation ${min.toFixed(1)}–${max.toFixed(1)} m, ${missing} missing samples`);
  return {
    resolution: n,
    cellM: grid.cellM,
    sizeM: grid.sizeM,
    centerLat: cfg.centerLat,
    centerLon: cfg.centerLon,
    minElevation: min,
    maxElevation: max,
  };
}

const meta = await buildGrid(cfg, SOURCES, 'heightmap');
meta.attribution = '出典：国土地理院 (GSI DEM tiles)';
if (cfg.outer) meta.outer = await buildGrid(cfg.outer, SOURCES.slice(2), 'outer');
fs.writeFileSync(path.join(OUT, 'heightmap.json'), JSON.stringify(meta, null, 2));
