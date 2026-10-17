import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Heightmap } from '../world/Heightmap';
import { samplePath, type RunPath } from '../resort/RunPaths';
import type { LiftLine } from '../resort/Lifts';
import { WEAR_COLORS } from '../player/Equipment';

type Skill = 'beginner' | 'intermediate' | 'expert';

const SKILLS: Record<Skill, { speed: number; turnAmp: number; turnLen: number }> = {
  // cruising speed (m/s), half-width of the S-turns (m), metres of run per turn
  beginner: { speed: 5, turnAmp: 9, turnLen: 30 },
  intermediate: { speed: 10, turnAmp: 7, turnLen: 38 },
  expert: { speed: 16, turnAmp: 5, turnLen: 50 },
};


/** gone = went home (lifts closed), hidden until a lift opens again */
type State = 'ski' | 'toLift' | 'lift' | 'gone';

interface Npc {
  state: State;
  skill: Skill;
  path: RunPath;
  s: number;
  phase: number;
  speed: number;
  /** lateral dodge offset to keep clear of the player */
  dodge: number;
  lift: LiftLine | null;
  chair: number;
  pos: THREE.Vector3;
  heading: number;
  lean: number;
  snowboard: boolean;
}

export class NpcSkiers {
  readonly group = new THREE.Group();
  private readonly npcs: Npc[] = [];
  private readonly paths: RunPath[];
  private readonly meshes: { torso: THREE.InstancedMesh; legs: THREE.InstancedMesh; head: THREE.InstancedMesh; ski: THREE.InstancedMesh; board: THREE.InstancedMesh };

  constructor(
    private readonly hm: Heightmap,
    runs: RunPath[],
    private readonly lifts: LiftLine[],
    count = 60,
    /** whether a lift is currently loading passengers */
    private readonly isOpen: (lift: LiftLine) => boolean = () => true,
  ) {
    this.paths = runs.filter((p) => p.length > 80);

    const torsoGeo = mergeGeometries([
      new THREE.CapsuleGeometry(0.17, 0.4, 3, 8).translate(0, 0.38, 0),
      new THREE.CapsuleGeometry(0.06, 0.45, 3, 6).rotateX(-0.9).translate(0.25, 0.42, 0.18),
      new THREE.CapsuleGeometry(0.06, 0.45, 3, 6).rotateX(-0.9).translate(-0.25, 0.42, 0.18),
    ])!;
    const legsGeo = mergeGeometries([
      new THREE.CapsuleGeometry(0.075, 0.7, 3, 6).translate(0.1, -0.42, 0),
      new THREE.CapsuleGeometry(0.075, 0.7, 3, 6).translate(-0.1, -0.42, 0),
    ])!;
    const headGeo = new THREE.SphereGeometry(0.13, 10, 8).translate(0, 0.86, 0);
    const skiGeo = mergeGeometries([
      new THREE.BoxGeometry(0.085, 0.025, 1.65).translate(0.11, 0.012, 0.05),
      new THREE.BoxGeometry(0.085, 0.025, 1.65).translate(-0.11, 0.012, 0.05),
    ])!;
    const boardGeo = new THREE.BoxGeometry(0.27, 0.025, 1.5).translate(0, 0.012, 0);
    const mk = (geo: THREE.BufferGeometry, color: number) => {
      const m = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.7 }), count);
      m.castShadow = true;
      m.frustumCulled = false;
      this.group.add(m);
      return m;
    };
    this.meshes = {
      torso: mk(torsoGeo, 0xffffff),
      legs: mk(legsGeo, 0x24262c),
      head: mk(headGeo, 0xffffff),
      ski: mk(skiGeo, 0x8c2a2a),
      board: mk(boardGeo, 0x1e2a3a),
    };

    const skills: Skill[] = ['beginner', 'intermediate', 'intermediate', 'expert'];
    for (let i = 0; i < count; i++) {
      const path = this.paths[i % this.paths.length];
      const npc: Npc = {
        state: 'ski',
        skill: skills[i % skills.length],
        path,
        s: Math.random() * path.length * 0.9,
        phase: Math.random() * Math.PI * 2,
        speed: 3,
        dodge: 0,
        lift: null,
        chair: 0,
        pos: new THREE.Vector3(),
        heading: 0,
        lean: 0,
        snowboard: i % 4 === 3,
      };
      // a third of the crowd starts on the lifts
      if (i % 3 === 2 && lifts.length) this.boardLift(npc, lifts[i % lifts.length], true);
      this.npcs.push(npc);
      const outfit = WEAR_COLORS[(i * 7) % WEAR_COLORS.length].outfit;
      this.meshes.torso.setColorAt(i, new THREE.Color(outfit.jacket));
      this.meshes.head.setColorAt(i, new THREE.Color(outfit.hat));
    }
  }

  private boardLift(npc: Npc, lift: LiftLine, midway = false) {
    npc.state = 'lift';
    npc.lift = lift;
    if (midway) {
      // pick a random chair currently on the uphill side
      for (let tries = 0; tries < 20; tries++) {
        const c = Math.floor(Math.random() * lift.chairCount);
        if (lift.chairDistance(c) < lift.upLength - 10) { npc.chair = c; return; }
      }
    }
    npc.chair = lift.nextChair();
  }

  private chooseRunFrom(x: number, z: number): RunPath {
    const near = this.paths.filter((p) => p.pts[0].distanceTo(new THREE.Vector2(x, z)) < 350);
    if (near.length) return near[Math.floor(Math.random() * near.length)];
    return this.paths.reduce((best, p) => (p.pts[0].distanceTo(new THREE.Vector2(x, z)) < best.pts[0].distanceTo(new THREE.Vector2(x, z)) ? p : best));
  }

  update(dt: number, player: THREE.Vector3, visible: boolean) {
    this.group.visible = visible;
    const m = new THREE.Matrix4(), part = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const one = new THREE.Vector3(1, 1, 1);

    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    const anyOpen = this.lifts.some((l) => this.isOpen(l));
    this.npcs.forEach((n, i) => {
      let sitting = false;
      if (n.state === 'gone') {
        if (anyOpen && Math.random() < dt * 0.05) {
          n.path = this.paths[Math.floor(Math.random() * this.paths.length)];
          n.s = 0;
          n.state = 'ski';
        } else {
          for (const mesh of Object.values(this.meshes)) mesh.setMatrixAt(i, hidden);
          return;
        }
      }
      if (n.state === 'ski') this.updateSki(n, dt, player, anyOpen);
      else if (n.state === 'toLift') {
        const target = n.lift!.boardingPoint;
        const d = new THREE.Vector3(target.x - n.pos.x, 0, target.z - n.pos.z);
        const dist = d.length();
        if (dist < 2) this.boardLift(n, n.lift!);
        else {
          d.normalize();
          n.pos.x += d.x * 3 * dt;
          n.pos.z += d.z * 3 * dt;
          n.pos.y = this.hm.heightAt(n.pos.x, n.pos.z);
          n.heading = Math.atan2(d.x, d.z);
          n.lean = 0;
        }
      }
      if (n.state === 'lift' && !n.lift!.running) n.state = 'gone';
      if (n.state === 'gone') return;
      if (n.state === 'lift') {
        const lift = n.lift!;
        const dist = lift.chairDistance(n.chair);
        if (dist >= lift.upLength - 3 && dist < lift.upLength + 20) {
          n.path = this.chooseRunFrom(lift.top.x, lift.top.z);
          n.s = 0;
          n.state = 'ski';
          n.speed = 2;
        } else {
          const seat = lift.seatAt(dist);
          n.pos.copy(seat.pos);
          n.heading = seat.yaw;
          n.lean = 0;
          sitting = true;
        }
      }

      // base transform: position, heading, lean
      e.set(0, n.heading, 0, 'YXZ');
      q.setFromEuler(e);
      m.compose(n.pos, q, one);
      const roll = new THREE.Matrix4().makeRotationZ(n.lean);
      const hip = sitting ? 0.46 : 0.78;
      // torso + head: crouched forward when skiing, upright when seated
      part.copy(m).multiply(roll).multiply(new THREE.Matrix4().makeTranslation(0, hip, 0)).multiply(new THREE.Matrix4().makeRotationX(sitting ? 0 : 0.35));
      this.meshes.torso.setMatrixAt(i, part);
      this.meshes.head.setMatrixAt(i, part);
      // legs hang from the hips: forward when seated, slightly bent when skiing
      part.copy(m).multiply(roll).multiply(new THREE.Matrix4().makeTranslation(0, hip + 0.06, 0)).multiply(new THREE.Matrix4().makeRotationX(sitting ? -1.45 : -0.15));
      this.meshes.legs.setMatrixAt(i, part);
      // gear follows the feet
      const feet = sitting ? new THREE.Matrix4().makeTranslation(0, hip - 0.12, 0.82) : new THREE.Matrix4();
      part.copy(m).multiply(feet);
      this.meshes.ski.setMatrixAt(i, n.snowboard ? hidden : part);
      this.meshes.board.setMatrixAt(i, n.snowboard ? part : hidden);
    });
    for (const mesh of Object.values(this.meshes)) mesh.instanceMatrix.needsUpdate = true;
  }

  private updateSki(n: Npc, dt: number, player: THREE.Vector3, anyOpen: boolean) {
    const sk = SKILLS[n.skill];
    const { point, tan } = samplePath(n.path, n.s);
    // cruise faster on gentle slopes, check speed on steep ones
    const slope = this.hm.slopeAt(point.x, point.y);
    const target = sk.speed * THREE.MathUtils.clamp(0.6 + slope / 25, 0.5, 1.4);
    n.speed = THREE.MathUtils.damp(n.speed, target, 1.2, dt);

    // S-turns around the run centre line
    const turnRate = (Math.PI * 2) / sk.turnLen;
    n.phase += n.speed * turnRate * dt;
    const lateral = Math.sin(n.phase) * sk.turnAmp + n.dodge;
    const normal = new THREE.Vector2(-tan.y, tan.x);

    // dodge the player when close
    const px = point.x + normal.x * lateral, pz = point.y + normal.y * lateral;
    const dx = px - player.x, dz = pz - player.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < 64) n.dodge += Math.sign(dx * normal.x + dz * normal.y || 1) * dt * 6;
    else n.dodge *= Math.exp(-dt * 0.5);
    n.dodge = THREE.MathUtils.clamp(n.dodge, -15, 15);

    n.s += n.speed * dt;
    n.pos.set(px, this.hm.heightAt(px, pz), pz);
    // heading follows the S-curve: tangent rotated by the lateral derivative
    const dLat = Math.cos(n.phase) * sk.turnAmp * turnRate;
    n.heading = Math.atan2(tan.x + normal.x * dLat, tan.y + normal.y * dLat);
    n.lean = THREE.MathUtils.clamp(-Math.sin(n.phase) * 0.5 * (n.speed / sk.speed), -0.6, 0.6);

    if (n.s >= n.path.length) {
      const end = n.path.pts[n.path.pts.length - 1];
      const lift = this.lifts
        .filter((l) => this.isOpen(l))
        .map((l) => ({ l, d: Math.hypot(l.boardingPoint.x - end.x, l.boardingPoint.z - end.y) }))
        .sort((a, b) => a.d - b.d)[0];
      if (lift && lift.d < 300) {
        n.state = 'toLift';
        n.lift = lift.l;
      } else if (anyOpen) {
        // no lift nearby: start another run (out of sight in practice)
        n.path = this.paths[Math.floor(Math.random() * this.paths.length)];
        n.s = 0;
      } else {
        n.state = 'gone';
      }
    }
  }
}
