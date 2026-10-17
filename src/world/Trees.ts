import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Heightmap } from './Heightmap';
import type { PisteMask } from '../resort/PisteMask';
import { hash2 } from './Terrain';

export interface ForestOptions {
  center: [number, number];
  radius: number;
  step: number;
  max: number;
  /** share of bare deciduous trees (beech/oak) among the forest */
  deciduous: number;
}

const DEFAULTS: ForestOptions = { center: [-100, -150], radius: 1600, step: 7.5, max: 90000, deciduous: 0.35 };

function cedarGeometry() {
  // Two stacked cones read as a Japanese cedar (杉) from a distance
  const lower = new THREE.ConeGeometry(2.6, 7, 7).translate(0, 5.5, 0);
  const upper = new THREE.ConeGeometry(1.7, 5.5, 7).translate(0, 9.5, 0);
  const trunk = new THREE.CylinderGeometry(0.25, 0.35, 3, 5).translate(0, 1.5, 0);
  return mergeGeometries([lower, upper, trunk].map((g) => g.toNonIndexed()))!;
}

function bareTreeGeometry() {
  const parts: THREE.BufferGeometry[] = [new THREE.CylinderGeometry(0.18, 0.3, 9, 5).translate(0, 4.5, 0)];
  for (let b = 0; b < 5; b++) {
    const len = 3.5 - b * 0.3;
    const branch = new THREE.CylinderGeometry(0.05, 0.12, len, 4).translate(0, len / 2, 0);
    branch.rotateZ(0.7 + (b % 2) * 0.2);
    branch.rotateY((b / 5) * Math.PI * 2 + b);
    branch.translate(0, 4 + b * 1.0, 0);
    parts.push(branch);
  }
  return mergeGeometries(parts.map((g) => g.toNonIndexed()))!;
}

/** Forest placed from aerial-photo forest density, kept off pistes and lift lines. */
export function buildForest(hm: Heightmap, mask: PisteMask, options: Partial<ForestOptions> = {}) {
  const o = { ...DEFAULTS, ...options };
  const cedars: THREE.Matrix4[] = [], cedarColors: THREE.Color[] = [];
  const bare: THREE.Matrix4[] = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const green = new THREE.Color(0x26382b), snowy = new THREE.Color(0xc8d2d8);
  const [cx, cz] = o.center;

  for (let z = cz - o.radius; z <= cz + o.radius; z += o.step) {
    for (let x = cx - o.radius; x <= cx + o.radius; x += o.step) {
      if (cedars.length + bare.length >= o.max) break;
      if ((x - cx) ** 2 + (z - cz) ** 2 > o.radius ** 2) continue;
      const px = x + (hash2(z, x) - 0.5) * o.step;
      const pz = z + (hash2(x + 7, z - 3) - 0.5) * o.step;
      const density = THREE.MathUtils.smoothstep(hm.forestAt(px, pz), 0.35, 0.8);
      if (hash2(x, z) > density) continue;
      if (mask.get(px, pz) !== 0 || hm.slopeAt(px, pz) > 45) continue;

      const s = 0.7 + hash2(px, pz) * 0.8;
      q.setFromAxisAngle(up, hash2(pz, px) * Math.PI * 2);
      m.compose(new THREE.Vector3(px, hm.heightAt(px, pz) - 0.3, pz), q, new THREE.Vector3(s, s * (0.9 + hash2(px * 3, pz) * 0.4), s));
      if (hash2(px * 1.7, pz * 0.3) < o.deciduous) {
        bare.push(m.clone());
      } else {
        cedars.push(m.clone());
        cedarColors.push(green.clone().lerp(snowy, 0.05 + 0.3 * hash2(pz * 2.3, px)));
      }
    }
  }

  const group = new THREE.Group();
  const cedarMesh = new THREE.InstancedMesh(
    cedarGeometry(),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }),
    cedars.length,
  );
  cedars.forEach((mm, i) => {
    cedarMesh.setMatrixAt(i, mm);
    cedarMesh.setColorAt(i, cedarColors[i]);
  });
  const bareMesh = new THREE.InstancedMesh(
    bareTreeGeometry(),
    new THREE.MeshStandardMaterial({ color: 0x5a5048, roughness: 1 }),
    bare.length,
  );
  bare.forEach((mm, i) => bareMesh.setMatrixAt(i, mm));
  for (const mesh of [cedarMesh, bareMesh]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
