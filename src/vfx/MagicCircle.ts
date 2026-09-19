import * as THREE from 'three';
import { easeOutBack, mulberry } from '../core/Math';

/** Generates an original rune band texture procedurally on a canvas. */
function runeBandTexture(seed: number, glyphs = 24): THREE.CanvasTexture {
  const size = 1024;
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = 128;
  const ctx = cv.getContext('2d')!;
  ctx.clearRect(0, 0, size, 128);
  ctx.strokeStyle = '#fff';
  ctx.fillStyle = '#fff';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  const rnd = mulberry(seed);
  const cell = size / glyphs;
  for (let g = 0; g < glyphs; g++) {
    const x0 = g * cell + cell * 0.22, w = cell * 0.56;
    const y0 = 22, h = 84;
    const n = 3 + Math.floor(rnd() * 4);
    ctx.beginPath();
    let px = x0 + rnd() * w, py = y0 + rnd() * h;
    ctx.moveTo(px, py);
    for (let i = 0; i < n; i++) {
      const nx = x0 + Math.round(rnd() * 2) * (w / 2), ny = y0 + Math.round(rnd() * 3) * (h / 3);
      ctx.lineTo(nx, ny);
      px = nx; py = ny;
    }
    ctx.stroke();
    if (rnd() < 0.5) { ctx.beginPath(); ctx.arc(x0 + rnd() * w, y0 + rnd() * h, 5, 0, Math.PI * 2); ctx.fill(); }
  }
  // border lines
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, 6); ctx.lineTo(size, 6); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, 122); ctx.lineTo(size, 122); ctx.stroke();
  // ticks
  for (let i = 0; i < glyphs * 4; i++) {
    const x = (i / (glyphs * 4)) * size;
    ctx.beginPath(); ctx.moveTo(x, 6); ctx.lineTo(x, i % 4 === 0 ? 20 : 12); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const bandCache = new Map<number, THREE.CanvasTexture>();
function band(seed: number) {
  if (!bandCache.has(seed)) bandCache.set(seed, runeBandTexture(seed));
  return bandCache.get(seed)!;
}

function ringGeo(inner: number, outer: number, segs = 96) {
  const g = new THREE.RingGeometry(inner, outer, segs, 1);
  // remap uv so u runs around the ring and v across it
  const pos = g.attributes.position as THREE.BufferAttribute;
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    const a = Math.atan2(y, x) / (Math.PI * 2) + 0.5;
    const r = (Math.hypot(x, y) - inner) / (outer - inner);
    uv.setXY(i, a * 3, r);
  }
  uv.needsUpdate = true;
  return g;
}

function polygonLines(radius: number, sides: number, star = false): THREE.BufferGeometry {
  const pts: number[] = [];
  const step = star ? 2 : 1;
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2;
    const a1 = (((i + step) % sides) / sides) * Math.PI * 2;
    pts.push(Math.cos(a0) * radius, Math.sin(a0) * radius, 0, Math.cos(a1) * radius, Math.sin(a1) * radius, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return g;
}

export interface CircleOptions {
  color?: THREE.ColorRepresentation;
  radius?: number;
  layers?: number; // 1..3 complexity
  vertical?: boolean;
  seed?: number;
  intensity?: number;
}

/** A layered, animated, procedural anime magic circle. */
export class MagicCircle {
  group = new THREE.Group();
  private mats: THREE.Material[] = [];
  private rings: { m: THREE.Object3D; speed: number }[] = [];
  private t = 0;
  private appearT = 0;
  private appearDur = 0.45;
  private fadeOut = -1;
  private fadeDur = 0.3;
  private intensity: number;
  radius: number;
  color: THREE.Color;
  dead = false;
  private lineMat: THREE.LineBasicMaterial;
  private disc: THREE.Mesh;

  constructor(opts: CircleOptions = {}) {
    const color = new THREE.Color(opts.color ?? 0x7fd4ff);
    this.color = color;
    const radius = opts.radius ?? 1.6;
    this.radius = radius;
    const layers = opts.layers ?? 2;
    const seed = opts.seed ?? 3;
    this.intensity = opts.intensity ?? 1;

    const mkMat = (tex: THREE.Texture | null, opacity: number) => {
      const m = new THREE.MeshBasicMaterial({ color, map: tex, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
      this.mats.push(m);
      return m;
    };
    // outer rune band
    const outer = new THREE.Mesh(ringGeo(radius * 0.82, radius), mkMat(band(seed), 1));
    this.group.add(outer);
    this.rings.push({ m: outer, speed: 0.35 });
    // thin outer edge
    const edge = new THREE.Mesh(ringGeo(radius * 1.02, radius * 1.06, 96), mkMat(null, 0.9));
    this.group.add(edge);
    // inner rune band (counter rotating)
    if (layers >= 2) {
      const inner = new THREE.Mesh(ringGeo(radius * 0.5, radius * 0.62), mkMat(band(seed + 11), 0.9));
      this.group.add(inner);
      this.rings.push({ m: inner, speed: -0.6 });
    }
    // geometric layer: polygon + star lines
    this.lineMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.mats.push(this.lineMat);
    const poly = new THREE.LineSegments(polygonLines(radius * 0.8, layers >= 3 ? 8 : 6), this.lineMat);
    this.group.add(poly);
    this.rings.push({ m: poly, speed: -0.2 });
    const star = new THREE.LineSegments(polygonLines(radius * 0.8, layers >= 3 ? 8 : 6, true), this.lineMat);
    this.group.add(star);
    this.rings.push({ m: star, speed: 0.25 });
    if (layers >= 3) {
      const tri = new THREE.LineSegments(polygonLines(radius * 0.5, 3), this.lineMat);
      this.group.add(tri);
      this.rings.push({ m: tri, speed: 0.9 });
      const tri2 = new THREE.LineSegments(polygonLines(radius * 0.5, 3), this.lineMat);
      tri2.rotation.z = Math.PI;
      this.group.add(tri2);
      this.rings.push({ m: tri2, speed: 0.9 });
      const far = new THREE.Mesh(ringGeo(radius * 1.15, radius * 1.22, 96), mkMat(band(seed + 23), 0.6));
      this.group.add(far);
      this.rings.push({ m: far, speed: -0.15 });
    }
    // central glow disc
    this.disc = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.42, 48), mkMat(null, 0.35));
    this.group.add(this.disc);
    // small orbit dots
    const dotGeo = new THREE.CircleGeometry(radius * 0.05, 12);
    const dotMat = mkMat(null, 1);
    const dots = new THREE.Group();
    const nd = 6;
    for (let i = 0; i < nd; i++) {
      const d = new THREE.Mesh(dotGeo, dotMat);
      const a = (i / nd) * Math.PI * 2;
      d.position.set(Math.cos(a) * radius * 0.72, Math.sin(a) * radius * 0.72, 0.01);
      dots.add(d);
    }
    this.group.add(dots);
    this.rings.push({ m: dots, speed: 1.2 });

    if (!opts.vertical) this.group.rotation.x = -Math.PI / 2;
    this.group.scale.setScalar(0.001);
    this.group.renderOrder = 15;
  }

  /** Start fade out; group removed after done. */
  dismiss(dur = 0.3) {
    if (this.fadeOut < 0) { this.fadeOut = 0; this.fadeDur = dur; }
  }

  update(dt: number) {
    this.t += dt;
    let s = 1;
    if (this.appearT < this.appearDur) {
      this.appearT += dt;
      s = easeOutBack(Math.min(1, this.appearT / this.appearDur));
    }
    let op = 1;
    if (this.fadeOut >= 0) {
      this.fadeOut += dt;
      op = 1 - Math.min(1, this.fadeOut / this.fadeDur);
      s *= 1 + this.fadeOut * 0.6;
      if (op <= 0) { this.dead = true; this.group.removeFromParent(); return; }
    }
    const pulse = 0.92 + Math.sin(this.t * 6) * 0.08;
    this.group.scale.setScalar(Math.max(0.001, s) * this.radius / (this.radius) * pulse * 1);
    for (const r of this.rings) r.m.rotation.z += r.speed * dt * 2;
    for (const m of this.mats) (m as any).opacity = ((m as any)._base ?? ((m as any)._base = (m as any).opacity)) * op * this.intensity;
    (this.disc.material as THREE.MeshBasicMaterial).opacity = (0.25 + Math.sin(this.t * 8) * 0.1) * op;
  }

  setIntensity(v: number) { this.intensity = v; }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse((o) => { if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose(); });
    this.mats.forEach((m) => m.dispose());
    this.dead = true;
  }
}
