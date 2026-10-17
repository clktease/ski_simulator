export type QualityLevel = 'low' | 'medium' | 'high';

export interface QualitySettings {
  level: QualityLevel;
  pixelRatio: number;
  /** 0 disables shadows */
  shadowMap: number;
  maxTrees: number;
  npcs: number;
}

const PRESETS: Record<QualityLevel, Omit<QualitySettings, 'level' | 'pixelRatio'> & { maxPixelRatio: number }> = {
  low: { maxPixelRatio: 0.75, shadowMap: 0, maxTrees: 25000, npcs: 25 },
  medium: { maxPixelRatio: 1, shadowMap: 2048, maxTrees: 60000, npcs: 45 },
  high: { maxPixelRatio: 2, shadowMap: 4096, maxTrees: 90000, npcs: 60 },
};

const KEY = 'ski-sim-quality';

/** Quality from ?quality=…, then the remembered choice, then high. */
export function loadQuality(): QualitySettings {
  let level = new URLSearchParams(location.search).get('quality') as QualityLevel | null;
  if (!level || !(level in PRESETS)) {
    try {
      level = localStorage.getItem(KEY) as QualityLevel | null;
    } catch {
      level = null;
    }
  }
  if (!level || !(level in PRESETS)) level = 'high';
  const p = PRESETS[level];
  return { level, pixelRatio: Math.min(window.devicePixelRatio, p.maxPixelRatio), shadowMap: p.shadowMap, maxTrees: p.maxTrees, npcs: p.npcs };
}

/** Remember a level and reload (geometry budgets are decided at load time). */
export function switchQuality(level: QualityLevel) {
  try {
    localStorage.setItem(KEY, level);
  } catch {
    /* storage unavailable: the URL parameter still works */
  }
  const url = new URL(location.href);
  url.searchParams.set('quality', level);
  location.href = url.toString();
}
