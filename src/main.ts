import * as THREE from 'three';
import { Engine } from './core/Engine';
import { Heightmap } from './world/Heightmap';
import { buildOuterTerrain, buildTerrain } from './world/Terrain';
import { buildForest } from './world/Trees';
import { SkyLight } from './world/SkyLight';
import { loadResort } from './resort/ResortData';
import { PisteMask } from './resort/PisteMask';
import { LiftLine } from './resort/Lifts';
import { buildRunPaths } from './resort/RunPaths';
import { PisteGuide } from './world/PisteGuide';
import { Buildings } from './resort/Buildings';
import { Game } from './game/Game';
import { loadQuality } from './core/Quality';

const RESORT = 'iwappara';
const base = `${import.meta.env.BASE_URL}data/${RESORT}`;

async function main() {
  const [hm, resort] = await Promise.all([Heightmap.load(base), loadResort(base)]);
  const quality = loadQuality();
  const engine = new Engine(document.getElementById('app')!, quality);
  const { scene } = engine;

  // Grade building pads before any terrain-dependent geometry is built
  const pads = Buildings.gradeSites(hm, resort.facilities);
  const sky = new SkyLight(scene, engine.renderer, quality.shadowMap);
  const mask = new PisteMask(hm, resort);
  const terrain = buildTerrain(hm, mask);
  scene.add(terrain.group);
  const outer = buildOuterTerrain(hm);
  if (outer) scene.add(outer.group);
  const forest = buildForest(hm, mask, { max: quality.maxTrees });
  scene.add(forest.group);

  const lifts = resort.lifts.map((l) => new LiftLine(l, hm));
  for (const l of lifts) scene.add(l.group);
  const runPaths = buildRunPaths(hm, resort.runs, resort.lifts);
  const pisteGuide = new PisteGuide(hm, runPaths);
  scene.add(pisteGuide.group);
  const buildings = new Buildings(resort.facilities, pads);
  scene.add(buildings.group);

  const game = new Game(engine, { hm, resort, mask, trees: forest.index, sky, lifts, buildings, runPaths, pisteGuide });

  const params = new URLSearchParams(location.search);
  // Debug: ?spawn=x,z,headingDeg
  const spawnParam = params.get('spawn')?.split(',').map(Number);
  const spawn = spawnParam?.length === 3 ? { x: spawnParam[0], z: spawnParam[1], heading: spawnParam[2] } : resort.spawn;
  game.spawn(spawn.x, spawn.z, spawn.heading);

  // Debug viewpoint: ?cam=x,y,z,lookX,lookY,lookZ starts in fly mode there
  const camParam = params.get('cam')?.split(',').map(Number);
  if (camParam?.length === 6) {
    game.flyTo(new THREE.Vector3(camParam[0], camParam[1], camParam[2]), new THREE.Vector3(camParam[3], camParam[4], camParam[5]));
  }

  engine.onUpdate((dt, elapsed) => {
    game.update(dt, elapsed);
    game.input.endFrame();
    terrain.update(engine.camera);
    outer?.update(engine.camera);
    forest.update(engine.camera);
  });

  // Handle for automated tests / console tinkering
  (window as unknown as { game: Game }).game = game;

  document.getElementById('loading')!.remove();
  engine.start();
}

main().catch((err) => {
  console.error(err);
  document.getElementById('loading')!.textContent = `載入失敗：${err}`;
});
