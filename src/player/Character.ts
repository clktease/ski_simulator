import * as THREE from 'three';
import type { GearKind } from '../flow/GameState';

export interface Outfit {
  jacket: number;
  pants: number;
  hat: number;
}

export const STREET_OUTFIT: Outfit = { jacket: 0x3b3f46, pants: 0x2d3a52, hat: 0x6b5a4a };

export type Pose = 'stand' | 'ski' | 'sit' | 'fallen';

function part(geo: THREE.BufferGeometry, m: THREE.Material, y = 0) {
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.y = y;
  mesh.castShadow = true;
  return mesh;
}

/**
 * Procedural low-poly person (~1.72 m) with pivoted limbs, ski/snowboard gear and simple poses.
 * Placeholder until a rigged glTF character replaces it; the public API stays.
 */
export class Character {
  readonly root = new THREE.Group();
  /** everything above the feet; leans, crouches and falls */
  private readonly body = new THREE.Group();
  private readonly gear = new THREE.Group();
  private readonly jacketMat = new THREE.MeshStandardMaterial({ roughness: 0.75 });
  private readonly pantsMat = new THREE.MeshStandardMaterial({ roughness: 0.8 });
  private readonly hatMat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
  private readonly legs: THREE.Group[] = [];
  private readonly arms: THREE.Group[] = [];
  private readonly poles: THREE.Object3D[] = [];
  private phase = 0;
  private pose: Pose = 'stand';
  private gearKind: GearKind | null = null;
  private lean = 0;
  private crouch = 0;

  constructor(outfit: Outfit = STREET_OUTFIT) {
    const skin = new THREE.MeshStandardMaterial({ color: 0xe0b896, roughness: 0.7 });
    const boots = new THREE.MeshStandardMaterial({ color: 0x1e1e22, roughness: 0.6 });

    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.1, 0.88, 0);
      hip.add(part(new THREE.CapsuleGeometry(0.075, 0.72, 4, 8), this.pantsMat, -0.42));
      const boot = part(new THREE.BoxGeometry(0.12, 0.1, 0.26), boots, -0.84);
      boot.position.z = 0.04;
      hip.add(boot);
      this.legs.push(hip);
      this.body.add(hip);

      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.24, 1.4, 0);
      shoulder.add(part(new THREE.CapsuleGeometry(0.06, 0.5, 4, 8), this.jacketMat, -0.28));
      shoulder.add(part(new THREE.SphereGeometry(0.055, 8, 6), skin, -0.6));
      const pole = part(new THREE.CylinderGeometry(0.012, 0.012, 1.2, 4), new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.7, roughness: 0.3 }), -1.15);
      pole.visible = false;
      shoulder.add(pole);
      this.poles.push(pole);
      this.arms.push(shoulder);
      this.body.add(shoulder);
    }
    this.body.add(part(new THREE.CapsuleGeometry(0.17, 0.42, 4, 10), this.jacketMat, 1.17));
    this.body.add(part(new THREE.SphereGeometry(0.11, 12, 10), skin, 1.6));
    this.body.add(part(new THREE.SphereGeometry(0.115, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), this.hatMat, 1.63));
    // goggles
    const goggles = part(new THREE.BoxGeometry(0.17, 0.06, 0.04), new THREE.MeshStandardMaterial({ color: 0xd08a20, metalness: 0.8, roughness: 0.15 }), 1.63);
    goggles.position.z = 0.1;
    this.body.add(goggles);
    this.root.add(this.body, this.gear);
    this.setOutfit(outfit);
  }

  setOutfit(o: Outfit) {
    this.jacketMat.color.setHex(o.jacket);
    this.pantsMat.color.setHex(o.pants);
    this.hatMat.color.setHex(o.hat);
  }

  /** Attach skis (+ poles) or a snowboard under the feet; null removes gear. */
  setGear(kind: GearKind | null, lengthCm = 160) {
    this.gear.clear();
    this.gearKind = kind;
    const len = lengthCm / 100;
    if (kind === 'ski') {
      const m = new THREE.MeshStandardMaterial({ color: 0xd23b2f, roughness: 0.35, metalness: 0.2 });
      for (const side of [-1, 1]) {
        const ski = part(new THREE.BoxGeometry(0.085, 0.025, len), m, 0.012);
        ski.position.set(side * 0.11, 0.012, 0.05);
        // upturned tip
        const tip = part(new THREE.BoxGeometry(0.085, 0.025, 0.14), m, 0.04);
        tip.position.set(side * 0.11, 0.045, 0.05 + len / 2);
        tip.rotation.x = -0.5;
        this.gear.add(ski, tip);
      }
    } else if (kind === 'snowboard') {
      const board = part(new THREE.BoxGeometry(0.27, 0.025, len), new THREE.MeshStandardMaterial({ color: 0x1e2a3a, roughness: 0.35 }), 0.012);
      this.gear.add(board);
    }
    for (const p of this.poles) p.visible = kind === 'ski';
  }

  setPose(p: Pose) {
    this.pose = p;
  }

  /** roll into the turn (radians, + = lean left) and knee bend 0..1 */
  setSkiStance(lean: number, crouch: number) {
    this.lean = lean;
    this.crouch = crouch;
  }

  /** Advance animation; speed in m/s. */
  animate(dt: number, speed: number) {
    const b = this.body;
    b.rotation.set(0, 0, 0);
    b.position.set(0, 0, 0);
    // seated: skis dangle from the feet stretched out in front
    if (this.pose === 'sit') this.gear.position.set(0, 0.34, 0.84);
    else this.gear.position.set(0, 0, 0);
    this.gear.visible = this.pose !== 'fallen' || this.gearKind === 'snowboard';
    const board = this.gearKind === 'snowboard';

    if (this.pose === 'stand') {
      const amount = Math.min(speed / 1.6, 1);
      this.phase += dt * (2 + speed * 2.4);
      const swing = Math.sin(this.phase) * 0.55 * amount;
      this.setLimbs(swing, -swing, -swing * 0.8, swing * 0.8, 0);
      if (board) b.rotation.y = 0; // board carried / strapped on one foot: keep facing forward
    } else if (this.pose === 'ski') {
      const c = this.crouch;
      b.position.y = -0.18 * c - 0.05;
      b.rotation.z = this.lean;
      if (board) {
        // sideways stance, knees bent, arms out for balance
        b.rotation.y = Math.PI / 2;
        b.rotation.x = this.lean * 0.6;
        b.rotation.z = 0;
        this.setLimbs(0.25, -0.05, 0.4, 0.4, 0.9);
        this.legs[0].position.x = -0.22;
        this.legs[1].position.x = 0.22;
      } else {
        b.rotation.x = 0.25 + 0.35 * c; // forward lean
        this.setLimbs(-0.5 - 0.4 * c, -0.5 - 0.4 * c, -0.9, -0.9, 0.15);
      }
    } else if (this.pose === 'sit') {
      b.position.y = -0.42;
      this.setLimbs(-1.45, -1.45, -0.5, -0.5, 0.1);
    } else {
      // fallen: lying on the side in the snow
      b.rotation.z = Math.PI / 2 - 0.15;
      b.position.set(0.85, 0.15, 0);
      this.setLimbs(0.3, -0.4, -1.2, 0.6, 0.4);
    }
    if (this.pose !== 'ski' || !board) {
      this.legs[0].position.x = -0.1;
      this.legs[1].position.x = 0.1;
    }
  }

  private setLimbs(l0: number, l1: number, a0: number, a1: number, armSpread: number) {
    this.legs[0].rotation.x = l0;
    this.legs[1].rotation.x = l1;
    this.arms[0].rotation.set(a0, 0, -armSpread);
    this.arms[1].rotation.set(a1, 0, armSpread);
  }
}
