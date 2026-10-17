import * as THREE from 'three';
import { Engine } from './core/Engine';
import { FlyCamera } from './core/FlyCamera';
import { Heightmap } from './world/Heightmap';
import { buildTerrain } from './world/Terrain';
import { buildForest } from './world/Trees';
import { SkyLight } from './world/SkyLight';
import { loadResort } from './resort/ResortData';
import { PisteMask } from './resort/PisteMask';
import { LiftLine } from './resort/Lifts';
import { buildRunLines } from './resort/RunLines';

const RESORT = 'iwappara';
const base = `${import.meta.env.BASE_URL}data/${RESORT}`;

async function main() {
  const [hm, resort] = await Promise.all([Heightmap.load(base), loadResort(base)]);
  const engine = new Engine(document.getElementById('app')!);
  const { scene, camera } = engine;

  const sky = new SkyLight(scene, engine.renderer);
  const mask = new PisteMask(hm, resort);
  scene.add(buildTerrain(hm, mask));
  scene.add(buildForest(hm, mask));

  const lifts = resort.lifts.map((l) => new LiftLine(l, hm));
  for (const l of lifts) scene.add(l.group);
  const runLines = buildRunLines(hm, resort);
  scene.add(runLines);

  // Start at the bottom of the central quad, looking uphill
  const startLift = lifts.find((l) => l.data.name?.includes('中央')) ?? lifts[0];
  const bottom = startLift.loop.getPointAt(0);
  const topPt = startLift.loop.getPointAt(0.49);
  camera.position.set(bottom.x - 60, bottom.y + 25, bottom.z + 80);
  const fly = new FlyCamera(camera, engine.renderer.domElement, (x, z) => hm.heightAt(x, z));
  fly.lookAt(topPt);

  // Debug viewpoint: ?cam=x,y,z,lookX,lookY,lookZ
  const camParam = new URLSearchParams(location.search).get('cam')?.split(',').map(Number);
  if (camParam?.length === 6) {
    camera.position.set(camParam[0], camParam[1], camParam[2]);
    fly.lookAt(new THREE.Vector3(camParam[3], camParam[4], camParam[5]));
  }

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyM') runLines.visible = !runLines.visible;
  });

  const stats = document.getElementById('hud-stats')!;
  let fpsAcc = 0, fpsFrames = 0, fps = 0, hudTimer = 0;
  engine.onUpdate((dt) => {
    fly.update(dt);
    for (const l of lifts) l.update(dt);
    sky.follow(camera.position);

    fpsAcc += dt; fpsFrames++;
    if (fpsAcc >= 0.5) { fps = fpsFrames / fpsAcc; fpsAcc = 0; fpsFrames = 0; }
    hudTimer -= dt;
    if (hudTimer <= 0) {
      hudTimer = 0.2;
      const { x, z } = camera.position;
      const ground = hm.heightAt(x, z);
      const [lat, lon] = hm.toLatLon(x, z);
      stats.innerHTML = [
        `海拔（地面）${ground.toFixed(1)} m`,
        `鏡頭高度 +${(camera.position.y - ground).toFixed(1)} m`,
        `坡度 ${hm.slopeAt(x, z).toFixed(1)}°`,
        `${lat.toFixed(5)}N ${lon.toFixed(5)}E`,
        `${fps.toFixed(0)} fps · M 切換雪道線`,
      ].join('<br>');
    }
  });

  document.getElementById('loading')!.remove();
  engine.start();
}

main().catch((err) => {
  console.error(err);
  document.getElementById('loading')!.textContent = `載入失敗：${err}`;
});

// Expose for console debugging
(window as unknown as { THREE: typeof THREE }).THREE = THREE;
