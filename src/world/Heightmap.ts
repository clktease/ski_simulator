import * as THREE from 'three';

export interface HeightmapMeta {
  resolution: number;
  cellM: number;
  sizeM: number;
  centerLat: number;
  centerLon: number;
  minElevation: number;
  maxElevation: number;
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
    const [meta, buf] = await Promise.all([
      fetch(`${baseUrl}/heightmap.json`).then((r) => r.json() as Promise<HeightmapMeta>),
      fetch(`${baseUrl}/heightmap.bin`).then((r) => r.arrayBuffer()),
    ]);
    return new Heightmap(meta, new Float32Array(buf));
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
