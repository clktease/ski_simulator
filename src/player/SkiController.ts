import * as THREE from 'three';
import type { Input } from '../core/Input';
import type { FollowCamera } from '../core/FollowCamera';
import type { Heightmap } from '../world/Heightmap';
import type { TreeIndex } from '../world/Trees';
import type { SnowParams } from '../world/SnowConditions';
import type { Collider } from '../resort/Buildings';
import type { GearKind } from '../flow/GameState';
import type { PlayerBody } from './PlayerBody';
import { resolveColliders } from './collide';
import { gearHandling } from './Equipment';

const G = 9.81;
const STEP = 1 / 120;
const MASS = 75;
/** ½·ρ·Cd·A / m for an upright and a tucked skier (ρ = 1.2 kg/m³) */
const DRAG_UPRIGHT = (0.5 * 1.2 * 0.55) / MASS;
const DRAG_TUCK = (0.5 * 1.2 * 0.25) / MASS;
const FALL_TIME = 2.6;

export interface SkiEnvironment {
  snowAt(x: number, z: number): SnowParams;
  /** wind velocity in m/s (horizontal) */
  wind: THREE.Vector3;
  /** 0–100; tired skiers lose control more easily */
  stamina: number;
}

export interface SkiTelemetry {
  speed: number;
  /** terrain slope under the skis (degrees) */
  slopeDeg: number;
  /** pitch of the direction of travel: negative = downhill (degrees) */
  travelPitchDeg: number;
  /** sideways skid speed (m/s), drives the scraping sound */
  skid: number;
  snow: SnowParams | null;
}

/**
 * Skiing / snowboarding on the real heightmap.
 * Velocity lives in the tangent plane of the terrain; the edges convert sideways motion into
 * motion along the ski (carving), friction and air drag bleed energy.
 */
export class SkiController {
  readonly velocity = new THREE.Vector3();
  kind: GearKind = 'ski';
  handling = { turn: 1, stability: 1 };
  fallen = false;
  private fallTimer = 0;
  private yawRate = 0;
  private crouch = 0;
  private lean = 0;
  private accumulator = 0;
  private bobPhase = 0;
  readonly telemetry: SkiTelemetry = { speed: 0, slopeDeg: 0, travelPitchDeg: 0, skid: 0, snow: null };
  /** called when the skier falls (reason for the toast) */
  onFall: (reason: string) => void = () => {};
  /** distance & vertical drop accumulated, read and reset by the game */
  distance = 0;
  drop = 0;

  constructor(
    private readonly input: Input,
    private readonly hm: Heightmap,
    private readonly trees: TreeIndex,
    private readonly colliders: Collider[],
  ) {}

  setGear(kind: GearKind, lengthCm: number) {
    this.kind = kind;
    this.handling = gearHandling(kind, lengthCm);
  }

  /** Start skiing from standstill (or with an initial push along heading). */
  start(body: PlayerBody, initialSpeed = 0) {
    this.velocity.copy(body.forward).multiplyScalar(initialSpeed);
    this.fallen = false;
    this.fallTimer = 0;
  }

  get speed() {
    return this.telemetry.speed;
  }

  update(dt: number, body: PlayerBody, cam: FollowCamera, env: SkiEnvironment) {
    if (this.fallen) {
      this.fallTimer -= dt;
      this.velocity.multiplyScalar(Math.exp(-dt * 4));
      if (this.fallTimer <= 0) {
        this.fallen = false;
        this.velocity.set(0, 0, 0);
      }
    }

    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= STEP && steps < 20) {
      this.step(STEP, body, env);
      this.accumulator -= STEP;
      steps++;
    }
    if (steps === 20) this.accumulator = 0;

    const p = body.position;
    p.y = this.hm.heightAt(p.x, p.z);
    const speed = this.velocity.length();
    this.telemetry.speed = speed;
    this.telemetry.slopeDeg = this.hm.slopeAt(p.x, p.z);
    if (speed > 0.5) {
      const horiz = Math.hypot(this.velocity.x, this.velocity.z);
      this.telemetry.travelPitchDeg = THREE.MathUtils.radToDeg(Math.atan2(this.velocity.y, horiz));
    } else {
      this.telemetry.travelPitchDeg = 0;
    }

    // Visuals: crouch when tucking, lean into turns by the centripetal angle atan(v·ω/g)
    const c = body.character;
    c.setPose(this.fallen ? 'fallen' : 'ski');
    this.crouch = THREE.MathUtils.damp(this.crouch, this.input.isDown('KeyW') ? 1 : 0.25, 6, dt);
    const targetLean = -Math.atan((speed * this.yawRate) / G);
    this.lean = THREE.MathUtils.damp(this.lean, THREE.MathUtils.clamp(targetLean, -0.9, 0.9), 8, dt);
    c.setSkiStance(this.lean, this.crouch);
    c.animate(dt, speed);

    // Camera: chase the direction of travel; first person gets snow chatter
    const travelYaw = speed > 2 ? Math.atan2(this.velocity.x, this.velocity.z) : body.heading;
    this.bobPhase += dt * (6 + speed * 0.8);
    const rough = this.telemetry.snow ? this.telemetry.snow.fallRisk : 1;
    // snow chatter: bob plus jitter growing with speed and rough snow (gentler behind the skier)
    const chatter = (Math.sin(this.bobPhase) * 0.02 + (Math.random() - 0.5) * 0.004 * speed * rough) * Math.min(speed / 10, 1);
    const shake = cam.firstPerson ? chatter : chatter * 0.7;
    const eye = cam.firstPerson ? 1.55 - 0.25 * this.crouch : 1.4;
    cam.update(dt, p, { autoYaw: travelYaw, autoRate: 3, speed, shake, eye });
  }

  private step(h: number, body: PlayerBody, env: SkiEnvironment) {
    const k = this.input;
    const p = body.position;
    const n = this.hm.normalAt(p.x, p.z);
    const snow = env.snowAt(p.x, p.z);
    this.telemetry.snow = snow;
    const v = this.velocity;

    // Gravity component along the slope: g - (g·n)n
    v.x += n.x * n.y * G * h;
    v.y += (-1 + n.y * n.y) * G * h;
    v.z += n.z * n.y * G * h;

    // Ski direction and its sideways axis, both in the tangent plane
    const d = body.forward;
    d.addScaledVector(n, -d.dot(n)).normalize();
    const side = new THREE.Vector3().crossVectors(n, d).normalize();

    const steer = this.fallen ? 0 : (k.isDown('KeyA') ? 1 : 0) - (k.isDown('KeyD') ? 1 : 0);
    const brake = !this.fallen && k.isDown('KeyS');
    const tuck = !this.fallen && k.isDown('KeyW');

    // Turning: pivot quickly at low speed, carve radius limits yaw rate at high speed (R ≈ 9–14 m)
    const speed0 = v.length();
    const maxRate = speed0 < 4 ? 2.2 : Math.min(2.2, speed0 / (9 / this.handling.turn));
    const targetRate = steer * Math.max(maxRate, 0.6) * (brake ? 1.3 : 1);
    this.yawRate = THREE.MathUtils.damp(this.yawRate, targetRate, 10, h);
    body.heading += this.yawRate * h;

    // Edges: kill sideways velocity (carve). Braking = skidding / snowplough: less grip, more friction
    const vSide = v.dot(side);
    const grip = this.fallen ? 1.5 : snow.grip * (brake ? 0.45 : 1);
    const newSide = vSide * Math.exp(-grip * h);
    v.addScaledVector(side, newSide - vSide);
    this.telemetry.skid = Math.abs(vSide);

    // Kinetic friction ∝ normal force, plus snowplough braking
    let speed = v.length();
    if (speed > 1e-4) {
      const mu = snow.mu + (brake ? (this.kind === 'ski' ? 0.32 : 0.36) : 0) + (this.fallen ? 0.6 : 0);
      const dv = Math.min(speed, mu * G * n.y * h);
      v.multiplyScalar((speed - dv) / speed);
    }

    // Air drag against the relative wind + snow ploughing drag
    const rel = v.clone().sub(env.wind);
    const relSpeed = rel.length();
    const cd = (tuck ? DRAG_TUCK : DRAG_UPRIGHT) + snow.drag;
    v.addScaledVector(rel, -cd * relSpeed * h);

    // Skating / pole pushing on flats
    speed = v.length();
    if (tuck && speed < 4 && !this.fallen) v.addScaledVector(d, 1.6 * h);

    // Static friction: stand still on gentle terrain
    const slopeAccel = G * Math.sqrt(Math.max(0, 1 - n.y * n.y));
    if (speed < 0.25 && slopeAccel < (snow.mu + 0.01) * G * n.y && !tuck) v.set(0, 0, 0);

    // Keep velocity in the tangent plane and integrate
    v.addScaledVector(n, -v.dot(n));
    const ox = p.x, oz = p.z, oy = p.y;
    p.x += v.x * h;
    p.z += v.z * h;
    this.hm.clampInside(p);
    p.y = this.hm.heightAt(p.x, p.z);
    this.distance += Math.hypot(p.x - ox, p.z - oz);
    this.drop += Math.max(0, oy - p.y);

    if (!this.fallen) this.checkCrash(h, p, speed, vSide, snow, env);
  }

  private checkCrash(h: number, p: THREE.Vector3, speed: number, vSide: number, snow: SnowParams, env: SkiEnvironment) {
    const tree = this.trees.hit(p.x, p.z, 0.3);
    if (tree) {
      const away = new THREE.Vector3(p.x - tree.x, 0, p.z - tree.z).normalize();
      p.x += away.x * tree.overlap;
      p.z += away.z * tree.overlap;
      if (speed > 4.5) return this.fall('撞到樹了！');
      this.velocity.set(0, 0, 0);
      return;
    }
    if (resolveColliders(p, 0.4, this.colliders)) {
      if (speed > 4.5) return this.fall('撞到建築物了！');
      this.velocity.multiplyScalar(0.3);
    }
    // Losing the edges: hard sideways skids at speed can throw the skier
    const fatigue = env.stamina < 25 ? 1.8 : env.stamina < 50 ? 1.2 : 1;
    const limit = 7 * this.handling.stability;
    if (Math.abs(vSide) > limit && speed > 9) {
      const perSecond = 0.35 * snow.fallRisk * fatigue * ((Math.abs(vSide) - limit) / limit + 0.3);
      if (Math.random() < perSecond * h) this.fall(snow.fallRisk > 1.5 ? '在冰面上失去抓地力跌倒了' : '轉彎太急，失去平衡跌倒了');
    }
  }

  private fall(reason: string) {
    this.fallen = true;
    this.fallTimer = FALL_TIME;
    this.velocity.multiplyScalar(0.25);
    this.onFall(reason);
  }
}
