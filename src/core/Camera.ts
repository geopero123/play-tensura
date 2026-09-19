import * as THREE from 'three';
import { Input } from './Input';
import { clamp, damp, dampAngle, lerp, angleDiff } from './Math';
import { Terrain, Colliders } from '../world/Terrain';

export type CameraMode = 'explore' | 'combat' | 'cinematic' | 'title';

/** Polished third-person anime camera with lock-on, shake, punch and cinematic control. */
export class GameCamera {
  cam: THREE.PerspectiveCamera;
  yaw = Math.PI;
  pitch = 0.32;
  mode: CameraMode = 'title';
  lockTarget: THREE.Object3D | null = null;
  lockHeight = 1;
  lockRadius = 0.5;
  sprintBlend = 0;
  combatBlend = 0;
  private distance = 6.2;
  private curDist = 6.2;
  private pivot = new THREE.Vector3();
  private smoothPivot = new THREE.Vector3();
  private trauma = 0;
  private shakeT = 0;
  private punch = new THREE.Vector3();
  private punchVel = new THREE.Vector3();
  private fovTarget = 58;
  private fov = 58;
  // cinematic
  private cinePos = new THREE.Vector3();
  private cineLook = new THREE.Vector3();
  private cineLerp = 1;
  private cineFov = 50;
  private cineBlend = 0;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private forward = new THREE.Vector3(0, 0, -1);
  private terrain: Terrain | null = null;
  private colliders: Colliders | null = null;
  shakeScale = 1;
  sensitivity = 1;
  invertY = false;
  bossTarget: THREE.Object3D | null = null;
  ultBlend = 0;
  ultFocus: THREE.Vector3 | null = null;
  /** per-ultimate framing: extra pull-back distance, how far the look point leans toward ultFocus, extra FOV */
  ultFar = 5;
  ultLookK = 0.45;
  ultFovExtra = 8;
  private ultLookBlend = 0;

  constructor(cam: THREE.PerspectiveCamera) {
    this.cam = cam;
  }

  setWorld(terrain: Terrain, colliders: Colliders) { this.terrain = terrain; this.colliders = colliders; }

  /** camera-relative forward on ground plane */
  getForward(out = new THREE.Vector3()) { return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize(); }
  getRight(out = new THREE.Vector3()) { return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).normalize(); }

  addTrauma(t: number) { this.trauma = Math.min(1, this.trauma + t * this.shakeScale); }
  addPunch(dir: THREE.Vector3, strength = 0.3) { this.punchVel.addScaledVector(dir, strength * 12 * this.shakeScale); }

  cinematic(pos: THREE.Vector3, look: THREE.Vector3, fov = 50, snap = false) {
    this.mode = 'cinematic';
    this.cinePos.copy(pos); this.cineLook.copy(look); this.cineFov = fov;
    if (snap) { this.cam.position.copy(pos); this.cineBlend = 1; }
  }
  endCinematic() { if (this.mode === 'cinematic') this.mode = 'combat'; this.cineBlend = 0; }

  handleInput(input: Input, dt: number) {
    if (this.mode === 'cinematic' || this.mode === 'title') return;
    const s = 0.0022 * this.sensitivity;
    this.yaw -= input.mouseDX * s;
    this.pitch += input.mouseDY * s * (this.invertY ? -1 : 1);
    this.pitch = clamp(this.pitch, -0.35, 1.15);
    if (input.wheel !== 0) this.distance = clamp(this.distance + input.wheel * 0.6, 3.5, 10);
  }

  /** target: player root, playerVel for lead, options */
  update(dt: number, target: THREE.Vector3, playerFacing: number, opts: { sprint: boolean; inCombat: boolean; velocity: THREE.Vector3; ult?: boolean; playerHeight?: number }) {
    const rawDt = dt;
    // shake decay
    this.trauma = Math.max(0, this.trauma - rawDt * 1.6);
    this.shakeT += rawDt * 30;
    // punch spring
    this.punchVel.addScaledVector(this.punch, -160 * rawDt);
    this.punchVel.multiplyScalar(Math.max(0, 1 - 14 * rawDt));
    this.punch.addScaledVector(this.punchVel, rawDt);

    if (this.mode === 'cinematic') {
      this.cineBlend = damp(this.cineBlend, 1, 3, rawDt);
      this.cam.position.lerp(this.cinePos, 1 - Math.exp(-rawDt * 3.5));
      this.tmp.copy(this.cineLook);
      this.cam.lookAt(this.tmp);
      this.fov = damp(this.fov, this.cineFov, 3, rawDt);
      this.cam.fov = this.fov; this.cam.updateProjectionMatrix();
      this.applyShake();
      return;
    }
    if (this.mode === 'title') {
      // slow orbit around a point of interest
      const t = performance.now() * 0.0001;
      const r = 26;
      this.cam.position.set(target.x + Math.cos(t) * r, target.y + 9 + Math.sin(t * 0.7) * 2, target.z + Math.sin(t) * r);
      this.cam.lookAt(target.x, target.y + 3, target.z);
      this.fov = damp(this.fov, 46, 2, rawDt);
      this.cam.fov = this.fov; this.cam.updateProjectionMatrix();
      return;
    }

    this.combatBlend = damp(this.combatBlend, opts.inCombat ? 1 : 0, 2.5, rawDt);
    this.sprintBlend = damp(this.sprintBlend, opts.sprint ? 1 : 0, 4, rawDt);
    this.ultBlend = damp(this.ultBlend, opts.ult ? 1 : 0, 3, rawDt);

    // lock-on: ease yaw toward target
    if (this.lockTarget) {
      const tp = this.lockTarget.getWorldPosition(this.tmp);
      const dx = tp.x - target.x, dz = tp.z - target.z;
      const dist = Math.hypot(dx, dz);
      const desiredYaw = Math.atan2(-dx, -dz);
      // stronger correction when target far off-center
      const diff = angleDiff(this.yaw, desiredYaw);
      this.yaw += diff * (1 - Math.exp(-rawDt * (Math.abs(diff) > 1.2 ? 7 : 3)));
      const desiredPitch = clamp(0.22 + 0.006 * dist - (tp.y - target.y) * 0.03 + Math.max(0, this.lockRadius - 0.6) * 0.05, 0.05, 0.5);
      this.pitch = damp(this.pitch, desiredPitch, 2.2, rawDt);
    }

    // pivot: player + height + slight look-ahead
    const ph = opts.playerHeight ?? 1.0;
    const lead = this.tmp2.copy(opts.velocity).setY(0).multiplyScalar(0.12);
    this.pivot.set(target.x + lead.x, target.y + ph, target.z + lead.z);
    // shoulder offset (right) in combat
    const right = this.getRight(this.tmp);
    this.pivot.addScaledVector(right, 0.35 * this.combatBlend);
    // lock: bias pivot toward target midpoint a little
    if (this.lockTarget) {
      const tp = this.lockTarget.getWorldPosition(this.tmp2);
      // bias toward the target, but keep the player in the lower-middle of the frame even for huge bosses
      this.pivot.lerp(new THREE.Vector3(tp.x, tp.y + Math.min(this.lockHeight, 2.2) * 0.35, tp.z), this.lockRadius > 1 ? 0.1 : 0.18);
    }
    // smooth follow: fast on xz, softer on y (no jitter when jumping)
    const kxz = 1 - Math.exp(-rawDt * 14), ky = 1 - Math.exp(-rawDt * 7);
    this.smoothPivot.x = lerp(this.smoothPivot.x, this.pivot.x, kxz);
    this.smoothPivot.z = lerp(this.smoothPivot.z, this.pivot.z, kxz);
    this.smoothPivot.y = lerp(this.smoothPivot.y, this.pivot.y, ky);
    if (this.cineBlend > 0) { this.cineBlend = 0; this.smoothPivot.copy(this.pivot); }

    // distance: closer in combat, further when locked and target far
    let desired = this.distance * (1 - 0.14 * this.combatBlend) + this.sprintBlend * 0.6;
    if (this.lockTarget) {
      const tp = this.lockTarget.getWorldPosition(this.tmp);
      desired += clamp(tp.distanceTo(target) * 0.12, 0, 3) + Math.max(0, this.lockRadius - 0.6) * 2.2;
    }
    desired += this.ultBlend * this.ultFar;
    this.curDist = damp(this.curDist, desired, 4, rawDt);

    // position from spherical coords
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const dir = this.tmp.set(Math.sin(this.yaw) * cp, sp, Math.cos(this.yaw) * cp);
    const pos = this.tmp2.copy(this.smoothPivot).addScaledVector(dir, this.curDist);
    // terrain / obstacle avoidance: shorten distance if blocked
    if (this.terrain) {
      let d = this.curDist;
      const steps = 8;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const px = this.smoothPivot.x + dir.x * d * t, py = this.smoothPivot.y + dir.y * d * t, pz = this.smoothPivot.z + dir.z * d * t;
        const h = this.terrain.heightAt(px, pz) + 0.6;
        if (py < h) { d = Math.max(1.2, d * t - 0.3); break; }
      }
      pos.copy(this.smoothPivot).addScaledVector(dir, d);
      const minY = this.terrain.heightAt(pos.x, pos.z) + 0.5;
      if (pos.y < minY) pos.y = minY;
    }
    this.cam.position.copy(pos);
    // look at pivot with slight upward bias in combat; during the ultimate, frame the falling star
    const look = this.tmp.copy(this.smoothPivot);
    look.y += 0.15 * this.combatBlend + this.ultBlend * 1.5;
    if (this.ultFocus && this.ultBlend > 0.05) {
      this.ultLookBlend = damp(this.ultLookBlend, 1, 3, rawDt);
      look.lerp(this.tmp2.copy(this.smoothPivot).lerp(this.ultFocus, this.ultLookK), this.ultLookBlend * 0.8);
    } else this.ultLookBlend = damp(this.ultLookBlend, 0, 4, rawDt);
    this.cam.lookAt(look);
    // fov
    this.fovTarget = 58 - 3 * this.combatBlend + 7 * this.sprintBlend + this.ultBlend * this.ultFovExtra;
    this.fov = damp(this.fov, this.fovTarget, 5, rawDt);
    this.cam.fov = this.fov;
    this.cam.updateProjectionMatrix();
    this.applyShake();
  }

  private applyShake() {
    const t = this.trauma * this.trauma;
    if (t > 0.001) {
      const n1 = Math.sin(this.shakeT * 1.1) * 0.5 + Math.sin(this.shakeT * 2.3) * 0.3 + Math.sin(this.shakeT * 4.7) * 0.2;
      const n2 = Math.cos(this.shakeT * 1.3) * 0.5 + Math.cos(this.shakeT * 2.9) * 0.3 + Math.cos(this.shakeT * 5.1) * 0.2;
      const n3 = Math.sin(this.shakeT * 0.9 + 2) * 0.5 + Math.sin(this.shakeT * 3.1) * 0.5;
      this.cam.rotateX(n1 * 0.035 * t);
      this.cam.rotateY(n2 * 0.035 * t);
      this.cam.rotateZ(n3 * 0.02 * t);
    }
    if (this.punch.lengthSq() > 0.00001) {
      this.cam.position.add(this.punch);
    }
  }
}
