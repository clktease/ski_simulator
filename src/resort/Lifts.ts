import * as THREE from 'three';
import type { Heightmap } from '../world/Heightmap';
import type { Lift } from './ResortData';

const TOWER_HEIGHT = 11;
const CABLE_GAP = 2.4; // half distance between uphill and downhill cable
const CHAIR_SPACING = 14;
const CHAIR_DROP = 2.6;

/** One chairlift: stations, pylons, cable loop and moving chairs. */
export class LiftLine {
  readonly group = new THREE.Group();
  /** closed cable loop: uphill side then downhill side */
  readonly loop: THREE.CurvePath<THREE.Vector3>;
  readonly length: number;
  /** loop distance from the bottom anchor to the top anchor */
  readonly upLength: number;
  readonly speed: number; // m/s
  /** fast-forward while the player rides */
  speedMultiplier = 1;
  /** where skiers queue to board (bottom) and where they get off (top) */
  readonly bottom: THREE.Vector3;
  readonly top: THREE.Vector3;
  /** horizontal uphill direction at the top station (to ski away from it) */
  readonly topDir: THREE.Vector3;
  readonly boardingPoint: THREE.Vector3;
  running = true;
  private readonly chairs: THREE.InstancedMesh;
  private offset = 0;

  constructor(readonly data: Lift, hm: Heightmap) {
    let pts = data.points.map(([x, z]) => new THREE.Vector3(x, hm.heightAt(x, z), z));
    if (pts[0].y > pts[pts.length - 1].y) pts = pts.reverse(); // bottom station first
    const quad = (data.seats ?? 0) >= 4 || /クワッド|quad/i.test(data.name ?? '');
    this.speed = quad ? 4.5 : 2.2;

    const towerMat = new THREE.MeshStandardMaterial({ color: 0x8a9096, metalness: 0.6, roughness: 0.45 });
    const stationMat = new THREE.MeshStandardMaterial({ color: 0x5a6470, metalness: 0.3, roughness: 0.6 });

    // Cable anchor points (top of each pylon), offset sideways for each direction
    const up: THREE.Vector3[] = [], down: THREE.Vector3[] = [];
    pts.forEach((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const dir = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize();
      const side = new THREE.Vector3(-dir.z, 0, dir.x);
      const isStation = i === 0 || i === pts.length - 1;
      const top = p.clone().setY(p.y + (isStation ? 5 : TOWER_HEIGHT));
      up.push(top.clone().addScaledVector(side, CABLE_GAP));
      down.push(top.clone().addScaledVector(side, -CABLE_GAP));

      if (isStation) {
        const st = new THREE.Mesh(new THREE.BoxGeometry(12, 6, 9), stationMat);
        st.position.copy(p).setY(p.y + 3);
        st.rotation.y = Math.atan2(dir.x, dir.z);
        st.castShadow = st.receiveShadow = true;
        this.group.add(st);
      } else {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, TOWER_HEIGHT, 8), towerMat);
        pole.position.copy(p).setY(p.y + TOWER_HEIGHT / 2);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(CABLE_GAP * 2 + 1, 0.4, 0.4), towerMat);
        arm.position.copy(top);
        arm.rotation.y = Math.atan2(dir.x, dir.z) + Math.PI / 2;
        pole.castShadow = arm.castShadow = true;
        this.group.add(pole, arm);
      }
    });

    // Sagging cable spans between anchors
    this.loop = new THREE.CurvePath<THREE.Vector3>();
    const addSpans = (anchors: THREE.Vector3[]) => {
      for (let i = 0; i < anchors.length - 1; i++) {
        const a = anchors[i], b = anchors[i + 1];
        const mid = a.clone().lerp(b, 0.5);
        mid.y -= a.distanceTo(b) * 0.025;
        this.loop.add(new THREE.QuadraticBezierCurve3(a, mid, b));
      }
    };
    addSpans(up);
    this.upLength = this.loop.getLength();
    this.loop.add(new THREE.LineCurve3(up[up.length - 1], down[down.length - 1]));
    addSpans([...down].reverse());
    this.loop.add(new THREE.LineCurve3(down[0], up[0]));
    this.length = this.loop.getLength();

    const cable = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(this.loop.getSpacedPoints(Math.ceil(this.length / 4))),
      new THREE.LineBasicMaterial({ color: 0x222222 }),
    );
    this.group.add(cable);

    // Chair: hanger + seat + backrest
    const seatW = quad ? 2.4 : 1.3;
    const chairGeo = new THREE.BoxGeometry(seatW, 0.12, 0.6).translate(0, -CHAIR_DROP, 0);
    const chairMat = new THREE.MeshStandardMaterial({ color: quad ? 0x2a5aa8 : 0xb03030, roughness: 0.5, metalness: 0.2 });
    const count = Math.floor(this.length / CHAIR_SPACING);
    this.bottom = pts[0].clone();
    this.top = pts[pts.length - 1].clone();
    const firstDir = new THREE.Vector3(pts[1].x - pts[0].x, 0, pts[1].z - pts[0].z).normalize();
    this.topDir = new THREE.Vector3(this.top.x - pts[pts.length - 2].x, 0, this.top.z - pts[pts.length - 2].z).normalize();
    // queue area just downhill of the bottom station
    this.boardingPoint = this.bottom.clone().addScaledVector(firstDir, -9);
    this.boardingPoint.y = hm.heightAt(this.boardingPoint.x, this.boardingPoint.z);
    this.chairs = new THREE.InstancedMesh(chairGeo, chairMat, count);
    this.chairs.castShadow = true;
    this.group.add(this.chairs);
    this.update(0);
  }

  /** Pose of a point travelling `distance` metres along the loop. */
  poseAt(distance: number, target = new THREE.Matrix4()) {
    const u = (((distance % this.length) + this.length) % this.length) / this.length;
    const p = this.loop.getPointAt(u);
    const t = this.loop.getTangentAt(u);
    const yaw = Math.atan2(t.x, t.z);
    return target.compose(p, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw + Math.PI / 2), new THREE.Vector3(1, 1, 1));
  }

  get chairCount() {
    return this.chairs.count;
  }

  /** Loop distance of chair i right now. */
  chairDistance(i: number) {
    return (((this.offset + i * CHAIR_SPACING) % this.length) + this.length) % this.length;
  }

  /** Index of the chair that most recently passed the bottom bullwheel (the one to board). */
  nextChair() {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < this.chairs.count; i++) {
      // distance travelled past the bottom anchor, wrapping
      const d = (this.chairDistance(i) + this.length * 0.02) % this.length;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  /** Seat transform (where a rider sits) for a loop distance. */
  seatAt(distance: number) {
    const m = this.poseAt(distance);
    const pos = new THREE.Vector3(), q = new THREE.Quaternion();
    m.decompose(pos, q, new THREE.Vector3());
    pos.y -= CHAIR_DROP + 0.45; // character root sits ~0.45 m below the hips
    // chair frame is rotated +90° from the travel direction; riders face along travel
    const yaw = new THREE.Euler().setFromQuaternion(q, 'YXZ').y - Math.PI / 2;
    return { pos, yaw };
  }

  update(dt: number) {
    if (!this.running) return;
    this.offset += this.speed * this.speedMultiplier * dt;
    const m = new THREE.Matrix4();
    for (let i = 0; i < this.chairs.count; i++) {
      this.chairs.setMatrixAt(i, this.poseAt(this.offset + i * CHAIR_SPACING, m));
    }
    this.chairs.instanceMatrix.needsUpdate = true;
  }
}
