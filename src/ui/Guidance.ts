import * as THREE from 'three';
import type { Heightmap } from '../world/Heightmap';

export interface GuideTarget {
  position: THREE.Vector3;
  label: string;
}

const CHEVRONS = 70;
const SPACING = 3;

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
    this.group.add(this.beacon, this.chevrons);
  }

  /**
   * @param route ground points from the player to the target (walking) or null to hide the trail
   * @param viewYaw direction the camera looks (heading convention: facing (sin, cos))
   */
  update(dt: number, elapsed: number, player: THREE.Vector3, target: GuideTarget | null, route: THREE.Vector2[] | null, viewYaw: number) {
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

    this.layTrail(dt, route);
  }

  private layTrail(dt: number, route: THREE.Vector2[] | null) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    let placed = 0;
    if (route && route.length >= 2) {
      this.flow = (this.flow + dt * 2.5) % SPACING;
      // walk along the polyline placing a chevron every SPACING metres, scrolling forward
      let carry = SPACING - this.flow + 2;
      for (let s = 0; s < route.length - 1 && placed < CHEVRONS; s++) {
        const a = route[s], b = route[s + 1];
        const len = a.distanceTo(b);
        const yaw = Math.atan2(b.x - a.x, b.y - a.y);
        q.setFromAxisAngle(up, yaw);
        let d = carry;
        for (; d < len && placed < CHEVRONS; d += SPACING) {
          const x = a.x + ((b.x - a.x) * d) / len, z = a.y + ((b.y - a.y) * d) / len;
          m.compose(new THREE.Vector3(x, this.hm.heightAt(x, z) + 0.12, z), q, new THREE.Vector3(1, 1, 1));
          this.chevrons.setMatrixAt(placed++, m);
        }
        carry = d - len;
      }
    }
    for (let i = placed; i < CHEVRONS; i++) this.chevrons.setMatrixAt(i, hidden);
    this.chevrons.instanceMatrix.needsUpdate = true;
  }
}
