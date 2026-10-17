/** Keyboard + pointer-lock mouse state shared by all controllers. */
export class Input {
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  /** Disabled while a UI panel is open. */
  enabled = true;

  constructor(private readonly dom: HTMLElement) {
    dom.addEventListener('click', () => {
      if (this.enabled) dom.requestPointerLock();
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    dom.addEventListener('wheel', (e) => (this.wheel += Math.sign(e.deltaY)), { passive: true });
    window.addEventListener('keydown', (e) => {
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
  }

  get locked() {
    return document.pointerLockElement === this.dom;
  }

  /** Key held this frame. */
  isDown(code: string) {
    return this.enabled && this.down.has(code);
  }

  /** Key went down since the last endFrame(). */
  wasPressed(code: string) {
    return this.enabled && this.pressed.has(code);
  }

  /** Forget a press so it does not also trigger game actions this frame. */
  consume(code: string) {
    this.pressed.delete(code);
  }

  releasePointer() {
    if (this.locked) document.exitPointerLock();
  }

  /** Call once at the end of every frame. */
  endFrame() {
    this.pressed.clear();
    this.mouseDX = this.mouseDY = this.wheel = 0;
  }
}
