import * as THREE from 'three';

const CHUNK = 128; // cells per chunk side ((CHUNK+1)² + ring vertices must fit 16-bit indices)
const STEPS = [1, 2, 4, 8]; // vertex stride per LOD level

export interface TerrainLodOptions {
  /** camera distance (m) at which each coarser level starts: [lod1, lod2, lod3] */
  distances: [number, number, number];
  /** how far skirts hang below the chunk edge to hide cracks between levels (m) */
  skirt: number;
  /** drop chunks whose centre satisfies this (e.g. hidden under the detailed terrain) */
  skip?: (cx: number, cz: number) => boolean;
}

/**
 * Index buffers shared by every chunk: one per LOD, each with a skirt around the border.
 * Chunk vertex layout: (CHUNK+1)² grid vertices, then the ring of skirt vertices.
 */
function buildIndices() {
  const n = CHUNK + 1;
  // perimeter walked clockwise from the north-west corner, as grid (row, col)
  const ring: [number, number][] = [];
  for (let c = 0; c < CHUNK; c++) ring.push([0, c]);
  for (let r = 0; r < CHUNK; r++) ring.push([r, CHUNK]);
  for (let c = CHUNK; c > 0; c--) ring.push([CHUNK, c]);
  for (let r = CHUNK; r > 0; r--) ring.push([r, 0]);

  const indices = STEPS.map((step) => {
    const idx: number[] = [];
    for (let r = 0; r < CHUNK; r += step) {
      for (let c = 0; c < CHUNK; c += step) {
        const a = r * n + c, b = a + step, d = (r + step) * n + c, e = d + step;
        idx.push(a, d, b, b, d, e);
      }
    }
    // skirt: a vertical strip under every edge segment, both windings so it hides cracks from either side
    for (let k = 0; k < ring.length; k += step) {
      const k2 = (k + step) % ring.length;
      const g0 = ring[k][0] * n + ring[k][1], g1 = ring[k2][0] * n + ring[k2][1];
      const s0 = n * n + k, s1 = n * n + k2;
      idx.push(g0, s0, g1, g1, s0, s1, g0, g1, s0, g1, s1, s0);
    }
    return new THREE.BufferAttribute(new Uint16Array(idx), 1);
  });
  return { ring, indices };
}

/**
 * Splits a full-resolution grid (PlaneGeometry layout, already displaced, with normals and colours)
 * into chunks that frustum-cull individually and switch to coarser index buffers with distance.
 */
export class TerrainLod {
  readonly group = new THREE.Group();
  private readonly chunks: { mesh: THREE.Mesh; center: THREE.Vector3; lod: number }[] = [];
  private readonly indices: THREE.BufferAttribute[];

  constructor(full: THREE.BufferGeometry, gridVerts: number, material: THREE.Material, private readonly opts: TerrainLodOptions) {
    const cells = gridVerts - 1;
    if (cells % CHUNK !== 0) throw new Error(`terrain grid ${cells} is not a multiple of ${CHUNK}`);
    const { ring, indices } = buildIndices();
    this.indices = indices;
    const n = CHUNK + 1;
    const vcount = n * n + ring.length;
    const P = full.attributes.position as THREE.BufferAttribute;
    const N = full.attributes.normal as THREE.BufferAttribute;
    const C = full.attributes.color as THREE.BufferAttribute | undefined;

    for (let cr = 0; cr < cells / CHUNK; cr++) {
      for (let cc = 0; cc < cells / CHUNK; cc++) {
        const pos = new Float32Array(vcount * 3), nrm = new Float32Array(vcount * 3), col = new Float32Array(vcount * 3);
        const copy = (dst: number, src: number, drop: number) => {
          pos[dst * 3] = P.getX(src);
          pos[dst * 3 + 1] = P.getY(src) - drop;
          pos[dst * 3 + 2] = P.getZ(src);
          nrm[dst * 3] = N.getX(src);
          nrm[dst * 3 + 1] = N.getY(src);
          nrm[dst * 3 + 2] = N.getZ(src);
          if (C) {
            col[dst * 3] = C.getX(src);
            col[dst * 3 + 1] = C.getY(src);
            col[dst * 3 + 2] = C.getZ(src);
          }
        };
        const src = (r: number, c: number) => (cr * CHUNK + r) * gridVerts + cc * CHUNK + c;
        for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) copy(r * n + c, src(r, c), 0);
        ring.forEach(([r, c], k) => copy(n * n + k, src(r, c), opts.skirt));

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
        if (C) geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        geo.setIndex(indices[0]);
        geo.computeBoundingBox();
        geo.computeBoundingSphere();
        const center = geo.boundingSphere!.center.clone();
        if (opts.skip?.(center.x, center.z)) continue;
        const mesh = new THREE.Mesh(geo, material);
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        this.group.add(mesh);
        this.chunks.push({ mesh, center, lod: 0 });
      }
    }
  }

  /** Pick each chunk's level from its distance to the camera. */
  update(camera: THREE.Camera) {
    const [d1, d2, d3] = this.opts.distances;
    const cam = camera.position;
    for (const ch of this.chunks) {
      const box = ch.mesh.geometry.boundingBox!;
      // distance to the chunk's footprint, so a big chunk right under the camera stays detailed
      const dx = Math.max(box.min.x - cam.x, 0, cam.x - box.max.x);
      const dz = Math.max(box.min.z - cam.z, 0, cam.z - box.max.z);
      const dy = Math.max(box.min.y - cam.y, 0, cam.y - box.max.y);
      const d = Math.hypot(dx, dy, dz);
      const lod = d < d1 ? 0 : d < d2 ? 1 : d < d3 ? 2 : 3;
      if (lod !== ch.lod) {
        ch.lod = lod;
        ch.mesh.geometry.setIndex(this.indices[lod]);
      }
    }
  }
}
