import * as THREE from 'three';
import type { Heightmap } from './Heightmap';
import { samplePath, type RunPath } from '../resort/RunPaths';

const RIBBON_WIDTH = 6;
const RIBBON_STEP = 4;
const ARROW_SPACING = 22;

/**
 * Optional on-slope hints: a soft coloured band along every run, arrows pointing the way the
 * run descends, and a name sign at the top of each run.
 */
export class PisteGuide {
  readonly group = new THREE.Group();

  constructor(hm: Heightmap, paths: RunPath[]) {
    this.group.add(this.ribbons(hm, paths), this.arrows(hm, paths));
    for (const p of paths) this.group.add(this.sign(hm, p));
    this.group.visible = false;
  }

  get visible() {
    return this.group.visible;
  }

  set visible(v: boolean) {
    this.group.visible = v;
  }

  private ribbons(hm: Heightmap, paths: RunPath[]) {
    const pos: number[] = [], col: number[] = [], idx: number[] = [];
    for (const p of paths) {
      const base = pos.length / 3;
      const steps = Math.max(1, Math.floor(p.length / RIBBON_STEP));
      for (let k = 0; k <= steps; k++) {
        const { point, tan } = samplePath(p, (p.length * k) / steps);
        const nx = -tan.y, nz = tan.x;
        // fade the band out at both ends
        const edge = Math.min(1, k / 3, (steps - k) / 3);
        for (const side of [-1, 1]) {
          const x = point.x + nx * side * RIBBON_WIDTH / 2, z = point.y + nz * side * RIBBON_WIDTH / 2;
          pos.push(x, hm.heightAt(x, z) + 0.25, z);
          col.push(p.color.r * edge, p.color.g * edge, p.color.b * edge);
        }
        if (k < steps) {
          const a = base + k * 2;
          idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.NormalBlending, polygonOffset: true, polygonOffsetFactor: -2,
    }));
    mesh.renderOrder = 2;
    return mesh;
  }

  private arrows(hm: Heightmap, paths: RunPath[]) {
    const shape = new THREE.Shape();
    shape.moveTo(-2.1, -1.5);
    shape.lineTo(0, 0.7);
    shape.lineTo(2.1, -1.5);
    shape.lineTo(2.1, -0.4);
    shape.lineTo(0, 2.0);
    shape.lineTo(-2.1, -0.4);
    shape.closePath();
    // lay flat (tip ends up at -z), then turn so the tip points along +z
    const geo = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2).rotateY(Math.PI);
    const placements: { m: THREE.Matrix4; c: THREE.Color }[] = [];
    const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    for (const p of paths) {
      for (let s = ARROW_SPACING / 2; s < p.length - 5; s += ARROW_SPACING) {
        const { point, tan } = samplePath(p, s);
        q.setFromAxisAngle(up, Math.atan2(tan.x, tan.y));
        const m = new THREE.Matrix4().compose(new THREE.Vector3(point.x, hm.heightAt(point.x, point.y) + 0.35, point.y), q, new THREE.Vector3(1, 1, 1));
        // a deeper shade of the run's colour so arrows stand out on the pale band
        const hsl = { h: 0, s: 0, l: 0 };
        p.color.getHSL(hsl);
        placements.push({ m, c: new THREE.Color().setHSL(hsl.h, 0.65, 0.42) });
      }
    }
    const inst = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }), placements.length);
    placements.forEach(({ m, c }, i) => {
      inst.setMatrixAt(i, m);
      inst.setColorAt(i, c);
    });
    inst.renderOrder = 3;
    return inst;
  }

  /** Billboard with the run's colour and name, standing at its top. */
  private sign(hm: Heightmap, p: RunPath) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 112;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(16, 26, 40, 0.82)';
    ctx.beginPath();
    ctx.roundRect(4, 4, 504, 104, 18);
    ctx.fill();
    ctx.fillStyle = p.css;
    ctx.beginPath();
    ctx.roundRect(4, 4, 26, 104, [18, 0, 0, 18]);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 44px "Noto Sans JP", "Yu Gothic", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.name, 48, 56, 450);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
    const { point } = samplePath(p, Math.min(12, p.length / 2));
    sprite.position.set(point.x, hm.heightAt(point.x, point.y) + 4.5, point.y);
    sprite.scale.set(12, 12 * (112 / 512), 1);
    sprite.renderOrder = 4;
    return sprite;
  }
}
