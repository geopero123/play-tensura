import * as THREE from 'three';
import { Terrain, LANDMARKS } from './Terrain';
import { Particles, Shape } from '../vfx/Particles';
import { globalUniforms } from '../render/ToonMaterial';
import { mulberry, rand } from '../core/Math';

// ---------- butterflies (instanced, flapping in shader) ----------
const bfVert = /* glsl */ `
attribute vec3 iPos; attribute vec3 iCol; attribute float iPhase;
uniform float uTime;
varying vec3 vCol; varying vec2 vUv;
void main() {
  vUv = uv; vCol = iCol;
  vec3 p = position;
  float flap = sin(uTime * 14.0 + iPhase * 10.0);
  p.y += abs(p.x) * flap * 0.9;
  p.x *= 1.0 - abs(flap) * 0.25;
  // gentle bobbing
  vec3 wp = iPos + vec3(0.0, sin(uTime * 2.0 + iPhase * 6.0) * 0.15, 0.0);
  // face flight direction: rotate by time-based heading
  float head = iPhase * 6.28 + uTime * 0.25;
  float c = cos(head), s = sin(head);
  p = vec3(p.x * c - p.z * s, p.y, p.x * s + p.z * c);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp + p, 1.0);
}`;
const bfFrag = /* glsl */ `
precision highp float; varying vec3 vCol; varying vec2 vUv;
void main() {
  vec2 p = vUv - 0.5;
  float wing = 1.0 - smoothstep(0.35, 0.5, length(p * vec2(1.0, 1.4)));
  if (wing < 0.5) discard;
  float spot = smoothstep(0.12, 0.08, length(p - vec2(0.15, 0.1)));
  vec3 col = mix(vCol, vec3(0.1, 0.05, 0.15), spot);
  col = mix(col, vec3(0.1, 0.05, 0.15), smoothstep(0.42, 0.5, length(p * vec2(1.0, 1.4))) * 0.8);
  gl_FragColor = vec4(col, 1.0);
}`;

export class Ambient {
  group = new THREE.Group();
  private butterflies: THREE.Mesh;
  private bfPos: Float32Array;
  private bfAttr: THREE.InstancedBufferAttribute;
  private bfCenters: { x: number; z: number; r: number }[] = [];
  private bfCount: number;
  private birds: THREE.Group[] = [];
  private fogPlanes: THREE.Mesh[] = [];
  private fireflyTimer = 0;
  private moteTimer = 0;
  private leafTimer = 0;
  private fireTimer = 0;
  private terrain: Terrain;
  campfires: THREE.Vector3[] = [];
  chimneys: THREE.Vector3[] = [];
  blossomSpots: THREE.Vector3[] = [];

  constructor(terrain: Terrain) {
    this.terrain = terrain;
    // butterflies
    const n = 60;
    this.bfCount = n;
    const geo = new THREE.InstancedBufferGeometry();
    const base = new THREE.PlaneGeometry(0.28, 0.2);
    base.rotateX(-Math.PI / 2);
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.attributes.uv = base.attributes.uv;
    this.bfPos = new Float32Array(n * 3);
    const cols = new Float32Array(n * 3);
    const phases = new Float32Array(n);
    const rnd = mulberry(21);
    const palette = [[1, 0.6, 0.2], [0.5, 0.7, 1], [1, 0.4, 0.7], [1, 0.9, 0.4], [0.7, 0.5, 1]];
    const spots = [LANDMARKS.glade, LANDMARKS.village, LANDMARKS.spring, LANDMARKS.training, LANDMARKS.hidden, LANDMARKS.ruins];
    for (let i = 0; i < n; i++) {
      const s = spots[i % spots.length];
      const cx = s.x + (rnd() - 0.5) * 30, cz = s.z + (rnd() - 0.5) * 30;
      this.bfCenters.push({ x: cx, z: cz, r: 3 + rnd() * 6 });
      this.bfPos[i * 3] = cx; this.bfPos[i * 3 + 1] = terrain.heightAt(cx, cz) + 1; this.bfPos[i * 3 + 2] = cz;
      const c = palette[Math.floor(rnd() * palette.length)];
      cols[i * 3] = c[0]; cols[i * 3 + 1] = c[1]; cols[i * 3 + 2] = c[2];
      phases[i] = rnd();
    }
    this.bfAttr = new THREE.InstancedBufferAttribute(this.bfPos, 3);
    this.bfAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.bfAttr);
    geo.setAttribute('iCol', new THREE.InstancedBufferAttribute(cols, 3));
    geo.setAttribute('iPhase', new THREE.InstancedBufferAttribute(phases, 1));
    geo.instanceCount = n;
    this.butterflies = new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: bfVert, fragmentShader: bfFrag, uniforms: { uTime: globalUniforms.uTime }, side: THREE.DoubleSide }));
    this.butterflies.frustumCulled = false;
    this.group.add(this.butterflies);

    // birds: simple V shapes circling high
    const birdMat = new THREE.MeshBasicMaterial({ color: 0x2a2a3a, side: THREE.DoubleSide });
    for (let f = 0; f < 3; f++) {
      const flock = new THREE.Group();
      for (let i = 0; i < 5; i++) {
        const b = new THREE.Group();
        const wl = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.18), birdMat); wl.position.x = -0.35;
        const wr = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.18), birdMat); wr.position.x = 0.35;
        b.add(wl, wr);
        b.position.set((i - 2) * 1.4, -Math.abs(i - 2) * 0.4, Math.abs(i - 2) * 1.2);
        flock.add(b);
      }
      (flock as any).cx = [0, -80, 110][f]; (flock as any).cz = [-30, 60, -60][f]; (flock as any).r = 40 + f * 15; (flock as any).ph = f * 2;
      this.birds.push(flock);
      this.group.add(flock);
    }

    // drifting fog planes in forest and arena
    const fogTex = this.makeFogTexture();
    const fogMat = new THREE.MeshBasicMaterial({ map: fogTex, transparent: true, opacity: 0.22, depthWrite: false, color: 0xdff0ff });
    const fogSpots = [
      ...Array.from({ length: 14 }, (_, i) => ({ x: LANDMARKS.wolfWoods.x + (rnd() - 0.5) * 60, z: LANDMARKS.wolfWoods.z + (rnd() - 0.5) * 50, s: 14 + rnd() * 10 })),
      ...Array.from({ length: 10 }, () => ({ x: LANDMARKS.arena.x + (rnd() - 0.5) * 50, z: LANDMARKS.arena.z + (rnd() - 0.5) * 50, s: 16 + rnd() * 10 })),
      ...Array.from({ length: 10 }, () => ({ x: (rnd() - 0.5) * 300, z: (rnd() - 0.5) * 300, s: 18 + rnd() * 12 })),
      ...Array.from({ length: 6 }, () => ({ x: LANDMARKS.cave.x + (rnd() - 0.5) * 8, z: LANDMARKS.cave.z - 10 - rnd() * 40, s: 8 + rnd() * 4 })),
    ];
    for (const s of fogSpots) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), fogMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(s.x, terrain.heightAt(s.x, s.z) + 0.8 + rnd() * 1.2, s.z);
      m.scale.set(s.s, s.s, 1);
      m.rotation.z = rnd() * 6.28;
      m.renderOrder = 8;
      (m as any).ph = rnd() * 6.28;
      this.fogPlanes.push(m);
      this.group.add(m);
    }
  }

  private makeFogTexture() {
    const s = 256;
    const cv = document.createElement('canvas'); cv.width = s; cv.height = s;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(s, s);
    const rnd = mulberry(5);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const dx = (x - s / 2) / (s / 2), dy = (y - s / 2) / (s / 2);
      const d = Math.hypot(dx, dy);
      let a = Math.max(0, 1 - d);
      a = a * a * (0.7 + rnd() * 0.3);
      const i = (y * s + x) * 4;
      img.data[i] = 255; img.data[i + 1] = 255; img.data[i + 2] = 255; img.data[i + 3] = Math.floor(a * 255);
    }
    ctx.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(cv);
    return t;
  }

  update(dt: number, time: number, particles: Particles, playerPos: THREE.Vector3, storm: number) {
    // butterflies wander in figure-eights around their centers
    for (let i = 0; i < this.bfCount; i++) {
      const c = this.bfCenters[i];
      const t = time * 0.35 + i * 1.7;
      const x = c.x + Math.sin(t) * c.r + Math.sin(t * 2.3) * 1.5;
      const z = c.z + Math.sin(t * 0.7 + 1) * c.r * 0.8 + Math.cos(t * 1.9) * 1.2;
      const y = this.terrain.heightAt(x, z) + 0.9 + Math.sin(t * 3) * 0.4 + 0.3;
      this.bfPos[i * 3] = x; this.bfPos[i * 3 + 1] = y; this.bfPos[i * 3 + 2] = z;
    }
    this.bfAttr.needsUpdate = true;

    // birds circle
    for (const f of this.birds) {
      const a = time * 0.12 + (f as any).ph;
      const r = (f as any).r;
      f.position.set((f as any).cx + Math.cos(a) * r, 34 + Math.sin(time * 0.3 + (f as any).ph) * 4, (f as any).cz + Math.sin(a) * r);
      f.rotation.y = -a - Math.PI / 2;
      f.children.forEach((b, i) => { const flap = Math.sin(time * 9 + i) * 0.7; b.children[0].rotation.z = flap; b.children[1].rotation.z = -flap; });
    }
    // fog drift
    for (const m of this.fogPlanes) {
      const ph = (m as any).ph;
      m.position.x += Math.sin(time * 0.1 + ph) * dt * 0.6;
      m.position.z += Math.cos(time * 0.13 + ph) * dt * 0.5;
      (m.material as THREE.MeshBasicMaterial).opacity = 0.16 + Math.sin(time * 0.3 + ph) * 0.06 + storm * 0.12;
    }

    // ambient magical motes around the player (forest spirit particles)
    this.moteTimer -= dt;
    if (this.moteTimer <= 0) {
      this.moteTimer = 0.12;
      const info = this.terrain.info(playerPos.x, playerPos.z);
      const a = rand(0, Math.PI * 2), d = rand(4, 18);
      const px = playerPos.x + Math.cos(a) * d, pz = playerPos.z + Math.sin(a) * d;
      const magical = info.hidden > 0.2 || Math.hypot(px - LANDMARKS.caveEnd.x, pz - LANDMARKS.caveEnd.z) < 14;
      particles.emit({ pos: { x: px, y: this.terrain.heightAt(px, pz) + rand(0.5, 3), z: pz }, count: magical ? 3 : 1, spread: 0.5, velUp: 0.4, velSpread: 0.3, life: 3, lifeVar: 1, size: magical ? 0.12 : 0.07, sizeVar: 0.03, color: magical ? [0x9fefff, 0xc8a8ff, 0xffffff] : [0xfff6c0, 0xd8ffd0], alpha: 0.8, fadeIn: 0.8, shape: Shape.GLOW, gravity: -0.05 });
    }
    // fireflies in forest & storm sparks in arena
    this.fireflyTimer -= dt;
    if (this.fireflyTimer <= 0) {
      this.fireflyTimer = 0.3;
      const info = this.terrain.info(playerPos.x, playerPos.z);
      if (info.forest > 0.4) {
        const a = rand(0, Math.PI * 2), d = rand(3, 14);
        const px = playerPos.x + Math.cos(a) * d, pz = playerPos.z + Math.sin(a) * d;
        particles.emit({ pos: { x: px, y: this.terrain.heightAt(px, pz) + rand(0.4, 1.8), z: pz }, count: 1, velSpread: 0.5, life: 2.5, lifeVar: 1, size: 0.1, color: [0xd4ff7a, 0xa8ff5a], alpha: 1, fadeIn: 1, shape: Shape.GLOW, gravity: -0.1 });
      }
      if (storm > 0.2) {
        const a = rand(0, Math.PI * 2), d = rand(3, 24);
        const px = playerPos.x + Math.cos(a) * d, pz = playerPos.z + Math.sin(a) * d;
        particles.emit({ pos: { x: px, y: this.terrain.heightAt(px, pz) + rand(0.5, 4), z: pz }, count: 2, vel: { x: -6 * storm, y: 1, z: 2 * storm }, velSpread: 3, life: 1.2, lifeVar: 0.4, size: 0.12, color: [0xbfe8ff, 0xa080ff, 0xffffff], shape: Shape.SPARK, stretch: 1.4, drag: 0.5 });
        particles.emit({ pos: { x: px, y: this.terrain.heightAt(px, pz) + rand(0.2, 2), z: pz }, count: 1, vel: { x: -8 * storm, y: 0.5, z: 3 * storm }, velSpread: 2, life: 1.5, size: 0.16, color: [0x5a4a3a, 0x7a6a5a], alpha: 0.9, shape: Shape.PETAL, rotSpeed: 10, additive: false });
      }
    }
    // falling blossom petals near blossom trees, leaves in forest
    this.leafTimer -= dt;
    if (this.leafTimer <= 0) {
      this.leafTimer = 0.25;
      const info = this.terrain.info(playerPos.x, playerPos.z);
      const dv = Math.hypot(playerPos.x - LANDMARKS.village.x, playerPos.z - LANDMARKS.village.z);
      const dh = Math.hypot(playerPos.x - LANDMARKS.hidden.x, playerPos.z - LANDMARKS.hidden.z);
      if (dv < 50 || dh < 22) {
        const px = playerPos.x + rand(-14, 14), pz = playerPos.z + rand(-14, 14);
        particles.emit({ pos: { x: px, y: this.terrain.heightAt(px, pz) + rand(3, 6), z: pz }, count: 2, vel: { x: 0.8, y: -0.6, z: 0.3 }, velSpread: 0.6, life: 4, lifeVar: 1, size: 0.13, color: [0xffb7d5, 0xffd1e3], alpha: 0.95, shape: Shape.PETAL, rotSpeed: 6, additive: false, gravity: 0.05 });
      } else if (info.forest > 0.5) {
        const px = playerPos.x + rand(-12, 12), pz = playerPos.z + rand(-12, 12);
        particles.emit({ pos: { x: px, y: this.terrain.heightAt(px, pz) + rand(3, 6), z: pz }, count: 1, vel: { x: 0.6, y: -0.5, z: 0.2 }, velSpread: 0.5, life: 4, lifeVar: 1, size: 0.14, color: [0x7cc95a, 0xa8d86a, 0xd8b35a], alpha: 0.95, shape: Shape.PETAL, rotSpeed: 6, additive: false, gravity: 0.05 });
      }
    }
    // campfire flames & chimney smoke
    this.fireTimer -= dt;
    if (this.fireTimer <= 0) {
      this.fireTimer = 0.05;
      for (const c of this.campfires) {
        if (c.distanceTo(playerPos) > 70) continue;
        particles.emit({ pos: c, count: 2, spread: 0.25, velUp: 2.2, velSpread: 0.4, life: 0.55, lifeVar: 0.15, size: 0.55, sizeVar: 0.15, sizeEnd: 0.3, color: [0xffb020, 0xff6a10, 0xffe080], shape: Shape.FLAME, drag: 1 });
        if (Math.random() < 0.4) particles.emit({ pos: { x: c.x, y: c.y + 0.6, z: c.z }, count: 1, spread: 0.2, velUp: 1.8, velSpread: 0.3, life: 0.7, size: 0.06, color: [0xffd070, 0xff8030], shape: Shape.SPARK, stretch: 0.6, gravity: -1 });
        if (Math.random() < 0.3) particles.emit({ pos: { x: c.x, y: c.y + 1.0, z: c.z }, count: 1, velUp: 1.2, velSpread: 0.2, life: 2.5, size: 0.5, sizeEnd: 3, color: [0x555560], alpha: 0.35, shape: Shape.SMOKE, additive: false, rotSpeed: 1, drag: 0.5 });
      }
      for (const c of this.chimneys) {
        if (c.distanceTo(playerPos) > 80 || Math.random() > 0.35) continue;
        particles.emit({ pos: c, count: 1, velUp: 1.0, vel: { x: 0.4, y: 0, z: 0.2 }, velSpread: 0.2, life: 3.5, size: 0.4, sizeEnd: 3.5, color: [0xcfd4e0], alpha: 0.35, shape: Shape.SMOKE, additive: false, rotSpeed: 0.8 });
      }
    }
  }
}
