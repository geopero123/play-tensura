import * as THREE from 'three';
import { Particles, Shape } from './Particles';
import { createGlowMaterial } from '../render/ToonMaterial';
import { easeOutCubic, easeOutQuart, rand } from '../core/Math';

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
