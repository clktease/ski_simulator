import * as THREE from 'three';

// resolved lazily: the Node physics tests import this module without Vite's import.meta.env
const base = () => `${import.meta.env?.BASE_URL ?? '/'}assets/textures`;
let loader: THREE.TextureLoader | null = null;
const cache = new Map<string, THREE.Texture>();

/**
 * A CC0 texture from public/assets/textures (see tools/assets/fetch-assets.mjs).
 * Cached per file + repeat, so materials that share a texture share one GPU upload.
 */
export function tex(asset: string, map: 'diff' | 'nor' | 'arm', repeat = 1) {
  const key = `${asset}/${map}@${repeat}`;
  let t = cache.get(key);
  if (t) return t;
  loader ??= new THREE.TextureLoader();
  t = loader.load(`${base()}/${asset}/${map}.jpg`);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  if (map === 'diff') t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}

/** Textured PBR material; `repeat` is tiles per UV unit (box UVs span 0..1 per face). */
export function pbr(asset: string, opts: { repeat?: number; arm?: boolean; normalScale?: number } & Omit<THREE.MeshStandardMaterialParameters, 'normalScale'> = {}) {
  const { repeat = 1, arm = true, normalScale = 1, ...params } = opts;
  const m = new THREE.MeshStandardMaterial({
    map: tex(asset, 'diff', repeat),
    normalMap: tex(asset, 'nor', repeat),
    normalScale: new THREE.Vector2(normalScale, normalScale),
    ...params,
  });
  if (arm) {
    const t = tex(asset, 'arm', repeat);
    // glTF-style packing: R = AO, G = roughness, B = metalness
    m.aoMap = t;
    m.roughnessMap = t;
    m.metalnessMap = t;
  }
  return m;
}

/**
 * Box geometry with UVs in metres (1 UV unit = `metresPerTile` m) so textures keep their real-world
 * scale on boxes of any size instead of stretching one tile across each face.
 */
export function worldUvBox(w: number, h: number, d: number, metresPerTile = 2) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z; each face has 4 vertices
  const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, (uv.getX(i) * dims[f][0]) / metresPerTile, (uv.getY(i) * dims[f][1]) / metresPerTile);
    }
  }
  return geo;
}

export interface TerrainShading {
  material: THREE.MeshStandardMaterial;
  /** keep the snow sparkle aligned with the sun */
  setSun(dir: THREE.Vector3, intensity: number): void;
}

/**
 * Terrain material: baked vertex colours for the large-scale look plus world-space detail
 * textures (snow, rock on steep faces, snowy asphalt on roads) blended by a per-vertex `splat`
 * attribute (x = rock, y = paved, z = groomed). Detail fades out with distance to hide tiling.
 */
export function terrainMaterial(detail: boolean): TerrainShading {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
  const uniforms = {
    tSnowD: { value: tex('snow_02', 'diff') },
    tSnowN: { value: tex('snow_02', 'nor') },
    tRockD: { value: tex('gray_rocks', 'diff') },
    tRockN: { value: tex('gray_rocks', 'nor') },
    tAsphD: { value: tex('asphalt_snow', 'diff') },
    tAsphN: { value: tex('asphalt_snow', 'nor') },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSun: { value: 1 },
  };
  if (!detail) return { material, setSun() {} };

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 splat;\nvarying vec3 vSplat;\nvarying vec3 vWPos;\nvarying vec3 vWNormal;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvSplat = splat;\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNormal = normalize(mat3(modelMatrix) * objectNormal);',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
uniform sampler2D tSnowD, tSnowN, tRockD, tRockN, tAsphD, tAsphN;
uniform vec3 uSunDir;
uniform float uSun;
varying vec3 vSplat;
varying vec3 vWPos;
varying vec3 vWNormal;
float tHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// average colour of a texture = its smallest mip
vec3 tAvg(sampler2D t) { return textureLod(t, vec2(0.5), 12.0).rgb; }
`,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `#include <map_fragment>
float tDist = length(vWPos - cameraPosition);
float tFade = 1.0 - smoothstep(120.0, 1100.0, tDist);
vec2 tUv = vWPos.xz;
// two scales of snow multiplied together break up visible tiling
vec3 sA = texture2D(tSnowD, tUv / 6.0).rgb / tAvg(tSnowD);
vec3 sB = texture2D(tSnowD, tUv / 41.0 + 0.37).rgb / tAvg(tSnowD);
vec3 snowDetail = mix(vec3(1.0), sA * mix(vec3(1.0), sB, 0.5), tFade * mix(0.55, 0.3, vSplat.z));
diffuseColor.rgb *= clamp(snowDetail, 0.6, 1.25);
// rock: project onto the dominant horizontal axis on steep faces
vec3 aN = abs(vWNormal);
vec2 rUv = aN.x > aN.z ? vWPos.zy : vWPos.xy;
vec3 rock = texture2D(tRockD, rUv / 7.0).rgb;
diffuseColor.rgb = mix(diffuseColor.rgb, rock * 0.9, clamp(vSplat.x * 1.2, 0.0, 1.0));
vec3 asph = texture2D(tAsphD, tUv / 5.0).rgb;
diffuseColor.rgb = mix(diffuseColor.rgb, asph * 1.35, vSplat.y);
`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
{
  vec3 T = normalize((viewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
  T = normalize(T - normal * dot(normal, T));
  vec3 B = cross(T, normal);
  vec3 dn = texture2D(tSnowN, tUv / 6.0).xyz * 2.0 - 1.0;
  vec3 an = texture2D(tAsphN, tUv / 5.0).xyz * 2.0 - 1.0;
  dn = mix(dn, an, vSplat.y);
  float strength = tFade * mix(0.9, 0.5, vSplat.z);
  normal = normalize(normal + (T * dn.x + B * dn.y) * strength);
}
`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
{
  // snow glints: sparse cells that mirror the sun towards the eye
  vec3 V = normalize(cameraPosition - vWPos);
  vec2 cell = floor(vWPos.xz * 9.0);
  float h = tHash(cell);
  vec3 jitter = normalize(vWNormal + vec3(tHash(cell + 1.3) - 0.5, 0.0, tHash(cell + 7.1) - 0.5) * 0.6);
  float glint = step(0.985, h) * pow(max(dot(reflect(-uSunDir, jitter), V), 0.0), 400.0);
  float near = 1.0 - smoothstep(10.0, 70.0, tDist);
  totalEmissiveRadiance += vec3(1.0, 0.98, 0.94) * glint * near * uSun * (1.0 - vSplat.y - vSplat.x) * 6.0;
}
`,
      );
  };
  return {
    material,
    setSun(dir, intensity) {
      uniforms.uSunDir.value.copy(dir);
      uniforms.uSun.value = intensity;
    },
  };
}
