import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Heightmap } from './Heightmap';
import type { PisteMask } from '../resort/PisteMask';
import { hash2 } from './Terrain';

/** Snow-dusted cedar forest (杉) as instanced meshes, kept off pistes and lift lines. */
export function buildForest(hm: Heightmap, mask: PisteMask, opts = { radius: 1900, step: 8, density: 0.55, max: 60000 }) {
  // Two stacked cones read as a Japanese cedar from a distance
  const lower = new THREE.ConeGeometry(2.6, 7, 7).translate(0, 5.5, 0);
  const upper = new THREE.ConeGeometry(1.7, 5.5, 7).translate(0, 9.5, 0);
  const foliageGeo = mergeGeometries([lower, upper])!;
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 3, 5).translate(0, 1.5, 0);

  const foliageMat = new THREE.MeshStandardMaterial({ color: 0x2c3d30, roughness: 0.95, flatShading: true });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3b2e25, roughness: 1 });

  const matrices: THREE.Matrix4[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (let z = -opts.radius; z <= opts.radius && matrices.length < opts.max; z += opts.step) {
    for (let x = -opts.radius; x <= opts.radius && matrices.length < opts.max; x += opts.step) {
      if (x * x + z * z > opts.radius * opts.radius) continue;
      if (hash2(x, z) > opts.density) continue;
      const px = x + (hash2(z, x) - 0.5) * opts.step;
      const pz = z + (hash2(x + 7, z - 3) - 0.5) * opts.step;
      if (mask.get(px, pz) !== 0) continue;
      if (hm.slopeAt(px, pz) > 42) continue;
      const s = 0.7 + hash2(px, pz) * 0.8;
      q.setFromAxisAngle(up, hash2(pz, px) * Math.PI * 2);
      m.compose(new THREE.Vector3(px, hm.heightAt(px, pz) - 0.3, pz), q, new THREE.Vector3(s, s * (0.9 + hash2(px * 3, pz) * 0.4), s));
      matrices.push(m.clone());
    }
  }

  const group = new THREE.Group();
  for (const [geo, mat] of [[foliageGeo, foliageMat], [trunkGeo, trunkMat]] as const) {
    const inst = new THREE.InstancedMesh(geo, mat, matrices.length);
    matrices.forEach((mm, i) => inst.setMatrixAt(i, mm));
    inst.castShadow = true;
    inst.receiveShadow = true;
    group.add(inst);
  }
  return group;
}
