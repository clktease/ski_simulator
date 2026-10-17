import * as THREE from 'three';
import type { Collider } from '../resort/Buildings';

/**
 * Push a circle of `radius` out of rotated-rectangle colliders.
 * Returns true if anything was hit (used by skiing to detect crashes).
 */
export function resolveColliders(p: THREE.Vector3, radius: number, colliders: Collider[]) {
  let hit = false;
  for (const c of colliders) {
    const cos = Math.cos(c.rot), sin = Math.sin(c.rot);
    const dx = p.x - c.x, dz = p.z - c.z;
    // world -> collider local
    const lx = dx * cos - dz * sin, lz = dx * sin + dz * cos;
    const qx = THREE.MathUtils.clamp(lx, -c.halfW, c.halfW);
    const qz = THREE.MathUtils.clamp(lz, -c.halfD, c.halfD);
    let ox = lx - qx, oz = lz - qz;
    let d = Math.hypot(ox, oz);
    if (d >= radius) continue;
    hit = true;
    if (d < 1e-6) {
      // inside: push out through the nearest face
      const px = c.halfW - Math.abs(lx), pz = c.halfD - Math.abs(lz);
      if (px < pz) { ox = Math.sign(lx) || 1; oz = 0; d = -px; } else { ox = 0; oz = Math.sign(lz) || 1; d = -pz; }
    } else {
      ox /= d; oz /= d;
    }
    const push = radius - d;
    // collider local -> world
    p.x += (ox * cos + oz * sin) * push;
    p.z += (-ox * sin + oz * cos) * push;
  }
  return hit;
}
