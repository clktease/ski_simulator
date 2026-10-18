import * as THREE from 'three';
import type { Heightmap } from '../world/Heightmap';
import type { Difficulty, Lift, Run } from './ResortData';

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  novice: '初級',
  easy: '初級',
  intermediate: '中級',
  advanced: '上級',
  expert: '上級',
  freeride: '非圧雪',
};

/** A run's centre line oriented downhill, with arc lengths, a display name and a colour. */
export interface RunPath {
  run: Run;
  /** Japanese name (official where known) */
  name: string;
  /** Traditional Chinese name, '' if unknown */
  nameZh: string;
  /** number on the official trail map, or null */
  number: number | null;
  /** "メインバーン（主雪坡）" */
  label: string;
  difficulty: string;
  /** light pastel, distinct per run */
  color: THREE.Color;
  css: string;
  pts: THREE.Vector2[];
  cum: number[];
  length: number;
}

/**
 * Orient every line run downhill and name it: the official name (from the trail map, merged into
 * resort.json) if known, otherwise a descriptive one from the lift whose top is nearest the run's
 * start ("山頂クワッド 上級コース"). Segments of the same course share one colour.
 */
export function buildRunPaths(hm: Heightmap, runs: Run[], lifts: Lift[]): RunPath[] {
  const liftTops = lifts.map((l) => {
    const a = l.points[0], b = l.points[l.points.length - 1];
    const top = hm.heightAt(a[0], a[1]) > hm.heightAt(b[0], b[1]) ? a : b;
    return { name: (l.name ?? '').replace(/リフト$/, ''), top: new THREE.Vector2(top[0], top[1]) };
  });
  const used = new Map<string, number>();

  const paths = runs
    .filter((r) => !r.area && r.points.length >= 2)
    .map((run) => {
      let pts = run.points.map(([x, z]) => new THREE.Vector2(x, z));
      const first = pts[0], last = pts[pts.length - 1];
      if (hm.heightAt(first.x, first.y) < hm.heightAt(last.x, last.y)) pts = pts.reverse();
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
      return { run, pts, cum, length: cum[cum.length - 1] };
    })
    // highest starts first so numbering runs top-down
    .sort((a, b) => hm.heightAt(b.pts[0].x, b.pts[0].y) - hm.heightAt(a.pts[0].x, a.pts[0].y));

  const colorIndex = new Map<string, number>();
  return paths.map((p) => {
    const difficulty = DIFFICULTY_LABEL[p.run.difficulty] ?? '';
    let name = p.run.name ?? '';
    if (!name) {
      const near = liftTops.filter((t) => t.name).sort((a, b) => a.top.distanceTo(p.pts[0]) - b.top.distanceTo(p.pts[0]))[0];
      const base = `${near && near.top.distanceTo(p.pts[0]) < 400 ? near.name + ' ' : ''}${difficulty}コース`;
      const n = (used.get(base) ?? 0) + 1;
      used.set(base, n);
      name = n === 1 ? base : `${base} ${n}`;
    }
    // golden-ratio hue spacing keeps neighbours distinct; high lightness = soft colours
    if (!colorIndex.has(name)) colorIndex.set(name, colorIndex.size);
    const color = new THREE.Color().setHSL((colorIndex.get(name)! * 0.618034 + 0.05) % 1, 0.7, 0.66);
    const nameZh = p.run.nameZh ?? '';
    const label = nameZh ? `${name}（${nameZh}）` : name;
    return { ...p, name, nameZh, number: p.run.number ?? null, label, difficulty, color, css: `#${color.getHexString()}` };
  });
}

/** Point and unit tangent at arc length s. */
export function samplePath(p: RunPath, s: number) {
  let i = 1;
  while (i < p.cum.length - 1 && p.cum[i] < s) i++;
  const t = (s - p.cum[i - 1]) / (p.cum[i] - p.cum[i - 1] || 1);
  const a = p.pts[i - 1], b = p.pts[i];
  return { point: a.clone().lerp(b, Math.min(1, Math.max(0, t))), tan: b.clone().sub(a).normalize() };
}
