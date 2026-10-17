import * as THREE from 'three';
import type { ResortData } from './ResortData';

interface Node {
  p: THREE.Vector2;
  edges: { to: number; cost: number }[];
}

/** Shortest routes over the ploughed walkways between facilities. */
export class WalkGraph {
  private readonly nodes: Node[] = [];

  constructor(resort: ResortData) {
    const nodeAt = (x: number, z: number) => {
      const p = new THREE.Vector2(x, z);
      // walkways share endpoints; merge vertices that are practically the same spot
      const found = this.nodes.findIndex((n) => n.p.distanceTo(p) < 2);
      if (found >= 0) return found;
      this.nodes.push({ p, edges: [] });
      return this.nodes.length - 1;
    };
    for (const path of resort.paths ?? []) {
      let prev = -1;
      for (const [x, z] of path.points) {
        const id = nodeAt(x, z);
        if (prev >= 0 && prev !== id) {
          const cost = this.nodes[prev].p.distanceTo(this.nodes[id].p);
          this.nodes[prev].edges.push({ to: id, cost });
          this.nodes[id].edges.push({ to: prev, cost });
        }
        prev = id;
      }
    }
  }

  private nearest(p: THREE.Vector2) {
    let best = -1, bestD = Infinity;
    this.nodes.forEach((n, i) => {
      const d = n.p.distanceTo(p);
      if (d < bestD) { bestD = d; best = i; }
    });
    return { id: best, dist: bestD };
  }

  /**
   * Route from `from` to `to` as ground points. Uses the walkways when both ends are near the
   * network and that is not a silly detour; otherwise a straight line.
   */
  route(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector2[] {
    const a = new THREE.Vector2(from.x, from.z), b = new THREE.Vector2(to.x, to.z);
    const direct = a.distanceTo(b);
    if (this.nodes.length === 0 || direct < 30) return [a, b];
    const na = this.nearest(a), nb = this.nearest(b);
    if (na.dist > 120 || nb.dist > 120) return [a, b];

    // Dijkstra (the network is tiny)
    const dist = this.nodes.map(() => Infinity);
    const prev = this.nodes.map(() => -1);
    const open = new Set(this.nodes.map((_, i) => i));
    dist[na.id] = 0;
    while (open.size) {
      let u = -1;
      for (const i of open) if (u < 0 || dist[i] < dist[u]) u = i;
      if (dist[u] === Infinity || u === nb.id) break;
      open.delete(u);
      for (const e of this.nodes[u].edges) {
        const alt = dist[u] + e.cost;
        if (alt < dist[e.to]) { dist[e.to] = alt; prev[e.to] = u; }
      }
    }
    if (dist[nb.id] === Infinity) return [a, b];
    const viaNetwork = na.dist + dist[nb.id] + nb.dist;
    if (viaNetwork > direct * 2.2) return [a, b];
    const chain: THREE.Vector2[] = [];
    for (let u = nb.id; u >= 0; u = prev[u]) chain.unshift(this.nodes[u].p.clone());
    return [a, ...chain, b];
  }
}
