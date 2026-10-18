import * as THREE from 'three';
import type { Input } from './Input';

export interface FollowOptions {
  /** desired yaw to drift towards (e.g. direction of travel); undefined = free orbit */
  autoYaw?: number;
  /** how fast the camera drifts to autoYaw (1/s) */
  autoRate?: number;
  /** eye height above `target` */
  eye?: number;
  /** speed in m/s, drives FOV widening and head bob */
  speed?: number;
  /** vertical bob/shake offset (first person) */
  shake?: number;
}

const BASE_FOV = 65;

/** Shared third-person orbit / first-person camera used by walking, skiing and lift riding. */
export class FollowCamera {
  yaw = 0;
  pitch = 0.25;
  dist = 6;
  firstPerson = false;
  private readonly smoothed = new THREE.Vector3();
  private lastManual = 0;
  private time = 0;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly input: Input,
    private readonly groundAt: (x: number, z: number) => number,
  ) {}

  /** Snap behind the target facing `yaw`. */
  reset(target: THREE.Vector3, yaw: number) {
    this.yaw = yaw;
    this.update(0, target, {});
    this.smoothed.copy(this.desired(target, 1.6));
    this.camera.position.copy(this.smoothed);
  }

  update(dt: number, target: THREE.Vector3, o: FollowOptions) {
    const k = this.input;
    this.time += dt;
    if (k.mouseDX !== 0 || k.mouseDY !== 0) this.lastManual = this.time;
    this.yaw -= k.mouseDX * 0.0025;
    this.pitch = THREE.MathUtils.clamp(this.pitch + k.mouseDY * 0.0025, this.firstPerson ? -1.2 : -0.3, 1.2);
    if (!this.firstPerson) this.dist = THREE.MathUtils.clamp(this.dist + k.wheel * 0.8, 2.5, 18);

    // Drift behind the direction of travel when the player is not steering the camera
    if (o.autoYaw !== undefined && this.time - this.lastManual > 1.2) {
      let d = o.autoYaw - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * (o.autoRate ?? 2.5));
    }

    const speed = o.speed ?? 0;
    // wider field of view with speed: the strongest cue that you are going fast
    const fov = BASE_FOV + Math.min(speed * 0.9, 22) * (this.firstPerson ? 1 : 0.8);
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, fov, 3, dt);
      this.camera.updateProjectionMatrix();
    }

    const eye = o.eye ?? 1.6;
    if (this.firstPerson) {
      const head = target.clone();
      head.y += eye + (o.shake ?? 0);
      this.camera.position.copy(head);
      this.smoothed.copy(head);
      const dir = this.direction(-this.pitch);
      this.camera.lookAt(head.add(dir));
      return;
    }
    // closer and lower at speed so the snow rushes past near the lens
    const fast = THREE.MathUtils.smoothstep(speed, 5, 22);
    const pos = this.desired(target, eye - 0.35 * fast, this.dist * (1 - 0.18 * fast));
    this.smoothed.lerp(pos, dt > 0 ? 1 - Math.exp(-dt * 12) : 1);
    this.camera.position.copy(this.smoothed);
    this.camera.position.y += o.shake ?? 0;
    this.camera.lookAt(target.clone().setY(target.y + eye));
  }

  /** unit look direction for yaw and a given pitch (+ = up) */
  private direction(pitch: number) {
    return new THREE.Vector3(Math.sin(this.yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(this.yaw) * Math.cos(pitch));
  }

  private desired(target: THREE.Vector3, eye: number, dist = this.dist) {
    // behind the player (opposite the look direction) and raised by the pitch
    const pos = target.clone().setY(target.y + eye).addScaledVector(this.direction(-this.pitch), -dist);
    pos.y = Math.max(pos.y, this.groundAt(pos.x, pos.z) + 0.6);
    return pos;
  }
}
