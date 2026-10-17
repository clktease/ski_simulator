import * as THREE from 'three';
import type { GearKind } from '../flow/GameState';

export interface Outfit {
  jacket: number;
  pants: number;
  hat: number;
}

export const STREET_OUTFIT: Outfit = { jacket: 0x3b3f46, pants: 0x2d3a52, hat: 0x6b5a4a };

export type Pose = 'stand' | 'ski' | 'sit' | 'fallen';

// Body proportions (m), ~1.75 m tall
const THIGH = 0.43;
const SHIN = 0.43;
const ANKLE = 0.09;
const UPPER_ARM = 0.27;
const FOREARM = 0.25;
const HIP_WIDTH = 0.1;
const SHOULDER_WIDTH = 0.2;
const SPINE = 0.5;

function mesh(geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  return o;
}

/** A limb segment hanging down (-y) from its pivot, with a joint group at its end. */
function segment(length: number, radius: number, m: THREE.Material) {
  const pivot = new THREE.Group();
  pivot.add(mesh(new THREE.CapsuleGeometry(radius, length - radius * 1.4, 4, 10), m, 0, -length / 2, 0));
  const end = new THREE.Group();
  end.position.y = -length;
  pivot.add(end);
  return { pivot, end };
}

interface Leg {
  hip: THREE.Group;
  knee: THREE.Group;
  ankle: THREE.Group;
}

interface Arm {
  shoulder: THREE.Group;
  elbow: THREE.Group;
  hand: THREE.Group;
  pole: THREE.Object3D;
}

/**
 * Procedural skier with knee/elbow joints, ski wear and gear.
 * Poses are solved so the feet stay on the ground (or on the chair footrest).
 */
export class Character {
  readonly root = new THREE.Group();
  /** pelvis and everything above; moves for crouching / falling */
  private readonly pelvis = new THREE.Group();
  private readonly spine = new THREE.Group();
  private readonly gear = new THREE.Group();
  private readonly mats = {
    jacket: new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05 }),
    jacketDark: new THREE.MeshStandardMaterial({ roughness: 0.6 }),
    accent: new THREE.MeshStandardMaterial({ roughness: 0.4 }),
    pants: new THREE.MeshStandardMaterial({ roughness: 0.75 }),
    hat: new THREE.MeshStandardMaterial({ roughness: 0.5 }),
    skin: new THREE.MeshStandardMaterial({ color: 0xe3b993, roughness: 0.65 }),
    glove: new THREE.MeshStandardMaterial({ color: 0x1b1c20, roughness: 0.7 }),
    boot: new THREE.MeshStandardMaterial({ color: 0x23262d, roughness: 0.35, metalness: 0.1 }),
    shoe: new THREE.MeshStandardMaterial({ color: 0x3a2f28, roughness: 0.8 }),
    lens: new THREE.MeshStandardMaterial({ color: 0xff8a1e, roughness: 0.08, metalness: 0.9 }),
    strap: new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.8 }),
  };
  private readonly legs: Leg[] = [];
  private readonly arms: Arm[] = [];
  private readonly helmet: THREE.Object3D;
  private readonly beanie: THREE.Object3D;
  private readonly goggles: THREE.Object3D;
  private readonly skiBoots: THREE.Object3D[] = [];
  private readonly shoes: THREE.Object3D[] = [];
  private phase = 0;
  private pose: Pose = 'stand';
  private gearKind: GearKind | null = null;
  private lean = 0;
  private crouch = 0;

  constructor(outfit: Outfit = STREET_OUTFIT) {
    const m = this.mats;
    this.root.add(this.pelvis, this.gear);

    // Pelvis + legs
    this.pelvis.add(mesh(new THREE.CapsuleGeometry(0.12, 0.14, 4, 10).rotateZ(Math.PI / 2).scale(1, 1, 0.8), m.pants));
    for (const side of [-1, 1]) {
      const thigh = segment(THIGH, 0.078, m.pants);
      thigh.pivot.position.set(side * HIP_WIDTH, 0, 0);
      const shin = segment(SHIN, 0.064, m.pants);
      thigh.end.add(shin.pivot);
      const ankle = shin.end;
      const skiBoot = mesh(new THREE.BoxGeometry(0.13, 0.17, 0.31), m.boot, 0, -ANKLE + 0.085, 0.04);
      const cuff = mesh(new THREE.CylinderGeometry(0.075, 0.08, 0.12, 10), m.boot, 0, 0.06, 0);
      const bootGroup = new THREE.Group();
      bootGroup.add(skiBoot, cuff);
      const shoe = mesh(new THREE.BoxGeometry(0.09, 0.075, 0.24), m.shoe, 0, -ANKLE + 0.04, 0.035);
      ankle.add(bootGroup, shoe);
      this.skiBoots.push(bootGroup);
      this.shoes.push(shoe);
      this.pelvis.add(thigh.pivot);
      this.legs.push({ hip: thigh.pivot, knee: shin.pivot, ankle });
    }

    // Torso: lathe profile from waist to neck, slightly flattened front-to-back
    const profile = [
      [0.0, 0.0], [0.15, 0.0], [0.17, 0.12], [0.19, 0.28], [0.18, 0.4], [0.13, 0.48], [0.07, 0.52], [0.0, 0.53],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    this.spine.position.y = 0.06;
    this.spine.add(mesh(new THREE.LatheGeometry(profile, 18).scale(1, 1, 0.78), m.jacket));
    // chest trim band, zip and collar
    this.spine.add(mesh(new THREE.CylinderGeometry(0.192, 0.192, 0.035, 18, 1, true).scale(1, 1, 0.79), m.accent, 0, 0.3, 0));
    this.spine.add(mesh(new THREE.BoxGeometry(0.018, 0.42, 0.01), m.jacketDark, 0, 0.27, 0.146));
    this.spine.add(mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.07, 14), m.jacketDark, 0, 0.53, 0));
    // hood rolled at the back of the collar
    this.spine.add(mesh(new THREE.TorusGeometry(0.09, 0.03, 8, 14, Math.PI).rotateX(-Math.PI / 2), m.jacket, 0, 0.53, -0.03));
    this.pelvis.add(this.spine);

    // Head
    const head = new THREE.Group();
    head.position.y = SPINE + 0.13;
    head.add(mesh(new THREE.SphereGeometry(0.1, 16, 12).scale(0.95, 1.12, 1), m.skin));
    head.add(mesh(new THREE.ConeGeometry(0.018, 0.04, 6).rotateX(Math.PI / 2), m.skin, 0, -0.01, 0.105));
    this.helmet = mesh(new THREE.SphereGeometry(0.125, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), m.hat, 0, 0.0, -0.005);
    const beanie = new THREE.Group();
    beanie.add(mesh(new THREE.SphereGeometry(0.112, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), m.hat, 0, 0.02, 0));
    // folded cuff hugging the head (not a brim)
    beanie.add(mesh(new THREE.CylinderGeometry(0.108, 0.106, 0.045, 18, 1, true), m.hat, 0, 0.035, 0));
    beanie.add(mesh(new THREE.SphereGeometry(0.035, 8, 6), m.accent, 0, 0.13, 0));
    this.beanie = beanie;
    const goggles = new THREE.Group();
    // lens wraps the front of the face (theta 0 = +z), strap goes round the helmet
    goggles.add(mesh(new THREE.CylinderGeometry(0.112, 0.112, 0.06, 18, 1, true, -1.1, 2.2), m.lens, 0, 0.025, 0));
    goggles.add(mesh(new THREE.CylinderGeometry(0.118, 0.118, 0.03, 18, 1, true), m.strap, 0, 0.025, 0));
    this.goggles = goggles;
    head.add(this.helmet, beanie, goggles);
    this.spine.add(head);

    // Arms with gloves and poles
    for (const side of [-1, 1]) {
      const upper = segment(UPPER_ARM, 0.058, m.jacket);
      upper.pivot.position.set(side * SHOULDER_WIDTH, SPINE - 0.06, 0);
      upper.pivot.add(mesh(new THREE.SphereGeometry(0.07, 10, 8), m.jacket));
      const fore = segment(FOREARM, 0.05, m.jacket);
      upper.end.add(fore.pivot);
      const hand = fore.end;
      hand.add(mesh(new THREE.CylinderGeometry(0.058, 0.052, 0.07, 10), m.jacketDark, 0, 0.02, 0));
      hand.add(mesh(new THREE.SphereGeometry(0.05, 10, 8).scale(0.9, 1.2, 0.8), m.glove, 0, -0.04, 0));
      const pole = new THREE.Group();
      pole.add(mesh(new THREE.CylinderGeometry(0.009, 0.009, 1.15, 5), new THREE.MeshStandardMaterial({ color: 0xb8c0c8, metalness: 0.8, roughness: 0.25 }), 0, -0.55, 0));
      pole.add(mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.008, 10), m.strap, 0, -1.02, 0));
      pole.position.y = -0.04;
      pole.visible = false;
      hand.add(pole);
      this.spine.add(upper.pivot);
      this.arms.push({ shoulder: upper.pivot, elbow: fore.pivot, hand, pole });
    }

    this.setOutfit(outfit);
    this.setSkiwear(false);
  }

  setOutfit(o: Outfit) {
    const m = this.mats;
    m.jacket.color.setHex(o.jacket);
    m.jacketDark.color.setHex(o.jacket).multiplyScalar(0.55);
    m.pants.color.setHex(o.pants);
    m.hat.color.setHex(o.hat);
    // contrasting trim: white on dark jackets, charcoal on light ones
    const lum = m.jacket.color.r * 0.3 + m.jacket.color.g * 0.59 + m.jacket.color.b * 0.11;
    m.accent.color.setHex(lum > 0.5 ? 0x2a2d33 : 0xf2f2f2);
  }

  /** Helmet, goggles and ski boots instead of a beanie and street shoes. */
  setSkiwear(on: boolean) {
    this.helmet.visible = on;
    this.goggles.visible = on;
    this.beanie.visible = !on;
    for (const b of this.skiBoots) b.visible = on;
    for (const s of this.shoes) s.visible = !on;
  }

  /** Attach skis (+ poles) or a snowboard under the feet; null removes gear. */
  setGear(kind: GearKind | null, lengthCm = 160) {
    this.gear.clear();
    this.gearKind = kind;
    const len = lengthCm / 100;
    if (kind === 'ski') {
      const top = new THREE.MeshStandardMaterial({ color: 0xd23b2f, roughness: 0.3, metalness: 0.2 });
      for (const side of [-1, 1]) {
        const ski = mesh(new THREE.BoxGeometry(0.085, 0.022, len), top, side * HIP_WIDTH, 0.011, 0.05);
        const tip = mesh(new THREE.BoxGeometry(0.085, 0.022, 0.14), top, side * HIP_WIDTH, 0.04, 0.05 + len / 2);
        tip.rotation.x = -0.5;
        const binding = mesh(new THREE.BoxGeometry(0.1, 0.04, 0.34), this.mats.strap, side * HIP_WIDTH, 0.03, 0.04);
        this.gear.add(ski, tip, binding);
      }
    } else if (kind === 'snowboard') {
      this.gear.add(mesh(new THREE.BoxGeometry(0.27, 0.022, len), new THREE.MeshStandardMaterial({ color: 0x1e2a3a, roughness: 0.3 }), 0, 0.011, 0));
      for (const z of [-0.22, 0.22]) this.gear.add(mesh(new THREE.BoxGeometry(0.22, 0.05, 0.12), this.mats.strap, 0, 0.035, z));
    }
    for (const a of this.arms) a.pole.visible = kind === 'ski';
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
    const p = this.pelvis;
    p.rotation.set(0, 0, 0);
    this.spine.rotation.set(0, 0, 0);
    this.gear.visible = this.pose !== 'fallen' || this.gearKind === 'snowboard';
    this.gear.rotation.set(0, 0, 0);
    const board = this.gearKind === 'snowboard';
    for (const [i, leg] of this.legs.entries()) leg.hip.position.x = (i === 0 ? -1 : 1) * HIP_WIDTH;

    if (this.pose === 'stand') {
      const amount = Math.min(speed / 2, 1);
      this.phase += dt * Math.min(2.5 + speed * 2.2, 16);
      const s = Math.sin(this.phase);
      const legA = this.legAngles(s * 0.55 * amount, amount * 0.9 * Math.max(0, Math.sin(this.phase + 2.2)));
      const legB = this.legAngles(-s * 0.55 * amount, amount * 0.9 * Math.max(0, Math.sin(this.phase + 2.2 + Math.PI)));
      this.setLeg(0, legA);
      this.setLeg(1, legB);
      // stance leg carries the body: pelvis height follows the longer leg
      p.position.set(0, Math.max(legA.drop, legB.drop) + ANKLE, 0);
      const lean = Math.min(speed / 12, 0.35);
      this.spine.rotation.x = lean;
      this.setArm(0, -s * 0.6 * amount, -0.25 - 0.5 * amount, 0.08);
      this.setArm(1, s * 0.6 * amount, -0.25 - 0.5 * amount, 0.08);
    } else if (this.pose === 'ski') {
      const c = this.crouch;
      if (board) {
        // sideways stance: body turned 90° over the board, knees bent, arms out for balance
        p.rotation.y = Math.PI / 2;
        for (const [i, leg] of this.legs.entries()) leg.hip.position.x = (i === 0 ? -1 : 1) * 0.2;
        const legs = this.legAngles(-0.45 - 0.35 * c, 0.85 + 0.6 * c);
        this.setLeg(0, legs);
        this.setLeg(1, legs);
        // pelvis local +z points along root +x once turned sideways
        p.position.set(-legs.forward, legs.drop + ANKLE, 0);
        this.spine.rotation.x = 0.25 + 0.2 * c;
        p.rotation.x = this.lean * 0.7; // heel/toe edge
        this.setArm(0, -0.3, -0.4, 0.9);
        this.setArm(1, -0.3, -0.4, 0.9);
      } else {
        // athletic stance: shins forward against the boots, hips back, chest over the knees
        const legs = this.legAngles(-0.55 - 0.55 * c, 0.95 + 0.75 * c);
        this.setLeg(0, legs);
        this.setLeg(1, legs);
        p.position.set(0, legs.drop + ANKLE, -legs.forward);
        p.rotation.z = this.lean;
        this.spine.rotation.x = 0.45 + 0.45 * c;
        // hands forward, poles angled back
        this.setArm(0, -0.55 - 0.3 * c, -0.75, 0.12, 0.45);
        this.setArm(1, -0.55 - 0.3 * c, -0.75, 0.12, 0.45);
        // skis tip with the lean so edges bite
        this.gear.rotation.z = this.lean * 0.5;
      }
    } else if (this.pose === 'sit') {
      // thighs on the seat, shins hanging, hands on the bar
      const legs = this.legAngles(-1.5, 1.4);
      this.setLeg(0, legs);
      this.setLeg(1, legs);
      p.position.set(0, 0.46, 0);
      this.spine.rotation.x = -0.05;
      // poles held across the lap
      this.setArm(0, -0.5, -0.9, 0.15, 1.5);
      this.setArm(1, -0.5, -0.9, 0.15, 1.5);
    } else {
      // fallen: lying on the side, one knee up
      this.setLeg(0, this.legAngles(-0.6, 1.1));
      this.setLeg(1, this.legAngles(-0.2, 0.3));
      p.position.set(0.8, 0.16, 0);
      p.rotation.z = Math.PI / 2 - 0.15;
      this.setArm(0, -1.6, -0.4, 0.3);
      this.setArm(1, -0.4, -0.6, 0.2);
    }

    // skis/board follow the feet (seated: they dangle from the boots)
    if (this.pose === 'sit') {
      const seated = this.legAngles(-1.5, 1.4);
      this.gear.position.set(0, p.position.y - seated.drop - ANKLE, seated.forward);
    } else this.gear.position.set(0, 0, 0);
  }

  /**
   * Thigh angle `hip` (rotation.x, negative = forward) and knee flex `knee` (positive = shin back).
   * Returns the vertical drop from hip to ankle and how far forward the ankle ends up.
   */
  private legAngles(hip: number, knee: number) {
    const drop = THIGH * Math.cos(hip) + SHIN * Math.cos(hip + knee);
    const forward = -(THIGH * Math.sin(hip) + SHIN * Math.sin(hip + knee));
    return { hip, knee, drop, forward };
  }

  private setLeg(i: number, a: { hip: number; knee: number }) {
    const leg = this.legs[i];
    leg.hip.rotation.x = a.hip;
    leg.knee.rotation.x = a.knee;
    // keep the sole flat on the ground
    leg.ankle.rotation.x = -(a.hip + a.knee) - this.pelvis.rotation.x;
  }

  /**
   * shoulder swing (negative = forward), elbow flex (negative = forearm up/forward), spread outwards,
   * and the pole's world tilt (positive = basket behind the hand). Call after setting the spine.
   */
  private setArm(i: number, shoulder: number, elbow: number, spread: number, poleTilt = 0.3) {
    const arm = this.arms[i];
    const side = i === 0 ? -1 : 1;
    arm.shoulder.rotation.set(shoulder, 0, side * spread);
    arm.elbow.rotation.x = elbow;
    arm.pole.rotation.x = poleTilt - (shoulder + elbow + this.spine.rotation.x);
  }
}
