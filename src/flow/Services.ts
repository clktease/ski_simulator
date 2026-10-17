import { DINNER_FROM, TICKETS, type GameState, type GearKind, type TicketType } from './GameState';
import { BOOT_SIZES, GEAR_LENGTHS, RENTAL_PRICES, WEAR_COLORS } from '../player/Equipment';
import type { Outfit } from '../player/Character';
import type { Hud } from '../ui/Hud';
import { h, type Panel } from '../ui/Panel';
import type { Service } from '../resort/ResortData';

export interface ServiceContext {
  state: GameState;
  panel: Panel;
  hud: Hud;
  /** re-dress the character from the current state */
  refreshLook(): void;
  endDay(): void;
}

interface MenuItem {
  name: string;
  price: number;
  satiety: number;
  stamina: number;
  warmth: number;
  minutes: number;
  /** counts as a proper meal for the lunch objective */
  meal: boolean;
}

const BASE_MENU: MenuItem[] = [
  { name: 'カレーライス（咖哩飯）', price: 1200, satiety: 45, stamina: 15, warmth: 10, minutes: 30, meal: true },
  { name: '醤油ラーメン（醬油拉麵）', price: 1100, satiety: 40, stamina: 10, warmth: 25, minutes: 30, meal: true },
  { name: 'カツ丼（豬排丼）', price: 1300, satiety: 55, stamina: 20, warmth: 10, minutes: 30, meal: true },
  { name: 'ホットココア（熱可可）', price: 500, satiety: 5, stamina: 5, warmth: 30, minutes: 10, meal: false },
];

const MOUNTAIN_MENU: MenuItem[] = [
  { name: '豚汁定食（豬肉味噌湯定食）', price: 1400, satiety: 50, stamina: 15, warmth: 30, minutes: 30, meal: true },
  { name: 'きのこそば（蕈菇蕎麥麵）', price: 1000, satiety: 35, stamina: 10, warmth: 25, minutes: 25, meal: true },
  { name: 'おしるこ（紅豆湯）', price: 700, satiety: 15, stamina: 10, warmth: 25, minutes: 15, meal: false },
];

const DINNERS: MenuItem[] = [
  { name: '和食会席（日式宴席料理）', price: 4500, satiety: 70, stamina: 30, warmth: 30, minutes: 75, meal: true },
  { name: '洋食ディナー（西式晚餐）', price: 3800, satiety: 65, stamina: 30, warmth: 25, minutes: 60, meal: true },
];

const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;

export function openService(service: Service, facilityId: string | undefined, label: string, ctx: ServiceContext) {
  const { panel } = ctx;
  switch (service) {
    case 'ticket':
      return panel.open(label, (b) => ticketPanel(b, ctx));
    case 'rental':
      return panel.open(label, (b) => rentalPanel(b, ctx));
    case 'locker':
      return panel.open(label, (b) => lockerPanel(b, ctx));
    case 'restaurant':
      return panel.open(label, (b) => menuPanel(b, ctx, facilityId === 'mountain-restaurant' ? MOUNTAIN_MENU : BASE_MENU, false));
    case 'dinner':
      return panel.open(label, (b) => dinnerPanel(b, ctx));
  }
}

function ticketPanel(body: HTMLElement, ctx: ServiceContext) {
  const { state } = ctx;
  body.replaceChildren();
  if (state.ticket && state.ticketValid()) {
    body.append(h('p', {}, `已持有：${TICKETS[state.ticket].label}`), h('p', { className: 'muted' }, '可以直接去搭纜車了。'));
    return;
  }
  body.append(h('p', { className: 'muted' }, '選擇纜車票種（遊戲內價格）'));
  const list = h('div', { className: 'options' });
  for (const [type, t] of Object.entries(TICKETS) as [TicketType, (typeof TICKETS)[TicketType]][]) {
    const expired = state.minutes > t.until;
    const notYet = state.minutes < t.from - 60;
    const btn = h('button', { className: 'option', disabled: expired || notYet || state.money < t.price },
      h('span', {}, t.label, h('br'), h('small', { className: 'muted' }, `${fmt(t.from)}〜${fmt(t.until)}`)),
      h('b', {}, yen(t.price)));
    btn.addEventListener('click', () => {
      if (!state.spend(t.price)) return;
      state.ticket = type;
      state.emit();
      ctx.hud.toast(`購買了 ${t.label}`);
      ctx.panel.close();
    });
    list.append(btn);
  }
  body.append(list);
}

function rentalPanel(body: HTMLElement, ctx: ServiceContext) {
  const { state } = ctx;
  body.replaceChildren();
  if (state.rental) {
    const r = state.rental;
    body.append(
      h('p', {}, `租借中：${r.kind === 'ski' ? '雙板' : '單板'} ${r.lengthCm} cm、雪鞋 ${r.bootSize} cm${r.wear ? '、雪衣' : ''}`),
      h('p', { className: 'muted' }, state.changed ? '下一步：去搭纜車吧！' : '下一步：到更衣室換裝。'),
    );
    return;
  }

  let kind: GearKind = 'ski';
  let length = 160;
  let boot = 26;
  let wear: Outfit | null = WEAR_COLORS[0].outfit;

  const render = () => {
    body.replaceChildren();
    const chips = <T,>(values: T[], current: T, label: (v: T) => string, set: (v: T) => void) =>
      values.map((v) => {
        const c = h('button', { className: `chip${v === current ? ' selected' : ''}` }, label(v));
        c.addEventListener('click', () => { set(v); render(); });
        return c;
      });
    body.append(
      h('div', { className: 'row' }, h('span', {}, '種類'), ...chips<GearKind>(['ski', 'snowboard'], kind, (k) => (k === 'ski' ? '雙板 スキー' : '單板 スノーボード'), (k) => {
        kind = k;
        length = k === 'ski' ? 160 : 150;
      })),
      h('div', { className: 'row' }, h('span', {}, '長度'), ...chips(GEAR_LENGTHS[kind], length, (l) => `${l}`, (l) => (length = l))),
      h('p', { className: 'muted' }, '短：好轉彎、適合初學　長：高速穩定'),
      h('div', { className: 'row' }, h('span', {}, '雪鞋'), ...chips(BOOT_SIZES, boot, (s) => `${s}`, (s) => (boot = s))),
    );
    const swatches = h('div', { className: 'row' }, h('span', {}, '雪衣'));
    for (const w of WEAR_COLORS) {
      const s = h('button', { className: `swatch${wear === w.outfit ? ' selected' : ''}`, title: w.name, ariaLabel: `雪衣 ${w.name}` });
      s.style.background = `#${w.outfit.jacket.toString(16).padStart(6, '0')}`;
      s.addEventListener('click', () => { wear = w.outfit; render(); });
      swatches.append(s);
    }
    const own = h('button', { className: `chip${wear === null ? ' selected' : ''}` }, '不租（穿自己的）');
    own.addEventListener('click', () => { wear = null; render(); });
    swatches.append(own);
    body.append(swatches);

    const total = RENTAL_PRICES[kind] + (wear ? RENTAL_PRICES.wear : 0);
    body.append(h('div', { className: 'total' }, h('span', {}, '合計'), h('span', {}, yen(total))));
    const rent = h('button', { className: 'primary', disabled: state.money < total }, '租借');
    rent.addEventListener('click', () => {
      if (!state.spend(total)) return;
      state.rental = { kind, lengthCm: length, bootSize: boot, wear };
      state.emit();
      ctx.hud.toast('租好了！接著到更衣室換裝');
      ctx.panel.close();
    });
    body.append(rent);
  };
  render();
}

function lockerPanel(body: HTMLElement, ctx: ServiceContext) {
  const { state } = ctx;
  body.replaceChildren();
  if (!state.rental) {
    body.append(h('p', {}, '還沒有雪具。請先到租借櫃台租借。'));
    return;
  }
  const LOCKER = 500;
  if (!state.changed) {
    body.append(h('p', {}, '把便服和行李放進置物櫃（コインロッカー ¥500），換上雪衣和雪鞋。'));
    const btn = h('button', { className: 'primary', disabled: state.money < LOCKER }, `換裝（${yen(LOCKER)}）`);
    btn.addEventListener('click', () => {
      if (!state.spend(LOCKER)) return;
      ctx.panel.close();
      void ctx.hud.fade('換裝中…', () => {
        state.changed = true;
        state.pass(15);
        ctx.refreshLook();
      }).then(() => ctx.hud.toast('換好裝了！按 Q 穿上雪板，或直接去纜車站'));
    });
    body.append(btn);
  } else {
    body.append(h('p', {}, '已經換好裝了。'));
    const back = h('button', { className: 'option' }, '換回便服');
    back.addEventListener('click', () => {
      ctx.panel.close();
      void ctx.hud.fade('換裝中…', () => {
        state.changed = false;
        state.pass(10);
        ctx.refreshLook();
      });
    });
    body.append(back);
  }
}

function menuPanel(body: HTMLElement, ctx: ServiceContext, menu: MenuItem[], isDinner: boolean) {
  const { state } = ctx;
  body.replaceChildren(h('p', { className: 'muted' }, '點餐（用餐會經過一段遊戲時間，並恢復體力、飽足和體溫）'));
  const list = h('div', { className: 'options' });
  for (const item of menu) {
    const btn = h('button', { className: 'option', disabled: state.money < item.price },
      h('span', {}, item.name, h('br'), h('small', { className: 'muted' }, effects(item))),
      h('b', {}, yen(item.price)));
    btn.addEventListener('click', () => {
      if (!state.spend(item.price)) return;
      ctx.panel.close();
      void ctx.hud.fade(isDinner ? '享用晚餐中…' : '用餐中…', () => {
        state.satiety = Math.min(100, state.satiety + item.satiety);
        state.stamina = Math.min(100, state.stamina + item.stamina);
        state.warmth = Math.min(100, state.warmth + item.warmth);
        state.pass(item.minutes);
        state.stats.meals.push(item.name.replace(/（.*/, ''));
        if (item.meal && !isDinner && state.minutes >= 11 * 60 && state.minutes <= 15 * 60) state.lunchDone = true;
        if (isDinner) state.dinnerDone = true;
        state.emit();
      }, isDinner ? 1600 : 900).then(() => {
        if (isDinner) ctx.endDay();
        else ctx.hud.toast(`吃了${item.name.replace(/（.*/, '')}，恢復了精神`);
      });
    });
    list.append(btn);
  }
  body.append(list);
}

function dinnerPanel(body: HTMLElement, ctx: ServiceContext) {
  const { state } = ctx;
  if (state.minutes >= DINNER_FROM) return menuPanel(body, ctx, DINNERS, true);
  body.replaceChildren(h('p', {}, `飯店晚餐 ${fmt(DINNER_FROM)} 開始。`));
  const rest = h('button', { className: 'option' }, `在大廳休息到 ${fmt(DINNER_FROM)}`);
  rest.addEventListener('click', () => {
    ctx.panel.close();
    void ctx.hud.fade('在大廳休息…', () => {
      state.minutes = DINNER_FROM;
      state.stamina = Math.min(100, state.stamina + 30);
      state.warmth = 100;
      state.emit();
    });
  });
  body.append(rest);
}

function effects(m: MenuItem) {
  const parts = [`飽足+${m.satiety}`];
  if (m.stamina) parts.push(`體力+${m.stamina}`);
  if (m.warmth) parts.push(`體溫+${m.warmth}`);
  parts.push(`${m.minutes}分`);
  return parts.join('　');
}

const fmt = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
