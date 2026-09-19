import * as THREE from 'three';
import { PlayerModel } from './PlayerModel';
import { Input } from '../core/Input';
import { Time } from '../core/Time';
import { GameCamera } from '../core/Camera';
import { Terrain, Colliders } from '../world/Terrain';
import { Combat, Combatant, HitInfo, AttackSpec, newId } from '../combat/Combat';
import { SkillSystem, SkillContext } from '../combat/Skills';
import { Progression } from '../progression/Progression';
import { Effects } from '../vfx/Effects';
import { Particles, Shape } from '../vfx/Particles';
import { PostFX } from '../render/PostFX';
import { SKILLS, SkillId } from '../progression/Data';
import { sfx } from '../audio/Audio';
import { damp, dampAngle, clamp, rand, lerp, easeOutCubic } from '../core/Math';
import { events } from '../core/Events';

type State = 'idle' | 'move' | 'air' | 'dodge' | 'attack' | 'heavy' | 'cast' | 'hit' | 'launched' | 'dead' | 'ult' | 'dive';

interface AttackDef {
  dur: number; hitAt: number; cancelAt: number; mult: number; radius: number; arc: number; knockback: number; launch: number; stagger: number; hitstop: number; type: 'light' | 'heavy';
  lunge: number; anim: (p: number, m: PlayerModel) => void; sound: string; slashTilt: number; aerial?: boolean; wide?: boolean; hover?: boolean;
}

const RUN_SPEED = 7.2, SPRINT_SPEED = 11.5, GRAVITY = 28, JUMP_V = 10.5;

export class Player implements Combatant, SkillContext {
  id = newId();
  name = 'Rimura';
  team: 'player' = 'player';
  pos = new THREE.Vector3(0, 0, 4);
  vel = new THREE.Vector3();
  radius = 0.45;
  height = 1.0;
  alive = true;
  targetable = true;
  root = new THREE.Group();
  model = new PlayerModel();
  facing = new THREE.Vector3(0, 0, 1);
  yaw = 0;
  state: State = 'idle';
  stateT = 0;
  grounded = true;
  target: Combatant | null = null;
  invulnerable = false;
  sprinting = false;
  private sprintHeld = false;
  private comboIndex = 0;
  private comboT = 0;
  private aerialIndex = 0;
  private attack: AttackDef | null = null;
  private attackHitDone = false;
  private hitSet = new Set<number>();
  private queued: 'light' | 'heavy' | null = null;
  private dodgeDir = new THREE.Vector3();
  private moveInput = new THREE.Vector3();
  private lastGroundY = 0;
  private fallSpeed = 0;
  private stepT = 0;
  private castT = 0;
  private castId: SkillId | null = null;
  private hitStunT = 0;
  private flashT = 0;
  private wasGrounded = true;
  private airTime = 0;
  private dodgeCooldown = 0;
  private perfectWindow = false;
  private jumpBuffer = 0;
  private coyote = 0;
  private attackVisualT = 0;
  private ultRise = 0;
  private landedHeavy = false;
  combo = 0;
  comboTimer = 0;
  comboMax = 3.5;
  inCombat = false;
  private combatT = 0;
  tips: string[] = [];
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  onDeath: (() => void) | null = null;
  onPerfectDodge: (() => void) | null = null;
  bladeColor = 0x9fe8ff;

  constructor(
    public input: Input, public time: Time, public gcam: GameCamera, public terrain: Terrain, public colliders: Colliders,
    public combat: Combat, public skills: SkillSystem, public prog: Progression, public fx: Effects, public particles: Particles, public post: PostFX
  ) {
    this.root.add(this.model.root);
    this.combat.register(this);
    this.skills.onCastStart = (id, castTime, ult) => {
      if (ult) { this.state = 'ult'; this.stateT = 0; this.ultRise = 0; this.model.setMood('focused', 4); }
      else { this.state = 'cast'; this.stateT = 0; this.castT = castTime; this.castId = id; this.model.setMood('focused', 1); this.model.squashTo(0.9, 1.15); this.model.impulseWobble(0.6); }
    };
    this.skills.onUltEnd = () => { if (this.state === 'ult') { this.state = 'idle'; this.model.setMood('happy', 1.5); } };
  }

  get combatant() { return this as unknown as Combatant; }
  get hp() { return this.prog.hp; }
  set hp(v: number) { this.prog.hp = v; }
  get maxHp() { return this.prog.maxHp; }
  /** set by the game when an interaction prompt is active (F is used for interact instead of Predator) */
  interactNearby = false;

  aimPoint(maxDist: number) {
    if (this.target && this.target.alive && this.target.pos.distanceTo(this.pos) < maxDist + 4) return this.target.pos.clone();
    // nearest enemy in facing cone
    let best: Combatant | null = null, bestD = maxDist;
    for (const e of this.combat.enemies()) {
      const d = e.pos.distanceTo(this.pos);
      if (d > bestD) continue;
      const to = this.tmp.copy(e.pos).sub(this.pos).setY(0).normalize();
      if (to.dot(this.facing) > 0.55) { best = e; bestD = d; }
    }
    if (best) return best.pos.clone();
    return this.pos.clone().addScaledVector(this.facing, Math.min(maxDist, 6));
  }

  spawn(p: THREE.Vector3) {
    this.pos.copy(p);
    this.pos.y = this.terrain.heightAt(p.x, p.z);
    this.vel.set(0, 0, 0);
    this.alive = true;
    this.state = 'idle';
    this.prog.hp = this.prog.maxHp;
    this.prog.mp = this.prog.maxMp;
    this.model.setDissolve(0);
    this.model.root.scale.setScalar(1);
    this.model.setMood('normal');
    this.root.position.copy(this.pos);
  }

  // ---------------- attacks ----------------
  private attacks: AttackDef[] = [
    { dur: 0.34, hitAt: 0.1, cancelAt: 0.2, mult: 1.0, radius: 1.9, arc: 2.6, knockback: 2.5, launch: 0, stagger: 0.3, hitstop: 0.045, type: 'light', lunge: 2.2, sound: 'slash', slashTilt: 0.3,
      anim: (p, m) => { m.bladePivot.rotation.set(0, lerp(1.6, -1.8, easeOutCubic(Math.min(1, p / 0.5))), 0.3); m.squashTo(1.1, 0.9); } },
    { dur: 0.34, hitAt: 0.1, cancelAt: 0.2, mult: 1.05, radius: 1.9, arc: 2.6, knockback: 2.5, launch: 0, stagger: 0.3, hitstop: 0.045, type: 'light', lunge: 2.4, sound: 'slash', slashTilt: -0.3,
      anim: (p, m) => { m.bladePivot.rotation.set(0, lerp(-1.6, 1.8, easeOutCubic(Math.min(1, p / 0.5))), -0.3); m.squashTo(1.1, 0.9); } },
    { dur: 0.46, hitAt: 0.16, cancelAt: 0.3, mult: 1.35, radius: 2.4, arc: 6.3, knockback: 4, launch: 0, stagger: 0.4, hitstop: 0.06, type: 'light', lunge: 1.5, sound: 'slashHeavy', slashTilt: 0.05, wide: true,
      anim: (p, m) => { m.bladePivot.rotation.set(0, lerp(0, Math.PI * 2.2, easeOutCubic(Math.min(1, p / 0.7))), 0.1); m.root.rotation.y = 0; m.squashTo(1.2, 0.8); } },
    { dur: 0.5, hitAt: 0.18, cancelAt: 0.34, mult: 1.6, radius: 2.0, arc: 2.2, knockback: 1, launch: 8.5, stagger: 0.7, hitstop: 0.08, type: 'heavy', lunge: 2.0, sound: 'launch', slashTilt: 1.5,
      anim: (p, m) => { const k = easeOutCubic(Math.min(1, p / 0.45)); m.bladePivot.rotation.set(lerp(1.2, -1.9, k), 0.2, 0); m.squashTo(0.85, 1.25); } },
  ];
  private aerials: AttackDef[] = [
    { dur: 0.36, hitAt: 0.1, cancelAt: 0.22, mult: 1.1, radius: 2.1, arc: 6.3, knockback: 1, launch: 3, stagger: 0.35, hitstop: 0.05, type: 'light', lunge: 1.2, sound: 'slash', slashTilt: 0.2, aerial: true, hover: true, wide: true,
      anim: (p, m) => { m.bladePivot.rotation.set(0.2, lerp(0, Math.PI * 2, easeOutCubic(Math.min(1, p / 0.6))), 0); m.squashTo(1.15, 0.85); } },
    { dur: 0.36, hitAt: 0.1, cancelAt: 0.22, mult: 1.15, radius: 2.1, arc: 6.3, knockback: 1, launch: 3.5, stagger: 0.35, hitstop: 0.05, type: 'light', lunge: 1.2, sound: 'slash', slashTilt: -0.2, aerial: true, hover: true, wide: true,
      anim: (p, m) => { m.bladePivot.rotation.set(-0.2, lerp(0, -Math.PI * 2, easeOutCubic(Math.min(1, p / 0.6))), 0); m.squashTo(1.15, 0.85); } },
  ];
  private diveAttack: AttackDef = { dur: 0.9, hitAt: 0.99, cancelAt: 0.99, mult: 2.4, radius: 3.4, arc: 6.3, knockback: 6, launch: 0, stagger: 0.7, hitstop: 0.09, type: 'heavy', lunge: 0, sound: 'slam', slashTilt: 0, aerial: true,
    anim: (p, m) => { m.bladePivot.rotation.set(1.4, p * 20, 0); m.squashTo(0.8, 1.4); } };
  private heavyAttack: AttackDef = { dur: 0.75, hitAt: 0.42, cancelAt: 0.6, mult: 2.6, radius: 2.4, arc: 2.4, knockback: 7, launch: 2, stagger: 0.8, hitstop: 0.1, type: 'heavy', lunge: 7, sound: 'slashHeavy', slashTilt: 0.9, wide: true,
    anim: (p, m) => { if (p < 0.4) { m.squashTo(1.25, 0.7); m.bladePivot.rotation.set(0, 2.2, 0.4); } else { const k = easeOutCubic(Math.min(1, (p - 0.4) / 0.35)); m.bladePivot.rotation.set(0, lerp(2.2, -2.4, k), 0.4); m.squashTo(0.8, 1.35); } } };

  private startAttack(a: AttackDef, state: State = 'attack') {
    this.attack = a;
    this.state = state;
    this.stateT = 0;
    this.attackHitDone = false;
    this.hitSet.clear();
    this.queued = null;
    this.model.showBlade(true, this.bladeColor);
    this.model.setMood('angry', a.dur + 0.2);
    this.model.impulseWobble(0.4);
    // face target / input
    if (this.target && this.target.alive) this.faceTowards(this.target.pos, true);
    else if (this.moveInput.lengthSq() > 0.01) this.faceTowards(this.pos.clone().add(this.moveInput), true);
    this.enterCombat();
  }

  private faceTowards(p: THREE.Vector3, snap = false) {
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
    if (Math.abs(dx) + Math.abs(dz) < 0.01) return;
    const y = Math.atan2(dx, dz);
    if (snap) { this.yaw = y; this.facing.set(Math.sin(y), 0, Math.cos(y)); }
    else this.yaw = dampAngle(this.yaw, y, 14, this.time.dt);
  }

  private enterCombat() { this.inCombat = true; this.combatT = 5; }

  // ---------------- hit reception ----------------
  takeHit(hit: HitInfo): boolean {
    if (!this.alive) return false;
    if (this.invulnerable && !hit.unblockable) {
      if (this.perfectWindow) this.perfectDodge();
      return false;
    }
    if (this.state === 'ult') { hit.damage = Math.round(hit.damage * 0.3); }
    let dmg = hit.damage * (1 - this.prog.def);
    if (hit.element === 'fire') dmg *= 1 - this.prog.fireRes;
    dmg = Math.max(1, Math.round(dmg));
    hit.damage = dmg;
    this.prog.hp -= dmg;
    this.flashT = 0.12;
    this.model.impulseWobble(1.2);
    this.model.setMood('hurt', 0.6);
    this.post.hurt(Math.min(1, dmg / this.prog.maxHp * 4 + 0.25));
    this.gcam.addTrauma(0.25 + Math.min(0.4, dmg / 40));
    this.gcam.addPunch(hit.dir, 0.25);
    this.enterCombat();
    this.combo = 0;
    if (this.state !== 'ult') {
      if (hit.launch > 0) {
        this.state = 'launched'; this.stateT = 0;
        this.vel.y = hit.launch * 0.8; this.vel.x = hit.dir.x * hit.knockback * 1.5; this.vel.z = hit.dir.z * hit.knockback * 1.5;
        this.grounded = false;
      } else if (hit.stagger > 0.1) {
        this.state = 'hit'; this.stateT = 0; this.hitStunT = Math.min(0.5, hit.stagger);
        this.vel.x = hit.dir.x * hit.knockback * 2; this.vel.z = hit.dir.z * hit.knockback * 2;
        this.attack = null; this.model.showBlade(false);
      }
    }
    if (this.prog.hp <= 0) this.die();
    return true;
  }

  private perfectDodge() {
    this.perfectWindow = false;
    this.time.slowmo(this.prog.traits.has('advancedPerception') ? 1.2 : 0.75, 0.22);
    this.post.flash(0.35, 0xbfe8ff);
    this.post.speedLinesTarget = 0.6;
    setTimeout(() => (this.post.speedLinesTarget = 0), 500);
    this.prog.mp = Math.min(this.prog.maxMp, this.prog.mp + 15);
    this.fx.shockwave(this.pos, 0xbfe8ff, 3, 0.5, { y: 0.5 });
    this.particles.emit({ pos: this.pos.clone().setY(this.pos.y + 0.5), count: 24, velSpread: 6, life: 0.6, size: 0.15, color: [0xbfe8ff, 0xffffff], shape: Shape.STAR, drag: 3 });
    sfx('perfectDodge');
    this.model.setMood('happy', 1);
    this.onPerfectDodge?.();
    events.emit('perfectDodge');
  }

  private die() {
    this.alive = false;
    this.state = 'dead';
    this.stateT = 0;
    this.model.showBlade(false);
    this.model.setMood('closed');
    sfx('death');
    this.gcam.lockTarget = null;
    this.target = null;
    this.onDeath?.();
  }

  heal(amount: number) {
    this.prog.hp = Math.min(this.prog.maxHp, this.prog.hp + amount);
    this.fx.healSparkles(this.pos);
  }

  // ---------------- update ----------------
  update(dt: number, allowInput: boolean) {
    const input = this.input;
    const rawDt = this.time.rawDt;
    this.stateT += dt;
    this.combatT -= dt; if (this.combatT <= 0) this.inCombat = false;
    this.dodgeCooldown = Math.max(0, this.dodgeCooldown - dt);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.coyote = Math.max(0, this.coyote - dt);
    if (this.comboTimer > 0) { this.comboTimer -= dt; if (this.comboTimer <= 0) this.combo = 0; }
    this.flashT = Math.max(0, this.flashT - rawDt);
    this.model.setFlash(this.flashT > 0 ? 0.9 : 0);
    this.prog.tick(dt, this.inCombat);
    this.model.setPower(this.prog.power);

    // target validity
    if (this.target && (!this.target.alive || this.target.pos.distanceTo(this.pos) > 45)) { this.target = null; this.gcam.lockTarget = null; }

    // movement input relative to camera
    const ax = allowInput ? input.axis() : { x: 0, y: 0 };
    const fwd = this.gcam.getForward(this.tmp), right = this.gcam.getRight(this.tmp2);
    this.moveInput.set(0, 0, 0).addScaledVector(fwd, ax.y).addScaledVector(right, ax.x);
    const hasMove = this.moveInput.lengthSq() > 0.01;
    if (hasMove) this.moveInput.normalize();

    if (this.state === 'dead') { this.updateDead(dt); this.applyPhysics(dt, 0); this.updateVisual(dt); return; }

    // ---- input: lock target ----
    if (allowInput && (input.justPressed('Tab') || input.mouseJustPressed(1))) this.toggleLock();
    if (allowInput && input.justPressed('Space')) this.jumpBuffer = 0.15;
    this.sprintHeld = allowInput && input.down('ShiftLeft');

    const canAct = this.state === 'idle' || this.state === 'move' || this.state === 'air' || (this.state === 'attack' && this.attack && this.stateT >= this.attack.cancelAt) || (this.state === 'cast' && this.stateT > this.castT * 0.5) || (this.state === 'heavy' && this.attack && this.stateT >= this.attack.cancelAt);
    const canDodge = (canAct || this.state === 'attack' || this.state === 'heavy' || this.state === 'cast') && this.dodgeCooldown <= 0 && this.state !== 'hit' && this.state !== 'launched' && this.state !== 'ult' && this.state !== 'dive';

    if (allowInput) {
      // queue attacks during current attack
      if (input.mouseJustPressed(0)) this.queued = 'light';
      if (input.mouseJustPressed(2)) this.queued = 'heavy';
      // dodge
      if (input.justPressed('ShiftLeft') && canDodge) this.startDodge();
      // skills
      if (canAct && this.state !== 'cast') {
        for (const id of Object.keys(SKILLS) as SkillId[]) {
          const def = SKILLS[id];
          if (input.justPressed(def.keyCode) && this.prog.hasSkill(id) && !(id === 'predator' && this.interactNearby)) {
            if (this.grounded || id === 'windCutter' || id === 'waterBlade') {
              const ct = this.skills.cast(id, this);
              if (ct >= 0) { this.model.showBlade(false); this.attack = null; this.enterCombat(); events.emit('skillUsed', id); if (this.target) this.faceTowards(this.target.pos, true); else if (hasMove) this.faceTowards(this.pos.clone().add(this.moveInput), true); }
            }
          }
        }
      }
    }

    // ---- state machine ----
    switch (this.state) {
      case 'idle': case 'move': {
        if (this.queued && canAct) this.consumeQueued();
        else if (this.jumpBuffer > 0 && (this.grounded || this.coyote > 0)) this.jump();
        else this.updateGroundMove(dt, hasMove);
        break;
      }
      case 'air': {
        if (this.queued === 'light') { const a = this.aerials[this.aerialIndex % 2]; if (this.aerialIndex < 2) { this.aerialIndex++; this.startAttack(a); } else { this.startDive(); } }
        else if (this.queued === 'heavy') this.startDive();
        this.queued = null;
        this.updateAirMove(dt, hasMove);
        break;
      }
      case 'attack': case 'heavy': {
        this.updateAttack(dt, hasMove);
        break;
      }
      case 'dive': {
        this.updateDive(dt);
        break;
      }
      case 'dodge': {
        this.updateDodge(dt);
        break;
      }
      case 'cast': {
        this.vel.x = damp(this.vel.x, 0, 12, dt); this.vel.z = damp(this.vel.z, 0, 12, dt);
        if (this.target) this.faceTowards(this.target.pos);
        if (this.stateT >= this.castT) { this.state = 'idle'; this.model.squashTo(1, 1); }
        else if (this.queued && this.stateT > this.castT * 0.6) { this.consumeQueued(); }
        break;
      }
      case 'ult': {
        this.vel.x = damp(this.vel.x, 0, 10, dt); this.vel.z = damp(this.vel.z, 0, 10, dt);
        this.ultRise = damp(this.ultRise, this.skills.ultActive && this.skills.ultChargeT < 1 ? 1.6 : 0.2, 2.5, dt);
        if (!this.skills.ultHold) this.yaw += dt * 0.8;
        this.model.squashTo(0.95, 1.1);
        if (!this.skills.ultActive) { this.state = 'idle'; }
        break;
      }
      case 'hit': {
        this.vel.x = damp(this.vel.x, 0, 8, dt); this.vel.z = damp(this.vel.z, 0, 8, dt);
        this.model.squashTo(1.15, 0.85);
        if (this.stateT >= this.hitStunT) { this.state = 'idle'; this.model.squashTo(1, 1); }
        break;
      }
      case 'launched': {
        this.model.squashTo(0.85, 1.2);
        if (this.grounded && this.stateT > 0.3) { this.state = 'hit'; this.stateT = 0; this.hitStunT = 0.35; this.fx.landDust(this.pos, 1); }
        break;
      }
    }

    this.applyPhysics(dt, this.state === 'ult' ? this.ultRise : 0);
    this.updateVisual(dt);
    this.updateFeedback(dt, hasMove);
  }

  private consumeQueued() {
    const q = this.queued; this.queued = null;
    if (q === 'light') {
      if (!this.grounded) { if (this.aerialIndex < 2) { this.startAttack(this.aerials[this.aerialIndex++ % 2]); } else this.startDive(); return; }
      // combo timing: continue if within window
      const idx = this.comboIndex % this.attacks.length;
      this.startAttack(this.attacks[idx], idx === 3 ? 'heavy' : 'attack');
      this.comboIndex = idx + 1;
      if (this.comboIndex >= this.attacks.length) this.comboIndex = 0;
      this.comboT = 0;
    } else if (q === 'heavy') {
      if (!this.grounded) { this.startDive(); return; }
      // heavy after 2+ light hits becomes the launcher, otherwise body slam
      if (this.comboIndex >= 2) { this.startAttack(this.attacks[3], 'heavy'); this.comboIndex = 0; }
      else { this.startAttack(this.heavyAttack, 'heavy'); this.comboIndex = 0; }
    }
  }

  private toggleLock() {
    if (this.target) { this.target = null; this.gcam.lockTarget = null; sfx('uiBack', 0.4); return; }
    // nearest enemy in front within 30u, prefer camera-facing
    let best: Combatant | null = null, bestScore = Infinity;
    const fwd = this.gcam.getForward(this.tmp);
    for (const e of this.combat.enemies()) {
      if (!e.targetable) continue;
      const d = e.pos.distanceTo(this.pos);
      if (d > 32) continue;
      const to = this.tmp2.copy(e.pos).sub(this.pos).setY(0).normalize();
      const ang = Math.acos(clamp(to.dot(fwd), -1, 1));
      const score = d * 0.5 + ang * 10;
      if (score < bestScore) { bestScore = score; best = e; }
    }
    if (best) { this.target = best; this.gcam.lockTarget = best.root; this.gcam.lockHeight = best.height; this.gcam.lockRadius = best.radius; sfx('ui', 0.6); this.enterCombat(); }
  }

  private jump() {
    this.jumpBuffer = 0; this.coyote = 0;
    this.vel.y = JUMP_V;
    this.grounded = false;
    this.state = 'air';
    this.stateT = 0;
    this.aerialIndex = 0;
    this.model.squashTo(0.8, 1.3);
    this.model.impulseWobble(0.5);
    this.model.setMood('surprised', 0.3);
    this.fx.dust(this.pos, 6, 0.4);
    sfx('jump');
  }

  private startDodge() {
    this.state = 'dodge'; this.stateT = 0;
    this.dodgeCooldown = 0.45;
    this.attack = null; this.model.showBlade(false);
    this.dodgeDir.copy(this.moveInput.lengthSq() > 0.01 ? this.moveInput : this.facing.clone().multiplyScalar(-1));
    if (this.moveInput.lengthSq() > 0.01) this.faceTowards(this.pos.clone().add(this.dodgeDir), true);
    this.invulnerable = true; this.perfectWindow = true;
    this.model.squashTo(1.35, 0.7);
    this.model.impulseWobble(0.8);
    this.model.setMood('focused', 0.5);
    this.fx.dashStreak(this.pos, this.dodgeDir, 0x9fe6ff);
    this.fx.dust(this.pos, 8, 0.45);
    this.post.speedLinesTarget = 0.35;
    sfx('dash');
  }

  private updateDodge(dt: number) {
    const t = this.stateT;
    const dur = 0.36;
    const sp = 16 * (1 - Math.pow(t / dur, 2)) + 1;
    this.vel.x = this.dodgeDir.x * sp; this.vel.z = this.dodgeDir.z * sp;
    if (t > 0.28) { this.invulnerable = false; this.perfectWindow = false; }
    if (t > 0.15) this.perfectWindow = this.perfectWindow && t < 0.3;
    if (t < 0.25 && Math.random() < 0.6) this.fx.dashStreak(this.pos, this.dodgeDir, 0x9fe6ff);
    if (t >= dur) {
      this.state = 'idle'; this.invulnerable = false; this.perfectWindow = false;
      this.post.speedLinesTarget = 0;
      this.model.squashTo(1, 1);
      if (this.queued) this.consumeQueued();
    }
  }

  private startDive() {
    this.startAttack(this.diveAttack, 'dive');
    this.vel.y = -26; this.vel.x *= 0.3; this.vel.z *= 0.3;
    this.post.speedLinesTarget = 0.5;
    sfx('dash');
  }

  private updateDive(dt: number) {
    this.attack!.anim(this.stateT, this.model);
    this.particles.emit({ pos: this.pos.clone().setY(this.pos.y + 0.5), count: 2, spread: 0.3, life: 0.3, size: 0.2, color: [this.bladeColor, 0xffffff], shape: Shape.SPARK, stretch: 1.5, vel: { x: 0, y: 8, z: 0 } });
    if (this.grounded) {
      // slam
      const a = this.attack!;
      this.post.speedLinesTarget = 0;
      this.combat.hit(this, 'enemy', this.pos.clone().setY(this.pos.y + 0.5), this.facing, this.spec(a), this.hitSet);
      this.fx.landDust(this.pos, 2.2);
      this.fx.shockwave(this.pos, this.bladeColor, 5, 0.5, { y: 0.2 });
      this.fx.burst(this.pos.clone().setY(this.pos.y + 0.4), 0xffffff, 2, 0.25);
      this.gcam.addTrauma(0.5);
      this.time.hitstop(0.05);
      sfx('slam');
      this.state = 'idle'; this.attack = null; this.model.showBlade(false); this.model.squashTo(1.4, 0.6); this.aerialIndex = 0; this.comboIndex = 0;
    }
  }

  private spec(a: AttackDef): AttackSpec {
    return { damage: this.prog.atk * a.mult, type: a.type, element: this.prog.traits.has('stormFang') ? 'lightning' : 'physical', radius: a.radius, arc: a.arc, knockback: a.knockback, launch: a.launch, stagger: a.stagger, hitstop: a.hitstop, critChance: this.prog.critChance };
  }

  private updateAttack(dt: number, hasMove: boolean) {
    const a = this.attack!;
    const p = this.stateT / a.dur;
    a.anim(p, this.model);
    // lunge toward target / forward during first part
    const lungeK = p < 0.35 ? 1 - p / 0.35 : 0;
    let lunge = a.lunge;
    if (this.target && this.target.alive) { const d = this.target.pos.distanceTo(this.pos); lunge = d > 2.2 ? Math.min(a.lunge * 2.2, d * 2.5) : 0; this.faceTowards(this.target.pos); }
    else if (hasMove && p < 0.2) this.faceTowards(this.pos.clone().add(this.moveInput));
    this.vel.x = this.facing.x * lunge * lungeK * 3 + (a.hover ? 0 : this.vel.x * 0.0);
    this.vel.z = this.facing.z * lunge * lungeK * 3;
    if (a.hover && !this.grounded) this.vel.y = Math.max(this.vel.y, -1.5) * 0.85 + 1.2 * (p < 0.3 ? 1 : 0);
    // hit frame
    if (!this.attackHitDone && this.stateT >= a.hitAt) {
      this.attackHitDone = true;
      const center = this.pos.clone().setY(this.pos.y + 0.6).addScaledVector(this.facing, a.arc > 5 ? 0.2 : a.radius * 0.5);
      const hits = this.combat.hit(this, 'enemy', center, this.facing, this.spec(a), this.hitSet);
      this.fx.slash(this.pos.clone().setY(this.pos.y + 0.7).addScaledVector(this.facing, 0.9), this.facing, this.bladeColor, a.wide ? 1.35 : 1.0, 0.2, { tilt: a.slashTilt, wide: a.wide });
      this.particles.emit({ pos: this.pos.clone().setY(this.pos.y + 0.7).addScaledVector(this.facing, 1.0), count: 8, dir: this.facing, cone: 0.5, velSpread: 5, life: 0.3, size: 0.12, color: [this.bladeColor, 0xffffff], shape: Shape.SPARK, stretch: 1.2, drag: 2 });
      sfx(a.sound, 0.9);
      if (hits.length) {
        this.combo += hits.length; this.comboTimer = 1;
        this.prog.mp = Math.min(this.prog.maxMp, this.prog.mp + 2.5 * hits.length);
        this.gcam.addPunch(this.facing, a.type === 'heavy' ? 0.35 : 0.14);
        if (a.type === 'heavy') this.gcam.addTrauma(0.2);
        if (a.launch > 0) { this.time.slowmo(0.25, 0.4); this.vel.y = 6.5; this.grounded = false; this.fx.shockwave(this.pos, this.bladeColor, 3, 0.4, { y: 0.4 }); }
        if (this.prog.traits.has('stormFang')) for (const h of hits) this.fx.lightning(h.pos.clone().setY(h.pos.y + h.height + 1.5), h.pos.clone().setY(h.pos.y + h.height * 0.5), 0xbfe8ff, 0.15, 0.06, 1);
      }
    }
    // end / cancel
    if (this.stateT >= a.dur) {
      this.attack = null; this.model.showBlade(false); this.model.squashTo(1, 1);
      this.state = this.grounded ? 'idle' : 'air';
      this.model.bladePivot.rotation.set(0, 0, 0);
      if (this.queued) this.consumeQueued();
    } else if (this.stateT >= a.cancelAt && this.queued) {
      this.consumeQueued();
    } else if (this.stateT >= a.cancelAt && this.jumpBuffer > 0 && this.grounded) { this.attack = null; this.model.showBlade(false); this.jump(); }
  }

  private updateGroundMove(dt: number, hasMove: boolean) {
    const sprint = this.sprintHeld && hasMove && this.state === 'move';
    this.sprinting = sprint;
    const speed = (sprint ? SPRINT_SPEED : RUN_SPEED) * this.prog.speedMod;
    const accel = hasMove ? 28 : 22;
    const tx = hasMove ? this.moveInput.x * speed : 0, tz = hasMove ? this.moveInput.z * speed : 0;
    this.vel.x = damp(this.vel.x, tx, accel * 0.5, dt);
    this.vel.z = damp(this.vel.z, tz, accel * 0.5, dt);
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.state = sp > 0.5 ? 'move' : 'idle';
    if (hasMove) {
      if (this.target && this.target.alive && this.inCombat && !sprint) this.faceTowards(this.target.pos);
      else this.faceTowards(this.pos.clone().add(this.moveInput));
    } else if (this.target && this.target.alive && this.inCombat) this.faceTowards(this.target.pos);
    // slope: slow uphill slightly
    if (this.comboT > 1.2) this.comboIndex = 0;
    this.comboT += dt;
    // bouncing locomotion
    if (sp > 0.5) {
      const freq = sprint ? 11 : 8;
      const bounce = Math.abs(Math.sin(this.time.elapsed * freq));
      this.model.squashTo(1 + bounce * 0.12 * (sp / speed), 1 - bounce * 0.12 * (sp / speed) + (sprint ? 0.1 : 0));
    } else this.model.squashTo(1, 1);
  }

  private updateAirMove(dt: number, hasMove: boolean) {
    const speed = RUN_SPEED * this.prog.speedMod;
    if (hasMove) {
      this.vel.x = damp(this.vel.x, this.moveInput.x * speed, 5, dt);
      this.vel.z = damp(this.vel.z, this.moveInput.z * speed, 5, dt);
      this.faceTowards(this.pos.clone().add(this.moveInput));
    }
    this.model.squashTo(this.vel.y > 0 ? 0.85 : 1.05, this.vel.y > 0 ? 1.25 : 0.95);
    if (this.grounded) { this.state = 'idle'; this.aerialIndex = 0; }
  }

  private updateDead(dt: number) {
    const k = Math.min(1, this.stateT / 1.6);
    this.model.setDissolve(k);
    this.model.squashTo(1.5, 0.3);
    this.vel.x = damp(this.vel.x, 0, 5, dt); this.vel.z = damp(this.vel.z, 0, 5, dt);
    if (Math.random() < 0.3) this.particles.emit({ pos: this.pos.clone().setY(this.pos.y + 0.3), count: 2, spread: 0.4, velUp: 2, life: 1.2, size: 0.15, color: [0x86d3ff, 0xffffff], shape: Shape.GLOW });
  }

  private applyPhysics(dt: number, hoverY: number) {
    // gravity
    if (!this.grounded) this.vel.y -= GRAVITY * dt;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vel.y * dt;
    // world bounds
    const B = 226;
    this.pos.x = clamp(this.pos.x, -B, B); this.pos.z = clamp(this.pos.z, -B, B);
    // obstacles
    this.colliders.resolve(this.pos, this.radius, this.pos.y + 0.5);
    // ground
    const gy = this.terrain.heightAt(this.pos.x, this.pos.z) + hoverY;
    const wasGrounded = this.grounded;
    if (this.pos.y <= gy + 0.02) {
      if (!wasGrounded && this.vel.y < -3) this.land(-this.vel.y);
      this.pos.y = gy; this.vel.y = Math.max(0, this.vel.y) * 0; this.grounded = true; this.coyote = 0.12;
      // slope handling: slide on steep slopes
      const n = this.terrain.normalAt(this.pos.x, this.pos.z, this.tmp);
      if (n.y < 0.62 && this.state !== 'dodge') { this.vel.x += n.x * 40 * dt; this.vel.z += n.z * 40 * dt; }
    } else {
      if (this.grounded && this.pos.y > gy + 0.35) this.grounded = false;
      else if (this.grounded) { this.pos.y = gy; }
    }
    if (this.grounded && this.state === 'air') { this.state = 'idle'; this.aerialIndex = 0; }
    if (!this.grounded && (this.state === 'idle' || this.state === 'move') && this.pos.y > gy + 0.6) { this.state = 'air'; this.stateT = 0; this.aerialIndex = 0; }
    this.root.position.copy(this.pos);
  }

  private land(speed: number) {
    const strong = speed > 14;
    this.model.squashTo(strong ? 1.5 : 1.3, strong ? 0.55 : 0.7);
    this.model.impulseWobble(strong ? 1.2 : 0.6);
    this.fx.landDust(this.pos, strong ? 1.6 : 0.9);
    if (this.terrain.info(this.pos.x, this.pos.z).forest < 0.9) this.fx.grassBurst(this.pos, strong ? 8 : 4);
    sfx('land', strong ? 1 : 0.6);
    if (strong) this.gcam.addTrauma(0.15);
  }

  private updateVisual(dt: number) {
    const m = this.model;
    m.root.rotation.y = this.yaw;
    // lean into movement
    const sp = Math.hypot(this.vel.x, this.vel.z);
    const lean = clamp(sp / SPRINT_SPEED, 0, 1) * 0.28 * (this.state === 'move' || this.state === 'dodge' ? 1 : 0.3);
    m.root.rotation.x = damp(m.root.rotation.x, lean, 10, dt);
    // spin during dodge
    if (this.state === 'dodge') m.root.rotation.x = -this.stateT * 10;
    // look at target or forward
    if (this.target && this.target.alive) m.lookTarget.copy(this.target.pos).setY(this.target.pos.y + this.target.height * 0.6);
    else m.lookTarget.copy(this.pos).addScaledVector(this.facing, 5).setY(this.pos.y + 0.7);
    m.update(dt, this.time.elapsed);
    this.facing.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  private updateFeedback(dt: number, hasMove: boolean) {
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (this.grounded && sp > 3 && (this.state === 'move')) {
      this.stepT += dt * (this.sprinting ? 9 : 7);
      if (this.stepT >= 1) {
        this.stepT = 0;
        sfx('footstep', this.sprinting ? 0.9 : 0.6);
        const info = this.terrain.info(this.pos.x, this.pos.z);
        this.fx.dust(this.pos, this.sprinting ? 4 : 2, 0.35, 0.25);
        if (info.path < 0.5 && info.water < 0.3 && Math.random() < 0.7) this.fx.grassBurst(this.pos, this.sprinting ? 3 : 1);
        if (info.water > 0.5) this.particles.emit({ pos: this.pos.clone().setY(this.pos.y + 0.1), count: 6, velSpread: 3, velUp: 2.5, life: 0.5, size: 0.12, color: [0x9fe6ff, 0xffffff], shape: Shape.DOT, gravity: 10 });
      }
      if (this.sprinting && Math.random() < 0.35) this.fx.dashStreak(this.pos, this.facing, 0xbfefff);
    }
    this.post.speedLinesTarget = this.state === 'dodge' ? 0.3 : this.state === 'dive' ? 0.5 : this.sprinting ? 0.12 : this.post.speedLinesTarget > 0.3 ? this.post.speedLinesTarget : 0;
  }
}
