import type { Outfit } from '../player/Character';

export type TicketType = 'day' | 'afternoon' | 'night' | 'dayNight';
export type GearKind = 'ski' | 'snowboard';

export interface Rental {
  kind: GearKind;
  lengthCm: number;
  bootSize: number;
  /** rented ski wear, or null when the player kept their own clothes */
  wear: Outfit | null;
}

/** In-game prices (game balance values, not the resort's official price list). */
export const TICKETS: Record<TicketType, { label: string; price: number; from: number; until: number }> = {
  day: { label: '1日券', price: 5500, from: 8 * 60 + 30, until: 17 * 60 },
  afternoon: { label: '午後券（12:00〜）', price: 4500, from: 12 * 60, until: 17 * 60 },
  night: { label: 'ナイター券（17:00〜）', price: 2500, from: 17 * 60, until: 20 * 60 + 30 },
  dayNight: { label: '1日＋ナイター券', price: 6500, from: 8 * 60 + 30, until: 20 * 60 + 30 },
};

export const DAY_START = 8 * 60;
export const LIFTS_OPEN = 8 * 60 + 30;
export const LIFTS_CLOSE_DAY = 17 * 60;
export const LIFTS_CLOSE_NIGHT = 20 * 60 + 30;
export const DINNER_FROM = 17 * 60;

export interface DayStats {
  runs: number;
  liftRides: number;
  distanceM: number;
  verticalM: number;
  topSpeed: number; // m/s
  falls: number;
  meals: string[];
  spent: number;
}

type Listener = () => void;

/** Everything about the player's day that persists across modes. */
export class GameState {
  /** minutes since midnight */
  minutes = DAY_START + 15;
  /** game seconds per real second */
  timeScale = 10;
  money = 30000;
  stamina = 100;
  satiety = 75;
  warmth = 100;
  ticket: TicketType | null = null;
  rental: Rental | null = null;
  /** changed into ski wear + boots in the locker room */
  changed = false;
  lunchDone = false;
  dinnerDone = false;
  readonly stats: DayStats = { runs: 0, liftRides: 0, distanceM: 0, verticalM: 0, topSpeed: 0, falls: 0, meals: [], spent: 0 };
  private readonly listeners: Listener[] = [];

  onChange(fn: Listener) {
    this.listeners.push(fn);
  }

  emit() {
    for (const fn of this.listeners) fn();
  }

  spend(amount: number) {
    if (this.money < amount) return false;
    this.money -= amount;
    this.stats.spent += amount;
    this.emit();
    return true;
  }

  /** Jump the clock forward (meals, changing...). */
  pass(minutes: number) {
    this.minutes += minutes;
    this.emit();
  }

  ticketValid(at = this.minutes) {
    if (!this.ticket) return false;
    const t = TICKETS[this.ticket];
    return at >= t.from && at <= t.until;
  }

  get canSki() {
    return this.rental !== null && this.changed;
  }

  get clockText() {
    const m = Math.floor(this.minutes);
    return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }

  /**
   * Advance the clock and body stats.
   * @param activity 0 idle/indoors … 1 hard skiing
   * @param cold extra cold exposure from weather (0 calm … 1 blizzard)
   * @param indoors warms up instead of cooling down
   */
  tick(realDt: number, activity: number, cold: number, indoors: boolean, speedup = 1) {
    const gameMin = (realDt * this.timeScale * speedup) / 60;
    this.minutes += gameMin;
    this.stamina = clamp(this.stamina - gameMin * (0.02 + 0.2 * activity) + (activity < 0.05 ? gameMin * 0.05 : 0));
    this.satiety = clamp(this.satiety - gameMin * (0.1 + 0.08 * activity));
    this.warmth = indoors
      ? clamp(this.warmth + gameMin * 2)
      : clamp(this.warmth - gameMin * (0.03 + 0.25 * cold) + activity * gameMin * 0.04);
  }
}

const clamp = (v: number) => Math.min(100, Math.max(0, v));
