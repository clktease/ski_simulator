import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

/** Approximate January sun for Yuzawa (36.9°N): sunrise ~6:55, sunset ~16:50, noon elevation ~31°. */
const SUNRISE = 6 * 60 + 55;
const SUNSET = 16 * 60 + 50;
const NOON_ELEVATION = 31;
const CLEAR_FOG = new THREE.Color(0xc9d8e8), GREY_FOG = new THREE.Color(0xcdd2d8), NIGHT_FOG = new THREE.Color(0x0b1120);

export interface SkyConditions {
  /** minutes since midnight */
  minutes: number;
  /** 0 clear … 1 fully overcast */
  cloud: number;
  /** FogExp2 density */
  fogDensity: number;
}

/** Physical sky, sun with camera-following shadows, time of day and overcast blending. */
export class SkyLight {
  readonly sun = new THREE.DirectionalLight(0xfff4e6, 3.2);
  readonly sunDir = new THREE.Vector3();
  readonly hemi = new THREE.HemisphereLight(0xbfd6ff, 0x8a8f99, 0.6);
  readonly fog = new THREE.FogExp2(0xc9d8e8, 0.00012);
  /** 0 at night … 1 full day, for other systems (night lights, NPC visibility) */
  daylight = 1;
  private readonly sky = new Sky();
  private readonly pmrem: THREE.PMREMGenerator;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  /** shares the sky material, so sun/turbidity uniforms carry over */
  private readonly envScene = new THREE.Scene();
  private lastEnvKey = '';

  constructor(
    private readonly scene: THREE.Scene,
    private readonly renderer: THREE.WebGLRenderer,
    shadowMapSize = 4096,
  ) {
    this.sky.scale.setScalar(20000);
    const u = this.sky.material.uniforms;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.8;
    scene.add(this.sky);
    this.envScene.add(new THREE.Mesh(this.sky.geometry, this.sky.material));

    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -220;
    cam.right = cam.top = 220;
    cam.near = 1;
    cam.far = 3000;
    this.sun.shadow.mapSize.set(Math.max(shadowMapSize, 512), Math.max(shadowMapSize, 512));
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.sun.castShadow = true;
    scene.add(this.sun, this.sun.target, this.hemi);
    scene.fog = this.fog;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.set({ minutes: 9 * 60, cloud: 0, fogDensity: 0.00012 });
  }

  set(c: SkyConditions) {
    const t = (c.minutes - SUNRISE) / (SUNSET - SUNRISE);
    const elevation = NOON_ELEVATION * Math.sin(Math.PI * t) - (t < 0 || t > 1 ? 8 * Math.min(1, Math.abs(t < 0 ? t : t - 1) * 4) : 0);
    const azimuth = 120 + 120 * THREE.MathUtils.clamp(t, -0.2, 1.2);
    const phi = THREE.MathUtils.degToRad(90 - elevation);
    const theta = THREE.MathUtils.degToRad(azimuth);
    // north = -z, east = +x
    this.sunDir.set(Math.sin(theta) * Math.sin(phi), Math.cos(phi), -Math.cos(theta) * Math.sin(phi));

    const day = THREE.MathUtils.smoothstep(elevation, -6, 8);
    this.daylight = day;
    const lowSun = 1 - THREE.MathUtils.smoothstep(elevation, 2, 20);
    const cloud = c.cloud;

    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(this.sunDir);
    u.turbidity.value = 2.5 + cloud * 8;
    u.rayleigh.value = 1.2 + lowSun * 1.5;

    this.sun.intensity = 3.2 * THREE.MathUtils.smoothstep(elevation, 0, 10) * (1 - 0.85 * cloud);
    this.sun.color.setHSL(0.09, 0.6 * lowSun + 0.1, 0.92 - 0.15 * lowSun);
    this.sun.castShadow = this.sun.intensity > 0.3;
    this.hemi.intensity = 0.1 + day * (0.6 + 1.1 * cloud);
    this.hemi.color.setHSL(0.6, 0.5 - 0.3 * cloud, 0.55 + 0.25 * day);

    // Fog / background colour: blue haze on clear days, grey when overcast, dark blue at night
    this.fog.color.copy(CLEAR_FOG).lerp(GREY_FOG, cloud).lerp(NIGHT_FOG, 1 - day);
    this.fog.density = c.fogDensity;
    // A heavy overcast hides the sky dome entirely
    this.sky.visible = cloud < 0.75 && day > 0.05;
    this.scene.background = this.sky.visible ? null : this.fog.color;

    this.renderer.toneMappingExposure = 0.55 + (1 - day) * 0.1 + cloud * 0.1;
    this.updateEnvironment(day, cloud);
  }

  /** Re-render the image-based lighting only when the look changed noticeably. */
  private updateEnvironment(day: number, cloud: number) {
    const key = `${(this.sunDir.x * 10) | 0},${(this.sunDir.y * 20) | 0},${(cloud * 5) | 0}`;
    this.scene.environmentIntensity = 0.5 * day * (1 - 0.4 * cloud);
    if (key === this.lastEnvKey) return;
    this.lastEnvKey = key;
    // a blurry sky is all the image-based lighting needs: 128 px keeps the re-bake to ~1 ms
    this.envTarget?.dispose();
    this.envTarget = this.pmrem.fromScene(this.envScene, 0, 0.1, 100, { size: 128 });
    this.scene.environment = this.envTarget.texture;
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
