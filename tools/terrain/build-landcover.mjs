// Estimate forest density per heightmap cell from GSI aerial photos (出典：国土地理院 シームレス空中写真).
// Ski slopes show up as smooth, bright grass; forest as dark, high-texture canopy.
// Usage: node tools/terrain/build-landcover.mjs [resortId]
import fs from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { fetchGsiTile, forEachCell, lonLatToPixel, resortConfig } from './common.mjs';

const id = process.argv[2] ?? 'iwappara';
const cfg = resortConfig(id);
const OUT = path.resolve('public/data', id);
const Z = 16;
const WINDOW = 2; // pixel radius (~2m/px at z16 -> ~10m window)

// Preload every tile covering the square so sampling can be synchronous
const mPerDegLat = (Math.PI / 180) * 6378137;
const mPerDegLon = mPerDegLat * Math.cos((cfg.centerLat * Math.PI) / 180);
const dLat = cfg.sizeM / 2 / mPerDegLat, dLon = cfg.sizeM / 2 / mPerDegLon;
const [px0, py0] = lonLatToPixel(cfg.centerLon - dLon, cfg.centerLat + dLat, Z);
const [px1, py1] = lonLatToPixel(cfg.centerLon + dLon, cfg.centerLat - dLat, Z);
const tiles = new Map();
const tx0 = Math.floor(px0 / 256) - 1, tx1 = Math.floor(px1 / 256) + 1;
const ty0 = Math.floor(py0 / 256) - 1, ty1 = Math.floor(py1 / 256) + 1;
console.log(`${id}: loading ${(tx1 - tx0 + 1) * (ty1 - ty0 + 1)} aerial tiles @ z${Z}`);
for (let ty = ty0; ty <= ty1; ty++) {
  for (let tx = tx0; tx <= tx1; tx++) {
    const buf = await fetchGsiTile('seamlessphoto', Z, tx, ty, 'jpg');
    tiles.set(`${tx},${ty}`, buf ? jpeg.decode(buf, { useTArray: true }).data : null);
  }
}

function pixel(px, py) {
  const tx = Math.floor(px / 256), ty = Math.floor(py / 256);
  const t = tiles.get(`${tx},${ty}`);
  if (!t) return null;
  const k = ((py - ty * 256) * 256 + (px - tx * 256)) * 4;
  return [t[k], t[k + 1], t[k + 2]];
}

const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

const n = Math.round(cfg.sizeM / cfg.cellM) + 1;
const raw = new Float32Array(n * n);
await forEachCell(cfg, (i, j, lon, lat) => {
  const [fx, fy] = lonLatToPixel(lon, lat, Z);
  const cx = Math.floor(fx), cy = Math.floor(fy);
  let sum = 0, sum2 = 0, sg = 0, count = 0;
  for (let dy = -WINDOW; dy <= WINDOW; dy++) {
    for (let dx = -WINDOW; dx <= WINDOW; dx++) {
      const p = pixel(cx + dx, cy + dy);
      if (!p) continue;
      const l = 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];
      sum += l; sum2 += l * l; sg += p[1] - (p[0] + p[2]) / 2; count++;
    }
  }
  if (!count) return;
  const mean = sum / count;
  const std = Math.sqrt(Math.max(0, sum2 / count - mean * mean));
  // Dark canopy or strongly textured canopy -> forest
  const darkness = smooth(125, 70, mean);
  const texture = smooth(9, 22, std);
  raw[j * n + i] = Math.min(1, 0.6 * darkness + 0.6 * texture);
});

// 5x5 box blur to get coherent stands of trees instead of noise
const forest = new Uint8Array(n * n);
const R = 2;
for (let j = 0; j < n; j++) {
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let dj = -R; dj <= R; dj++) {
      for (let di = -R; di <= R; di++) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
        s += raw[jj * n + ii]; c++;
      }
    }
    forest[j * n + i] = Math.round((s / c) * 255);
  }
}

fs.writeFileSync(path.join(OUT, 'forest.bin'), forest);

// Debug preview
const png = new PNG({ width: n, height: n });
for (let k = 0; k < n * n; k++) {
  const v = 255 - forest[k];
  png.data.set([v * 0.9, 255 - forest[k] * 0.6, v * 0.9, 255], k * 4);
}
fs.writeFileSync(path.resolve('tools/terrain/cache', `forest_${id}.png`), PNG.sync.write(png));
const cover = forest.reduce((s, v) => s + (v > 128 ? 1 : 0), 0) / forest.length;
console.log(`done: ${(cover * 100).toFixed(1)}% forest cover`);
