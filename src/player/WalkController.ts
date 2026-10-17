import * as THREE from 'three';
import type { Input } from '../core/Input';
import type { Heightmap } from '../world/Heightmap';
import type { Collider } from '../resort/Buildings';
import { Character } from './Character';

const WALK_SPEED = 1.5;
const RUN_SPEED = 4;
const RADIUS = 0.35;

/** Third-person walking around the base area with an orbiting follow camera. */
export class WalkController {
  readonly character = new Character();
  readonly position = new THREE.Vector3();
  heading = 0; // radians, Three.js rotation.y of the character
  speed = 0;
  private camYaw = 0;
  private camPitch = 0.25;
  private camDist = 6;
  private readonly smoothedCam = new THREE.Vector3();

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly input: Input,
    private readonly hm: Heightmap,
    private readonly colliders: Collider[],
  ) {}

  /** Place at (x, z) facing `headingDeg` (0 = south, like facility rotations). */
  spawn(x: number, z: number, headingDeg: number) {
    this.heading = THREE.MathUtils.degToRad(headingDeg);
    this.camYaw = this.heading;
    this.position.set(x, this.hm.heightAt(x, z), z);
    this.snapCamera();
  }

  update(dt: number) {
    const k = this.input;
    this.camYaw -= k.mouseDX * 0.0025;
    this.camPitch = THREE.MathUtils.clamp(this.camPitch + k.mouseDY * 0.0025, -0.3, 1.2);
    this.camDist = THREE.MathUtils.clamp(this.camDist + k.wheel * 0.8, 2.5, 14);

    // Movement relative to the camera's facing
    const fwd = (k.isDown('KeyW') ? 1 : 0) - (k.isDown('KeyS') ? 1 : 0);
    const strafe = (k.isDown('KeyD') ? 1 : 0) - (k.isDown('KeyA') ? 1 : 0);
    const target = fwd || strafe ? (k.isDown('ShiftLeft') ? RUN_SPEED : WALK_SPEED) : 0;
    this.speed = THREE.MathUtils.damp(this.speed, target, 8, dt);

    if (fwd || strafe) {
      // camYaw is the horizontal direction the camera looks in (same convention as heading)
      const moveAngle = this.camYaw + Math.atan2(-strafe, fwd);
      let delta = moveAngle - this.heading;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      this.heading += delta * Math.min(1, dt * 10);
    }

    if (this.speed > 0.01) {
      const step = this.speed * dt;
      const nx = this.position.x + Math.sin(this.heading) * step;
      const nz = this.position.z + Math.cos(this.heading) * step;
      // Struggle up steep snow: slow down proportionally to the uphill grade
      const rise = this.hm.heightAt(nx, nz) - this.hm.heightAt(this.position.x, this.position.z);
      const grade = rise / step;
      const factor = grade > 0 ? THREE.MathUtils.clamp(1 - (grade - 0.3) * 1.2, 0.15, 1) : 1;
      this.position.x += (nx - this.position.x) * factor;
      this.position.z += (nz - this.position.z) * factor;
    }
    this.resolveCollisions();
    this.position.y = this.hm.heightAt(this.position.x, this.position.z);

    this.character.root.position.copy(this.position);
    this.character.root.rotation.y = this.heading;
    this.character.animate(dt, this.speed);
    this.updateCamera(dt);
  }

  private resolveCollisions() {
    const p = this.position;
    for (const c of this.colliders) {
      const cos = Math.cos(c.rot), sin = Math.sin(c.rot);
      const dx = p.x - c.x, dz = p.z - c.z;
      // world -> collider local
      const lx = dx * cos - dz * sin, lz = dx * sin + dz * cos;
      const qx = THREE.MathUtils.clamp(lx, -c.halfW, c.halfW);
      const qz = THREE.MathUtils.clamp(lz, -c.halfD, c.halfD);
      let ox = lx - qx, oz = lz - qz;
      let d = Math.hypot(ox, oz);
      if (d >= RADIUS) continue;
      if (d < 1e-6) {
        // inside: push out through the nearest face
        const px = c.halfW - Math.abs(lx), pz = c.halfD - Math.abs(lz);
        if (px < pz) { ox = Math.sign(lx) || 1; oz = 0; d = -px; } else { ox = 0; oz = Math.sign(lz) || 1; d = -pz; }
        const len = Math.hypot(ox, oz);
        ox /= len; oz /= len;
      } else {
        ox /= d; oz /= d;
      }
      const push = RADIUS - d;
      // collider local -> world
      p.x += (ox * cos + oz * sin) * push;
      p.z += (-ox * sin + oz * cos) * push;
    }
  }

  private desiredCamera() {
    const head = this.position.clone().add(new THREE.Vector3(0, 1.6, 0));
    // behind the player (opposite the look direction) and raised by the pitch
    const offset = new THREE.Vector3(
      -Math.sin(this.camYaw) * Math.cos(this.camPitch),
      Math.sin(this.camPitch),
      -Math.cos(this.camYaw) * Math.cos(this.camPitch),
    ).multiplyScalar(this.camDist);
    const pos = head.clone().add(offset);
    pos.y = Math.max(pos.y, this.hm.heightAt(pos.x, pos.z) + 0.6);
    return { pos, head };
  }

  private snapCamera() {
    const { pos, head } = this.desiredCamera();
    this.smoothedCam.copy(pos);
    this.camera.position.copy(pos);
    this.camera.lookAt(head);
  }

  private updateCamera(dt: number) {
    const { pos, head } = this.desiredCamera();
    this.smoothedCam.lerp(pos, 1 - Math.exp(-dt * 12));
    this.camera.position.copy(this.smoothedCam);
    this.camera.lookAt(head);
  }

  /** Forward direction on the ground. */
  get forward() {
    return new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
  }
}
