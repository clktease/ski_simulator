import * as THREE from 'three';

export interface Outfit {
  jacket: number;
  pants: number;
  hat: number;
}

export const STREET_OUTFIT: Outfit = { jacket: 0x3b3f46, pants: 0x2d3a52, hat: 0x6b5a4a };

function part(geo: THREE.BufferGeometry, m: THREE.Material, y = 0) {
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.y = y;
  mesh.castShadow = true;
  return mesh;
}

/**
 * Procedural low-poly person (~1.72 m) with pivoted limbs for a simple walk cycle.
 * Placeholder until a rigged glTF character replaces it; the public API (outfit, animate) stays.
 */
export class Character {
  readonly root = new THREE.Group();
  private readonly jacketMat = new THREE.MeshStandardMaterial({ roughness: 0.75 });
  private readonly pantsMat = new THREE.MeshStandardMaterial({ roughness: 0.8 });
  private readonly hatMat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
  private readonly legs: THREE.Group[] = [];
  private readonly arms: THREE.Group[] = [];
  private phase = 0;

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
      this.root.add(hip);

      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.24, 1.4, 0);
      shoulder.add(part(new THREE.CapsuleGeometry(0.06, 0.5, 4, 8), this.jacketMat, -0.28));
      shoulder.add(part(new THREE.SphereGeometry(0.055, 8, 6), skin, -0.6));
      this.arms.push(shoulder);
      this.root.add(shoulder);
    }
    this.root.add(part(new THREE.CapsuleGeometry(0.17, 0.42, 4, 10), this.jacketMat, 1.17));
    this.root.add(part(new THREE.SphereGeometry(0.11, 12, 10), skin, 1.6));
    this.root.add(part(new THREE.SphereGeometry(0.115, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), this.hatMat, 1.63));
    this.setOutfit(outfit);
  }

  setOutfit(o: Outfit) {
    this.jacketMat.color.setHex(o.jacket);
    this.pantsMat.color.setHex(o.pants);
    this.hatMat.color.setHex(o.hat);
  }

  /** Advance the walk cycle; speed in m/s. */
  animate(dt: number, speed: number) {
    const amount = Math.min(speed / 1.6, 1);
    this.phase += dt * (2 + speed * 2.4);
    const swing = Math.sin(this.phase) * 0.55 * amount;
    this.legs[0].rotation.x = swing;
    this.legs[1].rotation.x = -swing;
    this.arms[0].rotation.x = -swing * 0.8;
    this.arms[1].rotation.x = swing * 0.8;
    // settle limbs when standing still
    if (amount < 0.05) for (const l of [...this.legs, ...this.arms]) l.rotation.x *= 0.8;
  }
}
