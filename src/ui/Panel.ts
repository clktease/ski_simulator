import type { Input } from '../core/Input';

/** Modal panel; gameplay input is suspended while it is open. */
export class Panel {
  private readonly el = document.getElementById('panel')!;
  private readonly title = this.el.querySelector('.panel-title')!;
  readonly body = this.el.querySelector('.panel-body') as HTMLElement;
  private onClose: (() => void) | null = null;

  constructor(private readonly input: Input) {
    this.el.querySelector('.panel-close')!.addEventListener('click', () => this.close());
    window.addEventListener('keydown', (e) => {
      if (this.isOpen && e.code === 'Escape') this.close();
    });
  }

  get isOpen() {
    return !this.el.hidden;
  }

  open(title: string, render: (body: HTMLElement) => void, onClose?: () => void) {
    this.title.textContent = title;
    render(this.body);
    this.el.hidden = false;
    this.onClose = onClose ?? null;
    this.input.enabled = false;
    this.input.releasePointer();
  }

  close() {
    if (!this.isOpen) return;
    this.el.hidden = true;
    // swallow the key that closed the panel so it does not trigger gameplay this frame
    this.input.consume('KeyE');
    this.input.consume('Escape');
    this.input.enabled = true;
    const cb = this.onClose;
    this.onClose = null;
    cb?.();
  }
}

/** Tiny DOM helper for panel content. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  ...children: (Node | string)[]
) {
  const el = document.createElement(tag);
  Object.assign(el, props);
  el.append(...children);
  return el;
}
