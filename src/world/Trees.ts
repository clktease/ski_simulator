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

/** Spatial hash of tree trunks for collisions. */
export class TreeIndex {
  private readonly cells = new Map<number, number[]>();
  private static readonly CELL = 8;

  add(x: number, z: number, radius: number) {
    const key = TreeIndex.key(Math.floor(x / TreeIndex.CELL), Math.floor(z / TreeIndex.CELL));
    let list = this.cells.get(key);
    if (!list) this.cells.set(key, (list = []));
    list.push(x, z, radius);
  }

  /** Nearest trunk overlapping a circle at (x, z), or null. */
  hit(x: number, z: number, r: number): { x: number; z: number; overlap: number } | null {
    const ci = Math.floor(x / TreeIndex.CELL), cj = Math.floor(z / TreeIndex.CELL);
    let best: { x: number; z: number; overlap: number } | null = null;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const list = this.cells.get(TreeIndex.key(ci + di, cj + dj));
        if (!list) continue;
        for (let k = 0; k < list.length; k += 3) {
          const overlap = r + list[k + 2] - Math.hypot(list[k] - x, list[k + 1] - z);
          if (overlap > 0 && (!best || overlap > best.overlap)) best = { x: list[k], z: list[k + 1], overlap };
        }
      }
    }
    return best;
  }

  private static key(i: number, j: number) {
    return (i + 4096) * 8192 + (j + 4096);
  }
}

/** Forest placed from aerial-photo forest density, kept off pistes and lift lines. */
export function buildForest(hm: Heightmap, mask: PisteMask, options: Partial<ForestOptions> = {}) {
  const o = { ...DEFAULTS, ...options };
  const cedars: THREE.Matrix4[] = [], cedarColors: THREE.Color[] = [];
  const bare: THREE.Matrix4[] = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const green = new THREE.Color(0x26382b), snowy = new THREE.Color(0xc8d2d8);
  const [cx, cz] = o.center;
  const index = new TreeIndex();

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
      // trunk + lower branches collision radius
      index.add(px, pz, 0.45 * s);
      if (hash2(px * 1.7, pz * 0.3) < o.deciduous) {
        bare.push(m.clone());
      } else {
        cedars.push(m.clone());
        cedarColors.push(green.clone().lerp(snowy, 0.05 + 0.3 * hash2(pz * 2.3, px)));
      }
    }
  }

  const lod = new ForestLod(cedars, cedarColors, bare);
  return { group: lod.group, update: (camera: THREE.Camera) => lod.update(camera), index };
}

/** Far-away stand-ins: a single open cone per tree, a few triangles instead of ~50. */
function cedarFarGeometry() {
  return new THREE.ConeGeometry(2.5, 11, 6, 1, true).translate(0, 7, 0);
}
function bareFarGeometry() {
  return new THREE.ConeGeometry(0.9, 9, 3, 1, true).translate(0, 4.5, 0);
}

const CELL = 400; // m per forest cell
const NEAR = 480; // full trees (and shadows) within this distance of a cell

/**
 * Forest split into square cells so each frustum-culls on its own; every cell has a full-detail
 * and a far InstancedMesh sharing one instance buffer, swapped by camera distance.
 */
class ForestLod {
  readonly group = new THREE.Group();
  private readonly cells: { near: THREE.InstancedMesh[]; far: THREE.InstancedMesh[]; x: number; z: number; isNear: boolean }[] = [];

  constructor(cedars: THREE.Matrix4[], cedarColors: THREE.Color[], bare: THREE.Matrix4[]) {
    const cedarMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
    const bareMat = new THREE.MeshStandardMaterial({ color: 0x5a5048, roughness: 1 });
    const kinds = [
      { near: cedarGeometry(), far: cedarFarGeometry(), mat: cedarMat, list: cedars, colors: cedarColors as THREE.Color[] | null },
      { near: bareTreeGeometry(), far: bareFarGeometry(), mat: bareMat, list: bare, colors: null },
    ];
    const byCell = new Map<string, { x: number; z: number; items: [number, THREE.Matrix4, THREE.Color | null][] }>();
    const p = new THREE.Vector3();
    kinds.forEach((k, kind) =>
      k.list.forEach((m, i) => {
        p.setFromMatrixPosition(m);
        const cx = Math.floor(p.x / CELL), cz = Math.floor(p.z / CELL);
        const key = `${cx},${cz}`;
        let cell = byCell.get(key);
        if (!cell) byCell.set(key, (cell = { x: (cx + 0.5) * CELL, z: (cz + 0.5) * CELL, items: [] }));
        cell.items.push([kind, m, k.colors ? k.colors[i] : null]);
      }),
    );

    for (const cell of byCell.values()) {
      const entry = { near: [] as THREE.InstancedMesh[], far: [] as THREE.InstancedMesh[], x: cell.x, z: cell.z, isNear: true };
      kinds.forEach((k, kind) => {
        const items = cell.items.filter((it) => it[0] === kind);
        if (!items.length) return;
        const near = new THREE.InstancedMesh(k.near, k.mat, items.length);
        items.forEach(([, m, c], i) => {
          near.setMatrixAt(i, m);
          if (c) near.setColorAt(i, c);
        });
        near.castShadow = near.receiveShadow = true;
        const far = new THREE.InstancedMesh(k.far, k.mat, items.length);
        far.instanceMatrix = near.instanceMatrix;
        far.instanceColor = near.instanceColor;
        far.receiveShadow = true;
        far.visible = false;
        for (const mesh of [near, far]) {
          mesh.matrixAutoUpdate = false;
          mesh.computeBoundingSphere();
          this.group.add(mesh);
        }
        entry.near.push(near);
        entry.far.push(far);
      });
      this.cells.push(entry);
    }
  }

  update(camera: THREE.Camera) {
    const cam = camera.position;
    for (const c of this.cells) {
      const d = Math.hypot(c.x - cam.x, c.z - cam.z);
      // hysteresis so a cell on the boundary does not flicker between levels
      const near = c.isNear ? d < NEAR + 60 : d < NEAR;
      if (near === c.isNear) continue;
      c.isNear = near;
      for (const m of c.near) m.visible = near;
      for (const m of c.far) m.visible = !near;
    }
  }
}
