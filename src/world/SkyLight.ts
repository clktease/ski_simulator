import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

/** Physical sky, sun light with camera-following shadows, and sky-based environment lighting. */
export class SkyLight {
  readonly sun = new THREE.DirectionalLight(0xfff4e6, 3.2);
  readonly sunDir = new THREE.Vector3();
  private readonly sky = new Sky();

  constructor(
    private readonly scene: THREE.Scene,
    renderer: THREE.WebGLRenderer,
    /** degrees above horizon, degrees clockwise from north */
    elevation = 28,
    azimuth = 150,
  ) {
    this.sky.scale.setScalar(20000);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 2.5;
    u.rayleigh.value = 1.2;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.8;
    scene.add(this.sky);

    const phi = THREE.MathUtils.degToRad(90 - elevation);
    const theta = THREE.MathUtils.degToRad(azimuth);
    // north = -z, east = +x
    this.sunDir.set(Math.sin(theta) * Math.sin(phi), Math.cos(phi), -Math.cos(theta) * Math.sin(phi));
    u.sunPosition.value.copy(this.sunDir);

    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -220;
    cam.right = cam.top = 220;
    cam.near = 1;
    cam.far = 3000;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.sun.castShadow = true;
    scene.add(this.sun, this.sun.target);

    scene.add(new THREE.HemisphereLight(0xbfd6ff, 0x8a8f99, 0.6));
    scene.fog = new THREE.FogExp2(0xc9d8e8, 0.00012);

    // Image-based lighting from the sky itself so snow picks up blue skylight
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.add(this.sky.clone());
    scene.environment = pmrem.fromScene(envScene).texture;
    scene.environmentIntensity = 0.5;
  }

  /** Keep the shadow frustum centred on the viewer. */
  follow(target: THREE.Vector3) {
    // snap to texel grid to avoid shimmering
    const snap = 440 / this.sun.shadow.mapSize.x;
    const cx = Math.round(target.x / snap) * snap;
    const cz = Math.round(target.z / snap) * snap;
    this.sun.target.position.set(cx, target.y, cz);
    this.sun.position.copy(this.sun.target.position).addScaledVector(this.sunDir, 1500);
  }
}
