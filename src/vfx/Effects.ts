import * as THREE from 'three';
import { Particles, Shape } from './Particles';
import { createGlowMaterial } from '../render/ToonMaterial';
import { easeOutCubic, easeOutQuart, easeOutBack, rand } from '../core/Math';

interface Transient {
  obj: THREE.Object3D;
  life: number;
  max: number;
  tick: (t: number, dt: number, obj: THREE.Object3D) => void;
  onEnd?: () => void;
}

const geoCache = {
  ring: new THREE.RingGeometry(0.8, 1, 64),
  disc: new THREE.CircleGeometry(1, 48),
  sphere: new THREE.SphereGeometry(1, 24, 16),
  plane: new THREE.PlaneGeometry(1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 12, 1, true),
  cone: new THREE.ConeGeometry(1, 1, 16, 1, true),
  torus: new THREE.TorusGeometry(1, 0.06, 8, 48),
};

/** crescent arc geometry for slash trails */
function crescentGeo(radius = 1, thickness = 0.35, arc = Math.PI * 1.1, segs = 24) {
  const shape = new THREE.Shape();
  const a0 = -arc / 2, a1 = arc / 2;
  for (let i = 0; i <= segs; i++) {
    const a = a0 + (a1 - a0) * (i / segs);
    const w = Math.sin((i / segs) * Math.PI) * thickness; // thin at ends
    const r = radius + w * 0.5;
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  for (let i = segs; i >= 0; i--) {
    const a = a0 + (a1 - a0) * (i / segs);
    const w = Math.sin((i / segs) * Math.PI) * thickness;
    const r = radius - w * 0.5;
    shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  return new THREE.ShapeGeometry(shape, 2);
}

/** Procedural kaleidoscopic rosette for the Megiddo mandala: petals in two rings, dotted inner band, radial spokes. Built once. */
let mandalaTex: THREE.CanvasTexture | null = null;
function mandalaTexture(): THREE.CanvasTexture {
  if (mandalaTex) return mandalaTex;
  const S = 1024, c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  ctx.translate(S / 2, S / 2);
  const R = S * 0.48;
  const petal = (r0: number, r1: number, w: number, alpha: number) => {
    ctx.beginPath();
    ctx.moveTo(0, -r0);
    ctx.bezierCurveTo(w, -r0 - (r1 - r0) * 0.35, w, -r1 + (r1 - r0) * 0.25, 0, -r1);
    ctx.bezierCurveTo(-w, -r1 + (r1 - r0) * 0.25, -w, -r0 - (r1 - r0) * 0.35, 0, -r0);
    ctx.closePath();
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.fill();
  };
  const ring = (r: number, lw: number, alpha: number, dash?: number[]) => {
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.lineWidth = lw; ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
    ctx.setLineDash(dash ?? []); ctx.stroke(); ctx.setLineDash([]);
  };
  // outer petals (16), inner petals (16, offset), tiny outer spikes (32)
  for (let i = 0; i < 16; i++) { ctx.save(); ctx.rotate((i / 16) * Math.PI * 2); petal(R * 0.42, R * 0.9, R * 0.075, 0.85); ctx.restore(); }
  for (let i = 0; i < 16; i++) { ctx.save(); ctx.rotate(((i + 0.5) / 16) * Math.PI * 2); petal(R * 0.28, R * 0.68, R * 0.05, 1); ctx.restore(); }
  for (let i = 0; i < 32; i++) { ctx.save(); ctx.rotate((i / 32) * Math.PI * 2); petal(R * 0.9, R * 0.99, R * 0.014, 0.9); ctx.restore(); }
  ring(R * 0.985, 3, 0.9); ring(R * 0.93, 1.5, 0.5); ring(R * 0.44, 4, 0.9); ring(R * 0.36, 2, 0.7, [6, 10]);
  for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; ctx.beginPath(); ctx.arc(Math.cos(a) * R * 0.4, Math.sin(a) * R * 0.4, 5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,1)'; ctx.fill(); }
  // centre: dark pupil with a bright iris ring, 8 small triangles
  ring(R * 0.2, 6, 1); ring(R * 0.14, 2, 0.8);
  for (let i = 0; i < 8; i++) { ctx.save(); ctx.rotate((i / 8) * Math.PI * 2); ctx.beginPath(); ctx.moveTo(0, -R * 0.22); ctx.lineTo(R * 0.03, -R * 0.28); ctx.lineTo(-R * 0.03, -R * 0.28); ctx.closePath(); ctx.fillStyle = 'rgba(255,255,255,1)'; ctx.fill(); ctx.restore(); }
  // radial hairlines
  ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  for (let i = 0; i < 48; i++) { const a = (i / 48) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(Math.cos(a) * R * 0.46, Math.sin(a) * R * 0.46); ctx.lineTo(Math.cos(a) * R * 0.92, Math.sin(a) * R * 0.92); ctx.stroke(); }
  mandalaTex = new THREE.CanvasTexture(c);
  mandalaTex.colorSpace = THREE.SRGBColorSpace;
  mandalaTex.anisotropy = 4;
  return mandalaTex;
}

const crescent = crescentGeo();
const crescentWide = crescentGeo(1, 0.5, Math.PI * 1.4);

export class Effects {
  scene: THREE.Scene;
  particles: Particles;
  private list: Transient[] = [];
  private tmp = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();
  heightAt: (x: number, z: number) => number = () => 0;

  constructor(scene: THREE.Scene, particles: Particles) {
    this.scene = scene;
    this.particles = particles;
  }

  private add(obj: THREE.Object3D, max: number, tick: Transient['tick'], onEnd?: () => void) {
    this.scene.add(obj);
    this.list.push({ obj, life: 0, max, tick, onEnd });
    return obj;
  }

  update(dt: number) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const t = this.list[i];
      t.life += dt;
      const k = Math.min(1, t.life / t.max);
      t.tick(k, dt, t.obj);
      if (t.life >= t.max) {
        this.scene.remove(t.obj);
        t.obj.traverse((o: any) => { if (o.material && o.material._own) o.material.dispose(); });
        t.onEnd?.();
        this.list.splice(i, 1);
      }
    }
  }

  private mat(color: THREE.ColorRepresentation, opacity = 1, additive = true) {
    const m = createGlowMaterial(color, opacity, additive);
    (m as any)._own = true;
    return m;
  }

  // ---------- generic transients ----------

  /** expanding ground ring */
  shockwave(pos: THREE.Vector3, color: THREE.ColorRepresentation = 0xffffff, radius = 4, dur = 0.5, opts: { y?: number; thickness?: number; vertical?: THREE.Vector3 } = {}) {
    const m = new THREE.Mesh(geoCache.ring, this.mat(color, 1));
    m.position.copy(pos);
    m.position.y += opts.y ?? 0.08;
    if (opts.vertical) {
      m.lookAt(m.position.clone().add(opts.vertical));
    } else m.rotation.x = -Math.PI / 2;
    m.renderOrder = 12;
    const mat = m.material as THREE.MeshBasicMaterial;
    return this.add(m, dur, (k) => {
      const e = easeOutCubic(k);
      m.scale.setScalar(0.2 + e * radius);
      mat.opacity = (1 - k) * 1.2;
    });
  }

  /** bright expanding sphere core */
  burst(pos: THREE.Vector3, color: THREE.ColorRepresentation, radius = 1.5, dur = 0.35, additive = true) {
    const m = new THREE.Mesh(geoCache.sphere, this.mat(color, 0.9, additive));
    m.position.copy(pos);
    m.renderOrder = 13;
    const mat = m.material as THREE.MeshBasicMaterial;
    return this.add(m, dur, (k) => {
      const e = easeOutQuart(k);
      m.scale.setScalar(0.1 + e * radius);
      mat.opacity = (1 - k) * 0.9;
    });
  }

  /** camera-facing flash sprite */
  flash(pos: THREE.Vector3, color: THREE.ColorRepresentation, size = 2, dur = 0.18, camera?: THREE.Camera) {
    const m = new THREE.Mesh(geoCache.disc, this.mat(color, 1));
    m.position.copy(pos);
    m.renderOrder = 14;
    const mat = m.material as THREE.MeshBasicMaterial;
    return this.add(m, dur, (k) => {
      if (camera) m.quaternion.copy(camera.quaternion);
      m.scale.setScalar(size * (0.3 + easeOutCubic(k) * 0.9));
      mat.opacity = 1 - k * k;
    });
  }

  /** anime slash crescent oriented along direction */
  slash(pos: THREE.Vector3, dir: THREE.Vector3, color: THREE.ColorRepresentation, radius = 1.4, dur = 0.22, opts: { tilt?: number; wide?: boolean; flip?: boolean; up?: number } = {}) {
    const m = new THREE.Mesh(opts.wide ? crescentWide : crescent, this.mat(color, 1));
    m.position.copy(pos);
    // orient: crescent lies in plane facing the dir; tilt rotates around dir axis
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize());
    m.quaternion.copy(q);
    m.rotateZ(opts.tilt ?? rand(-0.6, 0.6));
    if (opts.flip) m.rotateY(Math.PI);
    m.renderOrder = 13;
    const mat = m.material as THREE.MeshBasicMaterial;
    const core = new THREE.Mesh(opts.wide ? crescentWide : crescent, this.mat(0xffffff, 0.8));
    core.scale.setScalar(0.85);
    core.position.z += 0.01;
    m.add(core);
    return this.add(m, dur, (k) => {
      const e = easeOutCubic(k);
      m.scale.setScalar(radius * (0.5 + e * 0.7));
      mat.opacity = 1 - k * k;
      (core.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.9;
      m.rotateZ(dt(0.0, k) * 0);
    });
    function dt(a: number, b: number) { return a + b; }
  }

  /** vertical beam / pillar */
  pillar(pos: THREE.Vector3, color: THREE.ColorRepresentation, radius = 1, height = 30, dur = 0.5, opts: { fadeIn?: number } = {}) {
    const g = new THREE.Group();
    const outer = new THREE.Mesh(geoCache.cyl, this.mat(color, 0.6));
    const inner = new THREE.Mesh(geoCache.cyl, this.mat(0xffffff, 0.9));
    inner.scale.set(0.4, 1, 0.4);
    g.add(outer, inner);
    g.position.copy(pos);
    g.position.y += height / 2;
    g.scale.set(radius, height, radius);
    g.renderOrder = 13;
    return this.add(g, dur, (k) => {
      const w = k < 0.2 ? easeOutCubic(k / 0.2) : 1 - easeOutCubic((k - 0.2) / 0.8) * 0.9;
      g.scale.set(radius * w, height, radius * w);
      (outer.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - k * 0.7);
      (inner.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k);
    });
  }

  /** jagged lightning bolt between points */
  lightning(from: THREE.Vector3, to: THREE.Vector3, color: THREE.ColorRepresentation = 0xbfe8ff, dur = 0.25, width = 0.12, branches = 2) {
    const g = new THREE.Group();
    const build = (a: THREE.Vector3, b: THREE.Vector3, w: number, segs: number) => {
      const pts: THREE.Vector3[] = [a.clone()];
      const dir = b.clone().sub(a);
      const len = dir.length();
      const perp1 = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
      if (perp1.lengthSq() < 0.01) perp1.set(1, 0, 0);
      const perp2 = new THREE.Vector3().crossVectors(dir, perp1).normalize();
      for (let i = 1; i < segs; i++) {
        const t = i / segs;
        const p = a.clone().lerp(b, t);
        const amp = len * 0.09 * Math.sin(t * Math.PI);
        p.addScaledVector(perp1, rand(-amp, amp)).addScaledVector(perp2, rand(-amp, amp));
        pts.push(p);
      }
      pts.push(b.clone());
      const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0);
      const tube = new THREE.TubeGeometry(curve, segs * 2, w, 5, false);
      const m = new THREE.Mesh(tube, this.mat(color, 1));
      const core = new THREE.Mesh(new THREE.TubeGeometry(curve, segs * 2, w * 0.4, 4, false), this.mat(0xffffff, 1));
      g.add(m, core);
      return pts;
    };
    const pts = build(from, to, width, 10);
    for (let i = 0; i < branches; i++) {
      const s = pts[Math.floor(rand(2, pts.length - 2))];
      const e = s.clone().add(new THREE.Vector3(rand(-1, 1), rand(-1.5, 0.2), rand(-1, 1)).multiplyScalar(from.distanceTo(to) * 0.25));
      build(s, e, width * 0.5, 5);
    }
    g.renderOrder = 14;
    return this.add(g, dur, (k) => {
      const flick = k < 0.6 ? (Math.random() < 0.3 ? 0.4 : 1) : 1 - (k - 0.6) / 0.4;
      g.children.forEach((c) => ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = flick);
    }, () => g.children.forEach((c) => (c as THREE.Mesh).geometry.dispose()));
  }

  /** flat ground mark (scorch / water / crater) that fades slowly */
  groundMark(pos: THREE.Vector3, color: THREE.ColorRepresentation, radius = 2, dur = 6, additive = false) {
    const m = new THREE.Mesh(geoCache.disc, this.mat(color, 0.7, additive));
    m.position.copy(pos);
    m.position.y = this.heightAt(pos.x, pos.z) + 0.05;
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = rand(0, Math.PI * 2);
    m.scale.setScalar(radius);
    m.renderOrder = 11;
    const mat = m.material as THREE.MeshBasicMaterial;
    return this.add(m, dur, (k) => {
      mat.opacity = 0.7 * (1 - Math.pow(k, 3));
    });
  }

  /** aura ring hovering vertically around a character (charging) */
  auraRing(target: THREE.Object3D, color: THREE.ColorRepresentation, radius = 1.2, dur = 1) {
    const m = new THREE.Mesh(geoCache.torus, this.mat(color, 1));
    m.rotation.x = Math.PI / 2;
    m.renderOrder = 13;
    return this.add(m, dur, (k) => {
      m.position.copy(target.position);
      m.position.y += 0.2 + k * 2.2;
      m.scale.setScalar(radius * (1.2 - k * 0.9));
      (m.material as THREE.MeshBasicMaterial).opacity = 1 - k;
    });
  }

  /** orbiting energy orbs during casting */
  orbitOrbs(target: THREE.Object3D, color: THREE.ColorRepresentation, count = 5, dur = 1, radius = 1.2, height = 0.8) {
    const g = new THREE.Group();
    const geo = new THREE.SphereGeometry(0.12, 10, 8);
    const mat = this.mat(color, 1);
    for (let i = 0; i < count; i++) g.add(new THREE.Mesh(geo, mat));
    g.renderOrder = 13;
    let t = 0;
    return this.add(g, dur, (k, dt) => {
      t += dt;
      g.position.copy(target.position);
      const r = radius * (1 - k * 0.8);
      g.children.forEach((c, i) => {
        const a = t * 5 + (i / count) * Math.PI * 2;
        c.position.set(Math.cos(a) * r, height + Math.sin(t * 7 + i) * 0.25, Math.sin(a) * r);
        c.scale.setScalar(1 + Math.sin(t * 12 + i) * 0.3);
      });
      mat.opacity = k > 0.85 ? (1 - k) / 0.15 : 1;
    }, () => geo.dispose());
  }

  /** big explosion combo used by strong spells */
  explosion(pos: THREE.Vector3, color: THREE.ColorRepresentation, color2: THREE.ColorRepresentation, radius = 5, camera?: THREE.Camera) {
    this.burst(pos, color, radius, 0.45);
    this.burst(pos, 0xffffff, radius * 0.5, 0.25);
    this.shockwave(pos, color, radius * 2.2, 0.7);
    this.shockwave(pos, 0xffffff, radius * 1.4, 0.45, { y: 0.15 });
    this.flash(pos, 0xffffff, radius * 1.5, 0.2, camera);
    this.particles.emit({ pos, count: 60, velSpread: radius * 3.5, velUp: radius * 1.5, life: 0.8, lifeVar: 0.3, size: 0.25, sizeVar: 0.1, color: [color, color2, 0xffffff], gravity: 12, drag: 1.5, shape: Shape.SPARK, stretch: 1.2 });
    this.particles.emit({ pos, count: 30, velSpread: radius * 2, velUp: radius, life: 1.4, lifeVar: 0.4, size: radius * 0.35, sizeVar: 0.3, sizeEnd: 2.2, color: [color2, 0x332233], alpha: 0.6, gravity: -1, drag: 2, shape: Shape.SMOKE, additive: false, rotSpeed: 2 });
    this.particles.emit({ pos, count: 24, velSpread: radius * 4, life: 0.5, size: 0.5, sizeVar: 0.2, color: [color, 0xffffff], shape: Shape.GLOW, drag: 3 });
    this.groundMark(pos, 0x120a12, radius * 1.4, 10);
  }

  // ---------- gameplay presets ----------

  hitSpark(pos: THREE.Vector3, dir: THREE.Vector3, color: THREE.ColorRepresentation = 0xfff0a0, strong = false, camera?: THREE.Camera) {
    const n = strong ? 26 : 14;
    this.particles.emit({ pos, count: n, dir, cone: 0.55, velSpread: strong ? 14 : 9, life: 0.3, lifeVar: 0.12, size: 0.18, sizeVar: 0.08, color: [color, 0xffffff, 0xffc060], gravity: 10, drag: 2, shape: Shape.SPARK, stretch: 1.5 });
    this.particles.emit({ pos, count: 4, velSpread: 2, life: 0.25, size: strong ? 0.9 : 0.55, sizeVar: 0.1, sizeEnd: 1.8, color: [color, 0xffffff], shape: Shape.STAR, rotSpeed: 3 });
    this.flash(pos, 0xffffff, strong ? 0.85 : 0.5, 0.1, camera);
    if (strong) this.shockwave(pos, color, 1.6, 0.28, { y: 0.4, vertical: dir });
  }

  dust(pos: THREE.Vector3, count = 8, size = 0.5, spread = 0.4) {
    this.particles.emit({ pos: { x: pos.x, y: pos.y + 0.1, z: pos.z }, count, spread, velSpread: 1.6, velUp: 0.8, life: 0.7, lifeVar: 0.25, size, sizeVar: 0.15, sizeEnd: 2.4, color: [0xd8cfb8, 0xc9c0a8], alpha: 0.5, gravity: -0.3, drag: 3, shape: Shape.SMOKE, additive: false, rotSpeed: 1.5 });
  }

  landDust(pos: THREE.Vector3, strength = 1) {
    this.particles.emit({ pos: { x: pos.x, y: pos.y + 0.05, z: pos.z }, count: Math.round(14 * strength), spread: 0.3, velSpread: 3 * strength, velUp: 0.5, life: 0.6, lifeVar: 0.2, size: 0.5, sizeVar: 0.2, sizeEnd: 2.5, color: [0xe0d8c4, 0xd0c8b4], alpha: 0.55, gravity: -0.4, drag: 3.5, shape: Shape.SMOKE, additive: false, rotSpeed: 2 });
    this.shockwave(pos, 0xf4efe0, 1.6 * strength, 0.35, { y: 0.05 });
  }

  grassBurst(pos: THREE.Vector3, count = 4) {
    this.particles.emit({ pos: { x: pos.x, y: pos.y + 0.15, z: pos.z }, count, spread: 0.4, velSpread: 2.2, velUp: 2.5, life: 0.9, lifeVar: 0.3, size: 0.12, sizeVar: 0.04, color: [0x7fd65a, 0xa9e57a, 0x5cb54a], alpha: 0.95, gravity: 6, drag: 1.5, shape: Shape.PETAL, rotSpeed: 8, additive: false });
  }

  dashStreak(pos: THREE.Vector3, dir: THREE.Vector3, color: THREE.ColorRepresentation = 0x9fe6ff) {
    const back = dir.clone().multiplyScalar(-1);
    this.particles.emit({ pos: { x: pos.x, y: pos.y + 0.5, z: pos.z }, count: 8, spread: 0.3, dir: back, cone: 0.35, velSpread: 6, life: 0.3, lifeVar: 0.1, size: 0.25, sizeVar: 0.1, color: [color, 0xffffff], shape: Shape.SPARK, stretch: 1.5, drag: 4 });
    this.particles.emit({ pos: { x: pos.x, y: pos.y + 0.45, z: pos.z }, count: 2, spread: 0.2, life: 0.35, size: 0.9, sizeEnd: 1.8, color: [color], alpha: 0.5, shape: Shape.RING });
  }

  /** straight glowing ray between two points (Megiddo). Two nested cylinders: hot white core + colored halo. */
  ray(from: THREE.Vector3, to: THREE.Vector3, color: THREE.ColorRepresentation = 0xfff4d0, width = 0.25, dur = 0.35) {
    const g = new THREE.Group();
    const halo = new THREE.Mesh(geoCache.cyl, this.mat(color, 0.55));
    const core = new THREE.Mesh(geoCache.cyl, this.mat(0xffffff, 1));
    core.scale.set(0.38, 1, 0.38);
    g.add(halo, core);
    const len = from.distanceTo(to);
    g.position.lerpVectors(from, to, 0.5);
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.tmp.copy(to).sub(from).normalize());
    g.scale.set(width, len, width);
    g.renderOrder = 14;
    return this.add(g, dur, (k) => {
      const w = k < 0.12 ? easeOutCubic(k / 0.12) * 1.4 : 1.4 - easeOutCubic((k - 0.12) / 0.88) * 1.3;
      g.scale.set(width * w, len, width * w);
      (halo.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - k * 0.8);
      (core.material as THREE.MeshBasicMaterial).opacity = 1 - k * k;
    });
  }

  /** floating lens of water: a flattened glassy sphere with bright rims and a focal core. Lives until dispose(); shatter() bursts it into droplets. */
  lens(pos: THREE.Vector3, radius: number, color: THREE.ColorRepresentation = 0xbfe8ff) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(geoCache.sphere, this.mat(color, 0.07));
    body.scale.set(radius, radius * 0.14, radius);
    const sheen = new THREE.Mesh(geoCache.sphere, this.mat(0xffffff, 0.025));
    sheen.scale.set(radius * 0.92, radius * 0.05, radius * 0.92);
    sheen.position.y = radius * 0.06;
    const rim = new THREE.Mesh(geoCache.torus, this.mat(color, 0.75));
    rim.rotation.x = Math.PI / 2;
    rim.scale.set(radius * 0.98, radius * 0.98, radius * 0.14);
    const rim2 = new THREE.Mesh(geoCache.torus, this.mat(0xffffff, 0.3));
    rim2.rotation.x = Math.PI / 2;
    rim2.scale.set(radius * 0.72, radius * 0.72, radius * 0.1);
    const rim3 = new THREE.Mesh(geoCache.torus, this.mat(0xfff0b0, 0.3));
    rim3.rotation.x = Math.PI / 2;
    rim3.scale.set(radius * 0.45, radius * 0.45, radius * 0.1);
    const core = new THREE.Mesh(geoCache.sphere, this.mat(0xffffff, 0.0));
    core.scale.setScalar(radius * 0.06);
    const coreHalo = new THREE.Mesh(geoCache.sphere, this.mat(0xfff0b0, 0.0));
    coreHalo.scale.setScalar(radius * 0.12);
    g.add(body, sheen, rim, rim2, rim3, core, coreHalo);
    g.position.copy(pos);
    g.scale.setScalar(0.01);
    g.renderOrder = 13;
    this.scene.add(g);
    let t = 0;
    const particles = this.particles;
    const scene = this.scene;
    const handle = {
      group: g,
      /** 0..1 charge; drives the focal core brightness */
      charge: 0,
      /** 1 when the lens just fired; decays */
      flash: 0,
      update(dt: number) {
        t += dt;
        handle.flash = Math.max(0, handle.flash - dt * 4);
        const k = Math.min(1, t / 0.6);
        const pop = k < 1 ? easeOutCubic(k) * (1 + (1 - k) * 0.35) : 1 + Math.sin(t * 5) * 0.015;
        g.scale.setScalar(pop);
        rim.rotation.z += dt * 0.5; rim2.rotation.z -= dt * 0.8; rim3.rotation.z += dt * 1.3;
        const glow = Math.max(handle.charge, handle.flash);
        (core.material as THREE.MeshBasicMaterial).opacity = glow;
        (coreHalo.material as THREE.MeshBasicMaterial).opacity = glow * 0.25;
        core.scale.setScalar(radius * (0.05 + glow * 0.07 + handle.flash * 0.14));
        coreHalo.scale.setScalar(radius * (0.1 + glow * 0.14 + handle.flash * 0.3));
        (body.material as THREE.MeshBasicMaterial).opacity = 0.07 + handle.charge * 0.08 + handle.flash * 0.25;
        (rim.material as THREE.MeshBasicMaterial).opacity = 0.55 + glow * 0.3;
        (rim2.material as THREE.MeshBasicMaterial).opacity = 0.2 + glow * 0.4;
      },
      /** burst into falling droplets and remove */
      shatter() {
        particles.emit({ pos: g.position, count: 26, spread: radius * 0.9, velSpread: 4, life: 2.2, lifeVar: 0.6, size: 0.22, sizeVar: 0.1, color: [color, 0xffffff], shape: Shape.GLOW, gravity: 10, drag: 0.4 });
        particles.emit({ pos: g.position, count: 8, spread: radius * 0.5, life: 0.5, size: radius * 0.6, sizeEnd: radius * 1.8, color: [0xffffff], alpha: 0.4, shape: Shape.RING });
        handle.dispose();
      },
      dispose: () => { scene.remove(g); g.traverse((o: any) => { if (o.material && o.material._own) o.material.dispose(); }); },
    };
    return handle;
  }

  /**
   * Megiddo charge rig, modelled on the anime shot: a kaleidoscopic rosette mandala floating behind the
   * caster, two great wing-arcs of light sweeping up from the shoulders with flare tips, and lightning
   * crackling horizontally through the outstretched "arms". The group faces `facing` (toward the camera).
   */
  megiddoRig(pos: THREE.Vector3, facing: THREE.Vector3, color: THREE.ColorRepresentation = 0x5fd8ff) {
    const g = new THREE.Group();
    g.position.copy(pos);
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.tmp.copy(facing).setY(0).normalize());
    // ---- mandala: two stacked planes (colored rosette + hot white core), textured procedurally once
    const tex = mandalaTexture();
    const planeGeo = new THREE.PlaneGeometry(1, 1);
    const mandala = new THREE.Mesh(planeGeo, new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    const mandalaCore = new THREE.Mesh(planeGeo, new THREE.MeshBasicMaterial({ map: tex, color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    mandala.position.set(0, 3.2, -1.2); mandalaCore.position.set(0, 3.2, -1.15);
    mandala.renderOrder = 12; mandalaCore.renderOrder = 12;
    const halo = new THREE.Mesh(geoCache.disc, this.mat(color, 0));
    halo.position.set(0, 3.2, -1.3); halo.renderOrder = 11;
    g.add(halo, mandala, mandalaCore);
    // ---- wings: tapered crescents in the XY plane, tips out at (±4.6, 3.6), roots at the shoulders
    const wingGeo = crescentGeo(4.6, 0.16, Math.PI * 0.5, 40);
    const wingCoreGeo = crescentGeo(4.6, 0.07, Math.PI * 0.5, 40);
    const wings: THREE.Mesh[] = [];
    const tips: THREE.Vector3[] = [];
    for (const side of [-1, 1]) {
      const w = new THREE.Mesh(wingGeo, this.mat(color, 0));
      const c = new THREE.Mesh(wingCoreGeo, this.mat(0xffffff, 0));
      // centre of curvature above the head so the arc sweeps from the shoulder up and outward
      w.position.set(side * 0.4, 4.6, -0.3); c.position.copy(w.position).setZ(-0.28);
      w.rotation.z = side === 1 ? -Math.PI * 0.28 : Math.PI + Math.PI * 0.28;
      c.rotation.z = w.rotation.z;
      w.renderOrder = 13; c.renderOrder = 13;
      g.add(w, c); wings.push(w, c);
      // arc end at angle (rot ± arc/2) closest to horizontal is the tip
      const a = w.rotation.z + (side === 1 ? Math.PI * 0.25 : -Math.PI * 0.25);
      tips.push(new THREE.Vector3(w.position.x + Math.cos(a) * 4.6, w.position.y + Math.sin(a) * 4.6, -0.3));
    }
    const tipFlares = tips.map(() => { const m = new THREE.Mesh(geoCache.disc, this.mat(0xffffff, 0)); m.renderOrder = 14; g.add(m); return m; });
    g.scale.setScalar(0.01);
    this.scene.add(g);
    let t = 0, arcT = 0, flareT = 0;
    const scene = this.scene, fx = this;
    const worldTip = new THREE.Vector3();
    const handle = {
      group: g,
      charge: 0,
      update(dt: number, camera?: THREE.Camera) {
        t += dt; arcT += dt; flareT += dt;
        const k = Math.min(1, t / 0.9);
        g.scale.setScalar(easeOutBack(k) * (1 + Math.sin(t * 3) * 0.01));
        const c = handle.charge;
        mandala.rotation.z += dt * 0.25; mandalaCore.rotation.z -= dt * 0.18;
        const ms = 6.2 + c * 0.9 + Math.sin(t * 4) * 0.08;
        mandala.scale.set(ms, ms, 1); mandalaCore.scale.set(ms * 0.72, ms * 0.72, 1);
        (mandala.material as THREE.MeshBasicMaterial).opacity = 0.7 + c * 0.3;
        (mandalaCore.material as THREE.MeshBasicMaterial).opacity = 0.12 + c * 0.3;
        halo.scale.setScalar(ms * 0.55 + c * 0.6);
        (halo.material as THREE.MeshBasicMaterial).opacity = 0.03 + c * 0.05;
        for (let i = 0; i < wings.length; i++) (wings[i].material as THREE.MeshBasicMaterial).opacity = (i % 2 ? 0.5 : 0.75) * (0.35 + c * 0.65) * Math.min(1, t / 0.5);
        // lens-flare tips: a camera-facing disc that pulses
        for (let i = 0; i < tipFlares.length; i++) {
          const f = tipFlares[i];
          f.position.copy(tips[i]);
          if (camera) { f.quaternion.copy(g.quaternion).invert().multiply(camera.quaternion); }
          f.scale.setScalar(0.22 + c * 0.2 + Math.sin(t * 9 + i) * 0.06);
          (f.material as THREE.MeshBasicMaterial).opacity = (0.4 + c * 0.6) * Math.min(1, t / 0.5);
        }
        // lightning racing along the outstretched arms, in world space
        if (arcT > 0.07) {
          arcT = 0;
          const spanL = g.localToWorld(new THREE.Vector3(-2.6 - c * 0.6, 1.05, 0.2));
          const spanR = g.localToWorld(new THREE.Vector3(2.6 + c * 0.6, 1.05, 0.2));
          const mid = g.localToWorld(new THREE.Vector3(0, 1.0, 0.2));
          fx.lightning(mid, Math.random() < 0.5 ? spanL : spanR, 0xbfeeff, 0.1, 0.05 + c * 0.03, 1);
          if (c > 0.5 && Math.random() < 0.5) fx.lightning(spanL.clone().setY(spanL.y + 0.3), spanR.clone().setY(spanR.y + 0.3), 0xffffff, 0.08, 0.04, 0);
        }
        if (flareT > 0.28) { flareT = 0; for (const tp of tips) { g.localToWorld(worldTip.copy(tp)); fx.flash(worldTip.clone(), 0xffffff, 0.45 + c * 0.4, 0.3, camera); } }
      },
      /** dissolve into sparks and remove */
      dissolve() {
        for (const tp of tips) { g.localToWorld(worldTip.copy(tp)); fx.particles.emit({ pos: worldTip, count: 14, velSpread: 6, life: 0.9, size: 0.14, color: [color, 0xffffff], shape: Shape.SPARK, stretch: 1.4, gravity: 6 }); }
        const mp = g.localToWorld(new THREE.Vector3(0, 2.6, -0.9));
        fx.particles.emit({ pos: mp, count: 40, spread: 2.4, velSpread: 3, life: 1.2, size: 0.16, color: [color, 0xffffff], shape: Shape.STAR, gravity: 2, rotSpeed: 3 });
        fx.shockwave(mp, color, 8, 0.6, { vertical: facing });
        handle.dispose();
      },
      dispose() { scene.remove(g); g.traverse((o: any) => { if (o.material && o.material._own) o.material.dispose(); }); mandala.material.dispose(); mandalaCore.material.dispose(); wingGeo.dispose(); wingCoreGeo.dispose(); planeGeo.dispose(); },
    };
    return handle;
  }

  absorbVortex(center: THREE.Vector3, color: THREE.ColorRepresentation, radius = 3, count = 40) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2);
      const r = radius * rand(0.5, 1);
      this.particles.emit({ pos: { x: center.x + Math.cos(a) * r, y: center.y + rand(0, 1.5), z: center.z + Math.sin(a) * r }, count: 1, life: rand(0.5, 1.0), size: rand(0.1, 0.3), color: [color, 0x9a4bff, 0x2a0a40], shape: Shape.GLOW, orbit: rand(6, 10), vel: { x: 0, y: rand(-0.5, 0.5), z: 0 } });
    }
  }

  healSparkles(pos: THREE.Vector3, color: THREE.ColorRepresentation = 0x9bffb0, count = 12) {
    this.particles.emit({ pos: { x: pos.x, y: pos.y + 0.3, z: pos.z }, count, spread: 0.6, velUp: 2, velSpread: 0.6, life: 1, lifeVar: 0.3, size: 0.15, sizeVar: 0.06, color: [color, 0xffffff], shape: Shape.STAR, gravity: -1, rotSpeed: 2 });
  }
}
