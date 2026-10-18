import * as THREE from 'three';
import type { Heightmap } from '../world/Heightmap';
import type { RunPath } from './RunPaths';

const NODE_SPACING = 20;
/** runs closer than this are linked (junctions, crossings, short traverses) */
const LINK_RADIUS = 35;
/** a link may climb this much at most (skating / sidestepping a little) */
const MAX_CLIMB = 3;
/** how far the skier may be from the network when joining it, and the network from the target */
const JOIN_RADIUS = 300;
const LEAVE_RADIUS = 150;

interface Node {
  p: THREE.Vector2;
  h: number;
  edges: { to: number; cost: number }[];
}

/**
 * Downhill route network over the runs: edges follow each run from top to bottom, plus short
 * links between nearby runs. Routes never send a skier uphill.
 */
export class SkiGraph {
  private readonly nodes: Node[] = [];

  constructor(private readonly hm: Heightmap, paths: RunPath[]) {
    for (const path of paths) {
      let prev = -1;
      for (let s = 0; s <= path.length; s += NODE_SPACING) {
        prev = this.addNode(path, Math.min(s, path.length), prev);
      }
      // make sure the bottom of the run is a node
      const last = path.pts[path.pts.length - 1];
      if (this.nodes[prev].p.distanceTo(last) > 2) this.addNode(path, path.length, prev);
    }
    // junctions: link nodes of different runs that are close, if the link is not a climb
    for (let a = 0; a < this.nodes.length; a++) {
      for (let b = 0; b < this.nodes.length; b++) {
        if (a === b) continue;
        const na = this.nodes[a], nb = this.nodes[b];
        const d = na.p.distanceTo(nb.p);
        if (d > LINK_RADIUS || nb.h > na.h + MAX_CLIMB) continue;
        if (na.edges.some((e) => e.to === b)) continue;
        na.edges.push({ to: b, cost: d * 1.3 });
      }
    }
  }

  private addNode(path: RunPath, s: number, prev: number) {
    let i = 1;
    while (i < path.cum.length - 1 && path.cum[i] < s) i++;
    const t = (s - path.cum[i - 1]) / (path.cum[i] - path.cum[i - 1] || 1);
    const p = path.pts[i - 1].clone().lerp(path.pts[i], Math.min(1, Math.max(0, t)));
    const id = this.nodes.length;
    this.nodes.push({ p, h: this.hm.heightAt(p.x, p.y), edges: [] });
    if (prev >= 0) this.nodes[prev].edges.push({ to: id, cost: this.nodes[prev].p.distanceTo(p) });
    return id;
  }

  /**
   * Ground points from the skier to the target following the runs downhill, or null when no
   * downhill route exists (then the caller falls back to a straight line).
   */
  route(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector2[] | null {
    const start = new THREE.Vector2(from.x, from.z), goal = new THREE.Vector2(to.x, to.z);
    const n = this.nodes.length;
    const dist = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    // seed with every node the skier can glide to: nearby and not above them
    for (let i = 0; i < n; i++) {
      const node = this.nodes[i];
      const d = node.p.distanceTo(start);
      if (d < JOIN_RADIUS && node.h <= from.y + 1) dist[i] = d * 1.5;
    }
    const done = new Uint8Array(n);
    for (;;) {
      let u = -1;
      for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
      if (u < 0) break;
      done[u] = 1;
      for (const e of this.nodes[u].edges) {
        const alt = dist[u] + e.cost;
        if (alt < dist[e.to]) { dist[e.to] = alt; prev[e.to] = u; }
      }
    }
    // leave the network where it is cheapest overall to finish at the target
    let best = -1, bestCost = Infinity;
    for (let i = 0; i < n; i++) {
      if (dist[i] === Infinity) continue;
      const node = this.nodes[i];
      const d = node.p.distanceTo(goal);
      if (d > LEAVE_RADIUS || node.h < to.y - 10) continue;
      const cost = dist[i] + d * 2;
      if (cost < bestCost) { bestCost = cost; best = i; }
    }
    if (best < 0) return null;
    const chain: THREE.Vector2[] = [];
    for (let u = best; u >= 0; u = prev[u]) chain.unshift(this.nodes[u].p.clone());
    return [start, ...chain, goal];
  }
}
