import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Collapse the static meshes under `root` into one mesh per material (draw calls: dozens -> a few).
 * Instanced meshes, lines and anything named are left alone; merged meshes cast and receive shadows.
 */
export function mergeStatic(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert();
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const merged: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || o instanceof THREE.InstancedMesh || o.name || Array.isArray(o.material)) return;
    const geo = (o.geometry as THREE.BufferGeometry).index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geo.deleteAttribute(name);
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, o.matrixWorld));
    const list = byMat.get(o.material) ?? [];
    list.push(geo);
    byMat.set(o.material, list);
    merged.push(o);
  });
  for (const o of merged) o.removeFromParent();
  for (const [material, geos] of byMat) {
    const mesh = new THREE.Mesh(mergeGeometries(geos)!, material);
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
    for (const g of geos) g.dispose();
  }
  return root;
}
