import * as THREE from 'three';
import type { Heightmap } from '../world/Heightmap';
import { DIFFICULTY_COLOR, type ResortData } from './ResortData';

/** Coloured trail-map lines draped over the terrain (debug / map view). */
export function buildRunLines(hm: Heightmap, resort: ResortData) {
  const group = new THREE.Group();
  for (const run of resort.runs) {
    const pts: THREE.Vector3[] = [];
    const src = run.area ? [...run.points, run.points[0]] : run.points;
    for (let s = 0; s < src.length - 1; s++) {
      const [ax, az] = src[s], [bx, bz] = src[s + 1];
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 6));
      for (let k = 0; k < steps; k++) {
        const x = ax + ((bx - ax) * k) / steps, z = az + ((bz - az) * k) / steps;
        pts.push(new THREE.Vector3(x, hm.heightAt(x, z) + 0.8, z));
      }
    }
    const [lx, lz] = src[src.length - 1];
    pts.push(new THREE.Vector3(lx, hm.heightAt(lx, lz) + 0.8, lz));
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: DIFFICULTY_COLOR[run.difficulty] ?? 0x888888, transparent: true, opacity: 0.7 }),
    );
    group.add(line);
  }
  return group;
}
