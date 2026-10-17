import type { GameState } from '../flow/GameState';

export interface Objective {
  text: string;
  done: boolean;
}

const $ = (id: string) => document.getElementById(id)!;

/** Clock, money, body bars, objectives, toasts and fades. */
export class Hud {
  private toastTimer = 0;
  private readonly bars = {
    stamina: $('bar-stamina'),
    satiety: $('bar-satiety'),
    warmth: $('bar-warmth'),
  };

  update(state: GameState, weatherLabel: string, objectives: Objective[], debug: string) {
    $('st-clock').textContent = state.clockText;
    $('st-weather').textContent = weatherLabel;
    $('st-money').textContent = `¥${state.money.toLocaleString('ja-JP')}`;
    for (const key of ['stamina', 'satiety', 'warmth'] as const) {
      const v = state[key];
      this.bars[key].style.width = `${v}%`;
      this.bars[key].classList.toggle('low', v < 25);
    }
    const firstOpen = objectives.findIndex((o) => !o.done);
    $('objectives').innerHTML = objectives
      .map((o, i) => `<li class="${o.done ? 'done' : i === firstOpen ? 'current' : ''}">${o.text}</li>`)
      .join('');
    $('st-debug').textContent = debug;
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
