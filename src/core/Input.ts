import { DEBUG } from './Settings';

export class Input {
  keys = new Set<string>();
  pressed = new Set<string>();
  released = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  mouseButtons = new Set<number>();
  mousePressed = new Set<number>();
  locked = false;
  enabled = true;
  /** debug: accept mouse input without pointer lock (?debug in URL) */
  allowUnlocked = DEBUG;
  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    window.addEventListener('keydown', (e) => {
      const k = e.code;
      if (this.locked && ['Space', 'Tab', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(k);
      this.pressed.add(k);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.released.add(e.code);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseButtons.clear();
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked && !this.allowUnlocked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.locked && !this.allowUnlocked) return;
      this.mouseButtons.add(e.button);
      this.mousePressed.add(e.button);
    });
    document.addEventListener('mouseup', (e) => {
      this.mouseButtons.delete(e.button);
    });
    document.addEventListener(
      'wheel',
      (e) => {
        if (this.locked) this.wheel += Math.sign(e.deltaY);
      },
      { passive: true }
    );
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) {
        this.keys.clear();
        this.mouseButtons.clear();
      }
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  requestLock() {
    if (this.locked) return;
    try {
      const p = (this.canvas as any).requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => this.canvas.requestPointerLock());
    } catch {
      this.canvas.requestPointerLock();
    }
  }
  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  down(code: string) {
    return this.enabled && this.keys.has(code);
  }
  justPressed(code: string) {
    return this.enabled && this.pressed.has(code);
  }
  justReleased(code: string) {
    return this.enabled && this.released.has(code);
  }
  mouseDown(b: number) {
    return this.enabled && this.mouseButtons.has(b);
  }
  mouseJustPressed(b: number) {
    return this.enabled && this.mousePressed.has(b);
  }

  /** Movement axis from WASD */
  axis() {
    let x = 0,
      y = 0;
    if (this.down('KeyW') || this.down('ArrowUp')) y += 1;
    if (this.down('KeyS') || this.down('ArrowDown')) y -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) x += 1;
    if (this.down('KeyA') || this.down('ArrowLeft')) x -= 1;
    const l = Math.hypot(x, y);
    if (l > 1) {
      x /= l;
      y /= l;
    }
    return { x, y };
  }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.mousePressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }
}
