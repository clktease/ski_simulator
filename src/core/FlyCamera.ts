import * as THREE from 'three';

/** Free-flying debug camera: pointer-lock mouse look + WASD. */
export class FlyCamera {
  private yaw = 0;
  private pitch = 0;
  private readonly keys = new Set<string>();
  speed = 40; // m/s

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly dom: HTMLElement,
    private readonly minHeight: (x: number, z: number) => number,
  ) {
    camera.rotation.order = 'YXZ';
    dom.addEventListener('click', () => dom.requestPointerLock());
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== dom) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * 0.0022, -1.5, 1.5);
    });
    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  lookAt(target: THREE.Vector3) {
    const d = target.clone().sub(this.camera.position).normalize();
    this.yaw = Math.atan2(-d.x, -d.z);
    this.pitch = Math.asin(d.y);
  }

  update(dt: number) {
    const k = this.keys;
    const move = new THREE.Vector3(
      (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0),
      (k.has('Space') ? 1 : 0) - (k.has('ShiftLeft') ? 1 : 0),
      (k.has('KeyS') ? 1 : 0) - (k.has('KeyW') ? 1 : 0),
    );
    const boost = k.has('ControlLeft') ? 5 : 1;
    move.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw).multiplyScalar(this.speed * boost * dt);
    const p = this.camera.position.add(move);
    p.y = Math.max(p.y, this.minHeight(p.x, p.z) + 1.7);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }
}
