import * as THREE from 'three';
import type { SnowType } from './SnowConditions';

export type WeatherType = 'clear' | 'cloudy' | 'snow' | 'blizzard' | 'fog';

interface WeatherParams {
  label: string;
  cloud: number;
  /** FogExp2 density */
  fog: number;
  /** snowfall 0–1 */
  snowfall: number;
  /** mean wind speed m/s */
  wind: number;
  /** body heat loss factor 0–1 */
  cold: number;
}

export const WEATHER: Record<WeatherType, WeatherParams> = {
  clear: { label: '晴天', cloud: 0, fog: 0.00012, snowfall: 0, wind: 1.5, cold: 0.1 },
  cloudy: { label: '陰天', cloud: 0.85, fog: 0.0004, snowfall: 0, wind: 3, cold: 0.25 },
  snow: { label: '降雪', cloud: 1, fog: 0.0035, snowfall: 0.35, wind: 3, cold: 0.45 },
  blizzard: { label: '暴風雪', cloud: 1, fog: 0.012, snowfall: 1, wind: 14, cold: 1 },
  fog: { label: '濃霧', cloud: 0.9, fog: 0.016, snowfall: 0, wind: 0.5, cold: 0.3 },
};

/** Blends between weather states and derives wind, fresh snow and the piste surface. */
export class Weather {
  type: WeatherType = 'clear';
  /** current blended values */
  readonly current: WeatherParams = { ...WEATHER.clear };
  readonly wind = new THREE.Vector3();
  /** fresh snow on top of the base (cm) */
  freshSnowCm = 0;
  /** forced piste surface, or null for automatic */
  snowOverride: SnowType | null = null;
  private gustPhase = Math.random() * 100;
  private windDir = Math.random() * Math.PI * 2;

  set(type: WeatherType) {
    this.type = type;
  }

  /** dt in real seconds, gameMinutes = how much game time passed */
  update(dt: number, gameMinutes: number) {
    const target = WEATHER[this.type];
    const k = 1 - Math.exp(-dt * 0.4);
    for (const key of ['cloud', 'fog', 'snowfall', 'wind', 'cold'] as const) {
      this.current[key] += (target[key] - this.current[key]) * k;
    }
    this.current.label = target.label;
    // ~3 cm/h in steady snow, more in a blizzard; settles/gets skied off slowly otherwise
    this.freshSnowCm = Math.max(0, this.freshSnowCm + gameMinutes * (this.current.snowfall * 0.08 - 0.004));

    this.gustPhase += dt;
    this.windDir += Math.sin(this.gustPhase * 0.05) * dt * 0.02;
    const gust = 1 + 0.35 * Math.sin(this.gustPhase * 1.3) * Math.sin(this.gustPhase * 0.37);
    const speed = this.current.wind * gust;
    this.wind.set(Math.sin(this.windDir) * speed, 0, Math.cos(this.windDir) * speed);
  }

  /** Piste surface for the time of day and recent weather. */
  pisteSnow(minutes: number): SnowType {
    if (this.snowOverride) return this.snowOverride;
    if (this.freshSnowCm > 4) return 'powder';
    // cold clear mornings freeze the corduroy; afternoons get chopped up
    if (minutes < 10 * 60 && this.type === 'clear') return 'ice';
    if (minutes > 14 * 60) return 'crud';
    return 'groomed';
  }
}
