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
  readonly speed: number; // m/s
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

  update(dt: number) {
    this.offset += this.speed * dt;
    const m = new THREE.Matrix4();
    for (let i = 0; i < this.chairs.count; i++) {
      this.chairs.setMatrixAt(i, this.poseAt(this.offset + i * CHAIR_SPACING, m));
    }
    this.chairs.instanceMatrix.needsUpdate = true;
  }
}
