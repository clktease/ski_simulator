import * as THREE from 'three';

export interface HeightmapMeta {
  resolution: number;
  cellM: number;
  sizeM: number;
  centerLat: number;
  centerLon: number;
  minElevation: number;
  maxElevation: number;
  outer?: Omit<HeightmapMeta, 'outer'>;
}

/** Real elevation grid in local metres. +x = east, +z = south, y = elevation above sea level. */
export class Heightmap {
  readonly half: number;

  constructor(
    readonly meta: HeightmapMeta,
    readonly data: Float32Array,
  ) {
    this.half = meta.sizeM / 2;
  }

  static async load(baseUrl: string) {
    const meta: HeightmapMeta = await fetch(`${baseUrl}/heightmap.json`).then((r) => r.json());
    const bin = (name: string) => fetch(`${baseUrl}/${name}`).then((r) => r.arrayBuffer());
    const [main, forest, outer] = await Promise.all([
      bin('heightmap.bin'),
      bin('forest.bin'),
      meta.outer ? bin('outer.bin') : Promise.resolve(null),
    ]);
    const hm = new Heightmap(meta, new Float32Array(main));
    hm.forest = new Uint8Array(forest);
    if (meta.outer && outer) hm.outer = new Heightmap(meta.outer, new Float32Array(outer));
    return hm;
  }

  /** Forest density per cell (0–255), estimated from aerial photos. */
  forest: Uint8Array | null = null;
  /** Low-res surroundings beyond the playable square. */
  outer: Heightmap | null = null;

  /** Forest density 0–1 at world (x, z) (nearest cell). */
  forestAt(x: number, z: number) {
    if (!this.forest) return 0;
    const n = this.meta.resolution;
    const i = Math.round((x + this.half) / this.meta.cellM);
    const j = Math.round((z + this.half) / this.meta.cellM);
    if (i < 0 || j < 0 || i >= n || j >= n) return 0;
    return this.forest[j * n + i] / 255;
  }

  /**
   * Grade a rotated rectangle flat (building pads, parking lots), blending back into
   * the natural slope over `blend` metres. Must run before meshes are built.
   * Returns the pad elevation.
   */
  flattenRect(cx: number, cz: number, width: number, depth: number, rotationRad: number, blend = 8) {
    const { resolution: n, cellM } = this.meta;
    const cos = Math.cos(rotationRad), sin = Math.sin(rotationRad);
    const hw = width / 2, hd = depth / 2;
    const reach = Math.hypot(hw, hd) + blend;
    const i0 = Math.max(0, Math.floor((cx - reach + this.half) / cellM));
    const i1 = Math.min(n - 1, Math.ceil((cx + reach + this.half) / cellM));
    const j0 = Math.max(0, Math.floor((cz - reach + this.half) / cellM));
    const j1 = Math.min(n - 1, Math.ceil((cz + reach + this.half) / cellM));

    // Local frame: rotation.y turns local +z towards (sin r, cos r)
    const toLocal = (x: number, z: number): [number, number] => {
      const dx = x - cx, dz = z - cz;
      return [dx * cos - dz * sin, dx * sin + dz * cos];
    };

    let sum = 0, count = 0;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const [lx, lz] = toLocal(-this.half + i * cellM, -this.half + j * cellM);
        if (Math.abs(lx) <= hw && Math.abs(lz) <= hd) { sum += this.data[j * n + i]; count++; }
      }
    }
    const target = count ? sum / count : this.heightAt(cx, cz);

    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const [lx, lz] = toLocal(-this.half + i * cellM, -this.half + j * cellM);
        const ex = Math.max(0, Math.abs(lx) - hw), ez = Math.max(0, Math.abs(lz) - hd);
        const d = Math.hypot(ex, ez);
        if (d >= blend) continue;
        const w = 1 - THREE.MathUtils.smoothstep(d, 0, blend);
        const k = j * n + i;
        this.data[k] += (target - this.data[k]) * w;
      }
    }
    return target;
  }

  /** Keep a point inside the detailed terrain square. */
  clampInside(p: THREE.Vector3, margin = 10) {
    const lim = this.half - margin;
    p.x = THREE.MathUtils.clamp(p.x, -lim, lim);
    p.z = THREE.MathUtils.clamp(p.z, -lim, lim);
  }

  /** Grid sample, clamped to the edges. */
  at(i: number, j: number) {
    const n = this.meta.resolution;
    i = Math.min(n - 1, Math.max(0, i));
    j = Math.min(n - 1, Math.max(0, j));
    return this.data[j * n + i];
  }

  /** Bilinear elevation at world (x, z). */
  heightAt(x: number, z: number) {
    const fx = (x + this.half) / this.meta.cellM;
    const fz = (z + this.half) / this.meta.cellM;
    const i = Math.floor(fx), j = Math.floor(fz);
    const dx = fx - i, dz = fz - j;
    const h00 = this.at(i, j), h10 = this.at(i + 1, j);
    const h01 = this.at(i, j + 1), h11 = this.at(i + 1, j + 1);
    return (h00 * (1 - dx) + h10 * dx) * (1 - dz) + (h01 * (1 - dx) + h11 * dx) * dz;
  }

  normalAt(x: number, z: number, target = new THREE.Vector3()) {
    const e = this.meta.cellM;
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return target.set(-hx, 2 * e, -hz).normalize();
  }

  /** Slope angle in degrees at world (x, z). */
  slopeAt(x: number, z: number) {
    const n = this.normalAt(x, z);
    return THREE.MathUtils.radToDeg(Math.acos(n.y));
  }

  /** World (x, z) -> [lat, lon] */
  toLatLon(x: number, z: number): [number, number] {
    const mPerDegLat = (Math.PI / 180) * 6378137;
    const mPerDegLon = mPerDegLat * Math.cos(THREE.MathUtils.degToRad(this.meta.centerLat));
    return [this.meta.centerLat - z / mPerDegLat, this.meta.centerLon + x / mPerDegLon];
  }
}
