import * as THREE from 'three';
import type { Heightmap } from '../world/Heightmap';

export interface GuideTarget {
  position: THREE.Vector3;
  label: string;
}

const CHEVRONS = 90;

/** On foot: small, dense chevrons. Skiing: big ones spaced out so they read at speed. */
export type TrailStyle = 'walk' | 'ski';
const STYLE: Record<TrailStyle, { spacing: number; scale: number; lift: number; speed: number; lead: number; band: number; reach: number }> = {
  walk: { spacing: 3, scale: 1, lift: 0.12, speed: 2.5, lead: 2, band: 1.2, reach: 220 },
  ski: { spacing: 10, scale: 3.2, lift: 0.3, speed: 8, lead: 6, band: 3, reach: 650 },
};
const BAND_STEP = 3;

/**
 * Wayfinding: a light beacon over the destination, animated chevrons along the walking route
 * and a compass arrow with distance at the top of the screen.
 */
export class Guidance {
  readonly group = new THREE.Group();
  enabled = true;
  private readonly beacon = new THREE.Group();
  private readonly marker: THREE.Mesh;
  private readonly chevrons: THREE.InstancedMesh;
  /** continuous translucent band under the chevrons so the route reads even when foreshortened */
  private readonly band: THREE.Mesh;
  private readonly el = document.getElementById('guide')!;
  private readonly arrow = document.getElementById('guide-arrow')!;
  private readonly text = document.getElementById('guide-text')!;
  private flow = 0;

  constructor(private readonly hm: Heightmap) {
    // tall light pillar, fading upwards, visible through fog
    const pillarGeo = new THREE.CylinderGeometry(0.6, 0.6, 45, 16, 8, true).translate(0, 22.5, 0);
    const colors: number[] = [];
    const pos = pillarGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const fade = 1 - pos.getY(i) / 45;
      colors.push(fade, fade, fade);
    }
    pillarGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const glow = { color: 0xffc23d, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false } as const;
    this.beacon.add(new THREE.Mesh(pillarGeo, new THREE.MeshBasicMaterial({ ...glow, vertexColors: true, opacity: 0.55, side: THREE.DoubleSide })));
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.4, 1.9, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ ...glow, opacity: 0.8 }));
    ring.position.y = 0.1;
    this.beacon.add(ring);
    this.marker = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.9, 4).rotateX(Math.PI), new THREE.MeshBasicMaterial({ color: 0xffc23d, fog: false }));
    this.beacon.add(this.marker);

    // flat chevrons (arrow heads) pointing along +z
    const shape = new THREE.Shape();
    shape.moveTo(-0.55, -0.35);
    shape.lineTo(0, 0.25);
    shape.lineTo(0.55, -0.35);
    shape.lineTo(0.55, -0.05);
    shape.lineTo(0, 0.55);
    shape.lineTo(-0.55, -0.05);
    shape.lineTo(-0.55, -0.35);
    // lay flat (tip ends up at -z), then turn so the tip points along +z
    const chevronGeo = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2).rotateY(Math.PI);
    this.chevrons = new THREE.InstancedMesh(chevronGeo, new THREE.MeshBasicMaterial({ color: 0xffd060, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }), CHEVRONS);
    this.chevrons.frustumCulled = false;
    this.chevrons.renderOrder = 5;
    this.band = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ color: 0xffc23d, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3 }),
    );
    this.band.frustumCulled = false;
    this.band.renderOrder = 4;
    this.group.add(this.beacon, this.band, this.chevrons);
  }

  /**
   * @param route ground points from the player to the target (walking) or null to hide the trail
   * @param viewYaw direction the camera looks (heading convention: facing (sin, cos))
   */
  update(dt: number, elapsed: number, player: THREE.Vector3, target: GuideTarget | null, route: THREE.Vector2[] | null, viewYaw: number, style: TrailStyle = 'walk') {
    const show = this.enabled && target !== null;
    this.group.visible = show;
    this.el.hidden = !show;
    if (!show || !target) return;

    const t = target.position;
    this.beacon.position.set(t.x, this.hm.heightAt(t.x, t.z), t.z);
    this.marker.position.y = 3.6 + Math.sin(elapsed * 2.5) * 0.25;
    this.marker.rotation.y = elapsed * 1.5;

    // compass: angle from the view direction to the target (positive = to the left)
    const dx = t.x - player.x, dz = t.z - player.z;
    const dist = Math.hypot(dx, dz);
    let rel = Math.atan2(dx, dz) - viewYaw;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    this.arrow.style.transform = `rotate(${(-rel * 180) / Math.PI}deg)`;
    this.text.textContent = `${target.label} · ${dist >= 1000 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist)} m`}`;
    this.el.classList.toggle('arrived', dist < 4);

    this.layTrail(dt, route, STYLE[style]);
  }

  private layTrail(dt: number, route: THREE.Vector2[] | null, st: (typeof STYLE)[TrailStyle]) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    let placed = 0;
    if (route && route.length >= 2) {
      this.flow = (this.flow + dt * st.speed) % st.spacing;
      // walk along the polyline placing a chevron every `spacing` metres, scrolling forward
      let carry = st.spacing - this.flow + st.lead;
      const scale = new THREE.Vector3(st.scale, 1, st.scale);
      for (let s = 0; s < route.length - 1 && placed < CHEVRONS; s++) {
        const a = route[s], b = route[s + 1];
        const len = a.distanceTo(b);
        const yaw = Math.atan2(b.x - a.x, b.y - a.y);
        q.setFromAxisAngle(up, yaw);
        let d = carry;
        for (; d < len && placed < CHEVRONS; d += st.spacing) {
          const x = a.x + ((b.x - a.x) * d) / len, z = a.y + ((b.y - a.y) * d) / len;
          m.compose(new THREE.Vector3(x, this.hm.heightAt(x, z) + st.lift, z), q, scale);
          this.chevrons.setMatrixAt(placed++, m);
        }
        carry = d - len;
      }
    }
    for (let i = placed; i < CHEVRONS; i++) this.chevrons.setMatrixAt(i, hidden);
    this.chevrons.instanceMatrix.needsUpdate = true;
    this.layBand(route, st);
  }

  /** Rebuild the band along the first `reach` metres of the route, fading out at the far end. */
  private layBand(route: THREE.Vector2[] | null, st: (typeof STYLE)[TrailStyle]) {
    const pos: number[] = [], idx: number[] = [];
    if (route && route.length >= 2) {
      const pts: THREE.Vector2[] = [];
      let travelled = 0;
      for (let s = 0; s < route.length - 1 && travelled < st.reach; s++) {
        const a = route[s], b = route[s + 1];
        const len = a.distanceTo(b);
        for (let d = s === 0 ? 1.5 : 0; d < len && travelled < st.reach; d += BAND_STEP) {
          pts.push(a.clone().lerp(b, d / len));
          travelled += BAND_STEP;
        }
      }
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const q = pts[Math.min(pts.length - 1, i + 1)], o = pts[Math.max(0, i - 1)];
        const dir = q.clone().sub(o);
        if (dir.lengthSq() < 1e-6) dir.set(0, 1);
        dir.normalize();
        const w = st.band / 2 * Math.min(1, (pts.length - i) / 15);
        for (const side of [-1, 1]) {
          const x = p.x - dir.y * side * w, z = p.y + dir.x * side * w;
          pos.push(x, this.hm.heightAt(x, z) + st.lift * 0.6, z);
        }
        if (i < pts.length - 1) {
          const k = i * 2;
          idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    this.band.geometry.dispose();
    this.band.geometry = geo;
  }
}
