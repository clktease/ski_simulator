// Convert cached OSM piste/aerialway data into resort.json in local metres.
// Data © OpenStreetMap contributors (ODbL).
// Usage: node tools/terrain/build-resort.mjs [resortId]
import fs from 'node:fs';
import path from 'node:path';

const BOUNDS = {
  // OSM landuse=winter_sports "岩原スキー場" bbox, with a small margin
  iwappara: { s: 36.930, n: 36.957, w: 138.833, e: 138.851 },
};

const id = process.argv[2] ?? 'iwappara';
const b = BOUNDS[id];
const dir = path.resolve('public/data', id);
const meta = JSON.parse(fs.readFileSync(path.join(dir, 'heightmap.json'), 'utf8'));
const osm = JSON.parse(fs.readFileSync(path.resolve(`tools/terrain/cache/osm_${id}.json`), 'utf8'));

const mPerDegLat = (Math.PI / 180) * 6378137;
const mPerDegLon = mPerDegLat * Math.cos((meta.centerLat * Math.PI) / 180);
const toLocal = (p) => [
  +((p.lon - meta.centerLon) * mPerDegLon).toFixed(1),
  +(-(p.lat - meta.centerLat) * mPerDegLat).toFixed(1),
];

const inside = (geom) => {
  const lat = geom.reduce((s, p) => s + p.lat, 0) / geom.length;
  const lon = geom.reduce((s, p) => s + p.lon, 0) / geom.length;
  return lat >= b.s && lat <= b.n && lon >= b.w && lon <= b.e;
};

const runs = [];
const lifts = [];
for (const el of osm.elements) {
  const t = el.tags ?? {};
  if (!el.geometry || el.geometry.length < 2 || !inside(el.geometry)) continue;
  const pts = el.geometry.map(toLocal);
  if (t.aerialway && t.aerialway !== 'station') {
    lifts.push({ id: `osm-${el.id}`, name: t.name ?? null, type: t.aerialway, seats: t['aerialway:occupancy'] ? +t['aerialway:occupancy'] : null, points: pts });
  } else if (t['piste:type'] === 'downhill') {
    runs.push({ id: `osm-${el.id}`, name: t['piste:name'] ?? t.name ?? null, difficulty: t['piste:difficulty'] ?? 'easy', area: t.area === 'yes', points: pts });
  }
}

// Hand-placed facilities (centre house, hotel, rest house...) live next to this script
const facilitiesFile = path.resolve('tools/terrain/facilities', `${id}.json`);
const hand = fs.existsSync(facilitiesFile) ? JSON.parse(fs.readFileSync(facilitiesFile, 'utf8')) : {};

const resort = {
  id,
  name: '岩原スキー場',
  attribution: ['出典：国土地理院', '© OpenStreetMap contributors (ODbL)'],
  runs,
  lifts,
  spawn: hand.spawn ?? { x: 0, z: 0, heading: 0 },
  facilities: hand.facilities ?? [],
  paths: hand.paths ?? [],
};
fs.writeFileSync(path.join(dir, 'resort.json'), JSON.stringify(resort, null, 1));
console.log(`${id}: ${runs.length} runs, ${lifts.length} lifts, ${resort.facilities.length} facilities`);
for (const l of lifts) console.log(`  lift ${l.name ?? '(unnamed)'} ${l.points.length} pts`);
