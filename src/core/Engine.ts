import * as THREE from 'three';
import type { QualitySettings } from './Quality';
import { detectGpu, PerfHud, showGpuWarning, type GpuInfo } from './PerfHud';

export type UpdateFn = (dt: number, elapsed: number) => void;

/**
 * Lowers the pixel ratio when frames run long and raises it back when there is headroom.
 * Frame time under vsync stays pinned at the refresh interval, so "headroom" means
 * several seconds without a slow frame.
 */
class DynamicResolution {
  private avg = 1 / 60;
  private timer = 0;
  private goodSeconds = 0;

  constructor(private readonly engine: Engine, private readonly min: number, private readonly max: number) {}

  update(dt: number) {
    this.avg += (dt - this.avg) * 0.05;
    this.timer += dt;
    if (this.timer < 1) return;
    this.timer = 0;
    const r = this.engine.renderer.getPixelRatio();
    if (this.avg > 1 / 48 && r > this.min) {
      this.engine.setPixelRatio(Math.max(this.min, r * 0.85));
      this.goodSeconds = 0;
    } else if (this.avg < 1 / 57) {
      if (++this.goodSeconds >= 4 && r < this.max) {
        this.engine.setPixelRatio(Math.min(this.max, r + 0.1));
        this.goodSeconds = 0;
      }
    } else this.goodSeconds = 0;
  }
}

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly gpu: GpuInfo;
  private readonly clock = new THREE.Clock();
  private readonly updaters: UpdateFn[] = [];
  private readonly resizers: ((w: number, h: number, pixelRatio: number) => void)[] = [];
  readonly perf: PerfHud;
  private readonly dynRes: DynamicResolution;
  dynamicResolution: boolean;
  /** 0 … 1 sense-of-speed effects (speed lines), set by the game while skiing */
  speedFx = 0;
  /** Replaced by the post-processing chain when it is enabled. */
  renderFn: () => void = () => this.renderer.render(this.scene, this.camera);

  constructor(container: HTMLElement, readonly quality: QualitySettings) {
    // MSAA only without post-processing; the composer does its own anti-aliasing
    this.renderer = new THREE.WebGLRenderer({ antialias: !quality.postFx, powerPreference: 'high-performance', stencil: false });
    this.renderer.setPixelRatio(quality.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.55;
    this.renderer.shadowMap.enabled = quality.shadowMap > 0;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // several passes per frame (post-processing): count them all
    this.renderer.info.autoReset = false;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.5, 16000);
    this.gpu = detectGpu(this.renderer);
    showGpuWarning(this.gpu);
    this.perf = new PerfHud(this.renderer, this.gpu);
    this.dynamicResolution = quality.dynamicResolution;
    this.dynRes = new DynamicResolution(this, quality.minPixelRatio, quality.maxPixelRatio);

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.notifyResize();
    });
  }

  onUpdate(fn: UpdateFn) {
    this.updaters.push(fn);
  }

  onResize(fn: (w: number, h: number, pixelRatio: number) => void) {
    this.resizers.push(fn);
  }

  setPixelRatio(r: number) {
    this.renderer.setPixelRatio(r);
    this.notifyResize();
  }

  private notifyResize() {
    const r = this.renderer.getPixelRatio();
    for (const fn of this.resizers) fn(window.innerWidth, window.innerHeight, r);
  }

  start() {
    this.renderer.setAnimationLoop(() => {
      const t0 = performance.now();
      const dt = Math.min(this.clock.getDelta(), 0.1);
      const elapsed = this.clock.elapsedTime;
      this.renderer.info.reset();
      for (const fn of this.updaters) fn(dt, elapsed);
      this.renderFn();
      this.perf.frame(dt, performance.now() - t0);
      if (this.dynamicResolution) this.dynRes.update(dt);
    });
  }
}
