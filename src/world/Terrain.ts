import * as THREE from 'three';
import type { Heightmap } from './Heightmap';
import { MASK_PISTE, type PisteMask } from '../resort/PisteMask';

/** Cheap deterministic hash noise in [0, 1). */
export function hash2(x: number, z: number) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Single full-resolution terrain mesh with baked vertex colours.
 * TODO(perf): split into chunks with LOD once the play area grows.
 */
export function buildTerrain(hm: Heightmap, mask: PisteMask) {
  const { resolution: n, sizeM } = hm.meta;
  const geo = new THREE.PlaneGeometry(sizeM, sizeM, n - 1, n - 1);
  geo.rotateX(-Math.PI / 2); // row 0 -> north (-z), matching the heightmap layout

  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let k = 0; k < pos.count; k++) pos.setY(k, hm.data[k]);
  geo.computeVertexNormals();

  const nrm = geo.attributes.normal as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const groomed = new THREE.Color(0.95, 0.96, 0.98);
  const powder = new THREE.Color(0.86, 0.89, 0.95);
  const forest = new THREE.Color(0.72, 0.75, 0.8);
  const rock = new THREE.Color(0.32, 0.31, 0.3);
  const c = new THREE.Color();
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k), z = pos.getZ(k);
    const slope = THREE.MathUtils.radToDeg(Math.acos(nrm.getY(k)));
    const onPiste = (mask.data[k] & MASK_PISTE) !== 0;
    if (onPiste) c.copy(groomed);
    else c.copy(powder).lerp(forest, 0.5 * hash2(Math.floor(x / 23), Math.floor(z / 23)));
    // Snow cannot hold on very steep faces
    c.lerp(rock, THREE.MathUtils.smoothstep(slope, 38, 55));
    const v = 0.97 + 0.03 * hash2(x, z);
    colors[k * 3] = c.r * v;
    colors[k * 3 + 1] = c.g * v;
    colors[k * 3 + 2] = c.b * v;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}
