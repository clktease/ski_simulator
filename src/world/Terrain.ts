import * as THREE from 'three';
import type { Heightmap } from './Heightmap';
import { MASK_PISTE, type PisteMask } from '../resort/PisteMask';

/** Cheap deterministic hash noise in [0, 1). */
export function hash2(x: number, z: number) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

const GROOMED = new THREE.Color(0.95, 0.96, 0.98);
const POWDER = new THREE.Color(0.88, 0.91, 0.96);
const UNDER_CANOPY = new THREE.Color(0.62, 0.65, 0.7);
const ROCK = new THREE.Color(0.32, 0.31, 0.3);

function snowColor(c: THREE.Color, slopeDeg: number, forest: number, onPiste: boolean, x: number, z: number) {
  if (onPiste) c.copy(GROOMED);
  else c.copy(POWDER).lerp(UNDER_CANOPY, forest * (0.6 + 0.4 * hash2(Math.floor(x / 9), Math.floor(z / 9))));
  // Snow cannot hold on very steep faces
  c.lerp(ROCK, THREE.MathUtils.smoothstep(slopeDeg, 38, 55));
  return c.multiplyScalar(0.97 + 0.03 * hash2(x, z));
}

function gridGeometry(hm: Heightmap) {
  const { resolution: n, sizeM } = hm.meta;
  const geo = new THREE.PlaneGeometry(sizeM, sizeM, n - 1, n - 1);
  geo.rotateX(-Math.PI / 2); // row 0 -> north (-z), matching the heightmap layout
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let k = 0; k < pos.count; k++) pos.setY(k, hm.data[k]);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Single full-resolution terrain mesh with baked vertex colours.
 * TODO(perf): split into chunks with LOD once the play area grows.
 */
export function buildTerrain(hm: Heightmap, mask: PisteMask) {
  const geo = gridGeometry(hm);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nrm = geo.attributes.normal as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k), z = pos.getZ(k);
    const slope = THREE.MathUtils.radToDeg(Math.acos(nrm.getY(k)));
    const forest = hm.forest ? hm.forest[k] / 255 : 0;
    snowColor(c, slope, forest, (mask.data[k] & MASK_PISTE) !== 0, x, z);
    c.toArray(colors, k * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Low-res surroundings. Inside the playable square it is sunk below the detailed terrain
 * so the two never z-fight; outside it carries forest tint to read as wooded mountains.
 */
export function buildOuterTerrain(hm: Heightmap) {
  const outer = hm.outer;
  if (!outer) return null;
  const geo = gridGeometry(outer);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const inner = hm.half - outer.meta.cellM;
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k), z = pos.getZ(k);
    if (Math.abs(x) < inner && Math.abs(z) < inner) pos.setY(k, hm.heightAt(x, z) - 4);
  }
  geo.computeVertexNormals();

  const nrm = geo.attributes.normal as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k);
    const slope = THREE.MathUtils.radToDeg(Math.acos(nrm.getY(k)));
    // Distant slopes below ~1500 m are mostly forested; bare alpine ridges above that
    const forest = (1 - THREE.MathUtils.smoothstep(y, 1300, 1700)) * (0.5 + 0.5 * hash2(Math.floor(x / 200), Math.floor(z / 200)));
    snowColor(c, slope, forest, false, x, z);
    c.toArray(colors, k * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
  mesh.receiveShadow = true;
  return mesh;
}
