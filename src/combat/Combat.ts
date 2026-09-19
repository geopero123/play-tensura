import * as THREE from 'three';
import { events } from '../core/Events';
import { Time } from '../core/Time';
import { Effects } from '../vfx/Effects';
import { sfx } from '../audio/Audio';
import { rand } from '../core/Math';

export type Team = 'player' | 'enemy';
export type HitType = 'light' | 'heavy' | 'spell' | 'ult';
export type Element = 'physical' | 'water' | 'fire' | 'wind' | 'lightning' | 'dark' | 'meteor';

export interface HitInfo {
  damage: number;
  type: HitType;
  element: Element;
  source: Combatant | null;
  /** direction from attacker to target (horizontal) */
  dir: THREE.Vector3;
  knockback: number;
  launch: number;
  stagger: number; // seconds of stagger
  crit: boolean;
  point: THREE.Vector3;
  hitstop: number;
  skillId?: string;
  /** true if the hit ignores i-frames (e.g. environmental) */
  unblockable?: boolean;
}

export interface Combatant {
  id: number;
  name: string;
  team: Team;
  pos: THREE.Vector3;
  radius: number;
  height: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  root: THREE.Object3D;
  /** returns true if the hit was applied (false when invulnerable/dodging) */
  takeHit(hit: HitInfo): boolean;
  /** whether currently in perfect-dodge window (for player) */
  invulnerable?: boolean;
  /** used by lock-on & AI */
  targetable: boolean;
}

export interface AttackSpec {
  damage: number;
  type: HitType;
  element?: Element;
  knockback?: number;
  launch?: number;
  stagger?: number;
  critChance?: number;
  critMult?: number;
  hitstop?: number;
  skillId?: string;
  /** shape */
  radius: number;
  /** if set, arc in radians around dir (cone) */
  arc?: number;
}

let nextId = 1;
export const newId = () => nextId++;

export class Combat {
  combatants: Combatant[] = [];
  private time: Time;
  private fx: Effects;
  camera: THREE.Camera;
  /** callbacks set by the game */
  onPlayerHit: ((hit: HitInfo, target: Combatant) => void) | null = null;
  onEnemyHit: ((hit: HitInfo, target: Combatant) => void) | null = null;
  private tmp = new THREE.Vector3();

  constructor(time: Time, fx: Effects, camera: THREE.Camera) {
    this.time = time;
    this.fx = fx;
    this.camera = camera;
  }

  register(c: Combatant) { this.combatants.push(c); }
  unregister(c: Combatant) { const i = this.combatants.indexOf(c); if (i >= 0) this.combatants.splice(i, 1); }

  enemies() { return this.combatants.filter((c) => c.team === 'enemy' && c.alive); }

  /** Enemies within radius of a point */
  enemiesNear(p: THREE.Vector3, radius: number, team: Team = 'enemy') {
    const out: Combatant[] = [];
    for (const c of this.combatants) {
      if (c.team !== team || !c.alive) continue;
      const d = Math.hypot(c.pos.x - p.x, c.pos.z - p.z);
      if (d < radius + c.radius) out.push(c);
    }
    return out;
  }

  /**
   * Resolve an attack from a source against the opposing team.
   * center: hit sphere center. dir: facing direction (for arcs & knockback).
   * Returns the list of combatants hit.
   */
  hit(source: Combatant | null, team: Team, center: THREE.Vector3, dir: THREE.Vector3, spec: AttackSpec, exclude?: Set<number>): Combatant[] {
    const hits: Combatant[] = [];
    for (const c of this.combatants) {
      if (c.team !== team || !c.alive) continue;
      if (exclude && exclude.has(c.id)) continue;
      const dx = c.pos.x - center.x, dz = c.pos.z - center.z;
      const dh = Math.hypot(dx, dz);
      if (dh > spec.radius + c.radius) continue;
      const cy = c.pos.y + c.height * 0.5;
      if (Math.abs(cy - center.y) > spec.radius + c.height * 0.6) continue;
      if (spec.arc !== undefined && dh > 0.3) {
        const ang = Math.acos(Math.max(-1, Math.min(1, (dx * dir.x + dz * dir.z) / (dh || 1))));
        if (ang > spec.arc * 0.5) continue;
      }
      const critChance = spec.critChance ?? 0.08;
      const crit = Math.random() < critChance;
      const dmgBase = spec.damage * rand(0.92, 1.08);
      const damage = Math.round(dmgBase * (crit ? (spec.critMult ?? 1.7) : 1));
      const kdir = this.tmp.set(dx, 0, dz);
      if (kdir.lengthSq() < 0.01) kdir.copy(dir);
      kdir.normalize();
      const hit: HitInfo = {
        damage,
        type: spec.type,
        element: spec.element ?? 'physical',
        source,
        dir: kdir.clone(),
        knockback: spec.knockback ?? 0,
        launch: spec.launch ?? 0,
        stagger: spec.stagger ?? 0.25,
        crit,
        point: new THREE.Vector3(c.pos.x - kdir.x * c.radius * 0.6, cy + rand(-0.2, 0.3), c.pos.z - kdir.z * c.radius * 0.6),
        hitstop: spec.hitstop ?? 0,
        skillId: spec.skillId,
      };
      if (c.takeHit(hit)) {
        hits.push(c);
        if (exclude) exclude.add(c.id);
        this.afterHit(hit, c, team);
      }
    }
    return hits;
  }

  /** Direct hit on a specific combatant (projectiles, AI attacks) */
  hitDirect(source: Combatant | null, target: Combatant, dir: THREE.Vector3, spec: Omit<AttackSpec, 'radius'>): boolean {
    if (!target.alive) return false;
    const crit = Math.random() < (spec.critChance ?? 0.08);
    const damage = Math.round(spec.damage * rand(0.92, 1.08) * (crit ? (spec.critMult ?? 1.7) : 1));
    const kdir = dir.clone().setY(0);
    if (kdir.lengthSq() < 0.01) kdir.set(0, 0, 1);
    kdir.normalize();
    const hit: HitInfo = {
      damage, type: spec.type, element: spec.element ?? 'physical', source, dir: kdir,
      knockback: spec.knockback ?? 0, launch: spec.launch ?? 0, stagger: spec.stagger ?? 0.25, crit,
      point: new THREE.Vector3(target.pos.x, target.pos.y + target.height * 0.55, target.pos.z),
      hitstop: spec.hitstop ?? 0, skillId: spec.skillId,
    };
    const ok = target.takeHit(hit);
    if (ok) this.afterHit(hit, target, target.team);
    return ok;
  }

  private afterHit(hit: HitInfo, target: Combatant, targetTeam: Team) {
    if (hit.hitstop > 0) this.time.hitstop(hit.hitstop);
    // impact visuals by type/element
    const color = hit.element === 'water' ? 0x9fe6ff : hit.element === 'fire' ? 0xc060ff : hit.element === 'wind' ? 0xb0ffd8 : hit.element === 'lightning' ? 0xfff2a0 : hit.element === 'dark' ? 0xa060ff : hit.element === 'meteor' ? 0xffb070 : 0xfff0a0;
    const strong = hit.type === 'heavy' || hit.type === 'ult' || hit.crit;
    if (targetTeam === 'enemy') {
      this.fx.hitSpark(hit.point, hit.dir, color, strong, this.camera);
      if (hit.type === 'light' || hit.type === 'heavy') this.fx.slash(hit.point, hit.dir, 0xffffff, strong ? 0.85 : 0.55, 0.14);
      const pan = Math.max(-1, Math.min(1, (target.pos.clone().project(this.camera).x)));
      if (hit.crit) sfx('crit', 1, pan);
      else if (strong) sfx('hitHeavy', 0.9, pan);
      else sfx('hit', 0.8, pan);
    } else {
      this.fx.hitSpark(hit.point, hit.dir, 0xff6a6a, strong, this.camera);
      sfx('hurt', 1);
    }
    events.emit('damage', { hit, target });
    if (targetTeam === 'enemy') this.onEnemyHit?.(hit, target);
    else this.onPlayerHit?.(hit, target);
  }
}
