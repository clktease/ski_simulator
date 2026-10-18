import * as THREE from 'three';

const MAX = 700;
const GRAVITY = 9.8;

/**
 * Snow kicked up by the skis: a trickle while gliding, a fan when carving or skidding hard.
 * A small CPU particle pool drawn as soft points.
 */
export class SnowSpray {
  readonly points: THREE.Points;
  private readonly pos = new Float32Array(MAX * 3);
  private readonly vel = new Float32Array(MAX * 3);
  private readonly life = new Float32Array(MAX);
  private readonly alpha = new Float32Array(MAX);
  private next = 0;
  private carry = 0;
  private readonly prev = new THREE.Vector3();
  private hasPrev = false;

  constructor() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uScale: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float alpha;
        uniform float uScale;
        varying float vAlpha;
        void main() {
          vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = max(1.5, uScale * (0.05 + 0.1 * (1.0 - alpha)) / -mv.z);
        }`,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5 || vAlpha <= 0.0) discard;
          gl_FragColor = vec4(vec3(0.97, 0.98, 1.0), vAlpha * (1.0 - d * 2.0) * 0.55);
        }`,
    });
    this.points = new THREE.Points(geo, material);
    this.points.frustumCulled = false;
  }

  /** @param skid sideways slide speed (m/s) @param active on skis and upright */
  update(dt: number, feet: THREE.Vector3, skid: number, active: boolean, viewportHeight: number) {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = viewportHeight * 0.7;
    if (dt <= 0) return;
    const v = new THREE.Vector3();
    if (this.hasPrev) v.subVectors(feet, this.prev).divideScalar(dt);
    this.prev.copy(feet);
    this.hasPrev = true;
    const speed = Math.hypot(v.x, v.z);

    // emit
    if (active && speed > 3) {
      const rate = speed * 2 + skid * 45;
      this.carry += rate * dt;
      const dir = new THREE.Vector3(v.x, 0, v.z).normalize();
      const side = new THREE.Vector3(-dir.z, 0, dir.x);
      while (this.carry >= 1) {
        this.carry -= 1;
        const i = this.next;
        this.next = (this.next + 1) % MAX;
        const s = Math.random() - 0.5;
        this.pos[i * 3] = feet.x + side.x * s * 0.5 - dir.x * 0.6;
        this.pos[i * 3 + 1] = feet.y + 0.05;
        this.pos[i * 3 + 2] = feet.z + side.z * s * 0.5 - dir.z * 0.6;
        // thrown backwards and up; skids throw it sideways out of the turn
        const back = 0.15 + Math.random() * 0.2, up = 0.6 + Math.random() * (1 + skid * 0.25), lat = (Math.random() - 0.5) * (0.8 + skid * 0.6);
        this.vel[i * 3] = v.x * (1 - back) + side.x * lat;
        this.vel[i * 3 + 1] = up;
        this.vel[i * 3 + 2] = v.z * (1 - back) + side.z * lat;
        this.life[i] = 0.5 + Math.random() * 0.5;
      }
    } else this.carry = 0;

    // simulate: gravity, air drag slows the powder quickly
    const drag = Math.exp(-dt * 3);
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      this.vel[i * 3] *= drag;
      this.vel[i * 3 + 2] *= drag;
      this.vel[i * 3 + 1] -= GRAVITY * 0.35 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.alpha[i] = Math.max(0, Math.min(1, this.life[i] * 2));
    }
    const geo = this.points.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.alpha.needsUpdate = true;
  }
}
