import * as THREE from 'three';
import { ICONS, PORTRAIT_SVG } from './Icons';
import { SKILLS, SKILL_ORDER, SkillId } from '../progression/Data';
import { events } from '../core/Events';
import type { HitInfo, Combatant } from '../combat/Combat';

export interface HudState {
  hp: number; maxHp: number; mp: number; maxMp: number; level: number; xp: number; xpNext: number;
  skills: { id: SkillId; name: string; level: number; cooldown: number; maxCooldown: number; mp: number; owned: boolean; ready: boolean }[];
  target: { name: string; hp: number; maxHp: number; level?: string } | null;
  boss: { name: string; sub: string; hp: number; maxHp: number; phases: number[] } | null;
  quest: { title: string; objective: string; progress?: string; done?: boolean } | null;
  prompt: { key: string; text: string } | null;
  combo: number; comboTimer: number;
  lockScreen: { x: number; y: number } | null;
  tip: { key?: string; text: string } | null;
  hpLow: boolean;
}

function h(tag: string, cls: string, html = '') { const e = document.createElement(tag); e.className = cls; if (html) e.innerHTML = html; return e; }

export class HUD {
  root: HTMLElement;
  hud: HTMLElement;
  private hpFill: HTMLElement; private hpGhost: HTMLElement; private hpText: HTMLElement;
  private mpFill: HTMLElement; private mpText: HTMLElement;
  private xpFill: HTMLElement; private lvl: HTMLElement;
  private skillEls = new Map<SkillId, { el: HTMLElement; cd: HTMLElement; cdText: HTMLElement; name: HTMLElement; lvl: HTMLElement }>();
  private targetEl: HTMLElement; private targetName: HTMLElement; private targetFill: HTMLElement;
  private bossEl: HTMLElement; private bossName: HTMLElement; private bossFill: HTMLElement; private bossPhases: HTMLElement;
  private questEl: HTMLElement; private questTitle: HTMLElement; private questObj: HTMLElement;
  private promptEl: HTMLElement; private promptKey: HTMLElement; private promptText: HTMLElement;
  private comboEl: HTMLElement; private comboN: HTMLElement; private comboBar: HTMLElement;
  private lockEl: HTMLElement;
  private tipEl: HTMLElement;
  private dmgLayer: HTMLElement;
  private lastCombo = 0;
  private lastHp = 1;
  private lastQuest = '';
  private dmgPool: HTMLElement[] = [];
  private pending: { el: HTMLElement; pos: THREE.Vector3; t: number }[] = [];
  camera: THREE.Camera | null = null;
  showDamage = true;

  constructor(root: HTMLElement) {
    this.root = root;
    this.hud = h('div', 'hud');
    root.appendChild(this.hud);
    // left: portrait + bars
    const left = h('div', 'hud-left');
    const portrait = h('div', 'portrait', PORTRAIT_SVG);
    const ring = h('div', 'portrait-ring');
    portrait.appendChild(ring);
    this.lvl = h('div', 'level-badge', '1');
    portrait.appendChild(this.lvl);
    left.appendChild(portrait);
    const bars = h('div', 'bars');
    bars.appendChild(h('div', 'name-line', 'RIMURA <small>SLIME · MIMIC</small>'));
    const hp = h('div', 'bar hp'); this.hpGhost = h('div', 'bar-ghost'); this.hpFill = h('div', 'bar-fill'); this.hpText = h('div', 'bar-text');
    hp.append(this.hpGhost, this.hpFill, h('div', 'bar-shine'), this.hpText);
    const mp = h('div', 'bar mp'); this.mpFill = h('div', 'bar-fill'); this.mpText = h('div', 'bar-text');
    mp.append(this.mpFill, h('div', 'bar-shine'), this.mpText);
    const xp = h('div', 'bar xp'); this.xpFill = h('div', 'bar-fill'); xp.append(this.xpFill);
    bars.append(hp, mp, xp);
    left.appendChild(bars);
    this.hud.appendChild(left);
    // skills
    const skills = h('div', 'skills');
    for (const id of SKILL_ORDER) {
      const def = SKILLS[id];
      const el = h('div', 'skill' + (def.ultimate ? ' ult' : ''));
      el.innerHTML = ICONS[def.icon];
      const key = h('div', 'skill-key', def.key);
      const cd = h('div', 'skill-cd');
      const cdText = h('div', 'skill-cd-text');
      const name = h('div', 'skill-name', def.name);
      const lvl = h('div', 'skill-lvl', '');
      const cost = h('div', 'skill-cost', String(def.mp));
      el.append(cd, cdText, key, name, lvl, cost);
      skills.appendChild(el);
      this.skillEls.set(id, { el, cd, cdText, name, lvl });
    }
    this.hud.appendChild(skills);
    // target
    this.targetEl = h('div', 'target');
    this.targetName = h('div', 'target-name');
    const tb = h('div', 'bar'); this.targetFill = h('div', 'bar-fill'); tb.append(this.targetFill, h('div', 'bar-shine'));
    this.targetEl.append(this.targetName, tb);
    this.hud.appendChild(this.targetEl);
    // boss
    this.bossEl = h('div', 'boss');
    this.bossName = h('div', 'boss-name');
    const track = h('div', 'boss-track'); this.bossFill = h('div', 'bar-fill'); this.bossPhases = h('div', 'boss-phases');
    track.append(this.bossFill, h('div', 'bar-shine'), this.bossPhases, h('div', 'boss-ornament l'), h('div', 'boss-ornament r'));
    this.bossEl.append(this.bossName, track);
    this.hud.appendChild(this.bossEl);
    // quest
    this.questEl = h('div', 'quest glass');
    this.questTitle = h('div', 'quest-title');
    this.questObj = h('div', 'quest-obj');
    this.questEl.append(this.questTitle, this.questObj);
    this.hud.appendChild(this.questEl);
    // prompt
    this.promptEl = h('div', 'prompt glass');
    this.promptKey = h('div', 'key', 'F'); this.promptText = h('div', 'prompt-text');
    this.promptEl.append(this.promptKey, this.promptText);
    this.hud.appendChild(this.promptEl);
    // combo
    this.comboEl = h('div', 'combo');
    this.comboN = h('div', 'combo-n', '0');
    this.comboBar = h('div', 'combo-bar', '<div></div>');
    this.comboEl.append(this.comboN, h('div', 'combo-label', 'HITS'), this.comboBar);
    this.hud.appendChild(this.comboEl);
    // lock marker
    this.lockEl = h('div', 'lock', `<svg viewBox="0 0 100 100" fill="none" stroke="#ffd27f" stroke-width="4"><path d="M50 6 L 60 22 L 40 22 Z" fill="#ffd27f"/><path d="M6 50 L 22 40 L 22 60 Z" fill="#ffd27f"/><path d="M94 50 L 78 40 L 78 60 Z" fill="#ffd27f"/><path d="M50 94 L 40 78 L 60 78 Z" fill="#ffd27f"/><circle cx="50" cy="50" r="26" stroke-dasharray="20 12"/></svg>`);
    this.hud.appendChild(this.lockEl);
    // tip
    this.tipEl = h('div', 'tip');
    this.hud.appendChild(this.tipEl);
    // damage numbers layer
    this.dmgLayer = h('div', 'dmg-layer');
    this.dmgLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
    this.hud.appendChild(this.dmgLayer);

    events.on('damage', ({ hit, target }: { hit: HitInfo; target: Combatant }) => this.damageNumber(hit, target));
  }

  setVisible(v: boolean) { this.hud.classList.toggle('visible', v); }

  flashSkill(id: SkillId) {
    const s = this.skillEls.get(id);
    if (!s) return;
    s.el.classList.add('pressed');
    setTimeout(() => s.el.classList.remove('pressed'), 120);
  }

  questFlash() { this.questEl.classList.remove('flash'); void this.questEl.offsetWidth; this.questEl.classList.add('flash'); }

  damageNumber(hit: HitInfo, target: Combatant) {
    if (!this.showDamage) return;
    const el = this.dmgPool.pop() ?? document.createElement('div');
    const cls = ['dmg'];
    if (target.team === 'player') cls.push('player');
    else {
      if (hit.crit) cls.push('crit');
      if (hit.element !== 'physical') cls.push(hit.element);
      if (hit.type === 'spell') cls.push('spell');
    }
    el.className = cls.join(' ');
    el.textContent = String(hit.damage);
    const pos = hit.point.clone();
    pos.x += (Math.random() - 0.5) * 0.6;
    pos.y += 0.3 + Math.random() * 0.4;
    this.spawnFloating(el, pos);
  }

  floatingText(text: string, pos: THREE.Vector3, cls = 'text') {
    const el = this.dmgPool.pop() ?? document.createElement('div');
    el.className = 'dmg ' + cls;
    el.textContent = text;
    this.spawnFloating(el, pos.clone());
  }

  private spawnFloating(el: HTMLElement, pos: THREE.Vector3) {
    el.style.animation = 'none';
    el.style.opacity = '0';
    el.style.transform = 'translate(-50%, 0) scale(0.6)';
    this.dmgLayer.appendChild(el);
    const entry = { el, pos, t: 0 };
    this.pending.push(entry);
  }

  private project(p: THREE.Vector3, out = new THREE.Vector3()) {
    if (!this.camera) return null;
    out.copy(p).project(this.camera);
    if (out.z > 1) return null;
    return { x: (out.x * 0.5 + 0.5) * window.innerWidth, y: (-out.y * 0.5 + 0.5) * window.innerHeight };
  }

  private tmp = new THREE.Vector3();

  update(s: HudState, dt: number) {
    // bars
    const hpP = Math.max(0, s.hp / s.maxHp);
    this.hpFill.style.transform = `scaleX(${hpP})`;
    if (hpP < this.lastHp - 0.001) this.hpGhost.style.transform = `scaleX(${hpP})`;
    else if (hpP > this.lastHp) this.hpGhost.style.transform = `scaleX(${hpP})`;
    this.lastHp = hpP;
    this.hpText.textContent = `${Math.max(0, Math.ceil(s.hp))} / ${s.maxHp}`;
    this.mpFill.style.transform = `scaleX(${Math.max(0, s.mp / s.maxMp)})`;
    this.mpText.textContent = `${Math.floor(s.mp)}`;
    this.xpFill.style.transform = `scaleX(${Math.min(1, s.xp / s.xpNext)})`;
    this.lvl.textContent = String(s.level);
    this.hud.classList.toggle('hp-low', s.hpLow);
    // skills
    for (const sk of s.skills) {
      const e = this.skillEls.get(sk.id);
      if (!e) continue;
      e.el.classList.toggle('locked', !sk.owned);
      e.el.classList.toggle('ready', sk.owned && sk.ready && sk.cooldown <= 0);
      e.el.classList.toggle('nomp', sk.owned && !sk.ready && sk.cooldown <= 0);
      const p = sk.maxCooldown > 0 ? sk.cooldown / sk.maxCooldown : 0;
      e.cd.style.setProperty('--p', `${(p * 100).toFixed(1)}%`);
      e.cdText.textContent = sk.cooldown > 0.05 ? sk.cooldown.toFixed(sk.cooldown < 1 ? 1 : 0) : '';
      e.name.textContent = sk.owned ? sk.name : '???';
      e.lvl.textContent = sk.owned && sk.level > 1 ? 'Lv' + sk.level : '';
    }
    // target
    if (s.target) {
      this.targetEl.classList.add('visible');
      this.targetName.innerHTML = `${s.target.name}${s.target.level ? `<small>${s.target.level}</small>` : ''}`;
      this.targetFill.style.transform = `scaleX(${Math.max(0, s.target.hp / s.target.maxHp)})`;
    } else this.targetEl.classList.remove('visible');
    // boss
    if (s.boss) {
      this.bossEl.classList.add('visible');
      this.bossName.innerHTML = `${s.boss.name}<small>${s.boss.sub}</small>`;
      this.bossFill.style.transform = `scaleX(${Math.max(0, s.boss.hp / s.boss.maxHp)})`;
      if (this.bossPhases.childElementCount !== s.boss.phases.length) {
        this.bossPhases.innerHTML = s.boss.phases.map((p) => `<div class="boss-phase" style="left:${p * 100}%"></div>`).join('');
      }
    } else this.bossEl.classList.remove('visible');
    // quest
    if (s.quest) {
      this.questEl.classList.add('visible');
      const key = s.quest.title + '|' + s.quest.objective + '|' + (s.quest.progress ?? '');
      if (key !== this.lastQuest) {
        this.lastQuest = key;
        this.questTitle.innerHTML = `${ICONS.quest}${s.quest.title}`;
        this.questObj.className = 'quest-obj' + (s.quest.done ? ' done' : '');
        this.questObj.innerHTML = `<div class="box"></div><div>${s.quest.objective}${s.quest.progress ? `<span class="quest-progress">${s.quest.progress}</span>` : ''}</div>`;
        this.questFlash();
      }
    } else this.questEl.classList.remove('visible');
    // prompt
    if (s.prompt) { this.promptEl.classList.add('visible'); this.promptKey.textContent = s.prompt.key; this.promptText.textContent = s.prompt.text; }
    else this.promptEl.classList.remove('visible');
    // combo
    if (s.combo >= 2) {
      this.comboEl.classList.add('visible');
      if (s.combo !== this.lastCombo) { this.comboN.textContent = String(s.combo); this.comboN.classList.remove('pop'); void this.comboN.offsetWidth; this.comboN.classList.add('pop'); }
      (this.comboBar.firstElementChild as HTMLElement).style.transform = `scaleX(${Math.max(0, s.comboTimer)})`;
    } else this.comboEl.classList.remove('visible');
    this.lastCombo = s.combo;
    // lock marker
    if (s.lockScreen) { this.lockEl.classList.add('visible'); this.lockEl.style.transform = `translate(${s.lockScreen.x}px, ${s.lockScreen.y}px)`; }
    else this.lockEl.classList.remove('visible');
    // tip
    if (s.tip) { this.tipEl.classList.add('visible'); this.tipEl.innerHTML = (s.tip.key ? `<span class="key">${s.tip.key}</span>` : '') + s.tip.text; }
    else this.tipEl.classList.remove('visible');
    // floating numbers: JS-driven pop + float (independent of CSS animation and time scale)
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      p.t += dt;
      const life = p.el.classList.contains('crit') ? 1.1 : 0.95;
      if (p.t >= life) { p.el.remove(); this.pending.splice(i, 1); this.dmgPool.push(p.el); continue; }
      const sp = this.project(p.pos, this.tmp);
      if (!sp) { p.el.style.opacity = '0'; continue; }
      const k = p.t / life;
      const pop = k < 0.12 ? 0.6 + (k / 0.12) * 0.7 : k < 0.3 ? 1.3 - ((k - 0.12) / 0.18) * 0.3 : 1 - (k - 0.3) * 0.15;
      const rise = k < 0.3 ? k / 0.3 * 24 : 24 + (k - 0.3) / 0.7 * 50;
      const op = k < 0.08 ? k / 0.08 : k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      p.el.style.left = `${sp.x}px`;
      p.el.style.top = `${sp.y}px`;
      p.el.style.opacity = String(op);
      p.el.style.transform = `translate(-50%, ${-rise}px) scale(${pop})`;
    }
  }
}
