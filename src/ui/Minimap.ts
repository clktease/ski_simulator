import * as THREE from 'three';
import type { Heightmap } from '../world/Heightmap';
import type { ResortData } from '../resort/ResortData';
import { rectCorners } from '../resort/PisteMask';
import { samplePath, type RunPath } from '../resort/RunPaths';

const SIZE = 190; // css px
const ZOOMS = [3, 6, 10]; // metres per css px
const BAKE_M_PER_PX = 2; // resolution of the pre-rendered map

interface Label {
  text: string;
  /** second, smaller line (Traditional Chinese) */
  sub: string;
  /** official course number, shown on the full map */
  number: number | null;
  /** candidate anchor points, tried in order until one does not collide */
  spots: { x: number; z: number }[];
  color: string;
  kind: 'run' | 'lift';
}

/** North-up minimap plus a full-resort map: hillshade, forest, runs, lifts, buildings, labels, route. */
export class Minimap {
  private readonly canvas = document.getElementById('minimap') as HTMLCanvasElement;
  private readonly big = document.getElementById('bigmap') as HTMLCanvasElement;
  private readonly bigWrap = document.getElementById('bigmap-wrap')!;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly base: HTMLCanvasElement;
  private readonly labels: Label[] = [];
  private readonly lifts: { x: number; z: number }[][];
  private zoom = 1;
  private timer = 0;

  constructor(private readonly hm: Heightmap, resort: ResortData, private readonly paths: RunPath[]) {
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.canvas.width = SIZE * dpr;
    this.canvas.height = SIZE * dpr;
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.scale(dpr, dpr);
    // longest runs get first pick of label space; one label per course
    const seen = new Set<string>();
    for (const p of [...paths].sort((a, b) => b.length - a.length)) {
      if (seen.has(p.name)) continue;
      seen.add(p.name);
      const spots = [0.45, 0.25, 0.65, 0.85, 0.12].map((t) => {
        const { point } = samplePath(p, p.length * t);
        return { x: point.x, z: point.y };
      });
      this.labels.push({ text: p.name, sub: p.nameZh, number: p.number, spots, color: p.css, kind: 'run' });
    }
    this.lifts = resort.lifts.map((l) => l.points.map(([x, z]) => ({ x, z })));
    for (const l of resort.lifts) {
      if (!l.name) continue;
      const spots = [0.5, 0.3, 0.7].map((t) => {
        const [x, z] = l.points[Math.min(l.points.length - 1, Math.floor(l.points.length * t))];
        return { x, z };
      });
      this.labels.push({ text: `🚡 ${l.name}`, sub: l.nameZh ?? '', number: null, spots, color: '#111', kind: 'lift' });
    }
    this.base = this.bake(resort);
  }

  get metresPerPx() {
    return ZOOMS[this.zoom];
  }

  zoomBy(step: number) {
    this.zoom = THREE.MathUtils.clamp(this.zoom + step, 0, ZOOMS.length - 1);
    this.timer = 0;
  }

  get bigOpen() {
    return !this.bigWrap.hidden;
  }

  toggleBig(open = !this.bigOpen) {
    this.bigWrap.hidden = !open;
    this.timer = 0;
  }

  private toBake(x: number, z: number): [number, number] {
    return [(x + this.hm.half) / BAKE_M_PER_PX, (z + this.hm.half) / BAKE_M_PER_PX];
  }

  /** Render the static map once (labels are drawn live so they stay crisp). */
  private bake(resort: ResortData) {
    const n = this.hm.meta.resolution;
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
        const lit = 0.6 + 0.4 * Math.max(0, nrm.dot(light));
        const forest = this.hm.forest ? this.hm.forest[j * n + i] / 255 : 0;
        const k = (j * n + i) * 4;
        img.data[k] = (238 - forest * 105) * lit;
        img.data[k + 1] = (242 - forest * 80) * lit;
        img.data[k + 2] = (248 - forest * 100) * lit;
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
    const line = (pts: { x: number; z: number }[], color: string, width: number, dash: number[] = []) => {
      ctx.beginPath();
      pts.forEach(({ x, z }, i) => {
        const [px, py] = this.toBake(x, z);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.setLineDash(dash);
      ctx.stroke();
    };
    for (const p of resort.paths ?? []) line(p.points.map(([x, z]) => ({ x, z })), '#ffffff', 4);
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

  update(dt: number, player: THREE.Vector3, heading: number, target: THREE.Vector3 | null, route: THREE.Vector2[] | null, elapsed: number) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.1;
    const mpp = this.metresPerPx;
    this.draw(this.ctx, SIZE, SIZE, player.x, player.z, mpp, player, heading, target, route, elapsed, false);
    if (this.bigOpen) {
      const rect = this.big.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio, 2);
      if (this.big.width !== Math.round(rect.width * dpr)) {
        this.big.width = Math.round(rect.width * dpr);
        this.big.height = Math.round(rect.height * dpr);
      }
      const ctx = this.big.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // whole resort: fit the ski area (runs + lifts) with a margin
      const xs = this.paths.flatMap((p) => p.pts.map((v) => v.x)), zs = this.paths.flatMap((p) => p.pts.map((v) => v.y));
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
      const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) * 1.25;
      this.draw(ctx, rect.width, rect.height, cx, cz, span / Math.min(rect.width, rect.height), player, heading, target, route, elapsed, true);
    }
  }

  private draw(ctx: CanvasRenderingContext2D, w: number, h: number, cx: number, cz: number, mpp: number, player: THREE.Vector3, heading: number, target: THREE.Vector3 | null, route: THREE.Vector2[] | null, elapsed: number, big: boolean) {
    const [bx, by] = this.toBake(cx, cz);
    const srcW = (w * mpp) / BAKE_M_PER_PX, srcH = (h * mpp) / BAKE_M_PER_PX;
    ctx.fillStyle = '#dfe6ee';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(this.base, bx - srcW / 2, by - srcH / 2, srcW, srcH, 0, 0, w, h);
    const toMap = (x: number, z: number): [number, number] => [w / 2 + (x - cx) / mpp, h / 2 + (z - cz) / mpp];
    const polyline = (pts: { x: number; z: number }[], color: string, width: number, dash: number[] = []) => {
      ctx.beginPath();
      pts.forEach(({ x, z }, i) => {
        const [px, py] = toMap(x, z);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.setLineDash(dash);
      ctx.stroke();
      ctx.setLineDash([]);
    };

    // runs and lifts drawn live so line widths stay readable at every zoom
    ctx.lineCap = ctx.lineJoin = 'round';
    const runWidth = THREE.MathUtils.clamp(14 / mpp, 3, 6);
    for (const p of this.paths) {
      const pts = p.pts.map((v) => ({ x: v.x, z: v.y }));
      polyline(pts, 'rgba(30, 40, 50, 0.45)', runWidth + 2);
      polyline(pts, p.css, runWidth);
    }
    for (const l of this.lifts) polyline(l, '#111111', big ? 2 : 1.5, [5, 3]);

    // labels: greedy placement, skipping any that would overlap one already drawn
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const [ppx, ppy] = toMap(player.x, player.z);
    const placed: [number, number, number, number][] = [[ppx - 14, ppy - 14, ppx + 14, ppy + 14]];
    const hits = (b: [number, number, number, number]) => placed.some((q) => b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1]);
    for (const l of this.labels) {
      if (l.kind === 'lift' && !big) continue;
      const mainFont = l.kind === 'run' ? `bold ${big ? 13 : 10}px sans-serif` : `${big ? 12 : 9}px sans-serif`;
      const subFont = `${big ? 11 : 9}px sans-serif`;
      const text = big && l.number ? `${l.number} ${l.text}` : l.text;
      ctx.font = mainFont;
      const w1 = ctx.measureText(text).width;
      ctx.font = subFont;
      const w2 = l.sub ? ctx.measureText(l.sub).width : 0;
      const tw = Math.max(w1, w2) + (l.kind === 'run' ? 10 : 0);
      const line = big ? 15 : 11;
      const th = l.sub ? line * 2 : line;
      for (const spot of l.spots) {
        const [x, y] = toMap(spot.x, spot.z);
        const box: [number, number, number, number] = [x - tw / 2 - 2, y - th / 2, x + tw / 2 + 2, y + th / 2];
        if (box[0] < 2 || box[1] < 2 || box[2] > w - 2 || box[3] > h - 2 || hits(box)) continue;
        placed.push(box);
        const tx = x + (l.kind === 'run' ? 5 : 0);
        const y1 = l.sub ? y - line / 2 : y;
        const drawText = (t: string, ty: number, font: string, color: string) => {
          ctx.font = font;
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(255,255,255,0.92)';
          ctx.strokeText(t, tx, ty);
          ctx.fillStyle = color;
          ctx.fillText(t, tx, ty);
        };
        drawText(text, y1, mainFont, l.kind === 'run' ? '#1d2733' : '#333');
        if (l.sub) drawText(l.sub, y + line / 2, subFont, '#3d4a58');
        if (l.kind === 'run') {
          ctx.fillStyle = l.color;
          ctx.fillRect(box[0] + 2, y1 - 4, 7, 8);
        }
        break;
      }
    }

    if (route && route.length >= 2) {
      ctx.beginPath();
      route.forEach((p, i) => {
        const [x, y] = toMap(p.x, p.y);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = '#ff9f1a';
      ctx.lineWidth = big ? 4 : 3;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (target) {
      let [tx, ty] = toMap(target.x, target.z);
      // pin to the edge when off-map
      const r = Math.min(w, h) / 2 - 8;
      const dx = tx - w / 2, dy = ty - h / 2;
      const d = Math.hypot(dx, dy);
      if (!big && d > r) { tx = w / 2 + (dx / d) * r; ty = h / 2 + (dy / d) * r; }
      ctx.beginPath();
      ctx.arc(tx, ty, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#ffc23d';
      ctx.fill();
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // player: pulsing halo + arrow (heading convention: facing (sin h, cos h); map y = south)
    const [px, py] = toMap(player.x, player.z);
    const pulse = (elapsed * 1.2) % 1;
    ctx.beginPath();
    ctx.arc(px, py, 10 + pulse * 12, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(43, 123, 255, ${0.8 * (1 - pulse)})`;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(px, py, 11, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fill();
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-heading);
    ctx.beginPath();
    ctx.moveTo(0, 9);
    ctx.lineTo(6.5, -6);
    ctx.lineTo(0, -2.5);
    ctx.lineTo(-6.5, -6);
    ctx.closePath();
    ctx.fillStyle = '#2b7bff';
    ctx.fill();
    ctx.restore();

    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText('N', w / 2 - 4, 10);
    if (!big) {
      ctx.textAlign = 'center';
      ctx.font = '10px sans-serif';
      ctx.fillText(`${Math.round((SIZE * mpp) / 100) * 100} m`, w / 2, h - 12);
    }
  }
}
