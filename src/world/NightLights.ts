import * as THREE from 'three';
import type { Heightmap } from './Heightmap';
import type { Run } from '../resort/ResortData';

/**
 * Floodlights for night skiing (ナイター) along the lit runs: emissive lamp heads on poles
 * plus a handful of real spot lights near the player so the snow is actually lit.
 */
export class NightLights {
  readonly group = new THREE.Group();
  private readonly lampMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xfff1d0, emissiveIntensity: 0 });
  private readonly anchors: THREE.Vector3[] = [];
  private readonly spots: THREE.SpotLight[] = [];
  private on = false;

  constructor(hm: Heightmap, runs: Run[], spacing = 70, spotCount = 6) {
    const poleGeo = new THREE.CylinderGeometry(0.15, 0.2, 12, 6).translate(0, 6, 0);
    const headGeo = new THREE.BoxGeometry(1.2, 0.5, 0.6).translate(0, 12.2, 0);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x777d84, metalness: 0.6, roughness: 0.4 });
    const poles: THREE.Matrix4[] = [];
    for (const run of runs) {
      for (let s = 0; s < run.points.length - 1; s++) {
        const [ax, az] = run.points[s], [bx, bz] = run.points[s + 1];
        const len = Math.hypot(bx - ax, bz - az);
        const nx = -(bz - az) / len, nz = (bx - ax) / len;
        for (let d = 0; d < len; d += spacing) {
          // poles stand at the edge of the run
          const x = ax + ((bx - ax) * d) / len + nx * 20, z = az + ((bz - az) * d) / len + nz * 20;
          const y = hm.heightAt(x, z);
          poles.push(new THREE.Matrix4().makeTranslation(x, y, z));
          this.anchors.push(new THREE.Vector3(x, y + 12, z));
        }
      }
    }
    for (const [geo, mat] of [[poleGeo, poleMat], [headGeo, this.lampMat]] as const) {
      const inst = new THREE.InstancedMesh(geo, mat, poles.length);
      poles.forEach((m, i) => inst.setMatrixAt(i, m));
      this.group.add(inst);
    }
    for (let i = 0; i < spotCount; i++) {
      const spot = new THREE.SpotLight(0xfff1d0, 0, 90, 0.9, 0.6, 1.2);
      spot.visible = false;
      this.group.add(spot, spot.target);
      this.spots.push(spot);
    }
  }

  /** @param lit lights switched on  @param viewer nearest anchors get the real spot lights */
  update(lit: boolean, viewer: THREE.Vector3) {
    if (lit !== this.on) {
      this.on = lit;
      this.lampMat.emissiveIntensity = lit ? 4 : 0;
      for (const s of this.spots) s.visible = lit;
    }
    if (!lit || this.anchors.length === 0) return;
    const nearest = [...this.anchors]
      .map((a) => ({ a, d: a.distanceToSquared(viewer) }))
      .sort((p, q) => p.d - q.d)
      .slice(0, this.spots.length);
    nearest.forEach(({ a }, i) => {
      const s = this.spots[i];
      s.position.copy(a);
      s.target.position.set(a.x, a.y - 12, a.z).add(new THREE.Vector3(viewer.x - a.x, 0, viewer.z - a.z).multiplyScalar(0.3));
      s.intensity = 700;
    });
  }
}
