import * as THREE from 'three';
import { createToonMaterial, createOutlineMaterial, createGlowMaterial, ToonMat } from '../render/ToonMaterial';
import { damp, lerp } from '../core/Math';

export type EyeMood = 'normal' | 'happy' | 'angry' | 'hurt' | 'closed' | 'focused' | 'surprised';

/**
 * The slime protagonist: an expressive anime slime with big golden eyes,
 * jelly deformation, a glossy highlight, an evolving aura and a water blade.
 */
export class PlayerModel {
  root = new THREE.Group();
  body: THREE.Mesh;
  bodyMat: ToonMat;
  outline: THREE.Mesh;
  outlineMat: ReturnType<typeof createOutlineMaterial>;
  eyes: THREE.Group;
  eyeL: THREE.Group; eyeR: THREE.Group;
  lidL: THREE.Mesh; lidR: THREE.Mesh;
  browL: THREE.Mesh; browR: THREE.Mesh;
  mouth: THREE.Mesh;
  highlight: THREE.Mesh;
  bladePivot: THREE.Group;
  blade: THREE.Mesh;
  bladeMat: THREE.MeshBasicMaterial;
  aura: THREE.Mesh;
  auraMat: THREE.MeshBasicMaterial;
  auraRing: THREE.Mesh;
  shadowBlob: THREE.Mesh;
  crown: THREE.Group;
  private squash = new THREE.Vector2(1, 1);
  private squashTarget = new THREE.Vector2(1, 1);
  private wobble = 0;
  private wobblePhase = 0;
  private blinkT = 0;
  private nextBlink = 2;
  private blinkAmount = 0;
  mood: EyeMood = 'normal';
  private moodT = 0;
  lookTarget = new THREE.Vector3();
  private eyeOffset = new THREE.Vector2();
  power = 0; // 0..1 visible progression
  bodyColor = new THREE.Color(0x86d3ff);
  private t = 0;

  constructor() {
    const g = this.root;
    // body
    const geo = new THREE.SphereGeometry(0.58, 36, 26);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      // slime shape: flatter bottom, slightly pointed top
      const k = y > 0 ? 1 + y * 0.12 : 1 - y * 0.35;
      pos.setY(i, y * 0.9 * (y < -0.3 ? 0.8 : 1));
      pos.setX(i, pos.getX(i) * (y < -0.4 ? 1.05 : 1));
      pos.setZ(i, pos.getZ(i) * (y < -0.4 ? 1.05 : 1));
      void k;
    }
    geo.computeVertexNormals();
    geo.translate(0, 0.52, 0);
    this.bodyMat = createToonMaterial({ color: this.bodyColor, rimColor: 0xffffff, rimStrength: 0.9, rimPower: 2.4, specular: 0.9, jelly: true, shadowTint: 0x5a5ad0 });
    this.body = new THREE.Mesh(geo, this.bodyMat);
    this.body.castShadow = true;
    this.body.receiveShadow = false;
    g.add(this.body);
    this.outlineMat = createOutlineMaterial(0.02, 0x1e2a5a, { jelly: true });
    this.outline = new THREE.Mesh(geo, this.outlineMat);
    this.body.add(this.outline);

    // glossy highlight
    this.highlight = new THREE.Mesh(new THREE.CircleGeometry(0.11, 20), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, toneMapped: false, depthWrite: false }));
    this.highlight.scale.set(1.5, 0.7, 1);
    this.highlight.position.set(-0.22, 0.86, 0.42);
    this.highlight.lookAt(-0.6, 1.6, 1.4);
    this.highlight.renderOrder = 3;
    g.add(this.highlight);
    const hl2 = new THREE.Mesh(new THREE.CircleGeometry(0.05, 12), (this.highlight.material as THREE.Material).clone());
    hl2.position.set(-0.05, 0.94, 0.45); hl2.lookAt(-0.2, 1.7, 1.4);
    g.add(hl2);

    // eyes
    this.eyes = new THREE.Group();
    this.eyes.position.set(0, 0.5, 0);
    g.add(this.eyes);
    const mk = (side: number) => {
      const e = new THREE.Group();
      const white = new THREE.Mesh(new THREE.SphereGeometry(0.135, 20, 14), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
      white.scale.set(0.85, 1.25, 0.5);
      e.add(white);
      const iris = new THREE.Mesh(new THREE.SphereGeometry(0.095, 18, 12), new THREE.MeshBasicMaterial({ color: 0xffb020, toneMapped: false }));
      iris.scale.set(0.85, 1.2, 0.4); iris.position.z = 0.04;
      iris.name = 'iris';
      e.add(iris);
      const irisDark = new THREE.Mesh(new THREE.SphereGeometry(0.095, 18, 12), new THREE.MeshBasicMaterial({ color: 0xd07010, toneMapped: false }));
      irisDark.scale.set(0.85, 0.6, 0.38); irisDark.position.set(0, 0.06, 0.045);
      e.add(irisDark);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), new THREE.MeshBasicMaterial({ color: 0x1a0a20, toneMapped: false }));
      pupil.scale.set(0.8, 1.3, 0.4); pupil.position.z = 0.075;
      e.add(pupil);
      const shine = new THREE.Mesh(new THREE.SphereGeometry(0.032, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
      shine.position.set(-0.035 * side, 0.05, 0.1); shine.scale.set(1, 1, 0.4);
      e.add(shine);
      const shine2 = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
      shine2.position.set(0.04 * side, -0.05, 0.1); shine2.scale.set(1, 1, 0.4);
      e.add(shine2);
      // eyelid: body-colored cap that slides down
      const lid = new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.5), createToonMaterial({ color: this.bodyColor, rimStrength: 0.3 }));
      lid.scale.set(0.9, 1.3, 0.6);
      lid.position.y = 0.16;
      lid.name = 'lid';
      e.add(lid);
      // brow (dark line) for angry expression
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.035, 0.03), new THREE.MeshBasicMaterial({ color: 0x1e2a5a, toneMapped: false }));
      brow.position.set(0, 0.2, 0.06);
      brow.visible = false;
      e.add(brow);
      e.position.set(0.21 * side, 0.2, 0.49);
      e.rotation.y = 0.35 * side;
      return { e, lid, brow };
    };
    const L = mk(-1), R = mk(1);
    this.eyeL = L.e; this.eyeR = R.e; this.lidL = L.lid; this.lidR = R.lid; this.browL = L.brow; this.browR = R.brow;
    this.eyes.add(this.eyeL, this.eyeR);
    // mouth: small smile arc
    this.mouth = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 6, 16, Math.PI), new THREE.MeshBasicMaterial({ color: 0x1e2a5a, toneMapped: false }));
    this.mouth.position.set(0, 0.52, 0.575);
    this.mouth.rotation.z = Math.PI;
    g.add(this.mouth);

    // water blade (attached, hidden until attacks)
    this.bladePivot = new THREE.Group();
    this.bladePivot.position.set(0, 0.55, 0);
    g.add(this.bladePivot);
    const bladeShape = new THREE.Shape();
    bladeShape.moveTo(0, 0);
    bladeShape.quadraticCurveTo(0.9, 0.35, 1.7, 0.05);
    bladeShape.quadraticCurveTo(0.9, 0.12, 0, -0.08);
    const bladeGeo = new THREE.ShapeGeometry(bladeShape, 12);
    this.bladeMat = createGlowMaterial(0x9fe8ff, 0.95);
    this.blade = new THREE.Mesh(bladeGeo, this.bladeMat);
    const bladeCore = new THREE.Mesh(bladeGeo, createGlowMaterial(0xffffff, 0.9));
    bladeCore.scale.set(0.9, 0.5, 1); bladeCore.position.set(0.08, 0.02, 0.005);
    this.blade.add(bladeCore);
    this.blade.position.set(0.35, 0, 0);
    this.blade.scale.setScalar(1.45);
    this.blade.visible = false;
    this.blade.renderOrder = 10;
    this.bladePivot.add(this.blade);

    // aura (grows with power)
    this.auraMat = createGlowMaterial(0x6fc8ff, 0.0);
    this.aura = new THREE.Mesh(new THREE.SphereGeometry(0.8, 24, 16), this.auraMat);
    this.aura.position.y = 0.5;
    this.aura.renderOrder = 2;
    g.add(this.aura);
    this.auraRing = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.95, 48), createGlowMaterial(0x8fd8ff, 0));
    this.auraRing.rotation.x = -Math.PI / 2;
    this.auraRing.position.y = 0.05;
    g.add(this.auraRing);
    // soft ground shadow blob
    this.shadowBlob = new THREE.Mesh(new THREE.CircleGeometry(0.55, 24), new THREE.MeshBasicMaterial({ color: 0x1a2040, transparent: true, opacity: 0.28, depthWrite: false }));
    this.shadowBlob.rotation.x = -Math.PI / 2;
    this.shadowBlob.position.y = 0.03;
    g.add(this.shadowBlob);
    // small floating crown fragments appear at high power
    this.crown = new THREE.Group();
    this.crown.position.y = 1.35;
    for (let i = 0; i < 5; i++) {
      const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.06), createGlowMaterial(0xbfe8ff, 1));
      s.position.set(Math.cos((i / 5) * Math.PI * 2) * 0.35, 0, Math.sin((i / 5) * Math.PI * 2) * 0.35);
      this.crown.add(s);
    }
    this.crown.visible = false;
    g.add(this.crown);
  }

  setMood(m: EyeMood, seconds = 0) {
    this.mood = m;
    this.moodT = seconds;
  }
  blink() { this.blinkT = 0.001; }
  squashTo(x: number, y: number) { this.squashTarget.set(x, y); }
  impulseWobble(amount = 1) { this.wobble = Math.min(1.5, this.wobble + amount); }
  setFlash(v: number) { this.bodyMat.u.uFlash.value = v; }
  setDissolve(v: number) { this.bodyMat.u.uDissolve.value = v; this.outlineMat.u.uDissolve.value = v; }
  setTint(c: THREE.ColorRepresentation) { this.bodyMat.u.uTint.value.set(c); }

  showBlade(show: boolean, color?: THREE.ColorRepresentation) {
    this.blade.visible = show;
    if (color !== undefined) this.bladeMat.color.set(color);
  }

  /** power 0..1 drives the aura and crown for visible progression */
  setPower(p: number) { this.power = p; }

  update(dt: number, time: number) {
    this.t = time;
    // squash with spring
    this.squash.x = damp(this.squash.x, this.squashTarget.x, 18, dt);
    this.squash.y = damp(this.squash.y, this.squashTarget.y, 18, dt);
    this.wobble = damp(this.wobble, 0, 5, dt);
    this.wobblePhase += dt * 22;
    const idle = 1 + Math.sin(time * 2.4) * 0.018;
    const sx = this.squash.x * idle, sy = this.squash.y / idle;
    this.bodyMat.u.uSquash.value.set(sx, sy, sx);
    this.bodyMat.u.uWobble.value = this.wobble;
    this.bodyMat.u.uWobblePhase.value = this.wobblePhase;
    this.outlineMat.u.uSquash.value.set(sx, sy, sx);
    this.outlineMat.u.uWobble.value = this.wobble;
    this.outlineMat.u.uWobblePhase.value = this.wobblePhase;
    // face follows squash
    this.eyes.position.y = 0.5 * sy;
    this.eyes.scale.set(sx, sy, 1);
    this.mouth.position.y = 0.52 * sy;
    this.mouth.scale.set(sx, sy, 1);
    this.highlight.position.y = 0.86 * sy;
    this.highlight.scale.set(1.5 * sx, 0.7 * sy, 1);

    // blinking
    this.nextBlink -= dt;
    if (this.nextBlink <= 0 && this.blinkT <= 0) { this.blinkT = 0.001; this.nextBlink = 2 + Math.random() * 4; }
    if (this.blinkT > 0) {
      this.blinkT += dt * 9;
      this.blinkAmount = Math.sin(Math.min(Math.PI, this.blinkT));
      if (this.blinkT > Math.PI) { this.blinkT = 0; this.blinkAmount = 0; }
    }
    // mood expression
    if (this.moodT > 0) { this.moodT -= dt; if (this.moodT <= 0) this.mood = 'normal'; }
    let lidDown = 0, browVis = false, browAngle = 0, eyeScaleY = 1, mouthScale = 1, mouthFlip = false;
    switch (this.mood) {
      case 'happy': lidDown = 0.55; mouthScale = 1.4; break;
      case 'angry': browVis = true; browAngle = 0.35; lidDown = 0.25; mouthScale = 0.6; break;
      case 'focused': browVis = true; browAngle = 0.2; lidDown = 0.2; break;
      case 'hurt': lidDown = 0.35; mouthFlip = true; browVis = true; browAngle = -0.3; break;
      case 'closed': lidDown = 1; break;
      case 'surprised': eyeScaleY = 1.25; mouthScale = 0.5; break;
    }
    const lid = Math.max(lidDown, this.blinkAmount);
    this.lidL.position.y = lerp(0.16, -0.05, lid);
    this.lidR.position.y = lerp(0.16, -0.05, lid);
    this.browL.visible = browVis; this.browR.visible = browVis;
    this.browL.rotation.z = -browAngle; this.browR.rotation.z = browAngle;
    this.eyeL.scale.y = damp(this.eyeL.scale.y, eyeScaleY, 12, dt);
    this.eyeR.scale.y = this.eyeL.scale.y;
    this.mouth.scale.x = damp(this.mouth.scale.x, mouthScale * sx, 12, dt);
    this.mouth.rotation.z = damp(this.mouth.rotation.z, mouthFlip ? 0 : Math.PI, 10, dt);
    // eyes look toward target (small pupil offset)
    const local = this.root.worldToLocal(this.lookTarget.clone());
    const tx = Math.max(-1, Math.min(1, local.x * 0.15)), ty = Math.max(-1, Math.min(1, (local.y - 0.6) * 0.1));
    this.eyeOffset.x = damp(this.eyeOffset.x, tx, 8, dt);
    this.eyeOffset.y = damp(this.eyeOffset.y, ty, 8, dt);
    for (const e of [this.eyeL, this.eyeR]) {
      e.children.forEach((c, i) => { if (i >= 1 && i <= 5 && c.name !== 'lid') { c.position.x = (i === 4 ? (e === this.eyeL ? 0.035 : -0.035) : i === 5 ? (e === this.eyeL ? -0.04 : 0.04) : 0) + this.eyeOffset.x * 0.05; } });
    }
    // aura by power
    const p = this.power;
    this.auraMat.opacity = damp(this.auraMat.opacity, p * 0.22 + Math.sin(time * 3) * 0.03 * p, 4, dt);
    this.aura.scale.setScalar(1 + p * 0.5 + Math.sin(time * 2) * 0.05);
    (this.auraRing.material as THREE.MeshBasicMaterial).opacity = damp((this.auraRing.material as THREE.MeshBasicMaterial).opacity, p > 0.3 ? (p - 0.3) * 0.7 : 0, 4, dt);
    this.auraRing.rotation.z += dt * 0.8;
    this.auraRing.scale.setScalar(1 + Math.sin(time * 2.5) * 0.08);
    this.crown.visible = p > 0.75;
    if (this.crown.visible) { this.crown.rotation.y += dt * 1.5; this.crown.position.y = 1.35 * sy + Math.sin(time * 2) * 0.05; this.crown.children.forEach((c, i) => { c.rotation.x += dt * 2; c.position.y = Math.sin(time * 3 + i) * 0.06; }); }
    // color shifts slightly toward gold/white with power
    this.bodyMat.color.copy(this.bodyColor).lerp(new THREE.Color(0xa8e4ff), p * 0.5);
  }
}
