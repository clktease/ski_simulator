import * as THREE from 'three';
import type { Input } from './Input';

/** Free-flying debug camera: mouse look + WASD. */
export class FlyCamera {
  private yaw = 0;
  private pitch = 0;
  speed = 40; // m/s

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly input: Input,
    private readonly minHeight: (x: number, z: number) => number,
  ) {}

  lookAt(target: THREE.Vector3) {
    const d = target.clone().sub(this.camera.position).normalize();
    this.yaw = Math.atan2(-d.x, -d.z);
    this.pitch = Math.asin(d.y);
  }

  update(dt: number) {
    const k = this.input;
    this.yaw -= k.mouseDX * 0.0022;
    this.pitch = THREE.MathUtils.clamp(this.pitch - k.mouseDY * 0.0022, -1.5, 1.5);
    const move = new THREE.Vector3(
      (k.isDown('KeyD') ? 1 : 0) - (k.isDown('KeyA') ? 1 : 0),
      (k.isDown('Space') ? 1 : 0) - (k.isDown('ShiftLeft') ? 1 : 0),
      (k.isDown('KeyS') ? 1 : 0) - (k.isDown('KeyW') ? 1 : 0),
    );
    // not Ctrl: Ctrl+W closes the browser tab
    const boost = k.isDown('KeyR') ? 5 : 1;
    move.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw).multiplyScalar(this.speed * boost * dt);
    const p = this.camera.position.add(move);
    p.y = Math.max(p.y, this.minHeight(p.x, p.z) + 1.7);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }
}
