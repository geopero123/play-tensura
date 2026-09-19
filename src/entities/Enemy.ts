import * as THREE from 'three';
import { CreatureRig, AnimState, buildHumanoid, buildWolf, buildSlime, buildWisp, buildDummy } from './CreatureModels';
import { Terrain, Colliders } from '../world/Terrain';
import { Combat, Combatant, HitInfo, AttackSpec, newId } from '../combat/Combat';
import { Effects } from '../vfx/Effects';
import { Particles, Shape } from '../vfx/Particles';
import { Time } from '../core/Time';
import { GameCamera } from '../core/Camera';
import { PostFX } from '../render/PostFX';
import { ENEMIES, EnemyKind, EnemyDef } from '../progression/Data';
import { sfx } from '../audio/Audio';
import { damp, dampAngle, clamp, rand, angleDiff, lerp } from '../core/Math';
import { createGlowMaterial } from '../render/ToonMaterial';

export interface EnemyWorld {
  scene: THREE.Scene;
  terrain: Terrain;
  colliders: Colliders;
  combat: Combat;
  fx: Effects;
  particles: Particles;
  time: Time;
  camera: THREE.Camera;
  gcam: GameCamera;
  post: PostFX;
  player: Combatant & { pos: THREE.Vector3; invulnerable?: boolean };
  onBossEvent: (ev: 'phase2' | 'phase3' | 'howl' | 'ultimate' | 'dead', enemy: Enemy) => void;
}

type AIState = 'idle' | 'wander' | 'notice' | 'chase' | 'circle' | 'windup' | 'attack' | 'recover' | 'stagger' | 'launched' | 'retreat' | 'dead' | 'devoured' | 'cast' | 'blink' | 'phase' | 'howl';

const GRAVITY = 26;

export class Enemy implements Combatant {
  id = newId();
  name: string;
  team: 'enemy' = 'enemy';
  pos: THREE.Vector3;
  vel = new THREE.Vector3();
  radius: number;
  height: number;
  hp: number;
  maxHp: number;
  alive = true;
  targetable = true;
  root: THREE.Group;
  rig: CreatureRig;
  def: EnemyDef;
  kind: EnemyKind;
  state: AIState = 'idle';
  stateT = 0;
  yaw = 0;
  grounded = true;
  home: THREE.Vector3;
  dead = false; // fully finished (remove from world)
  devoured = false;
  devourable = true;
  private anim: AnimState = 'idle';
  private flashT = 0;
  private staggerT = 0;
  private attackCd = 0;
  private wanderT = 0;
  private wanderDir = new THREE.Vector3();
  private attackKind = 0;
  private hitDone = false;
  private hpBar: THREE.Group;
  private hpFill: THREE.Mesh;
  private hpShowT = 0;
  private circleDir = 1;
  private circleT = 0;
  private blinkCd = 0;
  private telegraph: THREE.Mesh | null = null;
  private devourT = 0;
  private devourTo = new THREE.Vector3();
  private deathT = 0;
  private lvlScale = 1;
  private lastHitByPlayer = 0;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private stormT = 0;
  private enraged = false;
  onDeath: ((e: Enemy, devoured: boolean) => void) | null = null;
  // boss
  bossPhase = 1;
  private bossCombo = 0;
  private bossPattern = 0;
  private bossTimer = 0;
  private bossAura: THREE.Mesh | null = null;
  private bossAuraT = 0;
  private tornado: { pos: THREE.Vector3; t: number; mesh: THREE.Group } | null = null;
  private pendingStrikes: { pos: THREE.Vector3; t: number; ring: THREE.Mesh }[] = [];
  private windBlades: { m: THREE.Mesh; dir: THREE.Vector3; t: number; hit: boolean }[] = [];
  private bolts: { m: THREE.Mesh; vel: THREE.Vector3; t: number }[] = [];
  private speedMul = 1;
  invulnerable = false;
  /** AI frozen (boss intro cinematic); only visuals update */
  frozen = false;

  constructor(kind: EnemyKind, pos: THREE.Vector3, private world: EnemyWorld, opts: { level?: number } = {}) {
    this.kind = kind;
    this.def = ENEMIES[kind];
    this.name = this.def.name;
    this.lvlScale = 1 + ((opts.level ?? 1) - 1) * 0.18;
    this.maxHp = Math.round(this.def.hp * this.lvlScale);
    this.hp = this.maxHp;
    this.pos = pos.clone();
    this.pos.y = world.terrain.heightAt(pos.x, pos.z);
    this.home = this.pos.clone();
    this.radius = this.def.radius;
    switch (kind) {
      case 'slime': this.rig = buildSlime(Math.random() < 0.5 ? 0x7fd85a : 0xff7a5a, 0.85); break;
      case 'goblin': this.rig = buildHumanoid({ skin: 0x6fa84a, cloth: 0x6a4a35, cloth2: 0x4a3a2a, goblin: true, weapon: 'club', eyeColor: 0xffcc00, scale: 0.85 }); break;
      case 'warlord': this.rig = buildHumanoid({ skin: 0x5a8a3a, cloth: 0x5a2a2a, cloth2: 0x2a2a2a, goblin: true, weapon: 'axe', armor: true, eyeColor: 0xff4020, scale: 1.45 }); break;
      case 'wolf': this.rig = buildWolf({ fur: 0x8a95a8, fur2: 0xd8dde8, eye: 0xffcc40 }); break;
      case 'stormWolf': this.rig = buildWolf({ fur: 0x3a2a5a, fur2: 0x6a4a9a, eye: 0x9fe8ff, corrupted: true, scale: 1.15 }); break;
      case 'boss': this.rig = buildWolf({ fur: 0xe8ecf8, fur2: 0x8fb8ff, eye: 0x7fe8ff, boss: true, scale: 3.1 }); break;
      case 'wisp': this.rig = buildWisp(); break;
      case 'dummy': this.rig = buildDummy(); this.devourable = false; break;
      default: this.rig = buildSlime(0x7fd85a);
    }
    this.root = this.rig.root;
    this.height = this.rig.height;
    this.radius = Math.max(this.radius, this.rig.radius);
    this.root.position.copy(this.pos);
    this.yaw = rand(0, Math.PI * 2);
    // hp bar (billboard)
    this.hpBar = new THREE.Group();
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.12), new THREE.MeshBasicMaterial({ color: 0x0a0a14, transparent: true, opacity: 0.8, depthTest: false, depthWrite: false }));
    this.hpFill = new THREE.Mesh(new THREE.PlaneGeometry(1.16, 0.08), new THREE.MeshBasicMaterial({ color: kind === 'boss' ? 0xff4a6a : 0xff6a6a, depthTest: false, depthWrite: false, toneMapped: false }));
    this.hpFill.position.z = 0.001;
    this.hpBar.add(bg, this.hpFill);
    this.hpBar.position.y = this.height + 0.35;
    this.hpBar.visible = false;
    this.hpBar.renderOrder = 30;
    this.root.add(this.hpBar);
    if (kind === 'boss') { this.hpBar.visible = false; this.name = 'Ancient Tempest Wolf'; }
    world.combat.register(this);
    world.scene.add(this.root);
  }

  private get player() { return this.world.player; }
  private h(x: number, z: number) { return this.world.terrain.heightAt(x, z); }
  private distToPlayer() { return Math.hypot(this.player.pos.x - this.pos.x, this.player.pos.z - this.pos.z); }
  private facePlayer(dt: number, speed = 10) {
    const dx = this.player.pos.x - this.pos.x, dz = this.player.pos.z - this.pos.z;
    this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), speed, dt);
  }
  private facing(out = this.tmp) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  private setState(s: AIState) { this.state = s; this.stateT = 0; this.hitDone = false; }
  private moveToward(target: THREE.Vector3, speed: number, dt: number, turn = 8) {
    const dx = target.x - this.pos.x, dz = target.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return;
    this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), turn, dt);
    this.vel.x = damp(this.vel.x, Math.sin(this.yaw) * speed, 10, dt);
    this.vel.z = damp(this.vel.z, Math.cos(this.yaw) * speed, 10, dt);
  }
  private stop(dt: number, k = 12) { this.vel.x = damp(this.vel.x, 0, k, dt); this.vel.z = damp(this.vel.z, 0, k, dt); }

  private atk(mult: number, extra: Partial<AttackSpec> = {}): AttackSpec {
    return { damage: this.def.atk * this.lvlScale * mult, type: 'heavy', radius: 1.5, knockback: 3, stagger: 0.3, hitstop: 0.02, critChance: 0.03, ...extra };
  }

  private showTelegraph(pos: THREE.Vector3, radius: number, dur: number, color = 0xff4a4a) {
    const ring = this.world.fx.shockwave(pos, color, radius, dur, { y: 0.1 }) as THREE.Mesh;
    return ring;
  }

  /** melee hit in front */
  private meleeHit(mult: number, radius: number, arc: number, extra: Partial<AttackSpec> = {}) {
    const f = this.facing();
    const center = this.pos.clone().setY(this.pos.y + 0.8).addScaledVector(f, radius * 0.5);
    const hits = this.world.combat.hit(this, 'player', center, f, this.atk(mult, { radius, arc, ...extra }));
    return hits.length > 0;
  }

  // ---------------- damage ----------------
  takeHit(hit: HitInfo): boolean {
    if (!this.alive || this.invulnerable) return false;
    // Predator's vortex wears enemies down but never kills them: it leaves them ready to be devoured
    if (hit.skillId === 'predator' && this.hp - hit.damage < 1) hit.damage = Math.max(0, Math.floor(this.hp - 1));
    this.hp -= hit.damage;
    this.flashT = 0.1;
    this.hpShowT = 4;
    this.lastHitByPlayer = 0;
    const superArmor = this.kind === 'warlord' || this.kind === 'boss' || this.kind === 'dummy';
    if (this.kind === 'dummy') { this.setState('stagger'); this.staggerT = 0.2; this.hp = this.maxHp; return true; }
    if (this.state === 'phase' || this.state === 'howl') return true;
    const kb = hit.knockback * (superArmor ? 0.15 : 1);
    this.vel.x += hit.dir.x * kb * 2.2; this.vel.z += hit.dir.z * kb * 2.2;
    if (hit.launch > 0 && !superArmor) {
      this.vel.y = hit.launch; this.grounded = false; this.setState('launched');
      this.pos.y += 0.05;
    } else if (hit.launch > 0 && superArmor && hit.type === 'ult') {
      this.vel.y = hit.launch * 0.4; this.grounded = false; this.setState('launched');
    } else if (!superArmor || hit.type === 'ult' || hit.type === 'heavy' && Math.random() < 0.35) {
      if (this.state !== 'launched') { this.setState('stagger'); this.staggerT = hit.stagger * (superArmor ? 0.5 : 1); }
    }
    if (this.kind === 'warlord' && !this.enraged && this.hp < this.maxHp * 0.5) { this.enraged = true; this.speedMul = 1.35; this.rig.setTint(0xff9a8a); sfx('growl'); this.world.fx.shockwave(this.pos, 0xff4a2a, 4, 0.6); }
    if (this.hp <= 0) this.die();
    return true;
  }

  pull(center: THREE.Vector3, dt: number, strength: number) {
    if (this.kind === 'boss' || this.kind === 'dummy' || !this.alive) return;
    const dx = center.x - this.pos.x, dz = center.z - this.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const k = this.kind === 'warlord' ? 0.3 : 1;
    this.vel.x += (dx / d) * strength * dt * 4 * k; this.vel.z += (dz / d) * strength * dt * 4 * k;
    if (this.state !== 'launched') { this.setState('stagger'); this.staggerT = 0.3; }
  }

  devour(to: THREE.Vector3) {
    if (!this.alive) return;
    this.alive = false; this.devoured = true;
    this.setState('devoured');
    this.devourTo.copy(to);
    this.devourT = 0;
    this.world.combat.unregister(this);
    this.hpBar.visible = false;
    this.clearTelegraph();
  }

  private die() {
    this.alive = false;
    this.setState('dead');
    this.deathT = 0;
    this.world.combat.unregister(this);
    this.hpBar.visible = false;
    this.clearTelegraph();
    sfx('death', 0.8);
    this.world.particles.emit({ pos: this.pos.clone().setY(this.pos.y + this.height * 0.5), count: 16, velSpread: 4, velUp: 2, life: 0.8, size: 0.2, color: [0xffffff, 0xc8a8ff], shape: Shape.STAR, drag: 2 });
    if (this.kind === 'boss') { this.world.onBossEvent('dead', this); this.world.time.slowmo(2.0, 0.2); this.world.post.impactFrame(1); this.world.post.flash(0.6, 0xffffff); this.world.gcam.addTrauma(0.6); }
    this.onDeath?.(this, false);
  }

  private clearTelegraph() { if (this.telegraph) { this.telegraph = null; } }

  dispose() {
    this.world.scene.remove(this.root);
    if (this.tornado) this.world.scene.remove(this.tornado.mesh);
    for (const b of this.windBlades) this.world.scene.remove(b.m);
    for (const b of this.bolts) this.world.scene.remove(b.m);
    this.dead = true;
  }

  // ---------------- update ----------------
  update(dt: number) {
    const t = this.world.time.elapsed;
    this.stateT += dt;
    this.attackCd = Math.max(0, this.attackCd - dt);
    this.blinkCd = Math.max(0, this.blinkCd - dt);
    this.lastHitByPlayer += dt;
    this.flashT = Math.max(0, this.flashT - this.world.time.rawDt);
    this.rig.setFlash(this.flashT > 0 ? 1 : 0);
    if (this.state === 'devoured') { this.updateDevoured(dt); return; }
    if (this.state === 'dead') { this.updateDead(dt); return; }
    if (this.frozen) { this.root.position.copy(this.pos); this.root.rotation.y = this.yaw; return; }

    const d = this.distToPlayer();
    const playerAlive = this.player.alive;
    switch (this.kind) {
      case 'dummy': this.anim = this.state === 'stagger' && this.stateT < this.staggerT ? 'hit' : 'idle'; if (this.state === 'stagger' && this.stateT >= this.staggerT) this.setState('idle'); break;
      case 'boss': this.updateBoss(dt, d, t); break;
      default: this.updateCommon(dt, d, playerAlive);
    }
    this.physics(dt);
    this.updateProjectiles(dt);
    // visuals
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    if (this.kind === 'wisp') this.root.rotation.y = this.yaw;
    this.rig.animate(this.anim, t, dt, Math.hypot(this.vel.x, this.vel.z), this.stateT);
    // hp bar
    this.hpShowT = Math.max(0, this.hpShowT - dt);
    this.hpBar.visible = this.kind !== 'boss' && this.kind !== 'dummy' && this.hpShowT > 0 && this.hp < this.maxHp;
    if (this.hpBar.visible) {
      this.hpBar.quaternion.copy(this.world.camera.quaternion);
      const p = clamp(this.hp / this.maxHp, 0, 1);
      this.hpFill.scale.x = p; this.hpFill.position.x = -(1 - p) * 0.58;
      this.hpBar.rotation.y -= this.yaw; // counter root rotation approx (quaternion copy already handles)
      this.hpBar.quaternion.copy(this.world.camera.quaternion);
      this.hpBar.quaternion.premultiply(this.tmpQ.setFromAxisAngle(this.tmp.set(0, 1, 0), -this.yaw));
    }
    // storm wolf sparks
    if (this.kind === 'stormWolf' && Math.random() < 0.25) this.world.particles.emit({ pos: this.pos.clone().setY(this.pos.y + rand(0.3, 1.2)), count: 1, velSpread: 2, life: 0.3, size: 0.1, color: [0xbfe8ff, 0xa080ff], shape: Shape.SPARK, stretch: 1 });
    if (this.kind === 'wisp' && Math.random() < 0.5) this.world.particles.emit({ pos: this.pos.clone().setY(this.pos.y + 1.2), count: 1, spread: 0.3, velUp: 1.5, life: 0.6, size: 0.35, sizeEnd: 0.2, color: [0x1a0530, 0x6a2cff, 0x9a40ff], shape: Shape.FLAME });
  }
  private tmpQ = new THREE.Quaternion();

  private updateCommon(dt: number, d: number, playerAlive: boolean) {
    const def = this.def;
    const speed = def.speed * this.lvlScale * 0.9 * this.speedMul;
    const isWolf = this.kind === 'wolf' || this.kind === 'stormWolf';
    const isRanged = this.kind === 'wisp';
    const leash = this.home.distanceTo(this.pos) > 55;
    switch (this.state) {
      case 'idle': {
        this.anim = 'idle'; this.stop(dt);
        this.wanderT -= dt;
        if (this.wanderT <= 0) { this.setState('wander'); this.wanderT = rand(1.5, 3.5); const a = rand(0, Math.PI * 2); this.wanderDir.set(Math.sin(a), 0, Math.cos(a)); }
        if (playerAlive && d < def.aggroRange && !leash) this.notice();
        break;
      }
      case 'wander': {
        this.anim = 'walk';
        // keep near home
        const toHome = this.tmp2.copy(this.home).sub(this.pos);
        if (toHome.length() > 14) this.wanderDir.copy(toHome).normalize();
        this.moveToward(this.pos.clone().add(this.wanderDir), speed * 0.35, dt, 4);
        this.wanderT -= dt;
        if (this.wanderT <= 0) { this.setState('idle'); this.wanderT = rand(2, 5); }
        if (playerAlive && d < def.aggroRange && !leash) this.notice();
        break;
      }
      case 'notice': {
        this.anim = this.kind === 'goblin' ? 'howl' : 'idle'; this.stop(dt);
        this.facePlayer(dt, 6);
        if (this.stateT > 0.55) this.setState('chase');
        break;
      }
      case 'chase': {
        if (!playerAlive || d > def.aggroRange * 2.2 || leash) { this.setState('retreat'); break; }
        this.anim = 'run';
        if (isRanged) {
          // keep distance
          if (d < 6) this.moveToward(this.pos.clone().sub(this.player.pos).add(this.pos), speed, dt);
          else if (d > 11) this.moveToward(this.player.pos, speed, dt);
          else { this.stop(dt); this.anim = 'idle'; this.facePlayer(dt); }
          if (d < 3.5 && this.blinkCd <= 0) { this.blink(); break; }
          if (this.attackCd <= 0 && d < def.attackRange) { this.setState('cast'); this.attackCd = 2.6; sfx('wisp', 0.7); break; }
        } else if (isWolf) {
          if (d > 7) this.moveToward(this.player.pos, speed, dt);
          else { this.setState('circle'); this.circleDir = Math.random() < 0.5 ? 1 : -1; this.circleT = rand(0.6, 1.6); }
        } else {
          this.moveToward(this.player.pos, speed, dt);
          if (d < def.attackRange && this.attackCd <= 0) this.startWindup();
        }
        break;
      }
      case 'circle': {
        this.anim = 'run';
        this.circleT -= dt;
        // strafe around player
        const toP = this.tmp.copy(this.player.pos).sub(this.pos).setY(0);
        const dist = toP.length(); toP.normalize();
        const tangent = this.tmp2.set(-toP.z, 0, toP.x).multiplyScalar(this.circleDir);
        const radial = dist > 6.5 ? 0.6 : dist < 4.5 ? -0.6 : 0;
        const target = this.pos.clone().addScaledVector(tangent, 3).addScaledVector(toP, radial * 3);
        this.moveToward(target, speed * 0.85, dt, 6);
        this.facePlayer(dt, 6);
        if (this.circleT <= 0) {
          if (this.attackCd <= 0) { this.startWindup(); }
          else { this.circleT = rand(0.5, 1.2); this.circleDir *= Math.random() < 0.4 ? -1 : 1; }
        }
        if (d > 16) this.setState('chase');
        break;
      }
      case 'windup': {
        this.stop(dt, 8);
        this.facePlayer(dt, 9);
        this.anim = isWolf ? 'lunge' : this.kind === 'slime' ? 'attack' : this.attackKind === 1 ? 'attack2' : 'attack';
        const wind = this.windupTime();
        if (this.stateT >= wind) { this.setState('attack'); this.hitDone = false; }
        break;
      }
      case 'attack': this.updateAttack(dt, d); break;
      case 'recover': {
        this.anim = 'idle'; this.stop(dt, 6);
        if (this.stateT > (isWolf ? 0.5 : 0.7)) this.setState(isWolf ? 'circle' : 'chase');
        // goblins occasionally sidestep after attacking
        if (this.kind === 'goblin' && this.stateT < 0.05 && Math.random() < 0.3) { const f = this.facing(); const side = Math.random() < 0.5 ? 1 : -1; this.vel.x += -f.z * side * 8; this.vel.z += f.x * side * 8; }
        break;
      }
      case 'stagger': {
        this.anim = 'hit'; this.stop(dt, 5);
        if (this.stateT >= this.staggerT) { this.setState(this.hp < this.maxHp * 0.25 && this.kind === 'goblin' && Math.random() < 0.5 ? 'retreat' : 'chase'); this.attackCd = Math.max(this.attackCd, 0.4); }
        break;
      }
      case 'launched': {
        this.anim = 'launch';
        if (this.grounded && this.stateT > 0.25) { this.setState('stagger'); this.staggerT = 0.6; this.world.fx.landDust(this.pos, 0.8); sfx('land', 0.5); }
        break;
      }
      case 'retreat': {
        this.anim = 'run';
        const away = this.pos.clone().sub(this.player.pos).setY(0).normalize();
        const target = leash || !playerAlive ? this.home : this.pos.clone().addScaledVector(away, 6);
        this.moveToward(target, speed * 0.9, dt);
        if (this.stateT > 2.2 || (leash && this.home.distanceTo(this.pos) < 8)) { this.setState(playerAlive && d < def.aggroRange && !leash ? 'chase' : 'idle'); }
        break;
      }
      case 'cast': {
        // wisp bolt
        this.anim = 'cast'; this.stop(dt); this.facePlayer(dt, 8);
        if (this.stateT > 0.7 && !this.hitDone) { this.hitDone = true; this.fireBolt(); }
        if (this.stateT > 1.0) this.setState('chase');
        break;
      }
      case 'blink': {
        this.anim = 'cast';
        if (this.stateT > 0.25) {
          const a = rand(0, Math.PI * 2);
          const p = this.player.pos.clone().add(new THREE.Vector3(Math.cos(a) * 9, 0, Math.sin(a) * 9));
          p.y = this.h(p.x, p.z);
          this.world.particles.emit({ pos: this.pos.clone().setY(this.pos.y + 1), count: 20, velSpread: 5, life: 0.5, size: 0.2, color: [0x9a40ff, 0x1a0530], shape: Shape.GLOW });
          this.pos.copy(p);
          this.world.particles.emit({ pos: this.pos.clone().setY(this.pos.y + 1), count: 20, velSpread: 5, life: 0.5, size: 0.2, color: [0x9a40ff, 0xffffff], shape: Shape.GLOW });
          this.setState('chase');
        }
        break;
      }
    }
  }

  private notice() {
    this.setState('notice');
    switch (this.kind) {
      case 'goblin': case 'warlord': sfx('goblin'); break;
      case 'wolf': case 'stormWolf': sfx('growl'); break;
      case 'slime': sfx('slime'); break;
      case 'wisp': sfx('wisp'); break;
    }
    this.world.particles.emit({ pos: this.pos.clone().setY(this.pos.y + this.height + 0.3), count: 3, velUp: 2, life: 0.5, size: 0.25, color: [0xff4040, 0xffffff], shape: Shape.STAR });
  }

  private blink() { this.setState('blink'); this.blinkCd = 4.5; sfx('wisp'); }

  private windupTime() {
    switch (this.kind) {
      case 'slime': return 0.45;
      case 'goblin': return this.attackKind === 1 ? 0.5 : 0.55;
      case 'wolf': case 'stormWolf': return this.attackKind === 1 ? 0.35 : 0.5;
      case 'warlord': return this.attackKind === 2 ? 0.8 : 0.7;
      default: return 0.5;
    }
  }

  private startWindup() {
    this.setState('windup');
    const isWolf = this.kind === 'wolf' || this.kind === 'stormWolf';
    if (this.kind === 'goblin') this.attackKind = Math.random() < 0.35 ? 1 : 0;
    else if (isWolf) this.attackKind = this.distToPlayer() < 3 ? 1 : 0;
    else if (this.kind === 'warlord') this.attackKind = Math.floor(rand(0, 3));
    else this.attackKind = 0;
    // telegraph
    const f = this.facing();
    const tele = 0xff5a5a;
    if (this.kind === 'slime') this.showTelegraph(this.pos.clone().addScaledVector(f, 1.2), 1.6, 0.45, tele);
    else if (this.kind === 'goblin') this.showTelegraph(this.pos.clone().addScaledVector(f, 1.0), this.attackKind === 1 ? 2.2 : 1.7, 0.5, tele);
    else if (isWolf) { if (this.attackKind === 0) this.showTelegraph(this.pos.clone().addScaledVector(f, 4), 2.2, 0.5, tele); else this.showTelegraph(this.pos.clone().addScaledVector(f, 1.2), 2.0, 0.35, tele); if (this.kind === 'stormWolf' && this.attackKind === 0) { const p = this.player.pos.clone(); this.pendingStrikes.push({ pos: p, t: 0.75, ring: this.showTelegraph(p, 2.4, 0.75, 0xbfe8ff) }); } }
    else if (this.kind === 'warlord') { if (this.attackKind === 0) this.showTelegraph(this.pos.clone().addScaledVector(f, 1.6), 3.2, 0.7, tele); else if (this.attackKind === 1) this.showTelegraph(this.pos, 4, 0.8, tele); else this.showTelegraph(this.pos.clone().addScaledVector(f, 5), 2.5, 0.8, tele); }
    if (this.kind === 'goblin' || this.kind === 'warlord') sfx('goblin', 0.6);
    if (isWolf) sfx('growl', 0.6);
  }

  private updateAttack(dt: number, d: number) {
    const f = this.facing();
    switch (this.kind) {
      case 'slime': {
        this.anim = 'lunge';
        if (this.stateT < 0.05) { this.vel.x = f.x * 11; this.vel.z = f.z * 11; this.vel.y = 5; this.grounded = false; sfx('slime'); }
        if (!this.hitDone && this.stateT > 0.1 && this.stateT < 0.5) { if (this.meleeHit(1, 1.3, 3.5, { knockback: 3, stagger: 0.25 })) this.hitDone = true; }
        if (this.stateT > 0.6 && this.grounded) { this.setState('recover'); this.attackCd = 1.4; }
        break;
      }
      case 'goblin': {
        this.anim = this.attackKind === 1 ? 'attack2' : 'attack';
        const dur = 0.9;
        if (this.stateT < 0.2) { this.vel.x = f.x * 5; this.vel.z = f.z * 5; } else this.stop(dt, 6);
        const hitAt = this.attackKind === 1 ? 0.42 : 0.45;
        if (!this.hitDone && this.stateT >= hitAt) {
          this.hitDone = true;
          const ok = this.meleeHit(this.attackKind === 1 ? 0.9 : 1.2, this.attackKind === 1 ? 2.3 : 1.9, this.attackKind === 1 ? 3.8 : 2.0, { knockback: 4, stagger: 0.4 });
          if (!ok) this.world.fx.dust(this.pos.clone().addScaledVector(f, 1.2), 5, 0.4);
          else this.world.gcam.addTrauma(0.15);
          sfx('slashHeavy', 0.4);
        }
        if (this.stateT >= dur) { this.setState('recover'); this.attackCd = rand(1.2, 2.0); }
        break;
      }
      case 'wolf': case 'stormWolf': {
        if (this.attackKind === 0) {
          // lunge charge
          this.anim = 'lunge';
          const sp = this.def.speed * 1.9 * this.speedMul;
          if (this.stateT < 0.45) { this.vel.x = f.x * sp; this.vel.z = f.z * sp; if (this.stateT < 0.05) { this.vel.y = 3; this.grounded = false; } }
          else this.stop(dt, 8);
          if (!this.hitDone && this.stateT > 0.05 && this.stateT < 0.5) { if (this.meleeHit(1.1, 1.6, 3.0, { knockback: 5, stagger: 0.45, launch: 0 })) { this.hitDone = true; this.world.gcam.addTrauma(0.15); } }
          if (this.stateT >= 0.75) { this.setState('recover'); this.attackCd = rand(1.0, 1.8); }
        } else {
          this.anim = 'attack2';
          this.stop(dt, 8);
          this.facePlayer(dt, 6);
          if (!this.hitDone && this.stateT >= 0.3) { this.hitDone = true; this.meleeHit(0.9, 2.0, 2.4, { knockback: 3, stagger: 0.35 }); sfx('slash', 0.4); }
          if (this.stateT >= 0.6) { this.setState('recover'); this.attackCd = rand(0.8, 1.4); }
        }
        break;
      }
      case 'warlord': {
        if (this.attackKind === 0) {
          // overhead slam with shockwave
          this.anim = 'attack';
          this.stop(dt, 6);
          if (!this.hitDone && this.stateT >= 0.42) {
            this.hitDone = true;
            const p = this.pos.clone().addScaledVector(f, 1.8);
            this.world.fx.shockwave(p, 0xff7a3a, 4.5, 0.5); this.world.fx.landDust(p, 2); this.world.gcam.addTrauma(0.35); sfx('slam', 0.9);
            this.world.combat.hit(this, 'player', p.clone().setY(p.y + 0.6), f, this.atk(1.4, { radius: 3.2, knockback: 8, stagger: 0.6, launch: 4 }));
            this.world.fx.groundMark(p, 0x2a2018, 2.5, 6);
          }
          if (this.stateT >= 1.1) { this.setState('recover'); this.attackCd = rand(1.4, 2.2); }
        } else if (this.attackKind === 1) {
          // spin sweep 360, two hits
          this.anim = 'attack2';
          this.stop(dt, 4);
          this.yaw += dt * 9;
          if (this.stateT >= 0.35 && this.stateT < 0.4 && !this.hitDone) { this.hitDone = true; this.world.combat.hit(this, 'player', this.pos.clone().setY(this.pos.y + 0.8), f, this.atk(0.9, { radius: 3.8, arc: 6.3, knockback: 6, stagger: 0.4 })); this.world.fx.shockwave(this.pos, 0xff5a5a, 4, 0.3, { y: 0.8 }); sfx('slashHeavy', 0.6); }
          if (this.stateT >= 0.8 && this.stateT < 0.85 && this.hitDone) { this.hitDone = false; this.world.combat.hit(this, 'player', this.pos.clone().setY(this.pos.y + 0.8), f, this.atk(0.9, { radius: 3.8, arc: 6.3, knockback: 6, stagger: 0.4 })); this.world.fx.shockwave(this.pos, 0xff5a5a, 4, 0.3, { y: 0.8 }); sfx('slashHeavy', 0.6); this.stateT = 0.86; }
          if (this.stateT >= 1.3) { this.setState('recover'); this.attackCd = rand(1.6, 2.4); }
        } else {
          // charge
          this.anim = 'run';
          const sp = 13 * this.speedMul;
          if (this.stateT < 0.6) { this.vel.x = f.x * sp; this.vel.z = f.z * sp; if (Math.random() < 0.5) this.world.fx.dust(this.pos, 3, 0.5); }
          else this.stop(dt, 6);
          if (!this.hitDone && this.stateT < 0.65) { if (this.meleeHit(1.3, 2.2, 2.5, { knockback: 9, stagger: 0.6, launch: 3 })) { this.hitDone = true; this.world.gcam.addTrauma(0.3); } }
          if (this.stateT >= 1.0) { this.setState('recover'); this.attackCd = rand(1.4, 2.2); }
        }
        break;
      }
      default: this.setState('recover');
    }
  }

  private fireBolt() {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 8), createGlowMaterial(0x9a40ff, 1));
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 6), createGlowMaterial(0x1a0530, 1, false));
    m.add(core);
    m.position.copy(this.pos).setY(this.pos.y + 1.3);
    this.world.scene.add(m);
    const dir = this.player.pos.clone().setY(this.player.pos.y + 0.6).sub(m.position).normalize();
    this.bolts.push({ m, vel: dir.multiplyScalar(13), t: 0 });
    sfx('bolt', 0.7);
    this.world.fx.flash(m.position, 0x9a40ff, 1.2, 0.2, this.world.camera);
  }

  private updateProjectiles(dt: number) {
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.t += dt;
      // slight homing
      const to = this.player.pos.clone().setY(this.player.pos.y + 0.6).sub(b.m.position).normalize();
      b.vel.lerp(to.multiplyScalar(13), dt * 1.5);
      b.m.position.addScaledVector(b.vel, dt);
      this.world.particles.emit({ pos: b.m.position, count: 2, spread: 0.2, life: 0.4, size: 0.3, sizeEnd: 0.2, color: [0x1a0530, 0x6a2cff, 0x9a40ff], shape: Shape.FLAME });
      const dp = b.m.position.distanceTo(this.player.pos.clone().setY(this.player.pos.y + 0.6));
      const gy = this.h(b.m.position.x, b.m.position.z);
      let done = false;
      if (dp < 0.9) {
        this.world.combat.hitDirect(this, this.player, b.vel, this.atk(1.0, { element: 'fire', knockback: 3, stagger: 0.3, type: 'spell' }));
        done = true;
      }
      if (b.m.position.y < gy || b.t > 4) done = true;
      if (done) { this.world.fx.burst(b.m.position, 0x6a2cff, 1.5, 0.3); this.world.particles.emit({ pos: b.m.position, count: 10, velSpread: 4, life: 0.5, size: 0.15, color: [0x9a40ff, 0x1a0530], shape: Shape.GLOW }); this.world.scene.remove(b.m); this.bolts.splice(i, 1); }
    }
    // pending lightning strikes (storm wolf & boss)
    for (let i = this.pendingStrikes.length - 1; i >= 0; i--) {
      const s = this.pendingStrikes[i];
      s.t -= dt;
      if (Math.random() < 0.3) this.world.particles.emit({ pos: s.pos.clone().setY(s.pos.y + 0.2), count: 1, spread: 1.5, velUp: 4, life: 0.4, size: 0.08, color: [0xbfe8ff], shape: Shape.SPARK, stretch: 1 });
      if (s.t <= 0) {
        this.world.fx.lightning(s.pos.clone().setY(s.pos.y + 30), s.pos, 0xbfe8ff, 0.3, 0.2, 2);
        this.world.fx.pillar(s.pos, 0xbfe8ff, 1.2, 25, 0.35);
        this.world.fx.shockwave(s.pos, 0xbfe8ff, 5, 0.4);
        this.world.fx.flash(s.pos.clone().setY(s.pos.y + 1), 0xffffff, 3, 0.15, this.world.camera);
        this.world.post.flash(0.25, 0xdff0ff);
        this.world.gcam.addTrauma(0.2);
        sfx('lightning', 0.45);
        this.world.combat.hit(this, 'player', s.pos.clone().setY(s.pos.y + 0.8), this.facing(), this.atk(this.kind === 'boss' ? 1.1 : 0.9, { radius: 2.4, element: 'lightning', knockback: 4, stagger: 0.5, launch: 3, type: 'spell' }));
        this.pendingStrikes.splice(i, 1);
      }
    }
    // wind blades
    for (let i = this.windBlades.length - 1; i >= 0; i--) {
      const b = this.windBlades[i];
      b.t += dt;
      b.m.position.addScaledVector(b.dir, 22 * dt);
      b.m.rotateZ(dt * 12);
      const gy = this.h(b.m.position.x, b.m.position.z) + 0.6;
      if (b.m.position.y < gy) b.m.position.y = gy;
      this.world.particles.emit({ pos: b.m.position, count: 1, life: 0.3, size: 0.2, color: [0xbfffe0], shape: Shape.SPARK, stretch: 1, vel: { x: -b.dir.x * 3, y: 0, z: -b.dir.z * 3 } });
      const dp = Math.hypot(b.m.position.x - this.player.pos.x, b.m.position.z - this.player.pos.z);
      if (!b.hit && dp < 1.3 && Math.abs(b.m.position.y - (this.player.pos.y + 0.5)) < 1.5) {
        b.hit = true;
        this.world.combat.hitDirect(this, this.player, b.dir, this.atk(1.0, { element: 'wind', knockback: 5, stagger: 0.4, type: 'spell' }));
        this.world.scene.remove(b.m); this.windBlades.splice(i, 1); continue;
      }
      if (b.t > 2.2) { this.world.scene.remove(b.m); this.windBlades.splice(i, 1); }
    }
    // tornado
    if (this.tornado) {
      const tn = this.tornado;
      tn.t += dt;
      // drift toward player
      const to = this.player.pos.clone().sub(tn.pos).setY(0);
      const dist = to.length();
      to.normalize();
      tn.pos.addScaledVector(to, Math.min(3.5, dist) * dt * 0.9);
      tn.pos.y = this.h(tn.pos.x, tn.pos.z);
      tn.mesh.position.copy(tn.pos);
      tn.mesh.rotation.y += dt * 9;
      tn.mesh.children.forEach((c, i) => (c.rotation.y += dt * (6 + i * 2) * (i % 2 ? -1 : 1)));
      for (let k = 0; k < 4; k++) {
        const a = rand(0, Math.PI * 2), r = rand(0.5, 3);
        this.world.particles.emit({ pos: { x: tn.pos.x + Math.cos(a) * r, y: tn.pos.y + rand(0, 6), z: tn.pos.z + Math.sin(a) * r }, count: 1, life: 0.8, size: 0.2, color: [0xbfffe0, 0xdff8ff, 0x6a5a4a], shape: Shape.SPARK, stretch: 0.8, orbit: 12, vel: { x: 0, y: 4, z: 0 } });
      }
      if (dist < 3.2 && !this.player.invulnerable && Math.floor(tn.t * 2) !== Math.floor((tn.t - dt) * 2)) {
        this.world.combat.hitDirect(this, this.player, to, this.atk(0.5, { element: 'wind', knockback: 6, stagger: 0.3, launch: 5, type: 'spell' }));
      }
      if (tn.t > 7) { this.world.scene.remove(tn.mesh); this.world.fx.burst(tn.pos.clone().setY(tn.pos.y + 2), 0xbfffe0, 4, 0.5); this.tornado = null; }
    }
  }

  // ---------------- BOSS ----------------
  private updateBoss(dt: number, d: number, t: number) {
    const p3 = this.bossPhase === 3;
    const sp = this.def.speed * (p3 ? 1.35 : this.bossPhase === 2 ? 1.15 : 1);
    this.bossTimer -= dt;
    // storm aura in phase 2+
    if (this.bossPhase >= 2 && this.alive) {
      this.bossAuraT += dt;
      if (Math.random() < (p3 ? 0.8 : 0.45)) this.world.particles.emit({ pos: this.pos.clone().setY(this.pos.y + rand(0.5, 4)), count: 2, spread: 2, velSpread: 3, life: 0.5, size: 0.15, color: [0xbfe8ff, 0xa080ff, 0xffffff], shape: Shape.SPARK, stretch: 1.2, orbit: 6 });
      if (Math.random() < 0.06) this.world.fx.lightning(this.pos.clone().add(new THREE.Vector3(rand(-3, 3), rand(1, 5), rand(-3, 3))), this.pos.clone().add(new THREE.Vector3(rand(-3, 3), rand(0.5, 4), rand(-3, 3))), 0xbfe8ff, 0.12, 0.05, 0);
    }
    // phase transitions
    if (this.state !== 'phase' && this.state !== 'howl') {
      if (this.bossPhase === 1 && this.hp < this.maxHp * 0.65) { this.startPhase(2); return; }
      if (this.bossPhase === 2 && this.hp < this.maxHp * 0.3) { this.startPhase(3); return; }
    }
    switch (this.state) {
      case 'idle': case 'wander': {
        this.anim = 'idle'; this.stop(dt);
        if (d < this.def.aggroRange && this.player.alive) this.setState('chase');
        break;
      }
      case 'phase': {
        this.anim = 'howl'; this.stop(dt);
        this.invulnerable = true;
        if (this.stateT > 2.8) { this.invulnerable = false; this.setState('chase'); this.bossTimer = 0.5; }
        break;
      }
      case 'howl': {
        // ultimate (phase 3): long telegraph then massive storm burst
        this.anim = 'howl'; this.stop(dt);
        this.facePlayer(dt, 3);
        if (this.stateT < 0.05) { sfx('howl'); this.world.onBossEvent('ultimate', this); this.showTelegraph(this.pos, 16, 2.6, 0xbfe8ff); this.showTelegraph(this.pos, 8, 2.6, 0xff5a5a); }
        if (Math.random() < 0.7) this.world.particles.emit({ pos: this.pos.clone().setY(this.pos.y + 2), count: 3, spread: 6, velSpread: 4, life: 0.7, size: 0.2, color: [0xbfe8ff, 0xffffff], shape: Shape.SPARK, stretch: 1.4, orbit: 8 });
        if (this.stateT > 1.0 && Math.random() < 0.3) { const a = rand(0, Math.PI * 2), r = rand(4, 15); const p = new THREE.Vector3(this.pos.x + Math.cos(a) * r, 0, this.pos.z + Math.sin(a) * r); p.y = this.h(p.x, p.z); this.pendingStrikes.push({ pos: p, t: 0.6, ring: this.showTelegraph(p, 2.4, 0.6, 0xbfe8ff) }); }
        if (this.stateT >= 2.6) {
          // burst: heavy damage within 16u, less beyond 8u
          this.world.fx.burst(this.pos.clone().setY(this.pos.y + 2), 0xbfe8ff, 16, 0.7);
          this.world.fx.shockwave(this.pos, 0xffffff, 40, 1.0);
          this.world.fx.shockwave(this.pos, 0xbfe8ff, 30, 0.8, { y: 0.4 });
          this.world.fx.pillar(this.pos, 0xbfe8ff, 6, 60, 0.9);
          this.world.post.flash(0.9, 0xdff0ff); this.world.post.impactFrame(0.8); this.world.gcam.addTrauma(0.9);
          sfx('lightning', 1.2); sfx('explosion', 0.8);
          const dd = this.distToPlayer();
          const dir = this.player.pos.clone().sub(this.pos).setY(0).normalize();
          if (dd < 16) this.world.combat.hitDirect(this, this.player, dir, this.atk(dd < 8 ? 3.2 : 1.6, { element: 'lightning', knockback: 14, stagger: 1, launch: 8, type: 'ult' }));
          this.setState('recover'); this.bossTimer = 1.2;
        }
        break;
      }
      case 'chase': {
        this.anim = 'run';
        if (!this.player.alive) { this.setState('idle'); break; }
        this.moveToward(this.player.pos, sp, dt, 5);
        if (this.bossTimer <= 0) this.chooseBossAttack(d);
        break;
      }
      case 'circle': {
        this.anim = 'run';
        const toP = this.tmp.copy(this.player.pos).sub(this.pos).setY(0); const dist = toP.length(); toP.normalize();
        const tangent = this.tmp2.set(-toP.z, 0, toP.x).multiplyScalar(this.circleDir);
        const target = this.pos.clone().addScaledVector(tangent, 5).addScaledVector(toP, dist > 12 ? 3 : dist < 7 ? -3 : 0);
        this.moveToward(target, sp * 0.8, dt, 4);
        this.facePlayer(dt, 4);
        if (this.bossTimer <= 0) this.chooseBossAttack(d);
        break;
      }
      case 'windup': {
        this.stop(dt, 5); this.facePlayer(dt, this.bossPattern === 1 ? 2 : 6);
        this.anim = this.bossPattern === 0 ? 'attack2' : this.bossPattern === 1 ? 'lunge' : this.bossPattern === 2 ? 'howl' : this.bossPattern === 3 ? 'lunge' : 'cast';
        const wind = [0.5, 0.8, 0.7, 0.75, 0.9, 1.0, 0.7, 0.35][this.bossPattern] * (p3 ? 0.8 : 1);
        if (this.stateT >= wind) { this.setState('attack'); this.hitDone = false; this.bossCombo = 0; }
        break;
      }
      case 'attack': this.updateBossAttack(dt, d, sp); break;
      case 'recover': {
        this.anim = 'idle'; this.stop(dt, 5);
        if (this.bossTimer <= 0) { this.setState(Math.random() < 0.5 ? 'circle' : 'chase'); this.circleDir = Math.random() < 0.5 ? 1 : -1; this.bossTimer = rand(0.4, 1.2) * (p3 ? 0.6 : 1); }
        break;
      }
      case 'stagger': {
        this.anim = 'hit'; this.stop(dt, 5);
        if (this.stateT >= this.staggerT) this.setState('chase');
        break;
      }
      case 'launched': {
        this.anim = 'launch';
        if (this.grounded && this.stateT > 0.2) { this.setState('stagger'); this.staggerT = 0.5; this.world.fx.landDust(this.pos, 2); }
        break;
      }
      case 'blink': {
        // teleport-like dash: vanish, reappear beside the player
        this.anim = 'lunge';
        if (this.stateT < 0.05) { this.world.particles.emit({ pos: this.pos.clone().setY(this.pos.y + 2), count: 40, velSpread: 8, life: 0.5, size: 0.25, color: [0xbfe8ff, 0xffffff], shape: Shape.SPARK, stretch: 1 }); this.root.visible = false; sfx('dash', 1.2); }
        if (this.stateT > 0.35 && !this.root.visible) {
          const a = rand(0, Math.PI * 2);
          this.pos.set(this.player.pos.x + Math.cos(a) * 4.5, 0, this.player.pos.z + Math.sin(a) * 4.5); this.pos.y = this.h(this.pos.x, this.pos.z);
          this.root.visible = true;
          this.facePlayer(1, 100);
          this.world.particles.emit({ pos: this.pos.clone().setY(this.pos.y + 2), count: 40, velSpread: 8, life: 0.5, size: 0.25, color: [0xbfe8ff, 0xffffff], shape: Shape.SPARK, stretch: 1 });
          this.world.fx.shockwave(this.pos, 0xbfe8ff, 5, 0.4);
          this.showTelegraph(this.pos.clone().addScaledVector(this.facing(), 2.5), 4, 0.4, 0xff5a5a);
        }
        if (this.stateT > 0.75) { this.bossPattern = 0; this.setState('attack'); this.hitDone = false; this.bossCombo = 0; }
        break;
      }
      default: this.setState('chase');
    }
  }

  private startPhase(n: number) {
    this.bossPhase = n;
    this.setState('phase');
    sfx('howl');
    sfx('phase');
    this.world.onBossEvent(n === 2 ? 'phase2' : 'phase3', this);
    this.world.fx.shockwave(this.pos, 0xbfe8ff, 20, 1.2);
    this.world.fx.pillar(this.pos, 0xbfe8ff, 3, 40, 1.5);
    this.world.particles.emit({ pos: this.pos.clone().setY(this.pos.y + 2), count: 80, velSpread: 14, velUp: 6, life: 1.2, size: 0.2, color: [0xbfe8ff, 0xa080ff, 0xffffff], shape: Shape.SPARK, stretch: 1.2, drag: 1 });
    if (this.rig.eyes) this.rig.eyes.color.set(n === 3 ? 0xff7ad0 : 0xbfe8ff);
    this.world.gcam.addTrauma(0.6);
    this.world.post.flash(0.5, 0xbfe8ff);
    // push player back
    const dir = this.player.pos.clone().sub(this.pos).setY(0).normalize();
    this.world.combat.hitDirect(this, this.player, dir, { damage: 1, type: 'heavy', knockback: 12, stagger: 0.5, launch: 3, unblockable: true } as any);
  }

  private chooseBossAttack(d: number) {
    const p2 = this.bossPhase >= 2, p3 = this.bossPhase === 3;
    let options: number[] = [];
    if (d < 6) options = [0, 0, 0, 3]; // claw combo, leap
    else if (d < 14) options = [1, 2, 3, 0]; // charge, wind blade, leap
    else options = [1, 1, 2, 3];
    if (p2) options.push(4, 5, 6); // tornado, lightning zones, triple wind, teleport
    if (p2) options.push(7);
    if (p3 && Math.random() < 0.22 && d < 30) { this.setState('howl'); return; }
    this.bossPattern = options[Math.floor(Math.random() * options.length)];
    if (this.bossPattern === 7) { this.setState('blink'); return; }
    this.setState('windup');
    const f = this.facing();
    if (this.bossPattern === 0) this.showTelegraph(this.pos.clone().addScaledVector(f, 2.5), 4.2, 0.5, 0xff5a5a);
    if (this.bossPattern === 1) { for (let i = 1; i <= 4; i++) this.showTelegraph(this.pos.clone().addScaledVector(f, i * 5), 3, 0.8, 0xff5a5a); }
    if (this.bossPattern === 3) { const lp = this.player.pos.clone(); this.showTelegraph(lp, 5.5, 0.75, 0xff5a5a); (this as any).leapTarget = lp; }
    if (this.bossPattern === 5) {
      for (let i = 0; i < (p3 ? 5 : 3); i++) { const a = rand(0, Math.PI * 2), r = i === 0 ? 0 : rand(2, 7); const p = this.player.pos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)); p.y = this.h(p.x, p.z); this.pendingStrikes.push({ pos: p, t: 1.0 + i * 0.15, ring: this.showTelegraph(p, 2.6, 1.0 + i * 0.15, 0xbfe8ff) }); }
    }
    if (this.bossPattern === 2 || this.bossPattern === 6) sfx('wind', 0.8);
    else sfx('growl', 1);
  }

  private updateBossAttack(dt: number, d: number, sp: number) {
    const f = this.facing();
    const p3 = this.bossPhase === 3;
    const fast = p3 ? 0.78 : 1;
    switch (this.bossPattern) {
      case 0: {
        // claw combo: 3 swipes
        const swingDur = 0.55 * fast;
        const k = this.stateT / swingDur;
        this.anim = this.bossCombo % 2 === 0 ? 'attack2' : 'attack';
        if (k < 0.3) { this.vel.x = f.x * 6; this.vel.z = f.z * 6; } else this.stop(dt, 8);
        this.facePlayer(dt, 3);
        if (!this.hitDone && k >= 0.35) { this.hitDone = true; if (this.meleeHit(1.0, 4.0, 2.6, { knockback: 7, stagger: 0.45 })) this.world.gcam.addTrauma(0.25); this.world.fx.slash(this.pos.clone().setY(this.pos.y + 2).addScaledVector(f, 3), f, 0xdff0ff, 3.5, 0.25, { wide: true, tilt: this.bossCombo % 2 ? 0.8 : -0.8 }); sfx('slashHeavy', 0.8); }
        if (k >= 1) { this.bossCombo++; this.stateT = 0; this.hitDone = false; if (this.bossCombo >= 3) { this.setState('recover'); this.bossTimer = 0.9 * fast; } else this.showTelegraph(this.pos.clone().addScaledVector(f, 2.5), 4.2, 0.35, 0xff5a5a); }
        break;
      }
      case 1: {
        // charge
        this.anim = 'lunge';
        const csp = sp * 2.4;
        if (this.stateT < 0.85) { this.vel.x = f.x * csp; this.vel.z = f.z * csp; this.world.fx.dust(this.pos, 4, 0.9); if (Math.random() < 0.5) this.world.fx.dashStreak(this.pos.clone().setY(this.pos.y + 1), f, 0xdff0ff); }
        else this.stop(dt, 6);
        if (!this.hitDone && this.stateT < 0.9) { if (this.meleeHit(1.4, 3.6, 2.6, { knockback: 12, stagger: 0.7, launch: 5 })) { this.hitDone = true; this.world.gcam.addTrauma(0.4); } }
        if (this.stateT >= 1.3) { this.setState('recover'); this.bossTimer = 1.0 * fast; }
        break;
      }
      case 2: case 6: {
        // wind blade(s)
        this.anim = 'howl';
        this.stop(dt, 6);
        this.facePlayer(dt, 4);
        const count = this.bossPattern === 6 ? 3 : 1;
        if (!this.hitDone && this.stateT > 0.2) {
          this.hitDone = true;
          for (let i = 0; i < count; i++) {
            const ang = (i - (count - 1) / 2) * 0.35;
            const dir = f.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), ang);
            const geo = new THREE.TorusGeometry(1.4, 0.18, 6, 24, Math.PI);
            const m = new THREE.Mesh(geo, createGlowMaterial(0xbfffe0, 1));
            m.position.copy(this.pos).setY(this.pos.y + 1.6).addScaledVector(dir, 3);
            m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
            this.world.scene.add(m);
            this.windBlades.push({ m, dir, t: 0, hit: false });
          }
          this.world.fx.slash(this.pos.clone().setY(this.pos.y + 2).addScaledVector(f, 3), f, 0xbfffe0, 4, 0.3, { wide: true });
          sfx('wind', 1.2);
        }
        if (this.stateT >= 0.7) { this.setState('recover'); this.bossTimer = 1.1 * fast; }
        break;
      }
      case 3: {
        // leap attack to the marked point
        this.anim = 'lunge';
        const target = (this as any).leapTarget as THREE.Vector3;
        if (this.stateT < 0.05) { const dx = target.x - this.pos.x, dz = target.z - this.pos.z; const dd = Math.hypot(dx, dz) || 1; const tt = 0.7; this.vel.set(dx / tt, 14, dz / tt); this.grounded = false; sfx('jump', 1.5); }
        if (this.grounded && this.stateT > 0.3 && !this.hitDone) {
          this.hitDone = true;
          this.world.fx.landDust(this.pos, 3); this.world.fx.shockwave(this.pos, 0xff7a5a, 8, 0.6); this.world.gcam.addTrauma(0.5); sfx('slam', 1.2);
          this.world.combat.hit(this, 'player', this.pos.clone().setY(this.pos.y + 1), f, this.atk(1.6, { radius: 5.5, knockback: 10, stagger: 0.7, launch: 6 }));
          this.world.fx.groundMark(this.pos, 0x2a2030, 5, 8);
        }
        if (this.hitDone && this.stateT > 0.9) { this.setState('recover'); this.bossTimer = 0.8 * fast; }
        if (this.stateT > 2.5) { this.setState('recover'); this.bossTimer = 0.5; }
        break;
      }
      case 4: {
        // tornado
        this.anim = 'howl'; this.stop(dt, 5);
        if (!this.hitDone && this.stateT > 0.3) {
          this.hitDone = true;
          const g = new THREE.Group();
          for (let i = 0; i < 4; i++) { const ring = new THREE.Mesh(new THREE.TorusGeometry(1 + i * 0.7, 0.12, 6, 24), createGlowMaterial(0xbfffe0, 0.7)); ring.rotation.x = Math.PI / 2; ring.position.y = 0.5 + i * 1.6; g.add(ring); }
          const cone = new THREE.Mesh(new THREE.ConeGeometry(3.2, 7, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }));
          cone.rotation.x = Math.PI; cone.position.y = 3.5; g.add(cone);
          const p = this.pos.clone().addScaledVector(f, 4);
          g.position.copy(p);
          this.world.scene.add(g);
          this.tornado = { pos: p, t: 0, mesh: g };
          sfx('wind', 1.4);
          this.world.fx.shockwave(p, 0xbfffe0, 6, 0.5);
        }
        if (this.stateT >= 0.9) { this.setState('recover'); this.bossTimer = 1.2 * fast; }
        break;
      }
      case 5: {
        this.anim = 'howl'; this.stop(dt, 5);
        if (this.stateT >= 1.2) { this.setState('recover'); this.bossTimer = 0.9 * fast; }
        break;
      }
      default: this.setState('recover'); this.bossTimer = 0.6;
    }
  }

  // ---------------- physics ----------------
  private physics(dt: number) {
    if (!this.grounded) this.vel.y -= GRAVITY * dt;
    else { this.vel.x *= Math.max(0, 1 - 2 * dt); this.vel.z *= Math.max(0, 1 - 2 * dt); }
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt; this.pos.y += this.vel.y * dt;
    this.pos.x = clamp(this.pos.x, -225, 225); this.pos.z = clamp(this.pos.z, -225, 225);
    if (this.kind !== 'wisp' || this.state === 'launched') this.world.colliders.resolve(this.pos, this.radius * 0.8, this.pos.y + 0.5);
    // separate from other enemies a bit
    for (const c of this.world.combat.combatants) {
      if (c === this || c.team !== 'enemy' || !c.alive) continue;
      const dx = this.pos.x - c.pos.x, dz = this.pos.z - this.pos.z;
      void dz;
      const ddx = this.pos.x - c.pos.x, ddz = this.pos.z - c.pos.z;
      const dd = Math.hypot(ddx, ddz);
      const min = this.radius + c.radius;
      if (dd < min && dd > 0.001) { const push = (min - dd) * 0.5; this.pos.x += (ddx / dd) * push; this.pos.z += (ddz / dd) * push; }
      void dx;
    }
    // player separation (don't overlap the player)
    {
      const p = this.player;
      const ddx = this.pos.x - p.pos.x, ddz = this.pos.z - p.pos.z;
      const dd = Math.hypot(ddx, ddz);
      const min = this.radius + p.radius;
      if (dd < min && dd > 0.001 && this.kind !== 'wisp') { const push = (min - dd) * 0.6; this.pos.x += (ddx / dd) * push; this.pos.z += (ddz / dd) * push; }
    }
    const gy = this.h(this.pos.x, this.pos.z);
    if (this.pos.y <= gy + 0.02) {
      if (!this.grounded && this.vel.y < -6) { this.world.fx.dust(this.pos, 4, 0.5); }
      this.pos.y = gy; this.vel.y = 0; this.grounded = true;
    } else if (this.grounded && this.pos.y > gy + 0.3) this.grounded = false;
    else if (this.grounded) this.pos.y = gy;
  }

  private updateDevoured(dt: number) {
    this.devourT += dt;
    const k = Math.min(1, this.devourT / 0.9);
    this.rig.setDissolve(k);
    // spiral toward the player
    const to = this.devourTo.clone().setY(this.devourTo.y + 0.6).sub(this.pos);
    this.pos.addScaledVector(to, dt * 3.5 * k);
    this.root.position.copy(this.pos);
    this.root.scale.setScalar(Math.max(0.05, 1 - k * 0.9));
    this.root.rotation.y += dt * 12;
    this.rig.animate('hit', this.world.time.elapsed, dt, 0, this.stateT);
    if (Math.random() < 0.9) this.world.particles.emit({ pos: this.pos.clone().setY(this.pos.y + this.height * 0.5 * (1 - k)), count: 3, spread: 0.5, life: 0.5, size: 0.18, color: [0x9a40ff, 0xc39bff, 0xffffff], shape: Shape.GLOW, vel: { x: to.x * 3, y: 2, z: to.z * 3 } });
    if (this.devourT >= 0.95) { this.onDeath?.(this, true); this.dispose(); }
  }

  private updateDead(dt: number) {
    this.deathT += dt;
    this.anim = 'die';
    this.physics(dt);
    this.root.position.copy(this.pos);
    this.rig.animate('die', this.world.time.elapsed, dt, 0, this.stateT);
    const k = clamp((this.deathT - 0.6) / 1.0, 0, 1);
    this.rig.setDissolve(k);
    if (k > 0 && Math.random() < 0.5) this.world.particles.emit({ pos: this.pos.clone().setY(this.pos.y + rand(0, this.height * 0.6)), count: 2, spread: this.radius, velUp: 2, life: 1, size: 0.12, color: [0xffffff, 0xc8a8ff, 0x86d3ff], shape: Shape.GLOW });
    if (this.deathT > 1.7) this.dispose();
  }
}
