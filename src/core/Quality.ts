export type QualityLevel = 'low' | 'medium' | 'high';

export interface QualitySettings {
  level: QualityLevel;
  /** starting pixel ratio; dynamic resolution moves between minPixelRatio and maxPixelRatio */
  pixelRatio: number;
  minPixelRatio: number;
  maxPixelRatio: number;
  /** 0 disables shadows */
  shadowMap: number;
  maxTrees: number;
  npcs: number;
  /** screen-space ambient occlusion, bloom etc. */
  postFx: boolean;
  dynamicResolution: boolean;
}

const PRESETS: Record<QualityLevel, Omit<QualitySettings, 'level' | 'pixelRatio' | 'dynamicResolution'>> = {
  low: { minPixelRatio: 0.5, maxPixelRatio: 0.75, shadowMap: 0, maxTrees: 25000, npcs: 25, postFx: false },
  medium: { minPixelRatio: 0.6, maxPixelRatio: 1, shadowMap: 1024, maxTrees: 60000, npcs: 45, postFx: true },
  high: { minPixelRatio: 0.7, maxPixelRatio: 1.5, shadowMap: 2048, maxTrees: 90000, npcs: 60, postFx: true },
};

const KEY = 'ski-sim-quality';
const DYN_KEY = 'ski-sim-dynres';

function stored(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the URL parameter still works */
  }
}

/** Quality from ?quality=…, then the remembered choice, then high. */
export function loadQuality(): QualitySettings {
  const params = new URLSearchParams(location.search);
  let level = params.get('quality') as QualityLevel | null;
  if (!level || !(level in PRESETS)) level = stored(KEY) as QualityLevel | null;
  if (!level || !(level in PRESETS)) level = 'high';
  const p = PRESETS[level];
  const maxPixelRatio = Math.min(window.devicePixelRatio, p.maxPixelRatio);
  return {
    level,
    ...p,
    maxPixelRatio,
    minPixelRatio: Math.min(p.minPixelRatio, maxPixelRatio),
    pixelRatio: maxPixelRatio,
    postFx: p.postFx && params.get('postfx') !== '0',
    dynamicResolution: (params.get('dynres') ?? stored(DYN_KEY) ?? '1') !== '0',
  };
}

/** Remember a level and reload (geometry budgets are decided at load time). */
export function switchQuality(level: QualityLevel) {
  store(KEY, level);
  const url = new URL(location.href);
  url.searchParams.set('quality', level);
  location.href = url.toString();
}

export function rememberDynamicResolution(on: boolean) {
  store(DYN_KEY, on ? '1' : '0');
}
