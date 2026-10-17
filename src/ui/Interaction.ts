import type * as THREE from 'three';
import type { Input } from '../core/Input';
import type { WorldInteraction } from '../resort/Buildings';

const RANGE = 3.5;

/** Shows "press E" next to the nearest interaction point and reports activations. */
export class InteractionUI {
  private readonly prompt = document.getElementById('prompt')!;
  current: WorldInteraction | null = null;

  constructor(
    private readonly input: Input,
    readonly points: WorldInteraction[],
    private readonly activate: (p: WorldInteraction) => void,
  ) {}

  /** @param enabled false hides the prompt (moving fast, riding, panel open) */
  update(player: THREE.Vector3, enabled: boolean) {
    let best: WorldInteraction | null = null;
    if (enabled) {
      let bestScore = 1;
      for (const p of this.points) {
        const d = Math.hypot(p.position.x - player.x, p.position.z - player.z);
        const score = d / (p.range ?? RANGE); // < 1 means in range
        if (score < bestScore) {
          bestScore = score;
          best = p;
        }
      }
    }
    this.current = best;
    this.prompt.hidden = !best;
    if (!best) return;
    this.prompt.innerHTML = `<kbd>E</kbd> ${best.label}`;
    if (this.input.wasPressed('KeyE')) this.activate(best);
  }
}
