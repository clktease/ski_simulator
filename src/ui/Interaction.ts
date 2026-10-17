import type * as THREE from 'three';
import type { Input } from '../core/Input';
import type { WorldInteraction } from '../resort/Buildings';

const RANGE = 3.5;

/** Shows "press E" when the player stands at a facility point, and opens its panel. */
export class InteractionUI {
  private readonly prompt = document.getElementById('prompt')!;
  private readonly panel = document.getElementById('panel')!;
  private current: WorldInteraction | null = null;
  private openPoint: WorldInteraction | null = null;
  /** Renders panel content for a service; replaced by the day-flow system. */
  render: (p: WorldInteraction, body: HTMLElement) => void = (p, body) => {
    body.innerHTML = `<p>${p.facility.name}</p><p class="muted">此設施的互動流程將在下一步實作。</p>`;
  };

  constructor(
    private readonly input: Input,
    private readonly points: WorldInteraction[],
  ) {
    this.panel.querySelector('.panel-close')!.addEventListener('click', () => this.close());
    window.addEventListener('keydown', (e) => {
      if (this.openPoint && (e.code === 'Escape' || e.code === 'KeyE')) this.close();
    });
  }

  get isOpen() {
    return this.openPoint !== null;
  }

  update(player: THREE.Vector3) {
    if (this.openPoint) return;
    let best: WorldInteraction | null = null;
    let bestD = RANGE;
    for (const p of this.points) {
      const d = Math.hypot(p.position.x - player.x, p.position.z - player.z);
      if (d < bestD) { bestD = d; best = p; }
    }
    this.current = best;
    this.prompt.hidden = !best;
    if (best) this.prompt.innerHTML = `<kbd>E</kbd> ${best.label}`;
    if (best && this.input.wasPressed('KeyE')) this.open(best);
  }

  open(p: WorldInteraction) {
    this.openPoint = p;
    this.prompt.hidden = true;
    this.panel.querySelector('.panel-title')!.textContent = p.label;
    this.render(p, this.panel.querySelector('.panel-body') as HTMLElement);
    this.panel.hidden = false;
    this.input.enabled = false;
    this.input.releasePointer();
  }

  close() {
    this.openPoint = null;
    this.panel.hidden = true;
    // swallow the key that closed the panel so it does not reopen it next frame
    this.input.consume('KeyE');
    this.input.consume('Escape');
    this.input.enabled = true;
  }
}
