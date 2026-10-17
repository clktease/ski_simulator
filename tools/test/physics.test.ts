// Ski physics sanity checks on synthetic slopes, using the real SkiController.
// Run: node tools/test/run-physics.mjs
import * as THREE from 'three';
import { Heightmap } from '../../src/world/Heightmap';
import { TreeIndex } from '../../src/world/Trees';
import { SkiController, type SkiEnvironment } from '../../src/player/SkiController';
import { PlayerBody } from '../../src/player/PlayerBody';
import { SNOW } from '../../src/world/SnowConditions';
import type { Input } from '../../src/core/Input';

const G = 9.81;
let failures = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? '✔' : '✘'} ${msg}`);
  if (!ok) failures++;
};

/** Plane descending towards +z at `deg` degrees. */
function slope(deg: number) {
  const n = 257, cell = 4;
  const data = new Float32Array(n * n);
  const t = Math.tan(THREE.MathUtils.degToRad(deg));
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) data[j * n + i] = 1000 - t * (j * cell - 512);
  return new Heightmap({ resolution: n, cellM: cell, sizeM: (n - 1) * cell, centerLat: 36.9, centerLon: 138.8, minElevation: 0, maxElevation: 2000 }, data);
}

function keys(...down: string[]): Input {
  return { isDown: (c: string) => down.includes(c), wasPressed: () => false } as unknown as Input;
}

function simulate(deg: number, seconds: number, opts: { keys?: string[]; heading?: number; snow?: keyof typeof SNOW; v0?: number } = {}) {
  const hm = slope(deg);
  const ski = new SkiController(keys(...(opts.keys ?? [])), hm, new TreeIndex(), []);
  const body = new PlayerBody();
  body.heading = opts.heading ?? 0; // 0 = facing +z = straight down the fall line
  body.position.set(0, hm.heightAt(0, 0), -400);
  const env: SkiEnvironment = { snowAt: () => SNOW[opts.snow ?? 'groomed'], wind: new THREE.Vector3(), stamina: 100 };
  ski.start(body, opts.v0 ?? 0);
  const step = (ski as unknown as { step(h: number, b: PlayerBody, e: SkiEnvironment): void }).step.bind(ski);
  const h = 1 / 120;
  for (let t = 0; t < seconds; t += h) step(h, body, env);
  return { speed: ski.velocity.length(), body, ski };
}

// 1. Straight run from rest: v(1 s) ≈ g(sinθ − μcosθ) (drag is negligible at ~3 m/s)
for (const deg of [10, 20, 30]) {
  const th = THREE.MathUtils.degToRad(deg);
  const expected = G * (Math.sin(th) - SNOW.groomed.mu * Math.cos(th));
  const { speed } = simulate(deg, 1);
  check(Math.abs(speed - expected) / expected < 0.03, `${deg}° slope: v(1s)=${speed.toFixed(3)} m/s, theory ${expected.toFixed(3)} m/s`);
}

// 2. Terminal velocity: tuck is faster than upright, both in a plausible range
const upright = simulate(20, 120).speed;
const tuck = simulate(20, 120, { keys: ['KeyW'] }).speed;
check(upright * 3.6 > 60 && upright * 3.6 < 110, `20° upright terminal speed ${(upright * 3.6).toFixed(0)} km/h`);
check(tuck > upright * 1.2, `tuck terminal speed ${(tuck * 3.6).toFixed(0)} km/h > upright`);

// 3. Gentle slope: static friction holds a standing skier
check(simulate(1.5, 3).speed === 0, '1.5° slope: standing skier stays put');

// 4. Braking (snowplough) stops a skier on a moderate slope
check(simulate(12, 8, { keys: ['KeyS'], v0: 10 }).speed < 1, `12° slope: snowplough from 36 km/h stops (${simulate(12, 8, { keys: ['KeyS'], v0: 10 }).speed.toFixed(2)} m/s)`);

// 5. Traversing across the slope: edges hold, little sideways slip on groomed snow, more on ice
const across = Math.PI / 2; // facing +x, slope falls towards +z
const g1 = simulate(20, 3, { heading: across });
const ice = simulate(20, 3, { heading: across, snow: 'ice' });
const drift = (b: PlayerBody) => b.position.z + 400;
check(drift(g1.body) < 3, `20° traverse on groomed: drift ${drift(g1.body).toFixed(2)} m down the hill`);
check(drift(ice.body) > drift(g1.body), `ice slips more: drift ${drift(ice.body).toFixed(2)} m`);

// 6. Steering turns the skier: holding A from a straight run changes heading
const turned = simulate(15, 2, { keys: ['KeyA'], v0: 8 });
check(turned.body.heading > 0.5, `holding A turns left (heading ${turned.body.heading.toFixed(2)} rad)`);

console.log(failures ? `\n${failures} check(s) failed` : '\nall physics checks passed');
process.exit(failures ? 1 : 0);
