import type { GameState } from '../flow/GameState';

export interface Objective {
  text: string;
  done: boolean;
}

const $ = (id: string) => document.getElementById(id)!;

/** Last value written per element: skip DOM writes (and the style/layout work they trigger) when nothing changed. */
const written = new Map<string, string>();
function write(id: string, value: string, html = false) {
  if (written.get(id) === value) return;
  written.set(id, value);
  if (html) $(id).innerHTML = value;
  else $(id).textContent = value;
}

/** Clock, money, body bars, objectives, toasts and fades. */
export class Hud {
  private toastTimer = 0;
  private readonly bars = {
    stamina: $('bar-stamina'),
    satiety: $('bar-satiety'),
    warmth: $('bar-warmth'),
  };

  update(state: GameState, weatherLabel: string, objectives: Objective[], debug: string) {
    write('st-clock', state.clockText);
    write('st-weather', weatherLabel);
    write('st-money', `¥${state.money.toLocaleString('ja-JP')}`);
    for (const key of ['stamina', 'satiety', 'warmth'] as const) {
      const v = Math.round(state[key] * 2) / 2;
      const width = `${v}%`;
      if (this.bars[key].style.width !== width) {
        this.bars[key].style.width = width;
        this.bars[key].classList.toggle('low', v < 25);
      }
    }
    const firstOpen = objectives.findIndex((o) => !o.done);
    write('objectives', objectives
      .map((o, i) => `<li class="${o.done ? 'done' : i === firstOpen ? 'current' : ''}">${o.text}</li>`)
      .join(''), true);
    write('st-debug', debug);
  }

  toast(message: string, ms = 2800) {
    const el = $('toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (el.hidden = true), ms);
  }

  /** Fade to black, run `during`, fade back. */
  async fade(caption: string, during: () => void, holdMs = 900) {
    const el = $('fade');
    el.textContent = caption;
    el.classList.add('on');
    await wait(550);
    during();
    await wait(holdMs);
    el.classList.remove('on');
    await wait(400);
  }

  setHelp(text: string) {
    $('help').textContent = text;
  }
}

export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
