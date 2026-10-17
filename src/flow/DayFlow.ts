import { DINNER_FROM, type GameState } from './GameState';
import type { Objective } from '../ui/Hud';

/** The checklist that walks the player through a ski day. */
export function objectives(s: GameState): Objective[] {
  return [
    { text: '在センターハウス購買纜車票', done: s.ticket !== null },
    { text: '租借雪具（レンタル）', done: s.rental !== null },
    { text: '到更衣室換裝', done: s.changed || s.stats.liftRides > 0 },
    { text: '搭乘纜車上山', done: s.stats.liftRides > 0 },
    { text: '滑完一趟', done: s.stats.runs > 0 },
    { text: '午餐休息（11:00〜15:00）', done: s.lunchDone },
    { text: `${Math.floor(DINNER_FROM / 60)}:00 後到ホテルアルパイン吃晚餐`, done: s.dinnerDone },
  ];
}

/** End-of-day report. */
export function showSummary(s: GameState) {
  const el = document.getElementById('summary')!;
  const st = s.stats;
  const item = (value: string, label: string) => `<div class="stat"><b>${value}</b><span>${label}</span></div>`;
  el.innerHTML = `
    <h2 style="margin:0 0 4px">岩原スキー場的一天結束了</h2>
    <p class="muted" style="margin:0">${s.clockText} · 辛苦了！おつかれさまでした</p>
    <div class="stats-grid">
      ${item(String(st.runs), '滑行趟數')}
      ${item(String(st.liftRides), '搭乘纜車')}
      ${item(`${(st.distanceM / 1000).toFixed(1)} km`, '滑行距離')}
      ${item(`${Math.round(st.verticalM)} m`, '累積落差')}
      ${item(`${(st.topSpeed * 3.6).toFixed(0)} km/h`, '最高速度')}
      ${item(String(st.falls), '跌倒次數')}
      ${item(`¥${st.spent.toLocaleString('ja-JP')}`, '總花費')}
      ${item(String(st.meals.length), '用餐')}
    </div>
    <p class="muted">吃了：${st.meals.join('、') || '（什麼都沒吃）'}</p>
    <button class="primary" id="again">再玩一天</button>`;
  el.hidden = false;
  document.exitPointerLock?.();
  el.querySelector('#again')!.addEventListener('click', () => location.reload());
}
