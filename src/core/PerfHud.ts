import type * as THREE from 'three';

export interface GpuInfo {
  name: string;
  /** software rasteriser (SwiftShader, llvmpipe, Microsoft Basic Render): everything runs on the CPU */
  software: boolean;
  /** likely an integrated GPU on a machine that may also have a discrete one */
  integrated: boolean;
}

export function detectGpu(renderer: THREE.WebGLRenderer): GpuInfo {
  const gl = renderer.getContext();
  let name = 'unknown';
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  } catch {
    /* some browsers hide the renderer string */
  }
  return {
    name,
    software: /swiftshader|llvmpipe|basic render|software|softpipe/i.test(name),
    integrated: /intel|uhd|iris|vega \d+ graphics|radeon\(tm\) graphics/i.test(name),
  };
}

/** Warn once when the browser is drawing on the CPU: that is the usual cause of "high CPU, low fps". */
export function showGpuWarning(gpu: GpuInfo) {
  if (!gpu.software) return;
  const el = document.createElement('div');
  el.id = 'gpu-warning';
  el.innerHTML =
    '<b>瀏覽器正在用 CPU 軟體渲染（' + gpu.name.replace(/[<>&]/g, '') + '）</b><br>' +
    '請到 Chrome 設定 → 系統 → 開啟「使用圖形加速功能」並重新啟動；筆電可在 Windows「設定 → 顯示器 → 圖形」把 Chrome 設為「高效能」。';
  const close = document.createElement('button');
  close.textContent = '×';
  close.addEventListener('click', () => el.remove());
  el.append(close);
  document.body.append(el);
  setTimeout(() => el.remove(), 20000);
}

/** F3 / ?stats=1 overlay: fps, CPU frame time, draw calls, triangles, resolution, GPU. */
export class PerfHud {
  private readonly el = document.createElement('pre');
  private frames = 0;
  private cpuSum = 0;
  private cpuMax = 0;
  private acc = 0;
  /** last half-second averages, for automated benchmarks */
  readonly stats = { fps: 0, cpuMs: 0, cpuMax: 0, calls: 0, triangles: 0 };

  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly gpu: GpuInfo) {
    this.el.id = 'perfhud';
    this.el.hidden = new URLSearchParams(location.search).get('stats') !== '1';
    document.body.append(this.el);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        e.preventDefault();
        this.el.hidden = !this.el.hidden;
      }
    });
  }

  /** @param cpuMs main-thread time spent in update + render submission this frame */
  frame(dt: number, cpuMs: number) {
    this.frames++;
    this.cpuSum += cpuMs;
    this.cpuMax = Math.max(this.cpuMax, cpuMs);
    this.acc += dt;
    if (this.acc < 0.5) return;
    const info = this.renderer.info;
    const fps = this.frames / this.acc;
    Object.assign(this.stats, { fps, cpuMs: this.cpuSum / this.frames, cpuMax: this.cpuMax, calls: info.render.calls, triangles: info.render.triangles });
    if (!this.el.hidden) {
      this.el.textContent =
        `${fps.toFixed(0)} fps  ${((this.acc / this.frames) * 1000).toFixed(1)} ms\n` +
        `CPU ${(this.cpuSum / this.frames).toFixed(1)} ms (max ${this.cpuMax.toFixed(1)})\n` +
        `calls ${info.render.calls}  tris ${(info.render.triangles / 1e6).toFixed(2)}M\n` +
        `res ×${this.renderer.getPixelRatio().toFixed(2)}  geo ${info.memory.geometries} tex ${info.memory.textures}\n` +
        `${this.gpu.name}`;
    }
    this.frames = 0;
    this.cpuSum = 0;
    this.cpuMax = 0;
    this.acc = 0;
  }
}
