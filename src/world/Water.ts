import * as THREE from 'three';
import { Terrain, riverX, LANDMARKS, WORLD_HALF } from './Terrain';
import { globalUniforms } from '../render/ToonMaterial';
import { Particles, Shape } from '../vfx/Particles';

const waterVert = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying vec3 vWorld;
varying float vFogDepth;
void main() {
  vUv = uv;
  vec3 p = position;
  p.y += sin(p.x * 0.8 + uTime * 2.0) * 0.06 + sin(p.z * 0.5 + uTime * 1.6) * 0.05;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  vec4 mv = viewMatrix * wp;
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const waterFrag = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uFoam; uniform vec3 uSky;
uniform vec3 uFogColor; uniform float uFogNear; uniform float uFogFar;
uniform float uFlow;
varying vec2 vUv; varying vec3 vWorld; varying float vFogDepth;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y); }
void main() {
  vec2 p = vWorld.xz;
  float t = uTime;
  // flowing caustic-ish highlight bands (stylized)
  float n1 = noise(p * 0.55 + vec2(0.0, t * uFlow));
  float n2 = noise(p * 1.1 + vec2(t * 0.3, t * uFlow * 1.7) + 5.0);
  float band = smoothstep(0.55, 0.62, n1 * 0.6 + n2 * 0.4) * 0.8;
  float band2 = smoothstep(0.66, 0.7, n2) * 0.6;
  // edge foam
  float edge = smoothstep(0.0, 0.16, vUv.x) * smoothstep(1.0, 0.84, vUv.x);
  float foamN = noise(p * 2.0 + vec2(0.0, t * uFlow * 2.2));
  float foam = (1.0 - edge) * smoothstep(0.35, 0.6, foamN);
  vec3 col = mix(uShallow, uDeep, edge * 0.85);
  col = mix(col, uSky, 0.25);
  col += uFoam * (band + band2) * 0.7;
  col = mix(col, uFoam, foam);
  float alpha = 0.82 + foam * 0.15;
  float fogF = smoothstep(uFogNear, uFogFar, vFogDepth);
  col = mix(col, uFogColor, fogF);
  gl_FragColor = vec4(col, alpha);
}`;

const fallFrag = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec3 uColor; uniform vec3 uFoam;
varying vec2 vUv; varying vec3 vWorld; varying float vFogDepth;
uniform vec3 uFogColor; uniform float uFogNear; uniform float uFogFar;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y); }
void main() {
  float t = uTime;
  float streaks = noise(vec2(vUv.x * 18.0, vUv.y * 3.0 + t * 2.6));
  float streaks2 = noise(vec2(vUv.x * 40.0 + 3.0, vUv.y * 5.0 + t * 3.8));
  float s = smoothstep(0.35, 0.75, streaks * 0.6 + streaks2 * 0.4);
  float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
  vec3 col = mix(uColor, uFoam, s);
  col = mix(col, uFoam, (1.0 - vUv.y) * 0.5);
  float alpha = (0.55 + s * 0.45) * edge;
  float fogF = smoothstep(uFogNear, uFogFar, vFogDepth);
  col = mix(col, uFogColor, fogF);
  gl_FragColor = vec4(col, alpha);
}`;

export class Water {
  group = new THREE.Group();
  river: THREE.Mesh;
  falls: THREE.Mesh[] = [];
  private u: Record<string, THREE.IUniform>;
  private mistTimer = 0;
  fallBase = new THREE.Vector3();
  fallTop = new THREE.Vector3();
  mistPoints: THREE.Vector3[] = [];

  constructor(terrain: Terrain, fog: THREE.Fog) {
    this.u = {
      uTime: globalUniforms.uTime,
      uDeep: { value: new THREE.Color(0x1f7bb8) },
      uShallow: { value: new THREE.Color(0x63d0ea) },
      uFoam: { value: new THREE.Color(0xf2ffff) },
      uSky: { value: new THREE.Color(0x9fdcff) },
      uFogColor: { value: fog.color },
      uFogNear: { value: fog.near },
      uFogFar: { value: fog.far },
      uFlow: { value: 1.4 },
    };
    // river ribbon
    const segs = 240;
    const width = 9;
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let i = 0; i <= segs; i++) {
      const z = -WORLD_HALF + (i / segs) * WORLD_HALF * 2;
      const cx = riverX(z);
      const dz = 1, dx = riverX(z + 1) - cx;
      const l = Math.hypot(dx, dz);
      const nx = dz / l, nz = -dx / l;
      const hc = terrain.heightAt(cx, z);
      const y = hc + 1.15;
      pos.push(cx - nx * width * 0.5, y, z - nz * width * 0.5, cx + nx * width * 0.5, y, z + nz * width * 0.5);
      uv.push(0, i / segs * 60, 1, i / segs * 60);
      if (i < segs) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setIndex(idx);
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    const mat = new THREE.ShaderMaterial({ vertexShader: waterVert, fragmentShader: waterFrag, uniforms: this.u, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.river = new THREE.Mesh(geo, mat);
    this.river.renderOrder = 5;
    this.group.add(this.river);

    // waterfall at the plateau cliff
    const zTop = LANDMARKS.plateauEdgeZ - 7, zBot = LANDMARKS.plateauEdgeZ + 9;
    const xTop = riverX(zTop), xBot = riverX(zBot);
    const yTop = terrain.heightAt(xTop, zTop) + 1.1, yBot = terrain.heightAt(xBot, zBot) + 0.9;
    this.fallTop.set(xTop, yTop, zTop);
    this.fallBase.set(xBot, yBot, zBot);
    const fallU = { ...this.u, uColor: { value: new THREE.Color(0x7fd8ff) }, uFoam: { value: new THREE.Color(0xffffff) } };
    const fallMat = new THREE.ShaderMaterial({ vertexShader: waterVert, fragmentShader: fallFrag, uniforms: fallU, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    // curved sheet from top to bottom
    const fSegs = 16;
    const fpos: number[] = [], fuv: number[] = [], fidx: number[] = [];
    for (let i = 0; i <= fSegs; i++) {
      const t = i / fSegs;
      const e = t * t;
      const z = zTop + (zBot - zTop) * (0.15 + 0.85 * t);
      const y = yTop + (yBot - yTop) * e + (1 - t) * 0.4;
      const cx = riverX(z);
      const w = 7.5 + t * 1.5;
      fpos.push(cx - w / 2, y, z + (1 - t) * 0.6, cx + w / 2, y, z + (1 - t) * 0.6);
      fuv.push(0, t, 1, t);
      if (i < fSegs) { const a = i * 2; fidx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const fgeo = new THREE.BufferGeometry();
    fgeo.setIndex(fidx);
    fgeo.setAttribute('position', new THREE.Float32BufferAttribute(fpos, 3));
    fgeo.setAttribute('uv', new THREE.Float32BufferAttribute(fuv, 2));
    fgeo.computeVertexNormals();
    const fall = new THREE.Mesh(fgeo, fallMat);
    fall.renderOrder = 6;
    this.falls.push(fall);
    this.group.add(fall);
    // foam pool at base
    const pool = new THREE.Mesh(new THREE.CircleGeometry(6, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }));
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(xBot, yBot + 0.12, zBot + 2);
    pool.renderOrder = 6;
    this.group.add(pool);
    for (let i = 0; i < 6; i++) this.mistPoints.push(new THREE.Vector3(xBot - 3 + i * 1.2, yBot + 0.3, zBot + 1));
  }

  update(dt: number, fog: THREE.Fog, particles: Particles, camPos: THREE.Vector3) {
    this.u.uFogNear.value = fog.near;
    this.u.uFogFar.value = fog.far;
    // mist at waterfall base when near
    if (camPos.distanceTo(this.fallBase) < 90) {
      this.mistTimer -= dt;
      if (this.mistTimer <= 0) {
        this.mistTimer = 0.08;
        const p = this.mistPoints[Math.floor(Math.random() * this.mistPoints.length)];
        particles.emit({ pos: p, count: 2, spread: 1.2, velUp: 2.5, velSpread: 1.2, life: 1.6, lifeVar: 0.4, size: 1.2, sizeVar: 0.4, sizeEnd: 2.5, color: [0xffffff, 0xd8f4ff], alpha: 0.35, gravity: -0.2, drag: 1.2, shape: Shape.SMOKE, additive: false, rotSpeed: 1 });
        particles.emit({ pos: this.fallTop, count: 1, spread: 3, velUp: 1.5, velSpread: 0.8, life: 1.2, size: 0.15, color: [0xffffff], shape: Shape.GLOW, gravity: 6 });
      }
    }
  }
}
