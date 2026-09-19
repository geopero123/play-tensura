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

/** pick a per-tier value; tiers are 1-based */
const T = <V>(lvl: number, vals: V[]) => vals[Math.min(vals.length, Math.max(1, lvl)) - 1];
const UP = new THREE.Vector3(0, 1, 0);

/** Implements the seven spells with layered anime presentation. Every spell scales across five evolution tiers. */
export class SkillSystem {
  private list: Active[] = [];
  private circles: MagicCircle[] = [];
  /** requests read by the game each frame */
  stormRequest = 0;
  windRequest = 0;
  /** 0..1 Megiddo: sun swell + sky wash */
  sunRequest = 0;
  /** 0..1 Megiddo: the world drops to night so only light constructs show */
  nightRequest = 0;
  /** true while an ultimate wants the caster to hold still (no idle spin) */
  ultHold = false;
  tint = new THREE.Color(1, 1, 1);
  ultActive = false;
  ultChargeT = 0;
  /** world position the camera should frame during an ultimate, or null */
  ultFocus: THREE.Vector3 | null = null;
  onCastStart: ((id: SkillId, castTime: number, ultimate: boolean) => void) | null = null;
  onUltEnd: (() => void) | null = null;
  /** devoured callback: enemy kind */
  onDevour: ((c: Combatant) => void) | null = null;
  /** presentation cues wired by the game: anime technique name card, and letterbox bars */
  onTechnique: ((name: string, sub: string, color: string) => void) | null = null;
  onBars: ((on: boolean) => void) | null = null;
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
      case 'megiddo': castTime = this.megiddo(ctx, lvl); break;
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

  /** nearest living enemies to a point, optionally excluding ids */
  private nearest(p: THREE.Vector3, range: number, exclude?: Set<number>) {
    return this.combat.enemies().filter((e) => (!exclude || !exclude.has(e.id)) && e.pos.distanceTo(p) < range).sort((a, b) => a.pos.distanceTo(p) - b.pos.distanceTo(p));
  }

  // ------------------------------------------------------------ WATER BLADE
  private waterBlade(ctx: SkillContext, lvl: number) {
    const color = 0x7fd8ff;
    const c = this.circle({ color, radius: T(lvl, [0.9, 0.9, 1.1, 1.2, 1.5]), layers: lvl >= 4 ? 2 : 1, vertical: true, seed: 5 }, ctx.pos.clone().add(new THREE.Vector3(0, 0.75, 0)).addScaledVector(ctx.facing, 0.9));
    c.group.lookAt(c.group.position.clone().add(ctx.facing));
    this.castFlash(ctx, color);
    sfx('water');
    // water spiral around body
    const spiral = lvl >= 4 ? 26 : 18;
    for (let i = 0; i < spiral; i++) {
      const a = (i / spiral) * Math.PI * 2;
      this.particles.emit({ pos: { x: ctx.pos.x + Math.cos(a) * 0.9, y: ctx.pos.y + 0.2 + i * 0.05, z: ctx.pos.z + Math.sin(a) * 0.9 }, count: 1, life: 0.45, size: 0.14, color: [color, 0xffffff], shape: Shape.GLOW, orbit: 12, vel: { x: 0, y: 1.5, z: 0 } });
    }
    if (lvl >= 5) this.fx.shockwave(ctx.pos, color, 3, 0.4, { y: 0.15 });
    const castTime = 0.22;
    const count = lvl;
    const scale = T(lvl, [1, 1.15, 1.7, 1.9, 2.3]);
    const mult = T(lvl, [1.7, 1.5, 2.0, 2.2, 2.6]);
    const launchAt = this.time.elapsed + castTime;
    let launched = false;
    this.list.push({ update: () => {
      if (!launched && this.time.elapsed >= launchAt) {
        launched = true;
        c.dismiss(0.15);
        for (let i = 0; i < count; i++) {
          const ang = count === 1 ? 0 : (i - (count - 1) / 2) * (count >= 4 ? 0.16 : 0.22);
          const dir = ctx.facing.clone().applyAxisAngle(UP, ang);
          if (ctx.target) { const tp = ctx.target.pos.clone().sub(ctx.pos).setY(0).normalize(); dir.lerp(tp, 0.8).normalize().applyAxisAngle(UP, ang); }
          this.spawnBlade(ctx, dir, scale, mult, i * 0.05, lvl);
        }
        this.prog.addSkillXp('waterBlade');
        sfx('slash', 0.8);
        if (lvl >= 3) sfx('water', 0.6);
      }
      return !launched;
    } });
    return castTime;
  }

  private spawnBlade(ctx: SkillContext, dir: THREE.Vector3, scale: number, mult: number, delay: number, lvl: number) {
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
    let bounces = lvl >= 5 ? 2 : 0;
    let life = T(lvl, [1.4, 1.4, 1.4, 1.5, 2.2]);
    const d = dir.clone();
    const spec = this.spec(mult, 'water', 1.2 * scale, { knockback: 4, stagger: 0.4, launch: lvl >= 4 ? 6 : 0, skillId: 'waterBlade' });
    const spin = rand(-8, 8);
    this.list.push({ update: (dt) => {
      t += dt;
      if (t < 0) return true;
      g.position.addScaledVector(d, speed * dt);
      g.rotateZ(spin * dt);
      const pulse = 1 + Math.sin(t * 40) * 0.08;
      g.scale.setScalar(scale * pulse);
      // trail
      this.particles.emit({ pos: g.position, count: 2, spread: 0.3 * scale, life: 0.35, size: 0.16 * scale, color: [color, 0xffffff, 0x2f7fe0], shape: Shape.GLOW, vel: { x: -d.x * 2, y: 0.5, z: -d.z * 2 }, velSpread: 1, gravity: 4 });
      this.particles.emit({ pos: g.position, count: 1, life: 0.3, size: 0.9 * scale, sizeEnd: 1.6, color: [color], alpha: 0.35, shape: Shape.RING });
      const hits = this.combat.hit(ctx.combatant, 'enemy', g.position, d, spec, hitSet);
      for (const hh of hits) {
        const hp = hh.pos.clone().setY(hh.pos.y + hh.height * 0.5);
        this.fx.slash(hp, d, color, 1.6 * scale, 0.25, { wide: true });
        this.particles.emit({ pos: hp, count: 18, velSpread: 6, velUp: 3, life: 0.6, size: 0.14, color: [color, 0xffffff], shape: Shape.DOT, gravity: 12, drag: 1 });
        this.fx.groundMark(hh.pos, 0x3a7fc8, 1.6 * scale, 5);
        sfx('waterHit', 0.9);
        // tier 4+: geyser erupts under the target and launches it
        if (lvl >= 4) {
          this.fx.pillar(hh.pos, 0x9fe8ff, 0.7 * scale, 7, 0.45);
          this.fx.shockwave(hh.pos, color, 3 * scale, 0.4, { y: 0.1 });
          this.particles.emit({ pos: hh.pos.clone().setY(hh.pos.y + 0.2), count: 22, spread: 0.5, velUp: 12, velSpread: 3, life: 0.9, size: 0.2, color: [color, 0xffffff, 0x2f7fe0], shape: Shape.DOT, gravity: 18, drag: 0.5 });
          sfx('water', 0.5);
        }
        // tier 5: ricochet toward the next enemy
        if (bounces > 0) {
          const next = this.nearest(g.position, 16, hitSet)[0];
          if (next) {
            bounces--;
            d.copy(next.pos).sub(g.position).setY(0).normalize();
            g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d);
            life = Math.max(life, t + 0.8);
            this.fx.flash(hp, 0xffffff, 1.2 * scale, 0.15, this.combat.camera);
          }
        }
      }
      // tier 5: surging water wake along the ground
      if (lvl >= 5 && Math.random() < 0.5) this.particles.emit({ pos: { x: g.position.x, y: this.h(g.position.x, g.position.z) + 0.1, z: g.position.z }, count: 1, spread: 0.8, life: 0.5, size: 1.2, sizeEnd: 2.4, color: [color], alpha: 0.3, shape: Shape.RING });
      const gy = this.h(g.position.x, g.position.z);
      if (g.position.y < gy + 0.1) g.position.y = gy + 0.1;
      const alive = t < life;
      if (!alive) { this.scene.remove(g); geo.dispose(); }
      return alive;
    } });
  }

  // ------------------------------------------------------------ BLACK FLAME
  private blackFlame(ctx: SkillContext, lvl: number) {
    const color = 0x9a3cff;
    const c = this.circle({ color, radius: T(lvl, [1.5, 1.5, 1.8, 2.0, 2.4]), layers: lvl >= 4 ? 3 : 2, seed: 17 }, ctx.pos.clone().setY(ctx.pos.y + 0.06));
    this.castFlash(ctx, color);
    sfx('fire');
    this.fx.orbitOrbs(ctx.root, color, lvl >= 4 ? 9 : 6, 0.5, 1.1, 0.7);
    const castTime = lvl >= 5 ? 0.55 : 0.42;
    const target = ctx.aimPoint(11);
    target.y = this.h(target.x, target.z);
    const radius = T(lvl, [3.4, 4.4, 5.2, 5.8, 6.5]);
    const fireAt = this.time.elapsed + castTime;
    let fired = false;
    // telegraph ring at target for the player to read
    this.fx.shockwave(target, color, radius * 0.9, castTime + 0.05, { y: 0.1 });
    // tier 5: a void sphere collapses over the target before the eclipse
    let eclipse: THREE.Mesh | null = null;
    if (lvl >= 5) {
      eclipse = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: 0x08010f, transparent: true, opacity: 0.85, depthWrite: false }));
      eclipse.position.copy(target).setY(target.y + 2.5);
      eclipse.scale.setScalar(radius * 0.9);
      eclipse.renderOrder = 11;
      this.scene.add(eclipse);
    }
    let t = 0;
    this.list.push({ update: (dt) => {
      t += dt;
      if (eclipse) { const k = Math.min(1, t / castTime); eclipse.scale.setScalar(lerp(radius * 0.9, 0.3, easeInCubic(k))); if (Math.random() < 0.7) this.particles.emit({ pos: eclipse.position, count: 2, spread: radius * 0.8, life: 0.4, size: 0.16, color: [0xd070ff, color], shape: Shape.GLOW, orbit: 14 }); }
      if (!fired && this.time.elapsed >= fireAt) {
        fired = true;
        c.dismiss(0.2);
        if (eclipse) { this.scene.remove(eclipse); eclipse.geometry.dispose(); }
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
    if (lvl >= 3) {
      this.fx.pillar(target, 0x6a1ad0, radius * 0.6, lvl >= 5 ? 24 : 16, 0.8);
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
    const mult = T(lvl, [2.2, 2.5, 3.6, 4.0, 5.0]);
    this.combat.hit(ctx.combatant, 'enemy', target.clone().setY(target.y + 1), ctx.facing, this.spec(mult, 'fire', radius, { knockback: 5, launch: lvl >= 3 ? 6 : 2, stagger: 0.6, hitstop: 0.06, skillId: 'blackFlame' }));
    // tier 4+: three cinder satellites detonate around the pillar
    if (lvl >= 4) {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + rand(-0.3, 0.3);
        const p = new THREE.Vector3(target.x + Math.cos(a) * radius * 0.85, 0, target.z + Math.sin(a) * radius * 0.85); p.y = this.h(p.x, p.z);
        this.later(0.3 + i * 0.22, () => {
          this.fx.burst(p.clone().setY(p.y + 0.8), 0x5a1aa0, radius * 0.4, 0.35);
          this.fx.shockwave(p, edge, radius * 0.9, 0.4);
          this.fx.pillar(p, 0x6a1ad0, radius * 0.18, 8, 0.4);
          this.particles.emit({ pos: p.clone().setY(p.y + 0.3), count: 16, velSpread: 6, velUp: 5, life: 0.7, size: 0.5, sizeEnd: 0.2, color: [dark, color, edge], shape: Shape.FLAME, drag: 1.5 });
          sfx('fireHit', 0.6);
          this.combat.hit(ctx.combatant, 'enemy', p.clone().setY(p.y + 0.8), ctx.facing, this.spec(1.4, 'fire', radius * 0.5, { knockback: 4, launch: 3, stagger: 0.4, skillId: 'blackFlame' }));
        });
      }
    }
    // tier 5: the eclipse detonates a second time, wider
    if (lvl >= 5) {
      this.later(0.95, () => {
        const r2 = radius * 1.4;
        this.fx.burst(target.clone().setY(target.y + 1.5), 0x08010f, r2 * 0.8, 0.5, false);
        this.fx.burst(target.clone().setY(target.y + 1.5), edge, r2 * 0.9, 0.45);
        this.fx.shockwave(target, 0xffffff, r2 * 2.2, 0.7);
        this.fx.shockwave(target, edge, r2 * 1.8, 0.6, { y: 0.4 });
        this.fx.flash(target.clone().setY(target.y + 2), 0xffffff, r2, 0.18, cam);
        this.post.impactFrame(0.5);
        this.post.flash(0.5, 0xd0a0ff);
        this.gcam.addTrauma(0.6);
        this.time.hitstop(0.05);
        sfx('explosion', 1.0);
        this.particles.emit({ pos: target.clone().setY(target.y + 0.5), count: 50, velSpread: 12, velUp: 9, life: 1.0, size: 0.18, color: [edge, 0xffffff, color], shape: Shape.SPARK, stretch: 1.6, gravity: 10, drag: 1 });
        this.combat.hit(ctx.combatant, 'enemy', target.clone().setY(target.y + 1), ctx.facing, this.spec(3.2, 'fire', r2, { knockback: 8, launch: 7, stagger: 0.9, hitstop: 0.08, skillId: 'blackFlame' }));
      });
    }
    // lingering zone
    const light = new THREE.PointLight(color, 14, radius * 4, 1.4);
    light.position.copy(target).add(new THREE.Vector3(0, 1.5, 0));
    this.scene.add(light);
    this.fx.groundMark(target, 0x1a0525, radius * 1.2, 5.5);
    const dur = T(lvl, [4, 5, 6, 7, 8]);
    let t = 0, tick = 0;
    const center = target.clone();
    const tickSpec = this.spec(T(lvl, [0.45, 0.45, 0.7, 0.85, 1.1]), 'fire', radius * 0.9, { knockback: 0.5, stagger: 0.15, hitstop: 0, skillId: 'blackFlame' });
    // tier 5: a slowly rotating eclipse halo over the zone
    let halo: THREE.Mesh | null = null;
    if (lvl >= 5) {
      halo = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.9, 0.12, 6, 48), createGlowMaterial(edge, 0.8));
      halo.rotation.x = Math.PI / 2; halo.position.copy(center).setY(center.y + 2.2); halo.renderOrder = 12;
      this.scene.add(halo);
    }
    this.list.push({ update: (dt) => {
      t += dt; tick += dt;
      const life = 1 - t / dur;
      light.intensity = (10 + Math.sin(t * 20) * 3) * life;
      // flames chase enemies (tier 2+)
      if (lvl >= 2) {
        const near = this.combat.enemiesNear(center, radius * 2.5);
        if (near.length) { const e = near[0]; center.x = lerp(center.x, e.pos.x, dt * 1.2); center.z = lerp(center.z, e.pos.z, dt * 1.2); center.y = this.h(center.x, center.z); light.position.set(center.x, center.y + 1.5, center.z); }
      }
      if (halo) { halo.position.set(center.x, center.y + 2.2 + Math.sin(t * 2) * 0.3, center.z); halo.rotation.z += dt * 1.5; (halo.material as THREE.MeshBasicMaterial).opacity = 0.8 * life; }
      // flame particles
      for (let i = 0; i < 3; i++) {
        const a = rand(0, Math.PI * 2), r = rand(0, radius * 0.8);
        this.particles.emit({ pos: { x: center.x + Math.cos(a) * r, y: center.y + 0.1, z: center.z + Math.sin(a) * r }, count: 1, velUp: rand(1.5, 3.5), life: 0.6, lifeVar: 0.2, size: rand(0.5, 1.0) * life, sizeEnd: 0.3, color: [dark, 0x2a0a4a, color, edge], shape: Shape.FLAME, drag: 1 });
      }
      if (Math.random() < 0.5) this.particles.emit({ pos: { x: center.x + rand(-radius, radius) * 0.7, y: center.y + 0.5, z: center.z + rand(-radius, radius) * 0.7 }, count: 1, velUp: 2, life: 0.8, size: 0.08, color: [edge, 0xffffff], shape: Shape.SPARK, stretch: 0.8, gravity: -1 });
      if (Math.random() < 0.25) this.particles.emit({ pos: { x: center.x, y: center.y + 1.5, z: center.z }, count: 1, spread: radius * 0.5, velUp: 1.5, life: 2, size: 1.2, sizeEnd: 2.5, color: [0x0a0212], alpha: 0.5, shape: Shape.SMOKE, additive: false, rotSpeed: 1 });
      if (tick > 0.5) { tick = 0; this.combat.hit(ctx.combatant, 'enemy', center.clone().setY(center.y + 0.8), ctx.facing, tickSpec); }
      if (t >= dur) { this.scene.remove(light); if (halo) { this.scene.remove(halo); halo.geometry.dispose(); } return false; }
      return true;
    } });
  }

  // ------------------------------------------------------------ WIND CUTTER
  private windCutter(ctx: SkillContext, lvl: number) {
    const color = 0xbfffe0;
    this.castFlash(ctx, 0x9fffd0);
    sfx('wind');
    const count = T(lvl, [3, 6, 12, 16, 20]);
    const mult = T(lvl, [0.9, 0.85, 0.8, 0.75, 0.7]);
    const castTime = 0.16;
    this.fx.shockwave(ctx.pos.clone(), color, 2.5, 0.3, { y: 0.6 });
    this.particles.emit({ pos: ctx.pos.clone().setY(ctx.pos.y + 0.6), count: 20, velSpread: 6, life: 0.4, size: 0.12, color: [color, 0xffffff], shape: Shape.SPARK, stretch: 1.4, drag: 3 });
    this.prog.addSkillXp('windCutter');
    const enemies = this.nearest(ctx.pos, 26);
    for (let i = 0; i < count; i++) {
      const delay = castTime + i * (lvl >= 3 ? 0.05 : 0.08);
      const target = ctx.target && ctx.target.alive ? (i % 2 === 0 || enemies.length < 2 ? ctx.target : enemies[i % enemies.length]) : enemies.length ? enemies[i % enemies.length] : null;
      this.spawnWindSlash(ctx, target, delay, mult, lvl, i);
    }
    // tier 5: a vacuum cyclone forms at the target point and drags enemies together
    if (lvl >= 5) {
      const center = ctx.target && ctx.target.alive ? ctx.target.pos.clone() : enemies.length ? enemies[0].pos.clone() : ctx.aimPoint(10);
      center.y = this.h(center.x, center.z);
      this.later(0.3, () => this.cyclone(ctx, center, 2.2, 5.5));
    }
    return castTime;
  }

  private cyclone(ctx: SkillContext, center: THREE.Vector3, dur: number, radius: number) {
    const color = 0xbfffe0;
    const g = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * (0.25 + i * 0.22), 0.05, 6, 32), createGlowMaterial(i % 2 ? 0xffffff : color, 0.7));
      ring.rotation.x = Math.PI / 2; ring.position.y = 0.4 + i * 1.1; ring.name = 'r';
      g.add(ring);
    }
    g.position.copy(center); g.scale.setScalar(0.01); g.renderOrder = 11;
    this.scene.add(g);
    sfx('wind', 0.8);
    let t = 0, tick = 0;
    const tickSpec = this.spec(0.4, 'wind', radius, { knockback: 0, stagger: 0.25, hitstop: 0, skillId: 'windCutter' });
    this.list.push({ update: (dt) => {
      t += dt; tick += dt;
      const k = Math.min(1, t / 0.3), out = t > dur - 0.3 ? (dur - t) / 0.3 : 1;
      g.scale.setScalar(easeOutCubic(k) * Math.max(0.01, out));
      g.children.forEach((c, i) => { c.rotation.z += dt * (8 + i * 2) * (i % 2 ? -1 : 1); });
      for (const e of this.combat.enemiesNear(center, radius * 1.6)) (e as any).pull?.(center, dt, 8);
      for (let i = 0; i < 3; i++) { const a = rand(0, Math.PI * 2), r = rand(0.5, radius); this.particles.emit({ pos: { x: center.x + Math.cos(a) * r, y: center.y + rand(0, 3), z: center.z + Math.sin(a) * r }, count: 1, life: 0.5, size: 0.1, color: [color, 0xffffff], shape: Shape.SPARK, stretch: 1.2, orbit: 12, vel: { x: 0, y: 3, z: 0 } }); }
      if (tick > 0.3) { tick = 0; this.combat.hit(ctx.combatant, 'enemy', center.clone().setY(center.y + 1), ctx.facing, tickSpec); }
      if (t >= dur) {
        this.scene.remove(g); g.children.forEach((c) => (c as THREE.Mesh).geometry.dispose());
        this.fx.shockwave(center, 0xffffff, radius * 2, 0.5);
        this.combat.hit(ctx.combatant, 'enemy', center.clone().setY(center.y + 1), ctx.facing, this.spec(1.8, 'wind', radius, { knockback: 6, launch: 8, stagger: 0.6, skillId: 'windCutter' }));
        sfx('windHit', 1);
        return false;
      }
      return true;
    } });
  }

  private spawnWindSlash(ctx: SkillContext, target: Combatant | null, delay: number, mult: number, lvl: number, index: number) {
    const color = 0xcfffe8;
    const geo = crescentGeo(0.6, 0.1, Math.PI * 0.9);
    const m = new THREE.Mesh(geo, createGlowMaterial(color, 0.85));
    m.renderOrder = 12;
    const side = index % 2 === 0 ? 1 : -1;
    const ang = (index / 3) * 0.6 * side + rand(-0.2, 0.2);
    const startDir = ctx.facing.clone().applyAxisAngle(UP, ang);
    const pos = ctx.pos.clone().add(new THREE.Vector3(0, 0.6 + rand(0, 0.8), 0)).addScaledVector(startDir, 0.5).addScaledVector(new THREE.Vector3(-startDir.z, 0, startDir.x), side * rand(0.3, 0.9));
    m.position.copy(pos);
    this.scene.add(m);
    m.visible = false;
    const dir = startDir.clone();
    let t = -delay;
    const hitSet = new Set<number>();
    const pierce = lvl >= 4;
    const spec = this.spec(mult, 'wind', 0.9, { knockback: 2, stagger: lvl >= 2 ? 0.55 : 0.3, launch: lvl >= 3 ? 5 : 0, hitstop: 0.03, skillId: 'windCutter' });
    let life = 0;
    let cur: Combatant | null = target;
    this.list.push({ update: (dt) => {
      t += dt;
      if (t < 0) return true;
      m.visible = true;
      life += dt;
      const speed = 34;
      if (cur && cur.alive) {
        const to = cur.pos.clone().setY(cur.pos.y + cur.height * 0.5).sub(m.position);
        const d = to.length();
        to.normalize();
        // homing: sharp turn
        dir.lerp(to, Math.min(1, dt * (life < 0.15 ? 4 : 14))).normalize();
        if (d < 1.2 && !hitSet.has(cur.id)) {
          const hits = this.combat.hit(ctx.combatant, 'enemy', m.position, dir, spec, hitSet);
          if (hits.length) {
            for (const hh of hits) { this.fx.slash(hh.pos.clone().setY(hh.pos.y + hh.height * 0.5), dir, color, 1.2, 0.18, { tilt: rand(-1, 1) }); sfx('windHit', 0.7); }
            if (!pierce) { this.scene.remove(m); geo.dispose(); return false; }
            // tier 4+: pass through and seek the next enemy
            cur = this.nearest(m.position, 18, hitSet)[0] ?? null;
            life = Math.min(life, 0.9);
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
    const radius = T(lvl, [4.2, 4.2, 5.5, 5.5, 6.5]);
    const c = this.circle({ color: gold, radius: radius * 0.8, layers: lvl >= 5 ? 4 : 3, seed: 41, intensity: 1.2 }, target.clone().setY(target.y + 0.1));
    const hand = this.circle({ color: blue, radius: 0.7, layers: 1, vertical: true, seed: 42 }, ctx.pos.clone().add(new THREE.Vector3(0, 1.0, 0)).addScaledVector(ctx.facing, 0.7));
    hand.group.lookAt(hand.group.position.clone().add(ctx.facing));
    this.castFlash(ctx, blue);
    sfx('lightningCharge');
    const castTime = 0.55;
    const buildup = T(lvl, [0.95, 0.95, 1.35, 1.35, 1.6]);
    const ringN = T(lvl, [0, 0, 6, 6, 8]);
    let t = 0, arcT = 0, struck = false, ringIdx = 0;
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
      if (ringN && t > buildup * 0.45 && ringIdx < ringN && t > buildup * 0.45 + ringIdx * (lvl >= 5 ? 0.09 : 0.12)) {
        const a = (ringIdx / ringN) * Math.PI * 2;
        const p = new THREE.Vector3(target.x + Math.cos(a) * radius * 0.9, target.y, target.z + Math.sin(a) * radius * 0.9);
        this.strike(ctx, p, 1.6, 0.9, false);
        ringIdx++;
      }
      if (!struck && t >= buildup) {
        struck = true;
        c.dismiss(0.25); hand.dismiss(0.15);
        this.prog.addSkillXp('lightning');
        const mainMult = T(lvl, [3.4, 3.2, 4.5, 4.5, 6]);
        this.strike(ctx, target, radius, mainMult, true, lvl >= 5);
        if (lvl === 2) this.later(0.28, () => this.strike(ctx, target.clone().addScaledVector(ctx.facing, 2.5), radius * 0.8, 2.4, true));
        // tier 4+: judgment chains between enemies
        if (lvl >= 4) this.chainJudgment(ctx, target, T(lvl, [0, 0, 0, 4, 5]));
        return false;
      }
      return true;
    } });
    return castTime;
  }

  private chainJudgment(ctx: SkillContext, from: THREE.Vector3, hops: number) {
    const hit = new Set<number>();
    const gold = 0xfff2a0, blue = 0xbfe8ff;
    const step = (prev: THREE.Vector3, n: number) => {
      if (n <= 0) return;
      const next = this.nearest(prev, 16, hit)[0];
      if (!next) return;
      hit.add(next.id);
      this.later(0.18, () => {
        const p = next.pos.clone().setY(this.h(next.pos.x, next.pos.z));
        this.fx.lightning(prev.clone().setY(prev.y + 1.5), p.clone().setY(p.y + 1), blue, 0.3, 0.12, 2);
        this.fx.lightning(prev.clone().setY(prev.y + 2), p.clone().setY(p.y + 1.2), gold, 0.25, 0.06, 1);
        this.strike(ctx, p, 2.8, 2.6, false);
        step(p, n - 1);
      });
    };
    step(from, hops);
  }

  private strike(ctx: SkillContext, p: THREE.Vector3, radius: number, mult: number, big: boolean, verdict = false) {
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
    // tier 5: a pillar of white judgment lingers and stuns
    if (verdict) {
      this.fx.pillar(p, white, radius * 0.35, 90, 1.3, { fadeIn: 0.1 });
      this.fx.pillar(p, gold, radius * 0.6, 70, 1.0);
      this.fx.shockwave(p, white, radius * 4, 1.0, { y: 0.2 });
      this.post.impactFrame(0.6);
      this.gcam.addTrauma(0.3);
      this.later(0.1, () => sfx('lightning', 0.8));
    }
    this.combat.hit(ctx.combatant, 'enemy', p.clone().setY(p.y + 1), ctx.facing, this.spec(mult, 'lightning', radius, { knockback: 6, launch: big ? 7 : 3, stagger: verdict ? 2.2 : 0.8, hitstop: big ? 0.08 : 0.03, critChance: this.prog.critChance + 0.15, skillId: 'lightning' }));
  }

  // ------------------------------------------------------------ PREDATOR
  private predator(ctx: SkillContext, lvl: number) {
    const color = 0x8a3cff, dark = 0x0a0214;
    const radius = T(lvl, [3.2, 4.2, 5, 5.6, 6.2]);
    const threshold = T(lvl, [0.35, 0.5, 0.65, 0.8, 0.95]);
    // target: nearest enemy within 7u, else ahead
    const near = this.nearest(ctx.pos, 7);
    const center = near.length ? near[0].pos.clone() : ctx.pos.clone().addScaledVector(ctx.facing, 2.5);
    center.y = this.h(center.x, center.z);
    const c = this.circle({ color, radius: radius * 0.85, layers: lvl >= 4 ? 3 : 2, seed: 66 }, center.clone().setY(center.y + 0.08));
    this.castFlash(ctx, color);
    sfx('absorb');
    // vortex mesh: dark rotating torus + funnel
    const vortex = new THREE.Group();
    const torus = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.7, radius * 0.08, 8, 40), createGlowMaterial(color, 0.8));
    torus.rotation.x = Math.PI / 2;
    torus.position.y = 0.15;
    // inverted, translucent dark funnel (wide at the top) with glowing spiral rings
    const funnel = new THREE.Mesh(new THREE.ConeGeometry(radius * 0.75, lvl >= 4 ? 3.4 : 2.6, 32, 1, true), new THREE.MeshBasicMaterial({ color: dark, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false, blending: THREE.NormalBlending }));
    funnel.rotation.x = Math.PI;
    funnel.position.y = lvl >= 4 ? 1.8 : 1.4;
    vortex.add(torus, funnel);
    const ringN = lvl >= 4 ? 4 : 3;
    for (let i = 0; i < ringN; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * (0.25 + i * 0.2), 0.04, 6, 32), createGlowMaterial(i === 1 ? 0xc39bff : lvl >= 5 && i === 3 ? 0xffffff : color, 0.9));
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
    const tickSpec = this.spec(T(lvl, [0.35, 0.35, 0.35, 0.8, 1.0]), 'dark', radius, { knockback: 0, stagger: 0.2, hitstop: 0, skillId: 'predator' });
    this.prog.addSkillXp('predator');
    this.list.push({ update: (dt) => {
      t += dt; tick += dt;
      const k = Math.min(1, t / 0.3);
      vortex.scale.setScalar(easeOutCubic(k) * (1 + Math.sin(t * 12) * 0.05));
      torus.rotation.z += dt * 8;
      funnel.rotation.y -= dt * 10;
      vortex.children.forEach((cc, i) => { if (cc.name === 'ring') { cc.rotation.z += dt * (6 + i * 3) * (i % 2 ? -1 : 1); cc.scale.setScalar(1 + Math.sin(t * 10 + i) * 0.12); } });
      light.intensity = 8 + Math.sin(t * 30) * 4;
      this.fx.absorbVortex(center, color, radius, lvl >= 4 ? 8 : 6);
      // pull enemies
      for (const e of this.combat.enemiesNear(center, radius * 1.3)) (e as any).pull?.(center, dt, lvl >= 4 ? 12 : 9);
      if (tick > 0.3) { tick = 0; this.combat.hit(ctx.combatant, 'enemy', center.clone().setY(center.y + 0.8), ctx.facing, tickSpec); }
      if (!done && t >= dur) {
        done = true;
        c.dismiss(0.2);
        // tier 4+: the abyss crushes everything inside before devouring
        if (lvl >= 4) {
          this.fx.burst(center.clone().setY(center.y + 1), dark, radius * 0.9, 0.35, false);
          this.fx.shockwave(center, 0xffffff, radius * 1.4, 0.35, { y: 0.3 });
          this.gcam.addTrauma(0.3);
          this.time.hitstop(0.04);
          this.combat.hit(ctx.combatant, 'enemy', center.clone().setY(center.y + 0.8), ctx.facing, this.spec(2.5, 'dark', radius, { knockback: 0, stagger: 0.6, hitstop: 0.05, skillId: 'predator' }));
        }
        // devour weakened enemies
        const victims = this.combat.enemiesNear(center, radius).filter((e) => e.hp / e.maxHp <= threshold && (e as any).devourable !== false);
        for (const v of victims) {
          (v as any).devour?.(ctx.pos);
          this.onDevour?.(v);
          if (lvl >= 3) { this.prog.hp = Math.min(this.prog.maxHp, this.prog.hp + v.maxHp * (lvl >= 5 ? 0.18 : 0.1)); this.prog.mp = Math.min(this.prog.maxMp, this.prog.mp + (lvl >= 5 ? 25 : 15)); this.fx.healSparkles(ctx.pos, 0xc39bff, 16); }
        }
        if (victims.length) {
          sfx('absorbDone'); this.fx.burst(center.clone().setY(center.y + 0.8), color, radius, 0.4); this.time.slowmo(0.5, 0.35);
          // tier 5: the Gluttonous King refreshes every other skill
          if (lvl >= 5) { this.prog.resetCooldowns('predator'); this.fx.auraRing(ctx.root, 0xffffff, 1.8, 0.8); this.fx.healSparkles(ctx.pos, 0xffffff, 20); sfx('evolve', 0.5); }
        }
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
    const sky = this.circle({ color: red, radius: lvl >= 5 ? 34 : 26, layers: 3, seed: 100, intensity: 1.2 }, target.clone().setY(target.y + 55));
    sky.group.rotation.x = Math.PI / 2; // facing down
    const tgtCircle = this.circle({ color: gold, radius: 8, layers: 2, seed: 101 }, target.clone().setY(target.y + 0.1));
    sfx('meteorCharge');
    this.onBars?.(true);
    let meteorCued = false, barsOff = false;
    this.ultLight.color.set(0xff8040);
    this.ultLight.position.copy(ctx.pos).add(new THREE.Vector3(0, 3, 0));
    let t = 0, phase = 0, fallT = 0;
    const meteorMesh = this.buildMeteor(T(lvl, [2.6, 2.6, 3.4, 3.6, 4.2]));
    meteorMesh.visible = false;
    this.scene.add(meteorMesh);
    const start = target.clone().add(new THREE.Vector3(-22, 70, -30));
    const fallDur = 1.05;
    const mini: { m: THREE.Group; from: THREE.Vector3; to: THREE.Vector3; t: number }[] = [];
    let miniSpawned = 0;
    const miniMax = T(lvl, [0, 3, 3, 6, 9]);
    const miniGap = miniMax > 4 ? 0.18 : 0.35;
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
        if (!meteorCued && t > castTime * 0.62) {
          meteorCued = true;
          this.onTechnique?.('METEOR', SKILLS.meteor.tiers[lvl - 1].name.toUpperCase(), '#ff9a3c');
          this.time.slowmo(0.5, 0.2);
          this.post.impactFrame(0.5);
          this.post.flash(0.4, 0xffd0a0);
          this.fx.shockwave(sky.group.position, red, 40, 0.9, { y: 0 });
          this.gcam.addTrauma(0.25);
        }
        // tier 2+: mini meteors during charge
        if (miniMax && t > 1.0 && miniSpawned < miniMax && t > 1.0 + miniSpawned * miniGap) {
          const a = rand(0, Math.PI * 2), r = rand(4, lvl >= 4 ? 12 : 9);
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
        if (!barsOff && fallT > fallDur + 0.5) { barsOff = true; this.onBars?.(false); }
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
    const radius = T(lvl, [11, 11, 14, 15, 17]);
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
    this.combat.hit(ctx.combatant, 'enemy', p.clone().setY(p.y + 1), ctx.facing, this.spec(T(lvl, [10, 10, 14, 15, 18]), 'meteor', radius, { knockback: 14, launch: 10, stagger: 1.5, hitstop: 0.12, critChance: this.prog.critChance + 0.25, critMult: 2, skillId: 'meteor' }));
    this.prog.addSkillXp('meteor');
    // tier 5: an aftershock erupts from the crater as a ring of fire pillars
    if (lvl >= 5) {
      this.later(1.1, () => {
        sfx('shockwave', 0.9); sfx('explosion', 0.8);
        this.gcam.addTrauma(0.6);
        this.post.flash(0.5, 0xffd0a0);
        this.fx.shockwave(p, gold, radius * 3, 0.9, { y: 0.2 });
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const q = new THREE.Vector3(p.x + Math.cos(a) * radius * 0.75, 0, p.z + Math.sin(a) * radius * 0.75); q.y = this.h(q.x, q.z);
          this.later(i * 0.05, () => {
            this.fx.pillar(q, orange, 1.2, 14, 0.6);
            this.fx.burst(q.clone().setY(q.y + 1), red, 2.5, 0.3);
            this.particles.emit({ pos: q.clone().setY(q.y + 0.3), count: 14, velSpread: 5, velUp: 9, life: 0.8, size: 0.6, sizeEnd: 0.2, color: [red, orange, gold], shape: Shape.FLAME, drag: 1 });
            this.combat.hit(ctx.combatant, 'enemy', q.clone().setY(q.y + 1), ctx.facing, this.spec(3.5, 'fire', 4, { knockback: 6, launch: 7, stagger: 0.8, hitstop: 0.04, skillId: 'meteor' }));
          });
        }
      });
    }
    // lingering firestorm
    const light = new THREE.PointLight(orange, 30, radius * 4, 1.2);
    light.position.copy(p).add(new THREE.Vector3(0, 3, 0));
    this.scene.add(light);
    let t = 0, tick = 0;
    const dur = T(lvl, [4.5, 4.5, 7, 7.5, 9]);
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

  // ------------------------------------------------------------ MEGIDDO RAY (ULTIMATE)
  /**
   * Anime set piece. A formation of water lenses blooms across the sky, a shaft of sunlight pours
   * into them, time slows as the technique name slams on screen, and then compressed light lances
   * down from every lens onto the nearest enemies with perfect precision.
   */
  private megiddo(ctx: SkillContext, lvl: number) {
    const white = 0xffffff, cyan = 0x5fd8ff, ice = 0xbfeeff;
    this.ultActive = true;
    this.ultHold = true;
    this.ultChargeT = 0;
    const castTime = 2.6;
    const beams = T(lvl, [1, 2, 4, 7, 10]);
    const gap = T(lvl, [0.3, 0.26, 0.2, 0.15, 0.12]);
    const beamMult = T(lvl, [5.5, 4.8, 4.2, 3.8, 3.4]);
    const mainR = T(lvl, [4, 4.5, 5, 5.5, 6.5]);
    const tierName = SKILLS.megiddo.tiers[lvl - 1].name.toUpperCase();
    this.onBars?.(true);
    const origin = ctx.pos.clone();
    const facing = ctx.facing.clone().setY(0).normalize();
    const aim = ctx.aimPoint(14);
    // ---- the hero shot: camera in front of the caster looking back; lenses bloom behind and above
    const camPos = origin.clone().addScaledVector(facing, 10.5).setY(origin.y + 1.2);
    camPos.y = Math.max(camPos.y, this.h(camPos.x, camPos.z) + 0.8);
    this.gcam.cinematic(camPos, origin.clone().setY(origin.y + 2.6), 58, true);
    const rig = this.fx.megiddoRig(origin, facing, cyan);
    const lensPos = origin.clone().addScaledVector(facing, -13).setY(origin.y + 15);
    const lenses: { h: ReturnType<Effects['lens']>; pos: THREE.Vector3; born: number; circle: MagicCircle }[] = [];
    const makeLens = (pos: THREE.Vector3, r: number, born: number) => {
      const h = this.fx.lens(pos, r, cyan);
      h.group.visible = false;
      const circle = this.circle({ color: ice, radius: r * 1.25, layers: r > 4 ? 3 : 2, seed: 120 + lenses.length, intensity: 0.5 }, pos.clone().setY(pos.y + 0.6));
      circle.group.rotation.x = Math.PI / 2;
      circle.group.visible = false;
      lenses.push({ h, pos, born, circle });
    };
    makeLens(lensPos, mainR, 0.35);
    const sats = Math.max(0, beams - 1);
    for (let i = 0; i < sats; i++) {
      const a = (i / sats) * Math.PI * 2 + 0.4;
      const ring = sats > 6 && i % 2 ? 15 : 9.5;
      const p = lensPos.clone().add(new THREE.Vector3(Math.cos(a) * ring, rand(-2, 4) + (i % 2) * 2.5, Math.sin(a) * ring));
      makeLens(p, T(lvl, [2.4, 2.6, 2.6, 2.8, 3]), 0.6 + i * 0.13);
    }
    // stars: the night the technique brings with it
    for (let i = 0; i < 90; i++) {
      const a = rand(0, Math.PI * 2), r = rand(15, 70), y = rand(12, 55);
      this.particles.emit({ pos: { x: origin.x + Math.cos(a) * r, y: origin.y + y, z: origin.z + Math.sin(a) * r }, count: 1, life: castTime + 3.5, size: rand(0.12, 0.3), sizeEnd: 0.05, color: [white, ice, cyan], shape: Shape.STAR, vel: { x: 0, y: 0, z: 0 }, rotSpeed: rand(-1, 1) });
    }
    // a column of water drawn up out of the caster into the lenses
    this.fx.pillar(origin, cyan, 0.16, 40, castTime, { fadeIn: 0.8 });
    const feet = this.circle({ color: ice, radius: 4, layers: 3, seed: 121, intensity: 0.55 }, origin.clone().setY(origin.y + 0.08));
    this.ultLight.color.set(0x9fe8ff);
    this.ultLight.position.copy(origin).add(new THREE.Vector3(0, 3, 0));
    sfx('chargeUp'); sfx('crystal', 0.6);
    this.later(0.9, () => sfx('lightningCharge', 0.5));
    let t = 0, phase = 0, fired = 0, fireT = 0, endT = 0, cued = false;
    const hitOrder = new Set<number>();
    let sweepDone = false;
    const night = new THREE.Color(0.62, 0.72, 1.0);
    this.list.push({ update: (dt) => {
      t += dt;
      for (const L of lenses) {
        if (!L.h.group.visible && t >= L.born) {
          L.h.group.visible = true; L.circle.group.visible = true;
          this.fx.shockwave(L.pos, ice, L === lenses[0] ? mainR * 2.5 : 5, 0.5, { y: 0 });
          this.particles.emit({ pos: L.pos, count: 10, spread: 1, velSpread: 3, life: 0.6, size: 0.18, color: [cyan, white], shape: Shape.GLOW });
          sfx('water', L === lenses[0] ? 0.8 : 0.35);
        }
        L.h.update(dt);
      }
      if (phase === 0) {
        // ---- gather: night falls, the mandala and wings ignite, lenses bloom behind
        this.ultChargeT = t / castTime;
        const k = Math.min(1, t / castTime);
        const n = Math.min(1, t / 0.7);
        this.nightRequest = Math.max(this.nightRequest, n);
        this.tint.copy(new THREE.Color(1, 1, 1)).lerp(night, n);
        rig.charge = easeInCubic(k);
        rig.update(dt, this.combat.camera);
        for (const L of lenses) L.h.charge = easeInCubic(Math.min(1, Math.max(0, (t - L.born) / (castTime - L.born))));
        this.ultLight.intensity = 4 + 4 * k + Math.sin(t * 24) * 1;
        // slow push-in on the hero shot
        const cp = origin.clone().addScaledVector(facing, 10.5 - k * 2.2).setY(origin.y + 1.2 + k * 0.6);
        cp.y = Math.max(cp.y, this.h(cp.x, cp.z) + 0.8);
        this.gcam.cinematic(cp, origin.clone().setY(origin.y + 2.6 + k * 0.3), 58 - k * 6);
        feet.group.position.set(ctx.pos.x, this.h(ctx.pos.x, ctx.pos.z) + 0.08, ctx.pos.z);
        // water drawn up from the ground around the caster toward the lenses
        for (let i = 0; i < 4; i++) {
          const a = rand(0, Math.PI * 2), r = rand(1.5, 10);
          const to = lenses[Math.floor(rand(0, lenses.length))].pos;
          const px = origin.x + Math.cos(a) * r, pz = origin.z + Math.sin(a) * r;
          this.particles.emit({ pos: { x: px, y: this.h(px, pz) + 0.2, z: pz }, count: 1, vel: { x: (to.x - px) * 0.5, y: rand(10, 18), z: (to.z - pz) * 0.5 }, life: 1.8, size: 0.16, color: [cyan, white, ice], shape: Shape.GLOW, stretch: 0.8 });
        }
        // light motes converge on every lens
        if (k > 0.3) for (const L of lenses) if (L.h.group.visible && Math.random() < 0.6) this.particles.emit({ pos: L.pos, count: 2, spread: 4, life: 0.6, size: 0.2, color: [ice, white], shape: Shape.STAR, orbit: 12, vel: { x: 0, y: 0, z: 0 } });
        if (t > 0.4 && Math.random() < 0.4) this.fx.auraRing(ctx.root, Math.random() < 0.5 ? white : cyan, 1.5, 0.8);
        // the name card: time stalls, the sky flashes, every lens ignites
        if (!cued && k > 0.7) {
          cued = true;
          this.onTechnique?.('MEGIDDO', tierName, '#9fe8ff');
          this.time.slowmo(0.6, 0.18);
          this.post.impactFrame(0.55);
          this.post.flash(0.35, 0xdff4ff);
          this.post.chromaTarget = 0.012; this.later(0.3, () => (this.post.chromaTarget = 0));
          for (const L of lenses) L.h.flash = 0.6;
          this.fx.shockwave(origin, ice, 24, 1.0, { y: 0.1 });
          this.gcam.addTrauma(0.25);
        }
        if (k >= 1) {
          // ---- cut to the wide shot; the rig dissolves as the first beam falls
          phase = 1; fireT = -0.05;
          feet.dismiss(0.3);
          rig.dissolve();
          this.gcam.endCinematic();
          this.gcam.ultFar = 15; this.gcam.ultLookK = 0.22; this.gcam.ultFovExtra = 18;
          this.post.flash(0.6, 0xeaf8ff);
          this.post.impactFrame(0.5);
          this.fx.shockwave(lensPos, white, mainR * 4, 0.6, { y: 0 });
          this.gcam.addTrauma(0.3);
          sfx('lightningCharge', 0.8);
        }
      } else if (phase === 1) {
        // ---- fire: each lens fires in turn, beams snapping to the nearest enemies
        this.nightRequest = Math.max(this.nightRequest, 1);
        this.tint.copy(night);
        fireT += dt;
        this.post.speedLinesTarget = 0.1;
        if (fireT >= 0 && fired < beams) {
          fireT = -gap;
          const pool = this.nearest(ctx.pos, 34, hitOrder);
          const victim = pool[0] ?? this.nearest(ctx.pos, 34)[0] ?? null;
          if (victim) hitOrder.add(victim.id);
          if (hitOrder.size >= this.combat.enemies().length) hitOrder.clear();
          const p = victim ? victim.pos.clone() : aim.clone().add(new THREE.Vector3(rand(-3, 3), 0, rand(-3, 3)));
          p.y = this.h(p.x, p.z);
          const L = lenses[fired === 0 ? 0 : (fired % lenses.length)];
          L.h.flash = 1;
          this.beam(ctx, L.pos, p, beamMult, lvl, fired, L === lenses[0] ? 1.3 : 1);
          this.ultFocus = p;
          fired++;
        }
        if (fired >= beams && fireT >= -gap + 0.4) {
          if (lvl >= 5 && !sweepDone) { sweepDone = true; phase = 2; this.solarJudgment(ctx, lensPos, aim); }
          else { phase = 3; endT = 0; }
        }
      } else if (phase === 2) {
        fireT += dt;
        lenses[0].h.flash = 1;
        this.nightRequest = 1;
        if (fireT > 1.7) { phase = 3; endT = 0; }
      } else {
        // ---- aftermath: lenses shatter into rain, the night lifts
        endT += dt;
        this.post.speedLinesTarget = 0;
        this.tint.lerp(new THREE.Color(1, 1, 1), dt * 1.6);
        this.ultLight.intensity = Math.max(0, this.ultLight.intensity - dt * 30);
        this.ultFocus = null;
        if (endT === dt) { this.onBars?.(false); sfx('water', 0.7); }
        for (let i = 0; i < lenses.length; i++) { const L = lenses[i]; if (L.h.group.visible && endT > i * 0.07) { L.h.shatter(); L.h.group.visible = false; L.circle.dismiss(0.4); } }
        if (endT > 1.0) {
          this.gcam.ultFar = 5; this.gcam.ultLookK = 0.45; this.gcam.ultFovExtra = 8;
          this.ultActive = false; this.ultHold = false; this.onUltEnd?.(); this.tint.set(1, 1, 1);
          return false;
        }
      }
      return true;
    } });
    this.prog.addSkillXp('megiddo');
    return castTime;
  }

  /** one Megiddo beam from a lens to a ground point */
  private beam(ctx: SkillContext, from: THREE.Vector3, p: THREE.Vector3, mult: number, lvl: number, index: number, scale = 1) {
    const white = 0xffffff, gold = 0x9fe8ff;
    const cam = this.combat.camera;
    const top = p.clone().setY(p.y + 1);
    const w = T(lvl, [0.16, 0.16, 0.18, 0.2, 0.22]) * scale;
    // needle-thin hot core, a gold sheath, then a faint slow-fading halo so the sky keeps a lattice of afterglow lines
    this.fx.ray(from, top, white, w * 0.5, 0.4);
    this.fx.ray(from, top, gold, w * 1.1, 0.32);
    this.fx.ray(from, top, 0x5fd8ff, w * 1.8, 0.6);
    this.fx.pillar(p, white, 0.26 * scale, 24, 0.4, { fadeIn: 0.02 });
    this.fx.pillar(p, gold, 0.55 * scale, 8, 0.3, { fadeIn: 0.02 });
    this.fx.flash(top, white, 1.8 * scale, 0.18, cam);
    this.fx.burst(top, gold, 1.3 * scale, 0.28);
    // anime lens-flare cross: two flat slashes at right angles
    this.fx.slash(top, new THREE.Vector3(1, 0, 0), white, 2.2 * scale, 0.16, { wide: true });
    this.fx.slash(top, new THREE.Vector3(0, 0, 1), white, 2.2 * scale, 0.16, { wide: true });
    this.fx.shockwave(p, white, 5 * scale, 0.45, { y: 0.1 });
    this.fx.shockwave(p, gold, 3 * scale, 0.32, { y: 0.3 });
    this.fx.groundMark(p, 0xbfeeff, 1.6 * scale, 7, true);
    this.particles.emit({ pos: top, count: 26, velSpread: 11, velUp: 9, life: 0.8, size: 0.15, color: [gold, white], shape: Shape.SPARK, stretch: 1.6, gravity: 12, drag: 1.2 });
    this.particles.emit({ pos: top, count: 8, spread: 0.4, velUp: 14, velSpread: 2, life: 0.6, size: 0.12, color: [white], shape: Shape.SPARK, stretch: 3, gravity: 0 });
    this.particles.emit({ pos: p.clone().setY(p.y + 0.3), count: 8, spread: 0.6, velUp: 4, life: 1.2, size: 1.0, sizeEnd: 2.0, color: [0xd0d0e0, 0xffffff], alpha: 0.35, shape: Shape.SMOKE, additive: false, rotSpeed: 2 });
    // post: white flash, radial blur centered on the impact, impact frame on the first and every third beam
    this.post.flash(index === 0 ? 0.3 : 0.14, 0xdff4ff);
    const scr = top.clone().project(cam);
    if (scr.z < 1) { this.post.u.uRadialCenter.value.set(scr.x * 0.5 + 0.5, scr.y * 0.5 + 0.5); this.post.radialTarget = 0.03; this.later(0.08, () => (this.post.radialTarget = 0)); }
    if (index === 0) this.post.impactFrame(0.6);
    this.post.chromaTarget = 0.014; this.later(0.1, () => (this.post.chromaTarget = 0));
    this.gcam.addTrauma(0.2 * scale);
    this.time.hitstop(0.04);
    sfx('bolt', 0.8); sfx('crystal', 0.35); sfx('lightning', 0.25);
    this.ultLight.position.copy(top).setY(top.y + 2);
    this.ultLight.intensity = 9;
    this.combat.hit(ctx.combatant, 'enemy', top, ctx.facing, this.spec(mult * scale, 'light', 2.4 * scale, { knockback: 2, launch: 2, stagger: 0.7, hitstop: 0.05, critChance: this.prog.critChance + 0.2, critMult: 1.8, skillId: 'megiddo' }));
    // tier 4+: the impact bursts into radiant fragments that lance outward
    if (lvl >= 4) {
      for (let i = 0; i < 3; i++) {
        const a = rand(0, Math.PI * 2) + index, r = rand(2, 4.5);
        const q = new THREE.Vector3(p.x + Math.cos(a) * r, 0, p.z + Math.sin(a) * r); q.y = this.h(q.x, q.z);
        this.later(0.06 + i * 0.05, () => {
          this.fx.ray(top.clone().setY(top.y + 3), q.clone().setY(q.y + 0.4), white, 0.12, 0.22);
          this.fx.burst(q.clone().setY(q.y + 0.5), gold, 1.1, 0.25);
          this.fx.shockwave(q, white, 2, 0.3, { y: 0.1 });
          this.particles.emit({ pos: q.clone().setY(q.y + 0.4), count: 6, velSpread: 5, velUp: 5, life: 0.5, size: 0.12, color: [gold, white], shape: Shape.STAR, gravity: 8 });
          this.combat.hit(ctx.combatant, 'enemy', q.clone().setY(q.y + 0.8), ctx.facing, this.spec(1.2, 'light', 1.8, { knockback: 2, stagger: 0.3, hitstop: 0, skillId: 'megiddo' }));
        });
      }
    }
  }

  /** tier 5 finale: the main lens fires a wide pillar of daylight that sweeps forward */
  private solarJudgment(ctx: SkillContext, lensPos: THREE.Vector3, aim: THREE.Vector3) {
    const white = 0xffffff, gold = 0x9fe8ff;
    const dir = aim.clone().sub(ctx.pos).setY(0).normalize();
    const start = ctx.pos.clone().addScaledVector(dir, 3);
    const end = ctx.pos.clone().addScaledVector(dir, 22);
    const cur = start.clone();
    const dur = 1.2;
    let t = 0, tick = 0;
    this.onTechnique?.('SOLAR JUDGMENT', 'MEGIDDO · FINAL', '#dff4ff');
    sfx('lightning', 1); sfx('shockwave', 0.9);
    this.post.impactFrame(0.8);
    this.post.flash(0.9, 0xfffaf0);
    this.gcam.addTrauma(0.7);
    this.time.slowmo(0.5, 0.15);
    const pillarR = 3.4;
    this.list.push({ update: (dt) => {
      t += dt; tick += dt;
      const k = Math.min(1, t / dur);
      cur.lerpVectors(start, end, easeOutCubic(k));
      cur.y = this.h(cur.x, cur.z);
      this.ultFocus = cur;
      this.nightRequest = 1;
      this.post.speedLinesTarget = 0.5;
      // rebuild the pillar every few frames as a short-lived transient so it tracks the sweep cheaply
      if (tick > 0.05) {
        tick = 0;
        this.fx.pillar(cur, gold, pillarR, 80, 0.14, { fadeIn: 0.01 });
        this.fx.pillar(cur, white, pillarR * 0.4, 80, 0.14, { fadeIn: 0.01 });
        this.fx.ray(lensPos, cur.clone().setY(cur.y + 2), white, 1.6, 0.14);
        this.fx.shockwave(cur, white, pillarR * 2.4, 0.4, { y: 0.15 });
        this.particles.emit({ pos: cur.clone().setY(cur.y + 0.4), count: 12, spread: pillarR * 0.6, velUp: 12, velSpread: 6, life: 0.9, size: 0.16, color: [gold, white], shape: Shape.SPARK, stretch: 1.6, gravity: 10 });
        this.particles.emit({ pos: cur.clone().setY(cur.y + 0.5), count: 3, spread: pillarR, velUp: 3, life: 1.6, size: 1.6, sizeEnd: 3.2, color: [0xffffff, 0xe0e0f0], alpha: 0.3, shape: Shape.SMOKE, additive: false, rotSpeed: 1.5 });
        this.fx.groundMark(cur, 0xbfeeff, pillarR * 0.8, 7, true);
        this.combat.hit(ctx.combatant, 'enemy', cur.clone().setY(cur.y + 1), dir, this.spec(2.2, 'light', pillarR * 1.2, { knockback: 4, launch: 4, stagger: 0.8, hitstop: 0.02, critChance: this.prog.critChance + 0.2, skillId: 'megiddo' }));
        this.ultLight.position.copy(cur).setY(cur.y + 4); this.ultLight.intensity = 12;
      }
      if (k >= 1) {
        this.fx.burst(cur.clone().setY(cur.y + 1.5), white, pillarR * 2, 0.5);
        this.fx.shockwave(cur, gold, pillarR * 5, 0.9);
        this.fx.shockwave(cur, white, pillarR * 3.5, 0.6, { y: 0.4 });
        this.fx.pillar(cur, white, pillarR * 1.3, 90, 0.7, { fadeIn: 0.02 });
        this.post.impactFrame(0.6);
        this.post.flash(0.7, 0xfffaf0);
        this.gcam.addTrauma(0.6);
        this.time.hitstop(0.08);
        sfx('explosion', 0.9); sfx('lightning', 0.7);
        this.combat.hit(ctx.combatant, 'enemy', cur.clone().setY(cur.y + 1), dir, this.spec(4, 'light', pillarR * 2, { knockback: 10, launch: 8, stagger: 1.2, hitstop: 0.08, skillId: 'megiddo' }));
        return false;
      }
      return true;
    } });
  }

  update(dt: number) {
    this.stormRequest = Math.max(0, this.stormRequest - dt * 0.6);
    this.windRequest = Math.max(0, this.windRequest - dt * 2);
    this.sunRequest = Math.max(0, this.sunRequest - dt * 0.9);
    this.nightRequest = Math.max(0, this.nightRequest - dt * 0.7);
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
