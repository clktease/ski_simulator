import * as THREE from 'three';
import { BloomEffect, Effect, EffectComposer, EffectPass, RenderPass, SMAAEffect, SMAAPreset } from 'postprocessing';
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

/** Bloom for lamps and snow glints, tone mapping/grading and SMAA (`?fxskip=bloom,smaa` to isolate). */
export class PostFX {
  private readonly composer: EffectComposer;
  private readonly grade = new GradeEffect();
  readonly bloom: BloomEffect;

  constructor(private readonly engine: Engine, highQuality: boolean) {
    const { renderer, scene, camera } = engine;
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
    this.composer.addPass(new RenderPass(scene, camera));

    const skip = new URLSearchParams(location.search).get('fxskip') ?? '';

    this.bloom = new BloomEffect({ intensity: 0.6, luminanceThreshold: 1.15, luminanceSmoothing: 0.25, mipmapBlur: true, radius: 0.6 });
    this.composer.addPass(new EffectPass(camera, ...(skip.includes('bloom') ? [] : [this.bloom]), this.grade));
    if (!skip.includes('smaa')) this.composer.addPass(new EffectPass(camera, new SMAAEffect({ preset: highQuality ? SMAAPreset.HIGH : SMAAPreset.MEDIUM })));

    // tone mapping happens in GradeEffect
    renderer.toneMapping = THREE.NoToneMapping;
    engine.renderFn = () => this.render();
    engine.onResize((w, h) => this.composer.setSize(w, h));
    this.composer.setSize(window.innerWidth, window.innerHeight);
  }

  /** Lamps should glow at night: lower the bloom threshold in the dark. */
  setNight(night: number) {
    this.bloom.luminanceMaterial.threshold = THREE.MathUtils.lerp(1.15, 0.75, night);
    this.bloom.intensity = THREE.MathUtils.lerp(0.6, 1.1, night);
  }

  private render() {
    (this.grade.uniforms.get('exposure') as THREE.Uniform).value = this.engine.renderer.toneMappingExposure;
    this.composer.render();
  }
}
