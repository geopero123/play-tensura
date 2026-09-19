import { sfx } from '../audio/Audio';

export interface DialogueLine { speaker: string; text: string; mood?: string }

/** Anime dialogue box with typewriter text. Advance with F / Space / Enter / click. */
export class Dialogue {
  root: HTMLElement;
  box: HTMLElement;
  private nameEl: HTMLElement;
  private textEl: HTMLElement;
  private hintEl: HTMLElement;
  private lines: DialogueLine[] = [];
  private index = 0;
  private typed = 0;
  private typing = false;
  private timer = 0;
  private onDone: (() => void) | null = null;
  active = false;
  onLine: ((line: DialogueLine) => void) | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.box = document.createElement('div');
    this.box.className = 'dialogue glass';
    this.box.innerHTML = `<div class="dialogue-name"></div><div class="dialogue-text"></div><div class="dialogue-hint"><span class="key">F</span> CONTINUE</div>`;
    root.appendChild(this.box);
    this.nameEl = this.box.querySelector('.dialogue-name')!;
    this.textEl = this.box.querySelector('.dialogue-text')!;
    this.hintEl = this.box.querySelector('.dialogue-hint')!;
  }

  start(lines: DialogueLine[], onDone?: () => void) {
    this.lines = lines;
    this.index = 0;
    this.onDone = onDone ?? null;
    this.active = true;
    this.box.classList.add('visible');
    this.showLine();
  }

  private showLine() {
    const l = this.lines[this.index];
    this.nameEl.textContent = l.speaker;
    this.typed = 0;
    this.typing = true;
    this.timer = 0;
    this.textEl.innerHTML = '<span class="cursor"></span>';
    this.hintEl.style.opacity = '0';
    this.onLine?.(l);
  }

  /** call when the advance key is pressed */
  advance() {
    if (!this.active) return;
    const l = this.lines[this.index];
    if (this.typing) {
      this.typed = l.text.length;
      this.typing = false;
      this.render();
      return;
    }
    sfx('ui');
    this.index++;
    if (this.index >= this.lines.length) {
      this.end();
    } else this.showLine();
  }

  end() {
    this.active = false;
    this.box.classList.remove('visible');
    const cb = this.onDone;
    this.onDone = null;
    cb?.();
  }

  private render() {
    const l = this.lines[this.index];
    const shown = l.text.slice(0, this.typed);
    this.textEl.innerHTML = shown.replace(/\n/g, '<br>') + (this.typing ? '<span class="cursor"></span>' : '');
    if (!this.typing) this.hintEl.style.opacity = '1';
  }

  update(dt: number) {
    if (!this.active || !this.typing) return;
    this.timer += dt;
    const l = this.lines[this.index];
    const speed = 42; // chars per second
    const target = Math.min(l.text.length, Math.floor(this.timer * speed));
    if (target !== this.typed) {
      if (Math.floor(target / 3) !== Math.floor(this.typed / 3)) sfx('talk', 0.5);
      this.typed = target;
      if (this.typed >= l.text.length) this.typing = false;
      this.render();
    }
  }
}
