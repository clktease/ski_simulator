import * as THREE from 'three';
import { mergeStatic } from '../world/merge';
import type { Heightmap } from '../world/Heightmap';
import type { Facility, InteractionPoint } from './ResortData';
import type { LiftLine } from './Lifts';

/** Rotated rectangle obstacle on the ground plane. */
export interface Collider {
  x: number;
  z: number;
  halfW: number;
  halfD: number;
  rot: number;
}

export interface WorldInteraction extends Omit<InteractionPoint, 'service'> {
  service: InteractionPoint['service'] | 'lift';
  facility: Facility | null;
  position: THREE.Vector3;
  /** activation radius (default 3.5 m) */
  range?: number;
  lift?: LiftLine;
}

const mat = {
  wall: new THREE.MeshStandardMaterial({ color: 0xd8c9ad, roughness: 0.9 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x6e4b33, roughness: 0.8 }),
  concrete: new THREE.MeshStandardMaterial({ color: 0xb8b4ac, roughness: 0.95 }),
  roof: new THREE.MeshStandardMaterial({ color: 0x5b2f26, roughness: 0.6, metalness: 0.3 }),
  snow: new THREE.MeshStandardMaterial({ color: 0xf4f6fa, roughness: 0.7 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x1d2a36, roughness: 0.08, metalness: 0.6, envMapIntensity: 1.5 }),
  door: new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: 0.5 }),
  marker: new THREE.MeshBasicMaterial({ color: 0xffc23d }),
};

function gableRoofGeometry(width: number, depth: number, rise: number, overhang: number) {
  const hw = width / 2 + overhang, hd = depth / 2 + overhang;
  const shape = new THREE.Shape();
  shape.moveTo(-hd, 0);
  shape.lineTo(0, rise);
  shape.lineTo(hd, 0);
  shape.lineTo(-hd, 0);
  // Extrude along local x so the ridge runs the length of the building
  const geo = new THREE.ExtrudeGeometry(shape, { depth: hw * 2, bevelEnabled: false });
  geo.translate(0, 0, -hw);
  geo.rotateY(Math.PI / 2);
  return geo;
}

function signTexture(text: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#1f3b5c';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 56px "Noto Sans JP", "Yu Gothic", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Window band on all four walls of a storey. */
function windowBands(group: THREE.Group, w: number, d: number, y: number, h: number) {
  const t = 0.12;
  group.add(box(w * 0.86, h, t, mat.glass, 0, y, d / 2 + t / 2));
  group.add(box(w * 0.86, h, t, mat.glass, 0, y, -d / 2 - t / 2));
  group.add(box(t, h, d * 0.7, mat.glass, w / 2 + t / 2, y, 0));
  group.add(box(t, h, d * 0.7, mat.glass, -w / 2 - t / 2, y, 0));
  // mullions
  for (let x = -w * 0.43; x <= w * 0.43; x += 2.4) {
    group.add(box(0.12, h, 0.2, mat.wood, x, y, d / 2 + 0.12));
  }
}

function lodge(f: Facility, storeys: number, flatRoof: boolean) {
  const g = new THREE.Group();
  const storeyH = (f.height ?? 8) / (storeys + (flatRoof ? 0 : 0.6));
  const wallH = storeyH * storeys;
  // concrete plinth: Japanese snow-country buildings sit high above the snowpack
  g.add(box(f.width + 0.4, 1.2, f.depth + 0.4, mat.concrete, 0, 0.6, 0));
  g.add(box(f.width, wallH, f.depth, mat.wall, 0, 1.2 + wallH / 2, 0));
  for (let s = 0; s < storeys; s++) windowBands(g, f.width, f.depth, 1.2 + storeyH * (s + 0.55), storeyH * 0.45);

  const top = 1.2 + wallH;
  if (flatRoof) {
    g.add(box(f.width + 0.6, 0.5, f.depth + 0.6, mat.concrete, 0, top + 0.25, 0));
    g.add(box(f.width, 0.6, f.depth, mat.snow, 0, top + 0.8, 0));
  } else {
    const rise = f.depth * 0.32;
    const roof = new THREE.Mesh(gableRoofGeometry(f.width, f.depth, rise, 1.2), mat.roof);
    roof.position.y = top;
    roof.castShadow = roof.receiveShadow = true;
    const snow = new THREE.Mesh(gableRoofGeometry(f.width - 0.4, f.depth - 0.2, rise, 1.1), mat.snow);
    snow.position.y = top + 0.35;
    snow.castShadow = snow.receiveShadow = true;
    // Gable walls under the roof
    const gable = new THREE.Mesh(gableRoofGeometry(f.width, f.depth, rise, 0).scale(0.999, 0.999, 0.999), mat.wood);
    gable.position.y = top;
    g.add(roof, snow, gable);
  }

  // Entrance canopy, doors and sign on the front (local +z)
  const front = f.depth / 2;
  g.add(box(8, 0.3, 3, mat.wood, 0, 4.2, front + 1.5));
  g.add(box(7.6, 0.25, 2.8, mat.snow, 0, 4.48, front + 1.5));
  for (const sx of [-3.8, 3.8]) g.add(box(0.25, 3.2, 0.25, mat.wood, sx, 2.8, front + 2.8));
  g.add(box(3.2, 2.8, 0.15, mat.door, 0, 2.6, front + 0.08));
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(Math.min(f.width * 0.6, 14), Math.min(f.width * 0.6, 14) * (96 / 512)),
    new THREE.MeshStandardMaterial({ map: signTexture(f.name), roughness: 0.6 }),
  );
  sign.position.set(0, Math.min(top - 0.8, 6.2), front + 0.2);
  g.add(sign);
  return g;
}

/** Signpost marking an interaction point (door / counter). */
function marker() {
  const g = new THREE.Group();
  g.add(box(0.1, 2.2, 0.1, mat.wood, 0, 1.1, 0));
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.35), mat.marker);
  gem.position.y = 2.7;
  gem.name = 'gem';
  g.add(gem);
  return g;
}

export class Buildings {
  readonly group = new THREE.Group();
  readonly colliders: Collider[] = [];
  readonly interactions: WorldInteraction[] = [];
  private readonly gems: THREE.Object3D[] = [];

  /** Flattens the terrain under each facility; call before building terrain meshes. */
  static gradeSites(hm: Heightmap, facilities: Facility[]) {
    const pads = new Map<string, number>();
    for (const f of facilities) {
      pads.set(f.id, hm.flattenRect(f.x, f.z, f.width + 4, f.depth + 4, THREE.MathUtils.degToRad(f.rotation), f.type === 'parking' ? 15 : 10));
    }
    return pads;
  }

  constructor(facilities: Facility[], pads: Map<string, number>) {
    for (const f of facilities) {
      if (f.type === 'parking') continue;
      const rot = THREE.MathUtils.degToRad(f.rotation);
      const y = pads.get(f.id) ?? 0;
      const building = mergeStatic(f.type === 'hotel' ? lodge(f, 4, true) : lodge(f, f.type === 'center_house' ? 2 : 1, false));
      building.position.set(f.x, y, f.z);
      building.rotation.y = rot;
      this.group.add(building);
      this.colliders.push({ x: f.x, z: f.z, halfW: f.width / 2 + 0.3, halfD: f.depth / 2 + 0.3, rot });

      for (const p of f.points ?? []) {
        const local = new THREE.Vector3(p.at[0], 0, p.at[1]);
        const world = local.applyAxisAngle(new THREE.Vector3(0, 1, 0), rot).add(new THREE.Vector3(f.x, y, f.z));
        this.interactions.push({ ...p, facility: f, position: world });
        const m = marker();
        m.position.copy(world).add(new THREE.Vector3(Math.sin(rot) * 0.5, 0, Math.cos(rot) * 0.5));
        this.group.add(m);
        this.gems.push(m.getObjectByName('gem')!);
      }
    }
  }

  update(elapsed: number) {
    for (const g of this.gems) {
      g.rotation.y = elapsed * 1.5;
      g.position.y = 2.7 + Math.sin(elapsed * 2) * 0.12;
    }
  }
}
