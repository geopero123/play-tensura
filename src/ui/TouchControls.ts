import { Input } from '../core/Input';
import { audio } from '../audio/Audio';
import { SKILLS, SKILL_ORDER } from '../progression/Data';

type Action = { key?: string; mouse?: number };

const STICK_R = 58; // px the knob can travel
const LOOK_GAIN = 1.9; // touch px -> mouse px

/**
 * On-screen controls for phones and tablets:
 * - left side: floating joystick (appears where the thumb lands)
 * - right side: drag to look, plus an action cluster (attack, heavy, jump, dodge, lock)
 * - the HUD skill bar, the interact prompt, the dialogue box and the minimap become tappable
 * Everything is fed into Input as synthetic key / mouse events, so gameplay code is unchanged.
 */
export class TouchControls {
  private input: Input;
  private root: HTMLElement;
  private stickBase: HTMLElement;
  private stickKnob: HTMLElement;
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private lookId: number | null = null;
  private lookLast = { x: 0, y: 0 };
  private held = new Map<HTMLElement, () => void>();
  private active = false;
  private rotate: HTMLElement;
  private rotateDismissed = false;

  constructor(input: Input, uiRoot: HTMLElement, canvas: HTMLCanvasElement) {
    this.input = input;
    document.documentElement.classList.add('touch-mode');

    this.root = document.createElement('div');
    this.root.className = 'touch-ui';
    this.root.innerHTML = `
      <div class="tstick"><div class="tstick-knob"></div></div>
      <button class="tbtn t-attack" data-mouse="0" aria-label="Attack"><span>ATK</span></button>
      <button class="tbtn t-heavy" data-mouse="2" aria-label="Heavy attack"><span>HEAVY</span></button>
      <button class="tbtn t-jump" data-key="Space" aria-label="Jump"><span>JUMP</span></button>
      <button class="tbtn t-dodge" data-key="ShiftLeft" aria-label="Dodge (hold to sprint)"><span>DODGE</span></button>
      <button class="tbtn t-lock" data-key="Tab" aria-label="Lock target"><span>LOCK</span></button>
      <button class="tbtn t-small t-pause" data-key="Escape" aria-label="Pause"><span>II</span></button>
      <button class="tbtn t-small t-skills" data-key="KeyK" aria-label="Skills"><span>SK</span></button>`;
    uiRoot.appendChild(this.root);
    this.stickBase = this.root.querySelector('.tstick')!;
    this.stickKnob = this.root.querySelector('.tstick-knob')!;

    this.rotate = document.createElement('div');
    this.rotate.className = 'rotate-hint';
    this.rotate.innerHTML = `<div><div class="rotate-icon"></div><b>ROTATE YOUR PHONE</b><small>Tempest Rebirth plays best in landscape.<br>Tap to continue anyway.</small></div>`;
    uiRoot.appendChild(this.rotate);
    this.rotate.addEventListener('click', () => { this.rotateDismissed = true; this.rotate.classList.remove('visible'); });

    // action cluster buttons
    this.root.querySelectorAll<HTMLElement>('.tbtn').forEach((b) => {
      const a: Action = b.dataset.key ? { key: b.dataset.key } : { mouse: Number(b.dataset.mouse) };
      this.bindHold(b, a);
    });

    // HUD skill bar: tap a skill to cast it (DOM order matches SKILL_ORDER)
    document.querySelectorAll<HTMLElement>('.hud .skills .skill').forEach((el, i) => {
      const id = SKILL_ORDER[i];
      if (id) this.bindHold(el, { key: SKILLS[id].keyCode });
    });
    // interact prompt / dialogue: tap = F
    const tapF = (sel: string) => { const el = document.querySelector<HTMLElement>(sel); if (el) this.bindHold(el, { key: 'KeyF' }); };
    tapF('.hud .prompt');
    tapF('.dialogue');
    // minimap: tap to cycle zoom
    const mm = document.querySelector<HTMLElement>('.minimap');
    if (mm) this.bindHold(mm, { key: 'KeyM' });

    // title screen: touch control hint instead of keyboard legend
    const title = document.querySelector('.title-screen');
    if (title) {
      const hint = document.createElement('div');
      hint.className = 'menu-hint touch-hint';
      hint.innerHTML = '<span>LEFT THUMB · MOVE</span><span>RIGHT THUMB · LOOK</span><span>TAP SKILLS TO CAST</span>';
      title.appendChild(hint);
    }

    // canvas: joystick (left part of the screen) and camera look (right part)
    const opts = { passive: false } as AddEventListenerOptions;
    canvas.addEventListener('touchstart', (e) => this.onStart(e), opts);
    canvas.addEventListener('touchmove', (e) => this.onMove(e), opts);
    canvas.addEventListener('touchend', (e) => this.onEnd(e), opts);
    canvas.addEventListener('touchcancel', (e) => this.onEnd(e), opts);

    // audio must be unlocked from a user gesture (iOS wants touchend)
    const unlock = () => { if (!audio.ready) audio.init(); audio.resume(); };
    document.addEventListener('touchend', unlock, { passive: true });
    document.addEventListener('touchstart', unlock, { passive: true });

    // no pinch-zoom / double-tap zoom / long-press menus inside the game
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault());

    window.addEventListener('resize', () => this.layout());
    window.addEventListener('orientationchange', () => setTimeout(() => this.layout(), 200));
    this.layout();
  }

  /** press on touchstart, release on touchend; works with multitouch */
  private bindHold(el: HTMLElement, a: Action) {
    let touchId: number | null = null;
    const release = () => {
      if (touchId === null) return;
      touchId = null;
      el.classList.remove('down');
      this.held.delete(el);
      this.up(a);
    };
    el.addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (touchId !== null) return;
      touchId = e.changedTouches[0].identifier;
      el.classList.add('down');
      this.held.set(el, release);
      this.down(a);
    }, { passive: false });
    const end = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) if (t.identifier === touchId) { e.preventDefault(); release(); }
    };
    el.addEventListener('touchend', end, { passive: false });
    el.addEventListener('touchcancel', end, { passive: false });
  }

  private down(a: Action) {
    if (a.key) window.dispatchEvent(new KeyboardEvent('keydown', { code: a.key, key: a.key, bubbles: true }));
    else if (a.mouse !== undefined && this.input.locked) {
      this.input.mouseButtons.add(a.mouse);
      this.input.mousePressed.add(a.mouse);
    }
  }
  private up(a: Action) {
    if (a.key) window.dispatchEvent(new KeyboardEvent('keyup', { code: a.key, key: a.key, bubbles: true }));
    else if (a.mouse !== undefined) this.input.mouseButtons.delete(a.mouse);
  }

  private onStart(e: TouchEvent) {
    e.preventDefault();
    if (!this.active) return;
    for (const t of Array.from(e.changedTouches)) {
      if (this.stickId === null && t.clientX < window.innerWidth * 0.42) {
        this.stickId = t.identifier;
        this.stickOrigin.x = t.clientX; this.stickOrigin.y = t.clientY;
        this.stickBase.style.left = t.clientX + 'px';
        this.stickBase.style.top = t.clientY + 'px';
        this.stickKnob.style.transform = 'translate(-50%, -50%)';
        this.stickBase.classList.add('on');
      } else if (this.lookId === null) {
        this.lookId = t.identifier;
        this.lookLast.x = t.clientX; this.lookLast.y = t.clientY;
      }
    }
  }

  private onMove(e: TouchEvent) {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.stickId) {
        let dx = t.clientX - this.stickOrigin.x, dy = t.clientY - this.stickOrigin.y;
        const d = Math.hypot(dx, dy);
        // drag the base along if the thumb wanders far past the edge
        if (d > STICK_R * 1.6) {
          const k = (d - STICK_R * 1.6) / d;
          this.stickOrigin.x += dx * k; this.stickOrigin.y += dy * k;
          this.stickBase.style.left = this.stickOrigin.x + 'px';
          this.stickBase.style.top = this.stickOrigin.y + 'px';
          dx = t.clientX - this.stickOrigin.x; dy = t.clientY - this.stickOrigin.y;
        }
        const len = Math.hypot(dx, dy);
        const c = len > STICK_R ? STICK_R / len : 1;
        const kx = dx * c, ky = dy * c;
        this.stickKnob.style.transform = `translate(calc(-50% + ${kx}px), calc(-50% + ${ky}px))`;
        const nx = kx / STICK_R, ny = ky / STICK_R;
        const m = Math.hypot(nx, ny);
        if (m < 0.18) { this.input.stick.x = 0; this.input.stick.y = 0; }
        else { this.input.stick.x = nx; this.input.stick.y = -ny; }
      } else if (t.identifier === this.lookId) {
        if (this.active && this.input.locked) {
          this.input.mouseDX += (t.clientX - this.lookLast.x) * LOOK_GAIN;
          this.input.mouseDY += (t.clientY - this.lookLast.y) * LOOK_GAIN;
        }
        this.lookLast.x = t.clientX; this.lookLast.y = t.clientY;
      }
    }
  }

  private onEnd(e: TouchEvent) {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.stickId) this.resetStick();
      if (t.identifier === this.lookId) this.lookId = null;
    }
  }

  private resetStick() {
    this.stickId = null;
    this.input.stick.x = 0; this.input.stick.y = 0;
    this.stickBase.classList.remove('on');
  }

  /** called every frame by the game: controls are live only during free play */
  sync(playing: boolean) {
    if (playing !== this.active) {
      this.active = playing;
      this.root.classList.toggle('visible', playing);
      if (!playing) {
        // keep the skill/prompt/dialogue taps working; only drop sticks and cluster holds
        for (const [el, r] of Array.from(this.held.entries())) if (this.root.contains(el)) r();
        this.resetStick();
        this.lookId = null;
      }
    }
  }

  /** go fullscreen + landscape where the browser allows it (Android Chrome; iOS ignores) */
  enterFullscreen() {
    const el = document.documentElement as any;
    try {
      if (document.fullscreenElement || !el.requestFullscreen) return;
      const p = el.requestFullscreen({ navigationUI: 'hide' });
      if (p && p.then) p.then(() => (screen.orientation as any)?.lock?.('landscape').catch(() => {})).catch(() => {});
    } catch {}
  }

  /** scale the skill bar so it fits between the joystick area and the action cluster */
  private layout() {
    const w = window.innerWidth, h = window.innerHeight;
    const s = Math.max(0.55, Math.min(0.82, Math.min(w / 1000, h / 480)));
    document.documentElement.style.setProperty('--tui', String(s));
    this.rotate.classList.toggle('visible', h > w && !this.rotateDismissed);
  }
}
