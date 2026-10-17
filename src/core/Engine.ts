import * as THREE from 'three';

export type UpdateFn = (dt: number, elapsed: number) => void;

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly clock = new THREE.Clock();
  private readonly updaters: UpdateFn[] = [];

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.55;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.5, 12000);

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  onUpdate(fn: UpdateFn) {
    this.updaters.push(fn);
  }

  start() {
    this.renderer.setAnimationLoop(() => {
      const dt = Math.min(this.clock.getDelta(), 0.1);
      const elapsed = this.clock.elapsedTime;
      for (const fn of this.updaters) fn(dt, elapsed);
      this.renderer.render(this.scene, this.camera);
    });
  }
}
