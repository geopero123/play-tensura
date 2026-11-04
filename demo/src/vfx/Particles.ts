import * as THREE from 'three';
import { rand } from '../core/Math';

export const Shape = {
  GLOW: 0,
  DOT: 1,
  SPARK: 2,
  RING: 3,
  STAR: 4,
  SMOKE: 5,
  PETAL: 6,
  SLASH: 7,
  FLAME: 8,
} as const;

export interface EmitConfig {
  pos: THREE.Vector3 | { x: number; y: number; z: number };
  count?: number;
  /** spread radius around pos */
  spread?: number;
  spreadY?: number;
  /** base velocity */
  vel?: { x: number; y: number; z: number };
  /** random velocity magnitude added in random directions */
  velSpread?: number;
  velUp?: number;
  life?: number;
  lifeVar?: number;
  size?: number;
  sizeVar?: number;
  sizeEnd?: number; // multiplier
  color?: THREE.ColorRepresentation | THREE.ColorRepresentation[];
  colorEnd?: THREE.ColorRepresentation;
  alpha?: number;
  gravity?: number;
  drag?: number;
  shape?: number;
  stretch?: number;
  rotSpeed?: number;
  additive?: boolean;
  /** direction to bias random velocities (cone) */
  dir?: THREE.Vector3;
  cone?: number; // 0..1, 1 = full sphere
  fadeIn?: number;
  /** orbit around pos (for vortex effects) */
  orbit?: number;
}

const vert = /* glsl */ `
attribute vec3 iPos;
attribute vec3 iVel;
attribute vec4 iColor;
attribute vec4 iParams; // size, rot, shape, stretch
varying vec4 vColor;
varying vec2 vUv;
varying float vShape;
varying float vSeed;
void main() {
  vUv = uv;
  vColor = iColor;
  vShape = iParams.z;
  vSeed = fract(iPos.x * 12.9898 + iPos.z * 78.233);
  float size = iParams.x;
  float rot = iParams.y;
  float stretch = iParams.w;
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  vec2 q = position.xy;
  float c = cos(rot), s = sin(rot);
  q = vec2(q.x * c - q.y * s, q.x * s + q.y * c);
  if (stretch > 0.0) {
    vec3 vv = (viewMatrix * vec4(iVel, 0.0)).xyz;
    float len = length(vv.xy);
    vec2 d = len > 0.0001 ? vv.xy / len : vec2(1.0, 0.0);
    vec2 p = vec2(position.x * (1.0 + stretch * min(len, 12.0) * 0.25), position.y);
    q = vec2(p.x * d.x - p.y * d.y, p.x * d.y + p.y * d.x);
  }
  mv.xyz += vec3(q * size, 0.0);
  gl_Position = projectionMatrix * mv;
}`;

const frag = /* glsl */ `
precision highp float;
varying vec4 vColor;
varying vec2 vUv;
varying float vShape;
varying float vSeed;
uniform float uTime;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y); }
void main() {
  vec2 p = vUv - 0.5;
  float d = length(p) * 2.0;
  float a = 0.0;
  int shape = int(vShape + 0.5);
  if (shape == 0) { a = pow(max(0.0, 1.0 - d), 2.2); }                     // soft glow
  else if (shape == 1) { a = 1.0 - smoothstep(0.75, 0.95, d); }            // hard dot
  else if (shape == 2) { float x = abs(p.x) * 2.0; float y = abs(p.y) * 2.0; a = (1.0 - smoothstep(0.0, 1.0, x)) * (1.0 - smoothstep(0.0, 0.5, y)); a = pow(a, 1.5); } // spark streak
  else if (shape == 3) { a = smoothstep(0.55, 0.7, d) * (1.0 - smoothstep(0.85, 1.0, d)); } // ring
  else if (shape == 4) { float s = abs(p.x) + abs(p.y); a = (1.0 - smoothstep(0.25, 0.5, s)); float s2 = max(abs(p.x), abs(p.y)); a = max(a, pow(max(0.0, 1.0 - d), 3.0)); float rays = max(0.0, 1.0 - abs(p.x) * 14.0) * (1.0 - smoothstep(0.0, 1.0, abs(p.y) * 2.0)) + max(0.0, 1.0 - abs(p.y) * 14.0) * (1.0 - smoothstep(0.0, 1.0, abs(p.x) * 2.0)); a = clamp(a + rays * 0.8, 0.0, 1.0); } // star
  else if (shape == 5) { float n = noise(p * 5.0 + vSeed * 40.0 + uTime * 0.3); float n2 = noise(p * 11.0 - vSeed * 20.0); a = (1.0 - smoothstep(0.3, 1.0, d + (n - 0.5) * 0.5 + (n2 - 0.5) * 0.2)); a *= 0.85; } // smoke
  else if (shape == 6) { vec2 q = p * vec2(1.0, 1.8); float e = length(q) * 2.0; a = 1.0 - smoothstep(0.6, 0.85, e); } // petal
  else if (shape == 7) { float y = abs(p.y) * 2.0; float x = p.x * 2.0; float edge = 1.0 - smoothstep(0.0, 1.0, abs(x)); a = (1.0 - smoothstep(0.0, 0.18 * edge + 0.02, y)); } // slash line
  else if (shape == 8) { vec2 q = vec2(p.x, p.y + 0.15); float n = noise(q * 6.0 + vec2(vSeed * 30.0, -uTime * 4.0)); float flame = 1.0 - smoothstep(0.25, 0.95, length(q * vec2(1.6, 1.0)) * 2.0 + (n - 0.5) * 0.6 + max(0.0, q.y) * 0.8); a = flame; } // flame
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor.rgb, vColor.a * a);
}`;

interface P {
  alive: boolean;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; maxLife: number;
  size0: number; sizeEnd: number;
  r: number; g: number; b: number;
  r1: number; g1: number; b1: number;
  alpha: number; gravity: number; drag: number;
  rot: number; rotSpeed: number; shape: number; stretch: number;
  fadeIn: number;
  ox: number; oy: number; oz: number; orbit: number; orbitAngle: number; orbitR: number;
}

class Pool {
  mesh: THREE.Mesh;
  geo: THREE.InstancedBufferGeometry;
  ps: P[] = [];
  cap: number;
  aPos: THREE.InstancedBufferAttribute;
  aVel: THREE.InstancedBufferAttribute;
  aCol: THREE.InstancedBufferAttribute;
  aPar: THREE.InstancedBufferAttribute;
  cursor = 0;
  aliveCount = 0;

  constructor(cap: number, additive: boolean, uniforms: any) {
    this.cap = cap;
    const base = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = base.index;
    this.geo.attributes.position = base.attributes.position;
    this.geo.attributes.uv = base.attributes.uv;
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.aVel = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    this.aPar = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    for (const a of [this.aPos, this.aVel, this.aCol, this.aPar]) a.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iPos', this.aPos);
    this.geo.setAttribute('iVel', this.aVel);
    this.geo.setAttribute('iColor', this.aCol);
    this.geo.setAttribute('iParams', this.aPar);
    const mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 20 : 19;
    for (let i = 0; i < cap; i++) {
      this.ps.push({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, size0: 1, sizeEnd: 1, r: 1, g: 1, b: 1, r1: 1, g1: 1, b1: 1, alpha: 1, gravity: 0, drag: 0, rot: 0, rotSpeed: 0, shape: 0, stretch: 0, fadeIn: 0, ox: 0, oy: 0, oz: 0, orbit: 0, orbitAngle: 0, orbitR: 0 });
    }
    this.geo.instanceCount = 0;
  }

  next(): P {
    // round-robin allocation; overwrite oldest when full
    for (let i = 0; i < this.cap; i++) {
      const p = this.ps[(this.cursor + i) % this.cap];
      if (!p.alive) {
        this.cursor = (this.cursor + i + 1) % this.cap;
        return p;
      }
    }
    const p = this.ps[this.cursor];
    this.cursor = (this.cursor + 1) % this.cap;
    return p;
  }

  update(dt: number) {
    let n = 0;
    const pos = this.aPos.array as Float32Array;
    const vel = this.aVel.array as Float32Array;
    const col = this.aCol.array as Float32Array;
    const par = this.aPar.array as Float32Array;
    for (let i = 0; i < this.cap; i++) {
      const p = this.ps[i];
      if (!p.alive) continue;
      p.life += dt;
      if (p.life >= p.maxLife) { p.alive = false; continue; }
      const t = p.life / p.maxLife;
      p.vy -= p.gravity * dt;
      const dr = Math.max(0, 1 - p.drag * dt);
      p.vx *= dr; p.vy *= dr; p.vz *= dr;
      if (p.orbit > 0) {
        p.orbitAngle += p.orbit * dt;
        p.orbitR = Math.max(0, p.orbitR - dt * p.orbitR * 1.2);
        p.x = p.ox + Math.cos(p.orbitAngle) * p.orbitR;
        p.z = p.oz + Math.sin(p.orbitAngle) * p.orbitR;
        p.y += p.vy * dt;
      } else {
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      }
      p.rot += p.rotSpeed * dt;
      const size = p.size0 * (1 + (p.sizeEnd - 1) * t);
      let a = p.alpha * (1 - t * t);
      if (p.fadeIn > 0 && p.life < p.fadeIn) a *= p.life / p.fadeIn;
      const ct = t;
      const o3 = n * 3, o4 = n * 4;
      pos[o3] = p.x; pos[o3 + 1] = p.y; pos[o3 + 2] = p.z;
      vel[o3] = p.vx; vel[o3 + 1] = p.vy; vel[o3 + 2] = p.vz;
      col[o4] = p.r + (p.r1 - p.r) * ct; col[o4 + 1] = p.g + (p.g1 - p.g) * ct; col[o4 + 2] = p.b + (p.b1 - p.b) * ct; col[o4 + 3] = a;
      par[o4] = size; par[o4 + 1] = p.rot; par[o4 + 2] = p.shape; par[o4 + 3] = p.stretch;
      n++;
    }
    this.aliveCount = n;
    this.geo.instanceCount = n;
    if (n > 0) {
      this.aPos.addUpdateRange(0, n * 3); this.aPos.needsUpdate = true;
      this.aVel.addUpdateRange(0, n * 3); this.aVel.needsUpdate = true;
      this.aCol.addUpdateRange(0, n * 4); this.aCol.needsUpdate = true;
      this.aPar.addUpdateRange(0, n * 4); this.aPar.needsUpdate = true;
    }
  }
}

const tmpC = new THREE.Color();
const tmpC2 = new THREE.Color();

export class Particles {
  add: Pool;
  norm: Pool;
  uniforms = { uTime: { value: 0 } };
  group = new THREE.Group();
  budget = 1;

  constructor(cap: number) {
    this.add = new Pool(Math.floor(cap * 0.7), true, this.uniforms);
    this.norm = new Pool(Math.floor(cap * 0.3), false, this.uniforms);
    this.group.add(this.add.mesh, this.norm.mesh);
  }

  setCap(cap: number) {
    this.group.remove(this.add.mesh, this.norm.mesh);
    this.add = new Pool(Math.floor(cap * 0.7), true, this.uniforms);
    this.norm = new Pool(Math.floor(cap * 0.3), false, this.uniforms);
    this.group.add(this.add.mesh, this.norm.mesh);
  }

  emit(c: EmitConfig) {
    const pool = c.additive === false ? this.norm : this.add;
    const count = Math.max(1, Math.round((c.count ?? 1) * this.budget));
    const colors = Array.isArray(c.color) ? c.color : [c.color ?? 0xffffff];
    const hasEnd = c.colorEnd !== undefined;
    if (hasEnd) tmpC2.set(c.colorEnd!);
    const spread = c.spread ?? 0;
    const spreadY = c.spreadY ?? spread;
    const vs = c.velSpread ?? 0;
    for (let i = 0; i < count; i++) {
      const p = pool.next();
      p.alive = true;
      p.life = 0;
      p.maxLife = Math.max(0.05, (c.life ?? 1) + rand(-1, 1) * (c.lifeVar ?? 0));
      const ox = rand(-1, 1) * spread, oy = rand(-1, 1) * spreadY, oz = rand(-1, 1) * spread;
      p.x = c.pos.x + ox; p.y = c.pos.y + oy; p.z = c.pos.z + oz;
      // random direction, optionally biased to a cone around dir
      let dx = rand(-1, 1), dy = rand(-1, 1), dz = rand(-1, 1);
      const l = Math.hypot(dx, dy, dz) || 1;
      dx /= l; dy /= l; dz /= l;
      if (c.dir) {
        const k = 1 - (c.cone ?? 0.5);
        dx = dx * (1 - k) + c.dir.x * k * 1.5;
        dy = dy * (1 - k) + c.dir.y * k * 1.5;
        dz = dz * (1 - k) + c.dir.z * k * 1.5;
      }
      const sp = vs * rand(0.35, 1);
      p.vx = (c.vel?.x ?? 0) + dx * sp;
      p.vy = (c.vel?.y ?? 0) + dy * sp + (c.velUp ?? 0) * rand(0.5, 1);
      p.vz = (c.vel?.z ?? 0) + dz * sp;
      p.size0 = Math.max(0.01, (c.size ?? 0.3) + rand(-1, 1) * (c.sizeVar ?? 0));
      p.sizeEnd = c.sizeEnd ?? 1;
      tmpC.set(colors[Math.floor(Math.random() * colors.length)]);
      p.r = tmpC.r; p.g = tmpC.g; p.b = tmpC.b;
      if (hasEnd) { p.r1 = tmpC2.r; p.g1 = tmpC2.g; p.b1 = tmpC2.b; } else { p.r1 = p.r; p.g1 = p.g; p.b1 = p.b; }
      p.alpha = c.alpha ?? 1;
      p.gravity = c.gravity ?? 0;
      p.drag = c.drag ?? 0;
      p.rot = Math.random() * Math.PI * 2;
      p.rotSpeed = (c.rotSpeed ?? 0) * rand(-1, 1);
      p.shape = c.shape ?? Shape.GLOW;
      p.stretch = c.stretch ?? 0;
      p.fadeIn = c.fadeIn ?? 0;
      p.orbit = c.orbit ?? 0;
      if (p.orbit > 0) {
        p.ox = c.pos.x; p.oy = c.pos.y; p.oz = c.pos.z;
        p.orbitAngle = Math.atan2(oz, ox);
        p.orbitR = Math.hypot(ox, oz) || spread;
      }
    }
  }

  update(dt: number, time: number) {
    this.uniforms.uTime.value = time;
    this.add.update(dt);
    this.norm.update(dt);
  }

  get alive() {
    return this.add.aliveCount + this.norm.aliveCount;
  }
}
