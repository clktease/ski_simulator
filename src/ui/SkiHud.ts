import type { SkiTelemetry } from '../player/SkiController';

const $ = (id: string) => document.getElementById(id)!;
const MAX_KMH = 100;

export interface SkiReadouts {
  altitude: number;
  runName: string;
  snowLabel: string;
  topSpeedKmh: number;
  distanceM: number;
  wind: number;
}

/** Phase 2 instruments: speedometer, inclinometer and readouts. */
export class SkiHud {
  private readonly root = $('skihud');
  private readonly arc = $('speedo-arc');
  private readonly speedValue = $('speedo-value');
  private readonly needle = $('incline-needle');
  private readonly inclineValue = $('incline-value');
  private readonly readouts = $('ski-readouts');
  private timer = 0;

  set visible(v: boolean) {
    this.root.hidden = !v;
  }

  update(dt: number, t: SkiTelemetry, r: SkiReadouts) {
    const kmh = t.speed * 3.6;
    // 270° gauge starting bottom-left
    const frac = Math.min(kmh / MAX_KMH, 1);
    this.arc.setAttribute('d', arcPath(60, 60, 50, -225, -225 + 270 * frac));
    this.speedValue.textContent = kmh.toFixed(0);
    // needle shows the slope; tilted the way the skier is travelling (down = descending)
    const tilt = t.speed > 1 ? -Math.sign(t.travelPitchDeg || -1) : 1;
    this.needle.setAttribute('transform', `rotate(${(t.slopeDeg * tilt).toFixed(1)} 60 60)`);

    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.15;
    this.inclineValue.textContent = `${t.slopeDeg.toFixed(1)}°`;
    const rows: [string, string][] = [
      ['海拔', `${r.altitude.toFixed(0)} m`],
      ['行進坡度', `${t.travelPitchDeg.toFixed(1)}°`],
      ['最高速', `${r.topSpeedKmh.toFixed(0)} km/h`],
      ['滑行距離', r.distanceM >= 1000 ? `${(r.distanceM / 1000).toFixed(2)} km` : `${r.distanceM.toFixed(0)} m`],
      ['風速', `${r.wind.toFixed(1)} m/s`],
      ['雪道', r.runName],
      ['雪況', t.snow ? t.snow.label : r.snowLabel],
    ];
    this.readouts.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  }
}

function arcPath(cx: number, cy: number, r: number, fromDeg: number, toDeg: number) {
  if (toDeg - fromDeg < 0.5) return '';
  const p = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    return `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
  };
  const large = toDeg - fromDeg > 180 ? 1 : 0;
  return `M ${p(fromDeg)} A ${r} ${r} 0 ${large} 1 ${p(toDeg)}`;
}
