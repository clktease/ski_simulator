import * as THREE from 'three';
import { BloomEffect, Effect, EffectAttribute, EffectComposer, EffectPass, RenderPass, SMAAEffect, SMAAPreset } from 'postprocessing';
import type { Engine } from './Engine';

/**
 * Exposure + ACES tone mapping + gentle grading (saturation, contrast, vignette) in one shader.
 * Exposure follows renderer.toneMappingExposure so SkyLight keeps driving it.
 */
class GradeEffect extends Effect {
  constructor() {
    super('Grade', /* glsl */ `
uniform float exposure;
uniform float saturation;
uniform float contrast;
uniform float vignette;
// three.js ACESFilmicToneMapping (RRT + ODT fit), so the look matches the non-post-processed path
vec3 rrtOdt(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 aces(vec3 c) {
  const mat3 inM = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 outM = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  return clamp(outM * rrtOdt(inM * c), 0.0, 1.0);
}
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = aces(inputColor.rgb * exposure / 0.6);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, saturation);
  c = (c - 0.5) * contrast + 0.5;
  vec2 d = uv - 0.5;
  c *= 1.0 - vignette * dot(d, d) * 1.2;
  // opaque output: the canvas must never show the page through
  outputColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`, {
      uniforms: new Map<string, THREE.Uniform>([
        ['exposure', new THREE.Uniform(1)],
        ['saturation', new THREE.Uniform(1.08)],
        ['contrast', new THREE.Uniform(1.04)],
        ['vignette', new THREE.Uniform(0.3)],
      ]),
    });
  }
}

/**
 * Speed lines: radial blur towards the screen centre plus faint flickering streaks at the edges,
 * scaled by Engine.speedFx (0 standing … 1 fast).
 */
class SpeedEffect extends Effect {
  constructor() {
    super('Speed', /* glsl */ `
uniform float strength;
uniform float time;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 d = uv - 0.5;
  float r = length(d);
  float m = smoothstep(0.12, 0.7, r) * strength;
  vec3 acc = inputColor.rgb;
  for (int i = 1; i < 8; i++) acc += texture2D(inputBuffer, uv - d * (float(i) * 0.011 * m)).rgb;
  acc /= 8.0;
  float a = atan(d.y, d.x);
  float n = fract(sin(floor(a * 110.0) * 12.9898 + floor(time * 18.0) * 78.233) * 43758.5453);
  float streak = step(0.9, n) * m * smoothstep(0.3, 0.75, r) * 0.18;
  outputColor = vec4(acc + streak, 1.0);
}`, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, THREE.Uniform>([
        ['strength', new THREE.Uniform(0)],
        ['time', new THREE.Uniform(0)],
      ]),
    });
  }
}

/** Bloom for lamps and snow glints, tone mapping/grading and SMAA (`?fxskip=bloom,smaa` to isolate). */
export class PostFX {
  private readonly composer: EffectComposer;
  private readonly grade = new GradeEffect();
  readonly bloom: BloomEffect;
  private readonly speed = new SpeedEffect();
  private readonly speedPass: EffectPass;

  constructor(private readonly engine: Engine, highQuality: boolean) {
    const { renderer, scene, camera } = engine;
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
    this.composer.addPass(new RenderPass(scene, camera));

    const skip = new URLSearchParams(location.search).get('fxskip') ?? '';

    // threshold well above sunlit snow (~2–3 in HDR) so only glints, the sun and lamps glow
    this.bloom = new BloomEffect({ intensity: 0.45, luminanceThreshold: 4, luminanceSmoothing: 0.5, mipmapBlur: true, radius: 0.4 });
    this.composer.addPass(new EffectPass(camera, ...(skip.includes('bloom') ? [] : [this.bloom]), this.grade));
    this.speedPass = new EffectPass(camera, this.speed);
    this.speedPass.enabled = false;
    this.composer.addPass(this.speedPass);
    if (!skip.includes('smaa')) this.composer.addPass(new EffectPass(camera, new SMAAEffect({ preset: highQuality ? SMAAPreset.HIGH : SMAAPreset.MEDIUM })));

    // tone mapping happens in GradeEffect
    renderer.toneMapping = THREE.NoToneMapping;
    engine.renderFn = () => this.render();
    engine.onResize((w, h) => this.composer.setSize(w, h));
    this.composer.setSize(window.innerWidth, window.innerHeight);
  }

  /** Lamps should glow at night: lower the bloom threshold in the dark. */
  setNight(night: number) {
    this.bloom.luminanceMaterial.threshold = THREE.MathUtils.lerp(4, 0.9, night);
    this.bloom.intensity = THREE.MathUtils.lerp(0.45, 1.0, night);
  }

  private render() {
    (this.grade.uniforms.get('exposure') as THREE.Uniform).value = this.engine.renderer.toneMappingExposure;
    const s = this.engine.speedFx;
    this.speedPass.enabled = s > 0.01;
    (this.speed.uniforms.get('strength') as THREE.Uniform).value = s;
    (this.speed.uniforms.get('time') as THREE.Uniform).value = performance.now() / 1000;
    this.composer.render();
  }
}
