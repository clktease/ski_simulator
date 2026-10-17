import * as THREE from 'three';
import type { Heightmap } from '../world/Heightmap';
import { DIFFICULTY_COLOR, type ResortData } from '../resort/ResortData';
import { rectCorners } from '../resort/PisteMask';

const SIZE = 190; // css px
const METRES_PER_PX = 3; // view scale
const BAKE_M_PER_PX = 2; // resolution of the pre-rendered map

/** North-up minimap: hillshade, forest, runs, lifts, buildings, route and player. */
export class Minimap {
  private readonly canvas = document.getElementById('minimap') as HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly base: HTMLCanvasElement;
  private timer = 0;

  constructor(private readonly hm: Heightmap, resort: ResortData) {
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.canvas.width = SIZE * dpr;
    this.canvas.height = SIZE * dpr;
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.scale(dpr, dpr);
    this.base = this.bake(resort);
  }

  private toBake(x: number, z: number): [number, number] {
    return [(x + this.hm.half) / BAKE_M_PER_PX, (z + this.hm.half) / BAKE_M_PER_PX];
  }

  /** Render the static map once. */
  private bake(resort: ResortData) {
    const n = this.hm.meta.resolution;
    // hillshade + forest at heightmap resolution
    const shade = document.createElement('canvas');
    shade.width = shade.height = n;
    const sctx = shade.getContext('2d')!;
    const img = sctx.createImageData(n, n);
    const light = new THREE.Vector3(-1, 1.4, -1).normalize(); // from the north-west
    const nrm = new THREE.Vector3();
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = -this.hm.half + i * this.hm.meta.cellM, z = -this.hm.half + j * this.hm.meta.cellM;
        this.hm.normalAt(x, z, nrm);
        const lit = 0.55 + 0.45 * Math.max(0, nrm.dot(light));
        const forest = this.hm.forest ? this.hm.forest[j * n + i] / 255 : 0;
        const k = (j * n + i) * 4;
        img.data[k] = (235 - forest * 120) * lit;
        img.data[k + 1] = (240 - forest * 95) * lit;
        img.data[k + 2] = (248 - forest * 115) * lit;
        img.data[k + 3] = 255;
      }
    }
    sctx.putImageData(img, 0, 0);

    const size = this.hm.meta.sizeM / BAKE_M_PER_PX;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(shade, 0, 0, size, size);
    ctx.lineCap = ctx.lineJoin = 'round';
    const line = (pts: [number, number][], color: string, width: number, dash: number[] = []) => {
      ctx.beginPath();
      pts.forEach(([x, z], i) => {
        const [px, py] = this.toBake(x, z);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.setLineDash(dash);
      ctx.stroke();
    };
    for (const p of resort.paths ?? []) line(p.points, '#ffffff', 4);
    for (const r of resort.runs) {
      const col = `#${(DIFFICULTY_COLOR[r.difficulty] ?? 0x888888).toString(16).padStart(6, '0')}`;
      line(r.area ? [...r.points, r.points[0]] : r.points, col, 5);
    }
    for (const l of resort.lifts) line(l.points, '#111111', 2.5, [6, 4]);
    for (const f of resort.facilities) {
      const pts = rectCorners(f.x, f.z, f.width, f.depth, THREE.MathUtils.degToRad(f.rotation));
      ctx.beginPath();
      pts.forEach(([x, z], i) => {
        const [px, py] = this.toBake(x, z);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.setLineDash([]);
      ctx.fillStyle = f.type === 'parking' ? '#7a8088' : '#8a4a32';
      ctx.fill();
    }
    return c;
  }

  update(dt: number, player: THREE.Vector3, heading: number, target: THREE.Vector3 | null, route: THREE.Vector2[] | null) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.1;
    const ctx = this.ctx;
    const viewM = SIZE * METRES_PER_PX;
    const [cx, cy] = this.toBake(player.x, player.z);
    const src = viewM / BAKE_M_PER_PX;
    ctx.fillStyle = '#dfe6ee';
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.drawImage(this.base, cx - src / 2, cy - src / 2, src, src, 0, 0, SIZE, SIZE);

    const toMap = (x: number, z: number): [number, number] => [SIZE / 2 + (x - player.x) / METRES_PER_PX, SIZE / 2 + (z - player.z) / METRES_PER_PX];
    if (route && route.length >= 2) {
      ctx.beginPath();
      route.forEach((p, i) => {
        const [x, y] = toMap(p.x, p.y);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = '#ffc23d';
      ctx.lineWidth = 3;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (target) {
      let [tx, ty] = toMap(target.x, target.z);
      // pin to the edge when off-map
      const r = SIZE / 2 - 8;
      const dx = tx - SIZE / 2, dy = ty - SIZE / 2;
      const d = Math.hypot(dx, dy);
      if (d > r) { tx = SIZE / 2 + (dx / d) * r; ty = SIZE / 2 + (dy / d) * r; }
      ctx.beginPath();
      ctx.arc(tx, ty, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#ffc23d';
      ctx.fill();
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    // player arrow (heading convention: facing (sin h, cos h); map x = east, y = south)
    ctx.save();
    ctx.translate(SIZE / 2, SIZE / 2);
    ctx.rotate(-heading);
    ctx.beginPath();
    ctx.moveTo(0, 9);
    ctx.lineTo(6, -6);
    ctx.lineTo(0, -2);
    ctx.lineTo(-6, -6);
    ctx.closePath();
    ctx.fillStyle = '#2b7bff';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText('N', SIZE / 2 - 4, 12);
  }
}
