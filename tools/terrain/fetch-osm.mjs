// Download ski runs and lifts around the resort from OpenStreetMap (Overpass API) into the cache.
// Data © OpenStreetMap contributors (ODbL).
// Usage: node tools/terrain/fetch-osm.mjs [resortId]
import fs from 'node:fs';
import path from 'node:path';
import { CACHE, resortConfig } from './common.mjs';

const id = process.argv[2] ?? 'iwappara';
const cfg = resortConfig(id);
const out = path.join(CACHE, `osm_${id}.json`);
if (fs.existsSync(out) && !process.argv.includes('--force')) {
  console.log(`${id}: using cached ${path.relative(process.cwd(), out)} (--force to refetch)`);
  process.exit(0);
}

const mPerDegLat = (Math.PI / 180) * 6378137;
const mPerDegLon = mPerDegLat * Math.cos((cfg.centerLat * Math.PI) / 180);
const dLat = cfg.sizeM / 2 / mPerDegLat, dLon = cfg.sizeM / 2 / mPerDegLon;
const bbox = [cfg.centerLat - dLat, cfg.centerLon - dLon, cfg.centerLat + dLat, cfg.centerLon + dLon].map((v) => v.toFixed(5)).join(',');
const query = `[out:json][timeout:60];(way["piste:type"](${bbox});way["aerialway"](${bbox}););out geom tags;`;

// The public endpoint often answers 502/504 under load; retry a few times.
// (curl to this host fails TLS on some Windows setups, so use Node's fetch.)
for (let attempt = 1; attempt <= 5; attempt++) {
  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'User-Agent': 'ski-resort-sim (data pipeline)', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query),
    });
    const text = await res.text();
    const data = JSON.parse(text);
    fs.writeFileSync(out, text);
    console.log(`${id}: ${data.elements.length} OSM ways saved`);
    process.exit(0);
  } catch (err) {
    console.warn(`attempt ${attempt} failed: ${String(err.message).slice(0, 80)}`);
    await new Promise((r) => setTimeout(r, attempt * 3000));
  }
}
throw new Error('Overpass API unavailable, try again later');
