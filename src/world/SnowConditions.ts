export type SnowType = 'groomed' | 'powder' | 'ice' | 'slush' | 'crud';

export interface SnowParams {
  label: string;
  /** kinetic friction coefficient ski–snow */
  mu: number;
  /** edge grip: how fast sideways velocity is killed (1/s) */
  grip: number;
  /** extra quadratic drag from ploughing through snow (per m) */
  drag: number;
  /** multiplier on fall probability */
  fallRisk: number;
}

/**
 * Rough physical values: waxed skis on cold groomed snow μ≈0.04–0.05, wet spring snow ≈0.1,
 * deep powder adds a lot of drag but forgives mistakes, ice has little friction and little grip.
 */
export const SNOW: Record<SnowType, SnowParams> = {
  groomed: { label: '圧雪（整地雪面）', mu: 0.045, grip: 9, drag: 0, fallRisk: 1 },
  powder: { label: 'パウダー（新雪）', mu: 0.08, grip: 6, drag: 0.006, fallRisk: 0.7 },
  ice: { label: 'アイスバーン（結冰）', mu: 0.03, grip: 3.2, drag: 0, fallRisk: 1.9 },
  slush: { label: 'ザラメ・濕雪', mu: 0.11, grip: 7, drag: 0.003, fallRisk: 1.1 },
  crud: { label: '荒れた雪（不平整）', mu: 0.06, grip: 6.5, drag: 0.0015, fallRisk: 1.35 },
};

/** What snow is under the skier: off-piste is always deeper/rougher than the piste surface. */
export function snowAt(onPiste: boolean, pisteSnow: SnowType, freshSnowCm: number): SnowParams {
  if (onPiste) return SNOW[pisteSnow];
  const base = freshSnowCm > 5 ? SNOW.powder : SNOW.crud;
  // deeper fresh snow = more drag off-piste
  return { ...base, drag: base.drag + Math.min(freshSnowCm, 60) * 0.0001, label: base.label.replace(/（.*/, '') + '・區外' };
}
