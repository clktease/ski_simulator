import fs from 'node:fs';
import path from 'node:path';

export const CACHE = path.resolve('tools/terrain/cache');
fs.mkdirSync(CACHE, { recursive: true });

export const RESORTS = {
  iwappara: {
    // Centre of the OSM "岩原スキー場" area (bbox 36.932–36.955N, 138.836–138.849E), with margin.
    centerLat: 36.9435,
    centerLon: 138.8420,
    sizeM: 4096, // square extent in metres
    cellM: 4, // grid spacing in metres -> 1025 x 1025 samples
    // Low-res surroundings so the horizon shows the real Yuzawa valley and peaks
    outer: { sizeM: 20480, cellM: 32 },
  },
};

export function resortConfig(id) {
  const cfg = RESORTS[id];
  if (!cfg) throw new Error(`unknown resort: ${id}`);
  return cfg;
}

/** Web-Mercator pixel coordinate at zoom z (256px tiles). */
export function lonLatToPixel(lon, lat, z) {
  const n = 256 * 2 ** z;
  const x = ((lon + 180) / 360) * n;
  const s = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
  return [x, y];
}

/** Download a GSI tile once into the cache. Returns null for 404 (no data). */
export async function fetchGsiTile(layer, z, x, y, ext) {
  const file = path.join(CACHE, `${layer}_${z}_${x}_${y}.${ext}`);
  if (fs.existsSync(file)) {
    const buf = fs.readFileSync(file);
    return buf.length ? buf : null;
  }
  const res = await fetch(`https://cyberjapandata.gsi.go.jp/xyz/${layer}/${z}/${x}/${y}.${ext}`);
  if (res.status === 404) {
    fs.writeFileSync(file, Buffer.alloc(0));
    return null;
  }
  if (!res.ok) throw new Error(`${layer}/${z}/${x}/${y}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(file, buf);
  return buf;
}

/** Iterate grid cells of the resort square, calling fn(i, j, lon, lat). */
export async function forEachCell(cfg, fn) {
  const mPerDegLat = (Math.PI / 180) * 6378137;
  const mPerDegLon = mPerDegLat * Math.cos((cfg.centerLat * Math.PI) / 180);
  const n = Math.round(cfg.sizeM / cfg.cellM) + 1;
  const half = cfg.sizeM / 2;
  for (let j = 0; j < n; j++) {
    // +z = south
    const lat = cfg.centerLat - (-half + j * cfg.cellM) / mPerDegLat;
    for (let i = 0; i < n; i++) {
      const lon = cfg.centerLon + (-half + i * cfg.cellM) / mPerDegLon;
      await fn(i, j, lon, lat);
    }
  }
  return n;
}
