import { ICONS } from './Icons';
import { sfx } from '../audio/Audio';

function el(cls: string, html = '') { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; return d; }

/** Center-screen anime notifications: skill acquired, evolution, level up, area titles, boss intro. */
export class Notifications {
  root: HTMLElement;
  private notice: HTMLElement;
  private analyze: HTMLElement;
  private evolve: HTMLElement;
  private levelup: HTMLElement;
  private area: HTMLElement;
  private bossIntro: HTMLElement;
  private callout: HTMLElement;
  private tech: HTMLElement;
  private cineTop: HTMLElement;
  private cineBot: HTMLElement;
  private queue: (() => number)[] = [];
  private busyLeft = 0; // seconds of game time the current notice still occupies
  private timers: { t: number; fn: () => void }[] = [];
  private later(seconds: number, fn: () => void) { this.timers.push({ t: seconds, fn }); }

  constructor(root: HTMLElement) {
    this.root = root;
    this.notice = el('notice'); root.appendChild(this.notice);
    this.analyze = el('analyze', 'ANALYZING...'); root.appendChild(this.analyze);
    this.evolve = el('evolve'); root.appendChild(this.evolve);
    this.levelup = el('levelup'); root.appendChild(this.levelup);
    this.area = el('area'); root.appendChild(this.area);
    this.bossIntro = el('boss-intro'); root.appendChild(this.bossIntro);
    this.callout = el('callout'); root.appendChild(this.callout);
    this.tech = el('technique'); root.appendChild(this.tech);
    this.cineTop = el('cine top'); this.cineBot = el('cine bottom');
    root.appendChild(this.cineTop); root.appendChild(this.cineBot);
  }

  private restart(e: HTMLElement, cls: string) {
    e.classList.remove(cls);
    void e.offsetWidth;
    e.classList.add(cls);
  }

  /** queue so big notices don't overlap */
  private enqueue(fn: () => number) {
    this.queue.push(fn);
    this.pump();
  }
  private pump() {
    if (this.busyLeft > 0 || !this.queue.length) return;
    const fn = this.queue.shift()!;
    this.busyLeft = fn() / 1000 + 0.05;
  }

  /** dt in seconds of game time (0 while paused) */
  update(dt = 0) {
    if (this.busyLeft > 0) this.busyLeft -= dt;
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const tm = this.timers[i];
      tm.t -= dt;
      if (tm.t <= 0) { this.timers.splice(i, 1); tm.fn(); }
    }
    if (this.queue.length && this.busyLeft <= 0) this.pump();
  }

  analyzing(then: () => void, delay = 1500) {
    this.restart(this.analyze, 'show');
    sfx('analyze');
    this.later(0.4, () => sfx('analyze'));
    this.later(0.8, () => sfx('analyze'));
    this.later(delay / 1000, then);
  }

  acquired(kicker: string, name: string, sub: string, icon: string) {
    this.enqueue(() => {
      this.notice.innerHTML = `<div class="notice-icon">${ICONS[icon] ?? ICONS.evolve}</div><div class="notice-kicker">${kicker}</div><div class="notice-title">${name}</div><div class="notice-line"></div><div class="notice-sub">${sub}</div>`;
      this.restart(this.notice, 'show');
      sfx('acquire');
      return 3400;
    });
  }

  evolution(kicker: string, from: string, to: string, desc: string) {
    this.enqueue(() => {
      this.evolve.innerHTML = `<div class="evolve-rays"></div><div class="evolve-inner"><div class="evolve-kicker">${kicker}</div><div class="evolve-from">${from}</div><div class="evolve-arrow">&#9660;</div><div class="evolve-to">${to}</div><div class="evolve-desc">${desc}</div></div>`;
      this.restart(this.evolve, 'show');
      sfx('evolve');
      this.later(1.5, () => sfx('system'));
      return 4400;
    });
  }

  levelUp(level: number) {
    this.levelup.innerHTML = `<div class="levelup-title">LEVEL ${level}</div><div class="levelup-sub">HEALTH AND MAGIC RESTORED</div>`;
    this.restart(this.levelup, 'show');
    sfx('levelup');
  }

  areaTitle(name: string, sub: string) {
    this.area.innerHTML = `<div class="area-name">${name}</div><div class="area-line"></div><div class="area-sub">${sub}</div>`;
    this.restart(this.area, 'show');
    sfx('system', 0.6);
  }

  boss(kicker: string, name: string, sub: string) {
    this.bossIntro.innerHTML = `<div class="boss-intro-kicker">${kicker}</div><div class="boss-intro-name">${name}</div><div class="boss-intro-sub">${sub}</div>`;
    this.restart(this.bossIntro, 'show');
  }

  /** anime technique name card: slams in from the left with a colored brush line. color is any CSS color. */
  technique(name: string, sub: string, color = '#ffe3a3') {
    this.tech.style.setProperty('--tc', color);
    this.tech.innerHTML = `<div class="tech-streak"></div><div class="tech-bar"></div><div class="tech-body"><div class="tech-kicker">${sub}</div><div class="tech-name">${name.split('').map((c) => `<span>${c === ' ' ? '&nbsp;' : c}</span>`).join('')}</div></div>`;
    this.restart(this.tech, 'show');
    sfx('phase', 0.7);
    this.later(0.12, () => sfx('slashHeavy', 0.6));
  }

  say(text: string) {
    this.callout.textContent = text;
    this.restart(this.callout, 'show');
  }

  cinematicBars(on: boolean) {
    this.cineTop.classList.toggle('on', on);
    this.cineBot.classList.toggle('on', on);
  }
}
