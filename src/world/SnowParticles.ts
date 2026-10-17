import * as THREE from 'three';

const BOX = new THREE.Vector3(80, 40, 80);
const MAX = 30000;

/**
 * Falling snow around the camera. Flakes live in a box that wraps around the viewer in the
 * vertex shader, so the CPU only updates a few uniforms per frame.
 */
export class SnowParticles {
  readonly points: THREE.Points;
  private readonly material: THREE.ShaderMaterial;
  private readonly offset = new THREE.Vector3();

  constructor() {
    const pos = new Float32Array(MAX * 3);
    const seed = new Float32Array(MAX);
    for (let i = 0; i < MAX; i++) {
      pos[i * 3] = Math.random() * BOX.x;
      pos[i * 3 + 1] = Math.random() * BOX.y;
      pos[i * 3 + 2] = Math.random() * BOX.z;
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uOffset: { value: this.offset },
        uCamera: { value: new THREE.Vector3() },
        uBox: { value: BOX },
        uTime: { value: 0 },
        uSize: { value: 1 },
        uBrightness: { value: 1 },
      },
      vertexShader: /* glsl */ `
        attribute float seed;
        uniform vec3 uOffset, uCamera, uBox;
        uniform float uTime, uSize;
        varying float vAlpha;
        void main() {
          vec3 p = position + uOffset;
          // flutter
          p.x += sin(uTime * (0.7 + seed) + seed * 40.0) * 0.6;
          p.z += cos(uTime * (0.5 + seed) + seed * 17.0) * 0.6;
          // wrap into a box centred on the camera
          p = mod(p - uCamera + uBox * 0.5, uBox) - uBox * 0.5 + uCamera;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float dist = -mv.z;
          gl_PointSize = min(uSize * (0.6 + seed) * 60.0 / max(dist, 0.5), 10.0);
          vAlpha = smoothstep(40.0, 10.0, dist) * smoothstep(0.8, 3.0, dist);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uBrightness;
        varying float vAlpha;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.15, length(c)) * vAlpha;
          gl_FragColor = vec4(vec3(uBrightness), a * 0.9);
        }`,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  /**
   * @param intensity 0 none … 1 blizzard
   * @param wind horizontal wind (m/s)
   */
  update(dt: number, camera: THREE.Camera, intensity: number, wind: THREE.Vector3, brightness: number) {
    const count = Math.floor(MAX * intensity);
    this.points.visible = count > 0;
    this.points.geometry.setDrawRange(0, count);
    const fall = 1.2 + intensity * 0.8;
    this.offset.x += wind.x * dt;
    this.offset.y -= fall * dt;
    this.offset.z += wind.z * dt;
    const u = this.material.uniforms;
    u.uCamera.value.copy(camera.position);
    u.uTime.value += dt;
    u.uSize.value = 1 + intensity * 0.6;
    u.uBrightness.value = brightness;
  }
}
