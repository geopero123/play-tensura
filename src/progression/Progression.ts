import { SKILLS, TRAITS, TRAIT_FUSIONS, SkillId, TraitId, xpForLevel, SKILL_ORDER } from './Data';
import { events } from '../core/Events';

export interface SkillState { id: SkillId; level: number; xp: number; cooldown: number }

/** Player stats, level, acquired skills/traits, evolution logic. Emits events for the UI. */
export class Progression {
  level = 1;
  xp = 0;
  hp = 100;
  mp = 60;
  skills = new Map<SkillId, SkillState>();
  traits = new Set<TraitId>();
  traitStacks = new Map<TraitId, number>();
  absorbed = new Map<string, number>();
  kills = 0;
  private baseHp = 100;
  private baseMp = 60;

  constructor() {
    this.acquireSkill('predator', true);
  }

  get maxHp() { return Math.round((this.baseHp + (this.level - 1) * 14) * (1 + this.sumMod('maxHp') / 100)); }
  get maxMp() { return Math.round((this.baseMp + (this.level - 1) * 8) + this.sumMod('maxMp')); }
  get atk() { return (10 + (this.level - 1) * 2.2) * (1 + this.sumMod('atk')); }
  get def() { return Math.min(0.6, this.sumMod('def')); }
  get critChance() { return 0.08 + this.sumMod('crit'); }
  get regen() { return 0.2 + this.sumMod('regen'); }
  get mpRegen() { return 3 + this.sumMod('mpRegen'); }
  get fireRes() { return Math.min(1, this.sumMod('fireRes')); }
  get speedMod() { return 1 + this.sumMod('speed'); }
  /** 0..1 visible power for the aura */
  get power() { return Math.min(1, (this.level - 1) / 12 + this.skills.size * 0.06 + this.traits.size * 0.04); }

  private sumMod(k: string) {
    let v = 0;
    for (const t of this.traits) v += (TRAITS[t].mods as any)[k] ?? 0;
    return v;
  }

  hasSkill(id: SkillId) { return this.skills.has(id); }
  skill(id: SkillId) { return this.skills.get(id); }
  skillName(id: SkillId) { const s = this.skills.get(id); return s ? SKILLS[id].tiers[s.level - 1].name : SKILLS[id].name; }

  acquireSkill(id: SkillId, silent = false) {
    if (this.skills.has(id)) return false;
    this.skills.set(id, { id, level: 1, xp: 0, cooldown: 0 });
    if (!silent) events.emit('skillAcquired', id);
    return true;
  }

  acquireTrait(id: TraitId, silent = false): { result: TraitId; evolved: boolean } | null {
    // stacking: acquiring an already-owned trait pushes it toward evolution
    if (this.traits.has(id)) {
      const def = TRAITS[id];
      const stacks = (this.traitStacks.get(id) ?? 0) + 1;
      this.traitStacks.set(id, stacks);
      if (def.evolvesTo && stacks >= 2) {
        this.traits.delete(id);
        this.traits.add(def.evolvesTo);
        this.traitStacks.set(id, 0);
        if (!silent) events.emit('traitEvolved', { from: id, to: def.evolvesTo });
        this.checkFusions(silent);
        return { result: def.evolvesTo, evolved: true };
      }
      if (!silent) events.emit('traitStacked', { id, stacks, needed: 2 });
      return null;
    }
    // if we already own a higher evolution, skip
    for (const t of this.traits) { let cur: TraitId | undefined = id; while (cur) { if (TRAITS[cur].evolvesTo === t || cur === t) return null; cur = TRAITS[cur].evolvesTo; } }
    this.traits.add(id);
    if (!silent) events.emit('traitAcquired', id);
    this.checkFusions(silent);
    return { result: id, evolved: false };
  }

  private checkFusions(silent: boolean) {
    for (const f of TRAIT_FUSIONS) {
      if (this.traits.has(f.result)) continue;
      if (f.needs.every((n) => this.traits.has(n))) {
        f.needs.forEach((n) => this.traits.delete(n));
        this.traits.add(f.result);
        if (!silent) events.emit('traitFused', { from: f.needs, to: f.result });
      }
    }
  }

  /** skill usage XP; returns true if the skill evolved */
  addSkillXp(id: SkillId, amount = 1) {
    const s = this.skills.get(id);
    if (!s) return false;
    const def = SKILLS[id];
    if (s.level >= def.tiers.length) return false;
    s.xp += amount;
    const need = def.tiers[s.level].xp;
    if (s.xp >= need) {
      s.level++;
      s.xp = 0;
      events.emit('skillEvolved', { id, level: s.level, from: def.tiers[s.level - 2].name, to: def.tiers[s.level - 1].name, desc: def.tiers[s.level - 1].desc });
      return true;
    }
    return false;
  }

  addXp(amount: number) {
    this.xp += amount;
    let leveled = false;
    while (this.xp >= xpForLevel(this.level)) {
      this.xp -= xpForLevel(this.level);
      this.level++;
      leveled = true;
    }
    if (leveled) {
      this.hp = this.maxHp;
      this.mp = this.maxMp;
      events.emit('levelUp', this.level);
    }
  }

  get xpToNext() { return xpForLevel(this.level); }

  recordAbsorb(kind: string) {
    this.absorbed.set(kind, (this.absorbed.get(kind) ?? 0) + 1);
  }

  cooldownScale(id: SkillId) { return this.traits.has('thermalNull') && id === 'blackFlame' ? 0.75 : 1; }
  mpCost(id: SkillId) { const base = SKILLS[id].mp; return this.traits.has('thermalNull') && id === 'blackFlame' ? Math.round(base * 0.6) : base; }

  tick(dt: number, inCombat: boolean) {
    const regen = this.regen * (inCombat ? (this.traits.has('regen2') ? 1 : 0.25) : 1);
    this.hp = Math.min(this.maxHp, this.hp + regen * dt);
    this.mp = Math.min(this.maxMp, this.mp + this.mpRegen * dt * (inCombat ? 0.8 : 1.3));
    for (const s of this.skills.values()) s.cooldown = Math.max(0, s.cooldown - dt);
  }

  serialize() {
    return { level: this.level, xp: this.xp, skills: [...this.skills.values()], traits: [...this.traits], stacks: [...this.traitStacks], absorbed: [...this.absorbed], kills: this.kills };
  }

  orderedSkills() { return SKILL_ORDER; }
}
