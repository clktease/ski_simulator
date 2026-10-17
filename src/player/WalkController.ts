import * as THREE from 'three';
import type { Input } from '../core/Input';
import type { FollowCamera } from '../core/FollowCamera';
import type { Heightmap } from '../world/Heightmap';
import type { Collider } from '../resort/Buildings';
import type { PlayerBody } from './PlayerBody';
import { resolveColliders } from './collide';

const WALK_SPEED = 1.5;
const RUN_SPEED = 4;
/** ski boots make walking clumsy */
const BOOT_FACTOR = 0.7;

/** Third-person walking around the base area. */
export class WalkController {
  speed = 0;
  inBoots = false;

  constructor(
    private readonly input: Input,
    private readonly hm: Heightmap,
    private readonly colliders: Collider[],
  ) {}

  update(dt: number, body: PlayerBody, cam: FollowCamera) {
    const k = this.input;
    const fwd = (k.isDown('KeyW') ? 1 : 0) - (k.isDown('KeyS') ? 1 : 0);
    const strafe = (k.isDown('KeyD') ? 1 : 0) - (k.isDown('KeyA') ? 1 : 0);
    const run = k.isDown('ShiftLeft') || k.isDown('ShiftRight');
    const target = fwd || strafe ? (run ? RUN_SPEED : WALK_SPEED) * (this.inBoots ? BOOT_FACTOR : 1) : 0;
    this.speed = THREE.MathUtils.damp(this.speed, target, 8, dt);

    if (fwd || strafe) {
      // move relative to where the camera looks
      const moveAngle = cam.yaw + Math.atan2(-strafe, fwd);
      let delta = moveAngle - body.heading;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      body.heading += delta * Math.min(1, dt * 10);
    }

    const p = body.position;
    if (this.speed > 0.01) {
      const step = this.speed * dt;
      const nx = p.x + Math.sin(body.heading) * step;
      const nz = p.z + Math.cos(body.heading) * step;
      // struggle up steep snow: slow down proportionally to the uphill grade
      const grade = (this.hm.heightAt(nx, nz) - this.hm.heightAt(p.x, p.z)) / step;
      const factor = grade > 0 ? THREE.MathUtils.clamp(1 - (grade - 0.3) * 1.2, 0.15, 1) : 1;
      p.x += (nx - p.x) * factor;
      p.z += (nz - p.z) * factor;
    }
    resolveColliders(p, 0.35, this.colliders);
    this.hm.clampInside(p);
    p.y = this.hm.heightAt(p.x, p.z);

    body.character.setPose('stand');
    body.character.animate(dt, this.speed);
    cam.update(dt, p, { speed: 0 });
  }
}
