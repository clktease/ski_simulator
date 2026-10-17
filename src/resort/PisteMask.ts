import type { Heightmap } from '../world/Heightmap';
import * as THREE from 'three';
import type { Point2, ResortData } from './ResortData';

/** Corners of a rectangle rotated like a Three.js object (rotation.y = rot). */
export function rectCorners(cx: number, cz: number, width: number, depth: number, rot: number): Point2[] {
  const cos = Math.cos(rot), sin = Math.sin(rot);
  return ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([sx, sz]) => {
    const lx = (sx * width) / 2, lz = (sz * depth) / 2;
    return [cx + lx * cos + lz * sin, cz - lx * sin + lz * cos] as Point2;
  });
}

export const MASK_PISTE = 1;
export const MASK_LIFT = 2;
/** Building footprint: no trees */
export const MASK_BUILDING = 4;
/** Ploughed asphalt (parking, roads) */
export const MASK_PAVED = 8;

/** Per-heightmap-cell flags: groomed piste and lift corridors (no trees). */
export class PisteMask {
  readonly data: Uint8Array;
  private readonly n: number;

  constructor(
    private readonly hm: Heightmap,
    resort: ResortData,
    pisteHalfWidth = 18,
    liftHalfWidth = 10,
  ) {
    this.n = hm.meta.resolution;
    this.data = new Uint8Array(this.n * this.n);
    for (const run of resort.runs) {
      if (run.area) this.fillPolygon(run.points, MASK_PISTE);
      else this.strokeLine(run.points, pisteHalfWidth, MASK_PISTE);
    }
    for (const lift of resort.lifts) this.strokeLine(lift.points, liftHalfWidth, MASK_LIFT);
    for (const f of resort.facilities) {
      const corners = rectCorners(f.x, f.z, f.width + 6, f.depth + 6, THREE.MathUtils.degToRad(f.rotation));
      this.fillPolygon(corners, f.type === 'parking' ? MASK_PAVED : MASK_BUILDING);
    }
    // Walkways: groomed snow, no trees
    for (const p of resort.paths ?? []) this.strokeLine(p.points, p.width / 2 + 2, MASK_PISTE | MASK_BUILDING);
  }

  get(x: number, z: number) {
    const { cellM } = this.hm.meta;
    const i = Math.round((x + this.hm.half) / cellM);
    const j = Math.round((z + this.hm.half) / cellM);
    if (i < 0 || j < 0 || i >= this.n || j >= this.n) return 0;
    return this.data[j * this.n + i];
  }

  private cellRange(min: number, max: number) {
    const { cellM } = this.hm.meta;
    const a = Math.max(0, Math.floor((min + this.hm.half) / cellM));
    const b = Math.min(this.n - 1, Math.ceil((max + this.hm.half) / cellM));
    return [a, b];
  }

  private worldOf(i: number) {
    return -this.hm.half + i * this.hm.meta.cellM;
  }

  private strokeLine(pts: Point2[], hw: number, flag: number) {
    for (let s = 0; s < pts.length - 1; s++) {
      const [ax, az] = pts[s], [bx, bz] = pts[s + 1];
      const [i0, i1] = this.cellRange(Math.min(ax, bx) - hw, Math.max(ax, bx) + hw);
      const [j0, j1] = this.cellRange(Math.min(az, bz) - hw, Math.max(az, bz) + hw);
      const dx = bx - ax, dz = bz - az;
      const len2 = dx * dx + dz * dz || 1;
      for (let j = j0; j <= j1; j++) {
        const z = this.worldOf(j);
        for (let i = i0; i <= i1; i++) {
          const x = this.worldOf(i);
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
          const ex = ax + t * dx - x, ez = az + t * dz - z;
          if (ex * ex + ez * ez <= hw * hw) this.data[j * this.n + i] |= flag;
        }
      }
    }
  }

  private fillPolygon(pts: Point2[], flag: number) {
    const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
    const [i0, i1] = this.cellRange(Math.min(...xs), Math.max(...xs));
    const [j0, j1] = this.cellRange(Math.min(...zs), Math.max(...zs));
    for (let j = j0; j <= j1; j++) {
      const z = this.worldOf(j);
      for (let i = i0; i <= i1; i++) {
        const x = this.worldOf(i);
        let inside = false;
        for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) {
          const [xa, za] = pts[a], [xb, zb] = pts[b];
          if (za > z !== zb > z && x < ((xb - xa) * (z - za)) / (zb - za) + xa) inside = !inside;
        }
        if (inside) this.data[j * this.n + i] |= flag;
      }
    }
  }
}
