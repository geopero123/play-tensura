import * as THREE from 'three';
import { Combat, Combatant, AttackSpec } from './Combat';
import { Effects } from '../vfx/Effects';
import { Particles, Shape } from '../vfx/Particles';
import { MagicCircle } from '../vfx/MagicCircle';
import { Progression } from '../progression/Progression';
import { SKILLS, SkillId } from '../progression/Data';
import { Time } from '../core/Time';
import { PostFX } from '../render/PostFX';
import { GameCamera } from '../core/Camera';
import { Terrain } from '../world/Terrain';
import { createGlowMaterial, globalUniforms } from '../render/ToonMaterial';
import { sfx } from '../audio/Audio';
import { rand, easeOutCubic, easeInCubic, lerp } from '../core/Math';
import { events } from '../core/Events';

export interface SkillContext {
  pos: THREE.Vector3;
  facing: THREE.Vector3;
  root: THREE.Object3D;
  combatant: Combatant;
  target: Combatant | null;
  /** point the spell should land on */
  aimPoint: (maxDist: number) => THREE.Vector3;
}

interface Active { update(dt: number): boolean }

/** Implements the six spells with layered anime presentation. */
export class SkillSystem {
  private list: Active[] = [];
  private circles: MagicCircle[] = [];
  /** requests read by the game each frame */
  stormRequest = 0;
  windRequest = 0;
  tint = new THREE.Color(1, 1, 1);
  ultActive = false;
  ultChargeT = 0;
  /** world position the camera should frame during the ultimate (the falling meteor), or null */
  ultFocus: THREE.Vector3 | null = null;
  onCastStart: ((id: SkillId, castTime: number, ultimate: boolean) => void) | null = null;
  onUltEnd: (() => void) | null = null;
  /** devoured callback: enemy kind */
  onDevour: ((c: Combatant) => void) | null = null;
  private ultLight: THREE.PointLight;
  private castLight: THREE.PointLight;
  /** game-time delayed call (respects hit-stop / pause) */
  private later(seconds: number, fn: () => void) {
    let t = seconds;
    this.list.push({ update: (dt) => { t -= dt; if (t <= 0) { fn(); return false; } return true; } });
  }

  constructor(
    private scene: THREE.Scene, private fx: Effects, private particles: Particles, private combat: Combat,
    private prog: Progression, private time: Time, private post: PostFX, private gcam: GameCamera, private terrain: Terrain
  ) {
    this.ultLight = new THREE.PointLight(0xff8040, 0, 60, 1.2);
    this.castLight = new THREE.PointLight(0x7fd4ff, 0, 14, 1.5);
    scene.add(this.ultLight, this.castLight);
  }

  private h(x: number, z: number) { return this.terrain.heightAt(x, z); }

  private circle(opts: ConstructorParameters<typeof MagicCircle>[0], pos: THREE.Vector3, parent?: THREE.Object3D) {
    const c = new MagicCircle(opts);
    c.group.position.copy(pos);
    (parent ?? this.scene).add(c.group);
    this.circles.push(c);
    return c;
  }

  canCast(id: SkillId) {
    const s = this.prog.skill(id);
    if (!s) return false;
    return s.cooldown <= 0 && this.prog.mp >= this.prog.mpCost(id);
  }

  /** Attempt to cast. Returns cast time (seconds) or -1 if failed. */
  cast(id: SkillId, ctx: SkillContext): number {
    if (!this.canCast(id)) { sfx('uiBack', 0.5); return -1; }
    if (this.ultActive) return -1;
    const s = this.prog.skill(id)!;
    const def = SKILLS[id];
    this.prog.mp -= this.prog.mpCost(id);
    s.cooldown = def.cooldown * this.prog.cooldownScale(id);
    const lvl = s.level;
    let castTime = 0.3;
    switch (id) {
      case 'waterBlade': castTime = this.waterBlade(ctx, lvl); break;
      case 'blackFlame': castTime = this.blackFlame(ctx, lvl); break;
      case 'windCutter': castTime = this.windCutter(ctx, lvl); break;
      case 'lightning': castTime = this.lightning(ctx, lvl); break;
      case 'predator': castTime = this.predator(ctx, lvl); break;
      case 'meteor': castTime = this.meteor(ctx, lvl); break;
    }
    this.onCastStart?.(id, castTime, !!def.ultimate);
    events.emit('cast', id);
    return castTime;
  }

  private dmg(mult: number) { return this.prog.atk * mult; }
  private spec(mult: number, element: AttackSpec['element'], radius: number, extra: Partial<AttackSpec> = {}): AttackSpec {
    return { damage: this.dmg(mult), type: 'spell', element, radius, critChance: this.prog.critChance, hitstop: 0.04, stagger: 0.35, knockback: 3, ...extra };
  }

  private castFlash(ctx: SkillContext, color: number) {
    this.castLight.color.set(color);
    this.castLight.intensity = 8;
    this.castLight.position.copy(ctx.pos).add(new THREE.Vector3(0, 1.2, 0));
    this.fx.flash(ctx.pos.clone().setY(ctx.pos.y + 0.7), color, 0.9, 0.22, this.combat.camera);
  }

  // ------------------------------------------------------------ WATER BLADE
  private waterBlade(ctx: SkillContext, lvl: number) {
    const color = 0x7fd8ff;
    const c = this.circle({ color, radius: 0.9, layers: 1, vertical: true, seed: 5 }, ctx.pos.clone().add(new THREE.Vector3(0, 0.75, 0)).addScaledVector(ctx.facing, 0.9));
    c.group.lookAt(c.group.position.clone().add(ctx.facing));
    this.castFlash(ctx, color);
    sfx('water');
    // water spiral around body
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      this.particles.emit({ pos: { x: ctx.pos.x + Math.cos(a) * 0.9, y: ctx.pos.y + 0.2 + i * 0.05, z: ctx.pos.z + Math.sin(a) * 0.9 }, count: 1, life: 0.45, size: 0.14, color: [color, 0xffffff], shape: Shape.GLOW, orbit: 12, vel: { x: 0, y: 1.5, z: 0 } });
    }
    const castTime = 0.22;
    const count = lvl === 1 ? 1 : lvl === 2 ? 2 : 3;
    const scale = lvl === 3 ? 1.7 : lvl === 2 ? 1.15 : 1;
    const mult = lvl === 1 ? 1.7 : lvl === 2 ? 1.5 : 2.0;
    const launchAt = this.time.elapsed + castTime;
    let launched = false;
    this.list.push({ update: () => {
      if (!launched && this.time.elapsed >= launchAt) {
        launched = true;
        c.dismiss(0.15);
        for (let i = 0; i < count; i++) {
          const ang = count === 1 ? 0 : (i - (count - 1) / 2) * 0.22;
          const dir = ctx.facing.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), ang);
          if (ctx.target) { const tp = ctx.target.pos.clone().sub(ctx.pos).setY(0).normalize(); dir.lerp(tp, 0.8).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), ang); }
          this.spawnBlade(ctx, dir, scale, mult, i * 0.05);
        }
        this.prog.addSkillXp('waterBlade');
        sfx('slash', 0.8);
      }
      return !launched;
    } });
    return castTime;
  }

  private spawnBlade(ctx: SkillContext, dir: THREE.Vector3, scale: number, mult: number, delay: number) {
    const color = 0x7fd8ff;
    const g = new THREE.Group();
    const geo = crescentGeo(0.9, 0.34, Math.PI * 1.15);
    const m = new THREE.Mesh(geo, createGlowMaterial(color, 1));
    const core = new THREE.Mesh(geo, createGlowMaterial(0xffffff, 0.9));
    core.scale.set(0.85, 0.7, 1); core.position.z = 0.01;
    g.add(m, core);
    g.scale.setScalar(scale);
    const start = ctx.pos.clone().add(new THREE.Vector3(0, 0.75, 0)).addScaledVector(dir, 0.8);
    g.position.copy(start);
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    g.rotateZ(rand(-0.4, 0.4));
    g.renderOrder = 12;
    this.scene.add(g);
    const hitSet = new Set<number>();
    const speed = 30;
    let t = -delay;
    const spec = this.spec(mult, 'water', 1.2 * scale, { knockback: 4, stagger: 0.4, skillId: 'waterBlade' });
    const spin = rand(-8, 8);
    this.list.push({ update: (dt) => {
      t += dt;
      if (t < 0) return true;
      g.position.addScaledVector(dir, speed * dt);
      g.rotateZ(spin * dt);
      const pulse = 1 + Math.sin(t * 40) * 0.08;
      g.scale.setScalar(scale * pulse);
      // trail
      this.particles.emit({ pos: g.position, count: 2, spread: 0.3 * scale, life: 0.35, size: 0.16 * scale, color: [color, 0xffffff, 0x2f7fe0], shape: Shape.GLOW, vel: { x: -dir.x * 2, y: 0.5, z: -dir.z * 2 }, velSpread: 1, gravity: 4 });
      this.particles.emit({ pos: g.position, count: 1, life: 0.3, size: 0.9 * scale, sizeEnd: 1.6, color: [color], alpha: 0.35, shape: Shape.RING });
      const hits = this.combat.hit(ctx.combatant, 'enemy', g.position, dir, spec, hitSet);
      for (const h of hits) {
        this.fx.slash(h.pos.clone().setY(h.pos.y + h.height * 0.5), dir, color, 1.6 * scale, 0.25, { wide: true });
        this.particles.emit({ pos: h.pos.clone().setY(h.pos.y + h.height * 0.5), count: 18, velSpread: 6, velUp: 3, life: 0.6, size: 0.14, color: [color, 0xffffff], shape: Shape.DOT, gravity: 12, drag: 1 });
        this.fx.groundMark(h.pos, 0x3a7fc8, 1.6 * scale, 5);
        sfx('waterHit', 0.9);
      }
      const gy = this.h(g.position.x, g.position.z);
      if (g.position.y < gy + 0.1) g.position.y = gy + 0.1;
      const alive = t < 1.4;
      if (!alive) { this.scene.remove(g); geo.dispose(); }
      return alive;
    } });
  }

  // ------------------------------------------------------------ BLACK FLAME
  private blackFlame(ctx: SkillContext, lvl: number) {
    const color = 0x9a3cff, dark = 0x1a0530;
    const c = this.circle({ color, radius: 1.5, layers: 2, seed: 17 }, ctx.pos.clone().setY(ctx.pos.y + 0.06));
    this.castFlash(ctx, color);
    sfx('fire');
    this.fx.orbitOrbs(ctx.root, color, 6, 0.5, 1.1, 0.7);
    const castTime = 0.42;
    const target = ctx.aimPoint(11);
    target.y = this.h(target.x, target.z);
    const radius = lvl === 1 ? 3.4 : lvl === 2 ? 4.4 : 5.2;
    const fireAt = this.time.elapsed + castTime;
    let fired = false;
    // telegraph ring at target for the player to read
    const ring = this.fx.shockwave(target, color, radius * 0.9, castTime + 0.05, { y: 0.1 });
    void ring;
    this.list.push({ update: () => {
      if (!fired && this.time.elapsed >= fireAt) {
        fired = true;
        c.dismiss(0.2);
        this.prog.addSkillXp('blackFlame');
        this.igniteBlackFlame(ctx, target, radius, lvl);
      }
      return !fired;
    } });
    return castTime;
  }

  private igniteBlackFlame(ctx: SkillContext, target: THREE.Vector3, radius: number, lvl: number) {
    const color = 0x9a3cff, edge = 0xd070ff, dark = 0x120420;
    const cam = this.combat.camera;
    // burst
    if (lvl === 3) {
      this.fx.pillar(target, 0x6a1ad0, radius * 0.6, 16, 0.8);
      this.fx.pillar(target, 0x1a0530, radius * 0.35, 18, 0.7);
      sfx('explosion', 0.7);
      this.gcam.addTrauma(0.35);
    }
    this.fx.burst(target.clone().setY(target.y + 1), dark, radius * 0.75, 0.5, false);
    this.fx.burst(target.clone().setY(target.y + 1), 0x5a1aa0, radius * 0.85, 0.4);
    this.fx.shockwave(target, edge, radius * 2, 0.6);
    this.fx.flash(target.clone().setY(target.y + 1.5), 0xc080ff, radius, 0.2, cam);
    this.particles.emit({ pos: target.clone().setY(target.y + 0.4), count: 40, spread: radius * 0.4, velSpread: 4, velUp: 6, life: 1.0, lifeVar: 0.4, size: 0.9, sizeVar: 0.3, sizeEnd: 0.4, color: [dark, 0x2a0a4a, color], shape: Shape.FLAME, drag: 1.5 });
    this.particles.emit({ pos: target.clone().setY(target.y + 0.3), count: 30, spread: radius * 0.3, velSpread: 8, velUp: 5, life: 0.7, size: 0.16, color: [edge, 0xffffff, color], shape: Shape.SPARK, stretch: 1.2, gravity: 8, drag: 1 });
    this.particles.emit({ pos: target.clone().setY(target.y + 1), count: 14, spread: radius * 0.4, velUp: 2, velSpread: 1.5, life: 1.8, size: 1.4, sizeEnd: 2.6, color: [0x0a0212, 0x2a1040], alpha: 0.7, shape: Shape.SMOKE, additive: false, rotSpeed: 2, gravity: -0.8 });
    sfx('fireHit', 1.1);
    this.post.chromaTarget = 0.012;
    this.later(0.16, () => (this.post.chromaTarget = 0));
    this.gcam.addTrauma(0.25);
    const mult = lvl === 1 ? 2.2 : lvl === 2 ? 2.5 : 3.6;
    this.combat.hit(ctx.combatant, 'enemy', target.clone().setY(target.y + 1), ctx.facing, this.spec(mult, 'fire', radius, { knockback: 5, launch: lvl === 3 ? 6 : 2, stagger: 0.6, hitstop: 0.06, skillId: 'blackFlame' }));
    // lingering zone
    const light = new THREE.PointLight(color, 14, radius * 4, 1.4);
    light.position.copy(target).add(new THREE.Vector3(0, 1.5, 0));
    this.scene.add(light);
    const mark = this.fx.groundMark(target, 0x1a0525, radius * 1.2, 5.5);
    void mark;
    const dur = lvl === 1 ? 4 : lvl === 2 ? 5 : 6;
    let t = 0, tick = 0;
    const center = target.clone();
    const tickSpec = this.spec(lvl === 3 ? 0.7 : 0.45, 'fire', radius * 0.9, { knockback: 0.5, stagger: 0.15, hitstop: 0, skillId: 'blackFlame' });
    this.list.push({ update: (dt) => {
      t += dt; tick += dt;
      const life = 1 - t / dur;
      light.intensity = (10 + Math.sin(t * 20) * 3) * life;
      // flames chase enemies (tier 2+)
      if (lvl >= 2) {
        const near = this.combat.enemiesNear(center, radius * 2.5);
        if (near.length) { const e = near[0]; center.x = lerp(center.x, e.pos.x, dt * 1.2); center.z = lerp(center.z, e.pos.z, dt * 1.2); center.y = this.h(center.x, center.z); light.position.set(center.x, center.y + 1.5, center.z); }
      }
      // flame particles
      for (let i = 0; i < 3; i++) {
        const a = rand(0, Math.PI * 2), r = rand(0, radius * 0.8);
        this.particles.emit({ pos: { x: center.x + Math.cos(a) * r, y: center.y + 0.1, z: center.z + Math.sin(a) * r }, count: 1, velUp: rand(1.5, 3.5), life: 0.6, lifeVar: 0.2, size: rand(0.5, 1.0) * life, sizeEnd: 0.3, color: [dark, 0x2a0a4a, color, edge], shape: Shape.FLAME, drag: 1 });
      }
      if (Math.random() < 0.5) this.particles.emit({ pos: { x: center.x + rand(-radius, radius) * 0.7, y: center.y + 0.5, z: center.z + rand(-radius, radius) * 0.7 }, count: 1, velUp: 2, life: 0.8, size: 0.08, color: [edge, 0xffffff], shape: Shape.SPARK, stretch: 0.8, gravity: -1 });
      if (Math.random() < 0.25) this.particles.emit({ pos: { x: center.x, y: center.y + 1.5, z: center.z }, count: 1, spread: radius * 0.5, velUp: 1.5, life: 2, size: 1.2, sizeEnd: 2.5, color: [0x0a0212], alpha: 0.5, shape: Shape.SMOKE, additive: false, rotSpeed: 1 });
      if (tick > 0.5) { tick = 0; this.combat.hit(ctx.combatant, 'enemy', center.clone().setY(center.y + 0.8), ctx.facing, tickSpec); }
      if (t >= dur) { this.scene.remove(light); return false; }
      return true;
    } });
  }

  // ------------------------------------------------------------ WIND CUTTER
  private windCutter(ctx: SkillContext, lvl: number) {
    const color = 0xbfffe0;
    this.castFlash(ctx, 0x9fffd0);
    sfx('wind');
    const count = lvl === 1 ? 3 : lvl === 2 ? 6 : 12;
    const mult = lvl === 1 ? 0.9 : lvl === 2 ? 0.85 : 0.8;
    const castTime = 0.16;
    this.fx.shockwave(ctx.pos.clone(), color, 2.5, 0.3, { y: 0.6 });
    this.particles.emit({ pos: ctx.pos.clone().setY(ctx.pos.y + 0.6), count: 20, velSpread: 6, life: 0.4, size: 0.12, color: [color, 0xffffff], shape: Shape.SPARK, stretch: 1.4, drag: 3 });
    this.prog.addSkillXp('windCutter');
    const enemies = this.combat.enemies().filter((e) => e.pos.distanceTo(ctx.pos) < 26).sort((a, b) => a.pos.distanceTo(ctx.pos) - b.pos.distanceTo(ctx.pos));
    for (let i = 0; i < count; i++) {
      const delay = castTime + i * (lvl === 3 ? 0.05 : 0.08);
      const target = ctx.target && ctx.target.alive ? (i % 2 === 0 || enemies.length < 2 ? ctx.target : enemies[i % enemies.length]) : enemies.length ? enemies[i % enemies.length] : null;
      this.spawnWindSlash(ctx, target, delay, mult, lvl, i);
    }
    return castTime;
  }

  private spawnWindSlash(ctx: SkillContext, target: Combatant | null, delay: number, mult: number, lvl: number, index: number) {
    const color = 0xcfffe8;
    const geo = crescentGeo(0.6, 0.1, Math.PI * 0.9);
    const m = new THREE.Mesh(geo, createGlowMaterial(color, 0.85));
    m.renderOrder = 12;
    const side = index % 2 === 0 ? 1 : -1;
    const ang = (index / 3) * 0.6 * side + rand(-0.2, 0.2);
    const startDir = ctx.facing.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), ang);
    const pos = ctx.pos.clone().add(new THREE.Vector3(0, 0.6 + rand(0, 0.8), 0)).addScaledVector(startDir, 0.5).addScaledVector(new THREE.Vector3(-startDir.z, 0, startDir.x), side * rand(0.3, 0.9));
    m.position.copy(pos);
    this.scene.add(m);
    m.visible = false;
    const dir = startDir.clone();
    let t = -delay;
    const hitSet = new Set<number>();
    const spec = this.spec(mult, 'wind', 0.9, { knockback: 2, stagger: lvl >= 2 ? 0.55 : 0.3, launch: lvl === 3 ? 5 : 0, hitstop: 0.03, skillId: 'windCutter' });
    let life = 0;
    this.list.push({ update: (dt) => {
      t += dt;
      if (t < 0) return true;
      m.visible = true;
      life += dt;
      const speed = 34;
      if (target && target.alive) {
        const to = target.pos.clone().setY(target.pos.y + target.height * 0.5).sub(m.position);
        const d = to.length();
        to.normalize();
        // homing: sharp turn
        dir.lerp(to, Math.min(1, dt * (life < 0.15 ? 4 : 14))).normalize();
        if (d < 1.2 && !hitSet.has(target.id)) {
          const hits = this.combat.hit(ctx.combatant, 'enemy', m.position, dir, spec, hitSet);
          if (hits.length) {
            for (const h of hits) { this.fx.slash(h.pos.clone().setY(h.pos.y + h.height * 0.5), dir, color, 1.2, 0.18, { tilt: rand(-1, 1) }); sfx('windHit', 0.7); }
            this.scene.remove(m); geo.dispose(); return false;
          }
        }
      } else {
        this.combat.hit(ctx.combatant, 'enemy', m.position, dir, spec, hitSet);
      }
      m.position.addScaledVector(dir, speed * dt);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      m.rotateZ(life * 30 * side);
      const gy = this.h(m.position.x, m.position.z) + 0.3;
      if (m.position.y < gy) m.position.y = gy;
      this.particles.emit({ pos: m.position, count: 1, life: 0.25, size: 0.1, color: [color, 0xffffff], alpha: 0.6, shape: Shape.SPARK, stretch: 1, vel: { x: -dir.x * 3, y: 0, z: -dir.z * 3 } });
      if (life > 1.6) { this.scene.remove(m); geo.dispose(); return false; }
      return true;
    } });
  }

  // ------------------------------------------------------------ LIGHTNING JUDGMENT
  private lightning(ctx: SkillContext, lvl: number) {
    const gold = 0xfff2a0, white = 0xffffff, blue = 0xbfe8ff;
    const target = ctx.aimPoint(14);
    target.y = this.h(target.x, target.z);
    const radius = lvl === 3 ? 5.5 : 4.2;
    const c = this.circle({ color: gold, radius: radius * 0.8, layers: 3, seed: 41, intensity: 1.2 }, target.clone().setY(target.y + 0.1));
    const hand = this.circle({ color: blue, radius: 0.7, layers: 1, vertical: true, seed: 42 }, ctx.pos.clone().add(new THREE.Vector3(0, 1.0, 0)).addScaledVector(ctx.facing, 0.7));
    hand.group.lookAt(hand.group.position.clone().add(ctx.facing));
    this.castFlash(ctx, blue);
    sfx('lightningCharge');
    const castTime = 0.55;
    const buildup = lvl === 3 ? 1.35 : 0.95;
    let t = 0, arcT = 0, struck = false, ringIdx = 0;
    const strikes = lvl === 1 ? 1 : lvl === 2 ? 2 : 1;
    this.list.push({ update: (dt) => {
      t += dt; arcT += dt;
      this.stormRequest = Math.max(this.stormRequest, Math.min(0.55, t / buildup * 0.55));
      // arcs on the circle
      if (arcT > 0.09 && !struck) {
        arcT = 0;
        const a1 = rand(0, Math.PI * 2), a2 = a1 + rand(0.6, 2.4), r = radius * 0.8;
        this.fx.lightning(new THREE.Vector3(target.x + Math.cos(a1) * r, target.y + 0.2, target.z + Math.sin(a1) * r), new THREE.Vector3(target.x + Math.cos(a2) * r, target.y + 0.3 + rand(0, 1.5), target.z + Math.sin(a2) * r), blue, 0.12, 0.04, 0);
        this.particles.emit({ pos: target.clone().setY(target.y + 0.2), count: 4, spread: radius * 0.7, velUp: 6, life: 0.6, size: 0.1, color: [gold, white, blue], shape: Shape.SPARK, stretch: 0.8 });
        sfx('bolt', 0.15);
      }
      if (lvl === 3 && t > buildup * 0.45 && ringIdx < 6 && t > buildup * 0.45 + ringIdx * 0.12) {
        const a = (ringIdx / 6) * Math.PI * 2;
        const p = new THREE.Vector3(target.x + Math.cos(a) * radius * 0.9, target.y, target.z + Math.sin(a) * radius * 0.9);
        this.strike(ctx, p, 1.6, 0.9, false);
        ringIdx++;
      }
      if (!struck && t >= buildup) {
        struck = true;
        c.dismiss(0.25); hand.dismiss(0.15);
        this.prog.addSkillXp('lightning');
        this.strike(ctx, target, radius, lvl === 3 ? 4.5 : lvl === 2 ? 3.2 : 3.4, true);
        if (strikes === 2) this.later(0.28, () => this.strike(ctx, target.clone().addScaledVector(ctx.facing, 2.5), radius * 0.8, 2.4, true));
        return false;
      }
      return true;
    } });
    return castTime;
  }

  private strike(ctx: SkillContext, p: THREE.Vector3, radius: number, mult: number, big: boolean) {
    const gold = 0xfff2a0, white = 0xffffff, blue = 0xbfe8ff;
    const cam = this.combat.camera;
    const top = p.clone().setY(p.y + 45);
    this.fx.lightning(top, p, white, 0.35, big ? 0.35 : 0.15, big ? 4 : 2);
    this.fx.lightning(top.clone().add(new THREE.Vector3(rand(-3, 3), 0, rand(-3, 3))), p, blue, 0.3, big ? 0.18 : 0.08, 2);
    this.fx.pillar(p, gold, radius * 0.5, 40, 0.5);
    this.fx.flash(p.clone().setY(p.y + 1.5), white, radius * 2, 0.22, cam);
    this.fx.shockwave(p, gold, radius * 2.4, 0.55);
    this.fx.shockwave(p, white, radius * 1.5, 0.35, { y: 0.12 });
    this.fx.burst(p.clone().setY(p.y + 0.6), white, radius * 0.7, 0.3);
    this.particles.emit({ pos: p.clone().setY(p.y + 0.5), count: big ? 60 : 20, velSpread: 16, velUp: 9, life: 0.7, lifeVar: 0.3, size: 0.16, color: [gold, white, blue], shape: Shape.SPARK, stretch: 1.4, gravity: 14, drag: 1.5 });
    this.particles.emit({ pos: p.clone().setY(p.y + 0.3), count: big ? 20 : 6, spread: radius * 0.4, velUp: 3, velSpread: 2, life: 1.5, size: 1.2, sizeEnd: 2.5, color: [0x8a8aa0, 0xd0d0e0], alpha: 0.5, shape: Shape.SMOKE, additive: false, rotSpeed: 2 });
    this.fx.groundMark(p, 0x1a1a22, radius * 1.1, 8);
    if (big) {
      this.post.flash(0.85, 0xfff8e0);
      this.post.chromaTarget = 0.02; this.later(0.14, () => (this.post.chromaTarget = 0));
      this.gcam.addTrauma(0.55);
      sfx('lightning', 1);
      this.time.hitstop(0.06);
    } else sfx('lightning', 0.35);
    this.combat.hit(ctx.combatant, 'enemy', p.clone().setY(p.y + 1), ctx.facing, this.spec(mult, 'lightning', radius, { knockback: 6, launch: big ? 7 : 3, stagger: 0.8, hitstop: big ? 0.08 : 0.03, critChance: this.prog.critChance + 0.15, skillId: 'lightning' }));
  }

  // ------------------------------------------------------------ PREDATOR
  private predator(ctx: SkillContext, lvl: number) {
    const color = 0x8a3cff, dark = 0x0a0214;
    const radius = lvl === 1 ? 3.2 : lvl === 2 ? 4.2 : 5;
    const threshold = lvl === 1 ? 0.35 : lvl === 2 ? 0.5 : 0.65;
    // target: nearest enemy within 7u, else ahead
    const near = this.combat.enemiesNear(ctx.pos, 7).sort((a, b) => a.pos.distanceTo(ctx.pos) - b.pos.distanceTo(ctx.pos));
    const center = near.length ? near[0].pos.clone() : ctx.pos.clone().addScaledVector(ctx.facing, 2.5);
    center.y = this.h(center.x, center.z);
    const c = this.circle({ color, radius: radius * 0.85, layers: 2, seed: 66 }, center.clone().setY(center.y + 0.08));
    this.castFlash(ctx, color);
    sfx('absorb');
    // vortex mesh: dark rotating torus + funnel
    const vortex = new THREE.Group();
    const torus = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.7, radius * 0.08, 8, 40), createGlowMaterial(color, 0.8));
    torus.rotation.x = Math.PI / 2;
    torus.position.y = 0.15;
    // inverted, translucent dark funnel (wide at the top) with glowing spiral rings
    const funnel = new THREE.Mesh(new THREE.ConeGeometry(radius * 0.75, 2.6, 32, 1, true), new THREE.MeshBasicMaterial({ color: dark, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false, blending: THREE.NormalBlending }));
    funnel.rotation.x = Math.PI;
    funnel.position.y = 1.4;
    vortex.add(torus, funnel);
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * (0.25 + i * 0.2), 0.04, 6, 32), createGlowMaterial(i === 1 ? 0xc39bff : color, 0.9));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.5 + i * 0.8;
      ring.name = 'ring';
      vortex.add(ring);
    }
    vortex.position.copy(center);
    vortex.scale.setScalar(0.01);
    vortex.renderOrder = 11;
    this.scene.add(vortex);
    const light = new THREE.PointLight(color, 10, radius * 4, 1.5);
    light.position.copy(center).add(new THREE.Vector3(0, 1.5, 0));
    this.scene.add(light);
    const dur = 1.3;
    let t = 0, tick = 0, done = false;
    const tickSpec = this.spec(0.35, 'dark', radius, { knockback: 0, stagger: 0.2, hitstop: 0, skillId: 'predator' });
    this.prog.addSkillXp('predator');
    this.list.push({ update: (dt) => {
      t += dt; tick += dt;
      const k = Math.min(1, t / 0.3);
      vortex.scale.setScalar(easeOutCubic(k) * (1 + Math.sin(t * 12) * 0.05));
      torus.rotation.z += dt * 8;
      funnel.rotation.y -= dt * 10;
      vortex.children.forEach((c, i) => { if (c.name === 'ring') { c.rotation.z += dt * (6 + i * 3) * (i % 2 ? -1 : 1); c.scale.setScalar(1 + Math.sin(t * 10 + i) * 0.12); } });
      light.intensity = 8 + Math.sin(t * 30) * 4;
      this.fx.absorbVortex(center, color, radius, 6);
      // pull enemies
      for (const e of this.combat.enemiesNear(center, radius * 1.3)) (e as any).pull?.(center, dt, 9);
      if (tick > 0.3) { tick = 0; this.combat.hit(ctx.combatant, 'enemy', center.clone().setY(center.y + 0.8), ctx.facing, tickSpec); }
      if (!done && t >= dur) {
        done = true;
        c.dismiss(0.2);
        // devour weakened enemies
        const victims = this.combat.enemiesNear(center, radius).filter((e) => e.hp / e.maxHp <= threshold && (e as any).devourable !== false);
        for (const v of victims) {
          (v as any).devour?.(ctx.pos);
          this.onDevour?.(v);
          if (lvl === 3) { this.prog.hp = Math.min(this.prog.maxHp, this.prog.hp + v.maxHp * 0.1); this.prog.mp = Math.min(this.prog.maxMp, this.prog.mp + 15); this.fx.healSparkles(ctx.pos, 0xc39bff, 16); }
        }
        if (victims.length) { sfx('absorbDone'); this.fx.burst(center.clone().setY(center.y + 0.8), color, radius, 0.4); this.time.slowmo(0.5, 0.35); }
        else this.fx.burst(center.clone().setY(center.y + 0.8), dark, radius * 0.6, 0.3, false);
        this.fx.shockwave(center, color, radius * 1.8, 0.4);
        this.scene.remove(vortex, light);
        torus.geometry.dispose(); funnel.geometry.dispose();
        return false;
      }
      return true;
    } });
    return 0.3;
  }

  // ------------------------------------------------------------ METEOR (ULTIMATE)
  private meteor(ctx: SkillContext, lvl: number) {
    const orange = 0xff9a3c, red = 0xff3a1a, gold = 0xffe0a0, white = 0xffffff;
    this.ultActive = true;
    this.ultChargeT = 0;
    const castTime = 2.4;
    const feet = this.circle({ color: orange, radius: 6, layers: 3, seed: 99, intensity: 1.3 }, ctx.pos.clone().setY(ctx.pos.y + 0.08));
    const target = ctx.aimPoint(16);
    target.y = this.h(target.x, target.z);
    const sky = this.circle({ color: red, radius: 26, layers: 3, seed: 100, intensity: 1.2 }, target.clone().setY(target.y + 55));
    sky.group.rotation.x = Math.PI / 2; // facing down
    const tgtCircle = this.circle({ color: gold, radius: 8, layers: 2, seed: 101 }, target.clone().setY(target.y + 0.1));
    sfx('meteorCharge');
    this.ultLight.position.copy(ctx.pos).add(new THREE.Vector3(0, 3, 0));
    let t = 0, phase = 0, fallT = 0;
    const meteorMesh = this.buildMeteor(lvl === 3 ? 3.4 : 2.6);
    meteorMesh.visible = false;
    this.scene.add(meteorMesh);
    const start = target.clone().add(new THREE.Vector3(-22, 70, -30));
    const fallDur = 1.05;
    const mini: { m: THREE.Group; from: THREE.Vector3; to: THREE.Vector3; t: number }[] = [];
    let miniSpawned = 0;
    this.list.push({ update: (dt) => {
      t += dt;
      this.ultFocus = phase === 0 ? (t > 1.0 ? sky.group.position : null) : phase === 1 ? meteorMesh.position : fallT < 1.0 ? target : null;
      if (phase === 0) {
        this.ultChargeT = t / castTime;
        this.stormRequest = Math.max(this.stormRequest, Math.min(0.75, t / castTime * 0.75));
        this.windRequest = Math.max(this.windRequest, 2.5 * Math.min(1, t / 0.8));
        this.tint.setRGB(1 + t * 0.06, 1 - t * 0.05, 1 - t * 0.12);
        this.ultLight.intensity = 20 * Math.min(1, t / 1.5) + Math.sin(t * 20) * 3;
        this.ultLight.position.copy(ctx.pos).add(new THREE.Vector3(0, 3, 0));
        feet.group.position.set(ctx.pos.x, this.h(ctx.pos.x, ctx.pos.z) + 0.08, ctx.pos.z);
        // particles flow upward toward the sky circle
        for (let i = 0; i < 4; i++) {
          const a = rand(0, Math.PI * 2), r = rand(2, 14);
          this.particles.emit({ pos: { x: ctx.pos.x + Math.cos(a) * r, y: ctx.pos.y + rand(0, 1), z: ctx.pos.z + Math.sin(a) * r }, count: 1, vel: { x: 0, y: rand(6, 14), z: 0 }, life: 1.6, size: 0.14, color: [orange, gold, white], shape: Shape.SPARK, stretch: 0.8 });
        }
        this.particles.emit({ pos: ctx.pos.clone().setY(ctx.pos.y + 0.6), count: 3, spread: 0.6, velUp: 3, life: 0.8, size: 0.4, sizeEnd: 0.2, color: [orange, red, gold], shape: Shape.FLAME });
        if (t > 0.6 && Math.random() < 0.3) this.fx.auraRing(ctx.root, orange, 1.6, 0.9);
        // tier 2+: mini meteors during charge
        if (lvl >= 2 && t > 1.2 && miniSpawned < 3 && t > 1.2 + miniSpawned * 0.35) {
          const a = rand(0, Math.PI * 2), r = rand(4, 9);
          const to = new THREE.Vector3(target.x + Math.cos(a) * r, 0, target.z + Math.sin(a) * r); to.y = this.h(to.x, to.z);
          const m = this.buildMeteor(0.9);
          this.scene.add(m);
          mini.push({ m, from: to.clone().add(new THREE.Vector3(-8, 40, -10)), to, t: 0 });
          miniSpawned++;
        }
        if (t >= castTime) {
          phase = 1; fallT = 0;
          feet.dismiss(0.4); tgtCircle.setIntensity(1.6);
          meteorMesh.visible = true;
          sfx('meteorFall');
          this.gcam.addTrauma(0.2);
        }
      } else if (phase === 1) {
        fallT += dt;
        const k = Math.min(1, fallT / fallDur);
        const e = easeInCubic(k);
        meteorMesh.position.lerpVectors(start, target, e);
        meteorMesh.rotation.x += dt * 4; meteorMesh.rotation.z += dt * 3;
        this.post.speedLinesTarget = 0.4 + k * 0.5;
        this.post.radialTarget = 0.02 + k * 0.05;
        this.post.u.uRadialCenter.value.set(0.5, 0.45);
        this.windRequest = 3;
        this.ultLight.position.copy(meteorMesh.position);
        this.ultLight.intensity = 40;
        // trail
        this.particles.emit({ pos: meteorMesh.position, count: 6, spread: 1.2, life: 0.8, size: 1.6, sizeEnd: 0.3, color: [orange, red, gold], shape: Shape.FLAME, vel: { x: 4, y: 12, z: 6 }, velSpread: 3 });
        this.particles.emit({ pos: meteorMesh.position, count: 4, spread: 1, life: 1.4, size: 1.2, sizeEnd: 3, color: [0x2a1a1a, 0x5a3a2a], alpha: 0.6, shape: Shape.SMOKE, additive: false, vel: { x: 2, y: 6, z: 3 } });
        this.particles.emit({ pos: meteorMesh.position, count: 3, spread: 1.5, life: 0.5, size: 0.2, color: [gold, white], shape: Shape.SPARK, stretch: 2, vel: { x: 6, y: 16, z: 8 }, velSpread: 4 });
        if (k >= 1) {
          phase = 2;
          this.impact(ctx, target, lvl);
          this.scene.remove(meteorMesh);
          sky.dismiss(0.6); tgtCircle.dismiss(0.3);
          this.post.speedLinesTarget = 0; this.post.radialTarget = 0;
        }
      } else {
        // aftermath
        fallT += dt;
        this.stormRequest = Math.max(this.stormRequest, 0.4 * (1 - fallT / 2));
        this.tint.lerp(new THREE.Color(1, 1, 1), dt * 2);
        this.ultLight.intensity = Math.max(0, this.ultLight.intensity - dt * 30);
        if (fallT > 1.6) { this.ultActive = false; this.ultFocus = null; this.onUltEnd?.(); this.tint.set(1, 1, 1); return false; }
      }
      // mini meteors
      for (let i = mini.length - 1; i >= 0; i--) {
        const mm = mini[i];
        mm.t += dt;
        const k = Math.min(1, mm.t / 0.7);
        mm.m.position.lerpVectors(mm.from, mm.to, easeInCubic(k));
        mm.m.rotation.x += dt * 6;
        this.particles.emit({ pos: mm.m.position, count: 2, spread: 0.4, life: 0.5, size: 0.7, sizeEnd: 0.2, color: [orange, red], shape: Shape.FLAME });
        if (k >= 1) {
          this.fx.explosion(mm.to, orange, red, 3.5, this.combat.camera);
          this.gcam.addTrauma(0.3);
          this.combat.hit(ctx.combatant, 'enemy', mm.to.clone().setY(mm.to.y + 0.8), ctx.facing, this.spec(3, 'meteor', 4, { knockback: 6, launch: 5, stagger: 0.6, hitstop: 0.04, skillId: 'meteor' }));
          this.scene.remove(mm.m);
          mini.splice(i, 1);
        }
      }
      return true;
    } });
    return castTime;
  }

  private buildMeteor(r: number) {
    const g = new THREE.Group();
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), new THREE.MeshBasicMaterial({ color: 0x1a0a08 }));
    const pos = rock.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) { const k = 1 + (Math.random() - 0.5) * 0.35; pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k); }
    rock.geometry.computeVertexNormals();
    const glow = new THREE.Mesh(new THREE.SphereGeometry(r * 1.25, 20, 14), createGlowMaterial(0xff7a2a, 0.55));
    const glow2 = new THREE.Mesh(new THREE.SphereGeometry(r * 1.6, 20, 14), createGlowMaterial(0xff3a1a, 0.25));
    const cracks = new THREE.Mesh(new THREE.IcosahedronGeometry(r * 0.98, 1), new THREE.MeshBasicMaterial({ color: 0xffb040, wireframe: true, transparent: true, opacity: 0.9 }));
    g.add(rock, glow, glow2, cracks);
    return g;
  }

  private impact(ctx: SkillContext, p: THREE.Vector3, lvl: number) {
    const orange = 0xff9a3c, red = 0xff3a1a, gold = 0xffe0a0, white = 0xffffff;
    const cam = this.combat.camera;
    const radius = lvl === 3 ? 14 : 11;
    this.time.slowmo(0.55, 0.12);
    this.post.impactFrame(1);
    this.post.flash(1, 0xfff0d0);
    this.post.chromaTarget = 0.035; this.later(0.4, () => (this.post.chromaTarget = 0));
    this.gcam.addTrauma(1);
    sfx('explosion', 1.3);
    sfx('shockwave', 1);
    this.later(0.12, () => sfx('explosion', 0.6));
    this.fx.explosion(p, orange, red, radius * 0.8, cam);
    this.fx.burst(p.clone().setY(p.y + 2), white, radius * 1.2, 0.5);
    this.fx.burst(p.clone().setY(p.y + 1), gold, radius * 1.6, 0.8);
    this.fx.shockwave(p, white, radius * 3.5, 1.0);
    this.fx.shockwave(p, orange, radius * 2.8, 0.8, { y: 0.3 });
    this.fx.shockwave(p, red, radius * 2.2, 0.6, { y: 0.5 });
    this.fx.pillar(p, gold, radius * 0.4, 60, 0.9);
    // debris
    this.particles.emit({ pos: p.clone().setY(p.y + 0.5), count: 80, velSpread: 30, velUp: 20, life: 1.6, lifeVar: 0.5, size: 0.35, sizeVar: 0.2, color: [0x2a1a10, 0x4a2a1a, orange], shape: Shape.DOT, gravity: 22, drag: 0.6, additive: false, rotSpeed: 6 });
    this.particles.emit({ pos: p.clone().setY(p.y + 0.5), count: 120, velSpread: 34, velUp: 16, life: 1.2, lifeVar: 0.4, size: 0.25, color: [gold, orange, white], shape: Shape.SPARK, stretch: 1.6, gravity: 16, drag: 1 });
    this.particles.emit({ pos: p.clone().setY(p.y + 2), count: 50, spread: radius * 0.3, velSpread: 8, velUp: 6, life: 3, lifeVar: 1, size: 3, sizeVar: 1, sizeEnd: 3, color: [0x1a0a08, 0x3a1a10, 0x2a1a1a], alpha: 0.75, shape: Shape.SMOKE, additive: false, rotSpeed: 1.5, gravity: -1.5, drag: 1 });
    this.fx.groundMark(p, 0x2a1a14, radius * 0.75, 14);
    this.combat.hit(ctx.combatant, 'enemy', p.clone().setY(p.y + 1), ctx.facing, this.spec(lvl === 3 ? 14 : 10, 'meteor', radius, { knockback: 14, launch: 10, stagger: 1.5, hitstop: 0.12, critChance: this.prog.critChance + 0.25, critMult: 2, skillId: 'meteor' }));
    this.prog.addSkillXp('meteor');
    // lingering firestorm
    const light = new THREE.PointLight(orange, 30, radius * 4, 1.2);
    light.position.copy(p).add(new THREE.Vector3(0, 3, 0));
    this.scene.add(light);
    let t = 0, tick = 0;
    const dur = lvl === 3 ? 7 : 4.5;
    const tickSpec = this.spec(0.9, 'fire', radius * 0.8, { knockback: 1, stagger: 0.2, hitstop: 0, skillId: 'meteor' });
    this.list.push({ update: (dt) => {
      t += dt; tick += dt;
      const life = 1 - t / dur;
      light.intensity = (16 + Math.sin(t * 15) * 6) * life;
      for (let i = 0; i < 4; i++) {
        const a = rand(0, Math.PI * 2), r = rand(0, radius * 0.9);
        this.particles.emit({ pos: { x: p.x + Math.cos(a) * r, y: p.y + 0.1, z: p.z + Math.sin(a) * r }, count: 1, velUp: rand(2, 5), life: 0.7, size: rand(0.6, 1.4) * life, sizeEnd: 0.3, color: [red, orange, gold], shape: Shape.FLAME, drag: 1 });
      }
      if (Math.random() < 0.4) this.particles.emit({ pos: { x: p.x + rand(-radius, radius) * 0.6, y: p.y + 1, z: p.z + rand(-radius, radius) * 0.6 }, count: 1, velUp: 2, life: 2.5, size: 1.5, sizeEnd: 3, color: [0x1a0a08], alpha: 0.5, shape: Shape.SMOKE, additive: false, rotSpeed: 1 });
      if (tick > 0.5) { tick = 0; this.combat.hit(ctx.combatant, 'enemy', p.clone().setY(p.y + 0.8), ctx.facing, tickSpec); }
      if (t >= dur) { this.scene.remove(light); return false; }
      return true;
    } });
  }

  update(dt: number) {
    this.stormRequest = Math.max(0, this.stormRequest - dt * 0.6);
    this.windRequest = Math.max(0, this.windRequest - dt * 2);
    this.castLight.intensity = Math.max(0, this.castLight.intensity - dt * 20);
    for (let i = this.list.length - 1; i >= 0; i--) if (!this.list[i].update(dt)) this.list.splice(i, 1);
    for (let i = this.circles.length - 1; i >= 0; i--) { const c = this.circles[i]; c.update(dt); if (c.dead) { c.dispose(); this.circles.splice(i, 1); } }
  }
}

function crescentGeo(radius = 1, thickness = 0.35, arc = Math.PI * 1.1, segs = 24) {
  const shape = new THREE.Shape();
  const a0 = -arc / 2, a1 = arc / 2;
  for (let i = 0; i <= segs; i++) { const a = a0 + (a1 - a0) * (i / segs); const w = Math.sin((i / segs) * Math.PI) * thickness; const r = radius + w * 0.5; if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r); else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
  for (let i = segs; i >= 0; i--) { const a = a0 + (a1 - a0) * (i / segs); const w = Math.sin((i / segs) * Math.PI) * thickness; const r = radius - w * 0.5; shape.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
  return new THREE.ShapeGeometry(shape, 2);
}

export { globalUniforms };
