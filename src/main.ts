import * as THREE from 'three';
import { Engine } from './core/Engine';
import { Input } from './core/Input';
import { FlyCamera } from './core/FlyCamera';
import { Heightmap } from './world/Heightmap';
import { buildOuterTerrain, buildTerrain } from './world/Terrain';
import { buildForest } from './world/Trees';
import { SkyLight } from './world/SkyLight';
import { loadResort } from './resort/ResortData';
import { PisteMask } from './resort/PisteMask';
import { LiftLine } from './resort/Lifts';
import { buildRunLines } from './resort/RunLines';
import { Buildings } from './resort/Buildings';
import { WalkController } from './player/WalkController';
import { InteractionUI } from './ui/Interaction';

const RESORT = 'iwappara';
const base = `${import.meta.env.BASE_URL}data/${RESORT}`;

type Mode = 'walk' | 'fly';
const HELP: Record<Mode, string> = {
  walk: '點擊畫面開始 · WASD 走路 · Shift 跑步 · 滑鼠轉視角 · 滾輪縮放 · E 互動 · F 切換飛行模式',
  fly: '飛行模式 · WASD 移動 · Space/Shift 升降 · Ctrl 加速 · M 雪道線 · F 回到步行',
};

async function main() {
  const [hm, resort] = await Promise.all([Heightmap.load(base), loadResort(base)]);
  const engine = new Engine(document.getElementById('app')!);
  const { scene, camera } = engine;
  const input = new Input(engine.renderer.domElement);

  // Grade building pads before any terrain-dependent geometry is built
  const pads = Buildings.gradeSites(hm, resort.facilities);
  const sky = new SkyLight(scene, engine.renderer);
  const mask = new PisteMask(hm, resort);
  scene.add(buildTerrain(hm, mask));
  const outer = buildOuterTerrain(hm);
  if (outer) scene.add(outer);
  scene.add(buildForest(hm, mask));

  const lifts = resort.lifts.map((l) => new LiftLine(l, hm));
  for (const l of lifts) scene.add(l.group);
  const runLines = buildRunLines(hm, resort);
  runLines.visible = false;
  scene.add(runLines);
  const buildings = new Buildings(resort.facilities, pads);
  scene.add(buildings.group);

  const walker = new WalkController(camera, input, hm, buildings.colliders);
  // Debug: ?spawn=x,z,headingDeg
  const spawnParam = new URLSearchParams(location.search).get('spawn')?.split(',').map(Number);
  const spawn = spawnParam?.length === 3 ? { x: spawnParam[0], z: spawnParam[1], heading: spawnParam[2] } : resort.spawn;
  walker.spawn(spawn.x, spawn.z, spawn.heading);
  scene.add(walker.character.root);
  const interaction = new InteractionUI(input, buildings.interactions);
  const fly = new FlyCamera(camera, input, (x, z) => hm.heightAt(x, z));

  let mode: Mode = 'walk';
  const help = document.getElementById('help')!;
  const setMode = (m: Mode) => {
    mode = m;
    help.textContent = HELP[m];
    if (m === 'fly') {
      camera.position.y += 30;
      fly.lookAt(walker.position);
    }
  };
  setMode('walk');

  // Debug viewpoint: ?cam=x,y,z,lookX,lookY,lookZ starts in fly mode there
  const camParam = new URLSearchParams(location.search).get('cam')?.split(',').map(Number);
  if (camParam?.length === 6) {
    setMode('fly');
    camera.position.set(camParam[0], camParam[1], camParam[2]);
    fly.lookAt(new THREE.Vector3(camParam[3], camParam[4], camParam[5]));
  }

  const stats = document.getElementById('hud-stats')!;
  let fpsAcc = 0, fpsFrames = 0, fps = 0, hudTimer = 0;
  engine.onUpdate((dt, elapsed) => {
    if (input.wasPressed('KeyF')) setMode(mode === 'walk' ? 'fly' : 'walk');
    if (input.wasPressed('KeyM')) runLines.visible = !runLines.visible;

    if (mode === 'walk') {
      walker.update(dt);
      interaction.update(walker.position);
    } else {
      fly.update(dt);
    }
    for (const l of lifts) l.update(dt);
    buildings.update(elapsed);
    sky.follow(mode === 'walk' ? walker.position : camera.position);

    fpsAcc += dt; fpsFrames++;
    if (fpsAcc >= 0.5) { fps = fpsFrames / fpsAcc; fpsAcc = 0; fpsFrames = 0; }
    hudTimer -= dt;
    if (hudTimer <= 0) {
      hudTimer = 0.2;
      const p = mode === 'walk' ? walker.position : camera.position;
      const ground = hm.heightAt(p.x, p.z);
      const [lat, lon] = hm.toLatLon(p.x, p.z);
      stats.innerHTML = [
        `海拔 ${ground.toFixed(1)} m`,
        `坡度 ${hm.slopeAt(p.x, p.z).toFixed(1)}°`,
        `${lat.toFixed(5)}N ${lon.toFixed(5)}E`,
        `${fps.toFixed(0)} fps`,
      ].join('<br>');
    }
    input.endFrame();
  });

  document.getElementById('loading')!.remove();
  engine.start();
}

main().catch((err) => {
  console.error(err);
  document.getElementById('loading')!.textContent = `載入失敗：${err}`;
});
