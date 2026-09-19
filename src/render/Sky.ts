import * as THREE from 'three';
import { fbm, mulberry } from '../core/Math';

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w * 0.9999; // push to far plane
}`;

const skyFrag = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunColor;
uniform float uStorm;
uniform float uFlash;
uniform float uCloudCover;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0; float a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
  return v;
}

void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  // gradient
  vec3 col = mix(uHorizon, uZenith, pow(clamp(y, 0.0, 1.0), 0.55));
  col = mix(col, uGround, smoothstep(0.0, -0.25, y));
  // storm darkening
  vec3 stormCol = mix(vec3(0.22, 0.24, 0.32), vec3(0.09, 0.1, 0.16), clamp(y, 0.0, 1.0));
  col = mix(col, stormCol, uStorm * 0.85);

  // sun
  float sd = max(dot(d, uSunDir), 0.0);
  float disc = smoothstep(0.9985, 0.999, sd);
  float glow = pow(sd, 24.0) * 0.55 + pow(sd, 3.0) * 0.18;
  col += uSunColor * (disc * 3.0 + glow) * (1.0 - uStorm * 0.85);

  // clouds projected on a plane above
  if (y > 0.02) {
    vec2 uv = d.xz / (y + 0.12);
    float t = uTime * 0.012;
    vec2 p1 = uv * 1.6 + vec2(t * 2.0, t * 0.7);
    float n1 = fbm(p1);
    vec2 p2 = uv * 3.4 + vec2(-t * 1.4, t * 2.2) + 7.0;
    float n2 = fbm(p2);
    float cover = uCloudCover + uStorm * 0.35;
    float c1 = smoothstep(0.52 - cover * 0.2, 0.68 - cover * 0.1, n1);
    float c2 = smoothstep(0.58 - cover * 0.15, 0.72, n2) * 0.7;
    float cl = clamp(c1 + c2, 0.0, 1.0);
    // fade near horizon
    cl *= smoothstep(0.02, 0.2, y);
    // lighting: brighter towards sun
    float lit = 0.6 + 0.4 * sd;
    vec3 cloudCol = mix(vec3(0.72, 0.76, 0.9), vec3(1.0, 0.99, 0.97), lit);
    vec3 cloudShade = vec3(0.62, 0.66, 0.85);
    float thick = smoothstep(0.55, 0.9, n1 + n2 * 0.5);
    vec3 cc = mix(cloudCol, cloudShade, thick * 0.55);
    // storm clouds
    cc = mix(cc, vec3(0.16, 0.16, 0.22) + thick * 0.05, uStorm * 0.9);
    col = mix(col, cc, cl * (0.92 + uStorm * 0.08));
    // lightning flash inside storm clouds
    col += vec3(0.8, 0.85, 1.0) * uFlash * (0.4 + cl * 0.8);
  }
  col += vec3(0.7, 0.75, 1.0) * uFlash * 0.25;
  gl_FragColor = vec4(col, 1.0);
}`;

export class Sky {
  mesh: THREE.Mesh;
  uniforms: Record<string, THREE.IUniform>;
  sunDir = new THREE.Vector3(0.35, 0.55, 0.45).normalize();
  storm = 0;
  flash = 0;

  constructor() {
    this.uniforms = {
      uTime: { value: 0 },
      uSunDir: { value: this.sunDir.clone() },
      uZenith: { value: new THREE.Color(0x2e6fd9) },
      uHorizon: { value: new THREE.Color(0xbfe6ff) },
      uGround: { value: new THREE.Color(0x7aa9c9) },
      uSunColor: { value: new THREE.Color(0xfff2c8) },
      uStorm: { value: 0 },
      uFlash: { value: 0 },
      uCloudCover: { value: 0.35 },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
  }

  update(time: number, cameraPos: THREE.Vector3, dt: number) {
    this.uniforms.uTime.value = time;
    this.uniforms.uSunDir.value.copy(this.sunDir);
    this.uniforms.uStorm.value = this.storm;
    this.flash = Math.max(0, this.flash - dt * 4);
    this.uniforms.uFlash.value = this.flash;
    this.mesh.position.copy(cameraPos);
  }
}

/** Distant painterly mountain ring, drawn as layered silhouettes. */
export function createMountains(seed = 7): THREE.Group {
  const g = new THREE.Group();
  const rnd = mulberry(seed);
  const layers = [
    { r: 360, h: 52, col: 0x7d93c4, n: 16, spread: 62 },
    { r: 470, h: 84, col: 0x93a8d4, n: 14, spread: 84 },
    { r: 600, h: 120, col: 0xaabbe0, n: 12, spread: 116 },
  ];
  for (const L of layers) {
    const mat = new THREE.MeshBasicMaterial({ color: L.col, fog: false });
    for (let i = 0; i < L.n; i++) {
      const a = (i / L.n) * Math.PI * 2 + rnd() * 0.4;
      const w = L.spread * (0.7 + rnd() * 0.8);
      const h = L.h * (0.6 + rnd() * 0.8);
      const geo = new THREE.ConeGeometry(w, h, 7, 4, true);
      const pos = geo.attributes.position as THREE.BufferAttribute;
      for (let v = 0; v < pos.count; v++) {
        const x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
        const k = (y / h + 0.5);
        const nz = fbm(x * 0.03 + i * 3.1, z * 0.03 + 9) - 0.5;
        pos.setX(v, x * (1 + nz * 0.5 * (1 - k)));
        pos.setZ(v, z * (1 + nz * 0.4 * (1 - k)));
        pos.setY(v, y + (fbm(x * 0.08, z * 0.08) - 0.5) * h * 0.25 * (1 - Math.abs(k - 0.5) * 2));
      }
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, mat);
      m.position.set(Math.cos(a) * L.r, h * 0.5 - 12, Math.sin(a) * L.r);
      m.rotation.y = rnd() * Math.PI;
      m.frustumCulled = true;
      g.add(m);
      // snow cap on tall ones
      if (h > L.h * 0.9) {
        const cap = new THREE.Mesh(new THREE.ConeGeometry(w * 0.32, h * 0.32, 7, 1), new THREE.MeshBasicMaterial({ color: 0xeaf2ff, fog: false }));
        cap.position.set(m.position.x, m.position.y + h * 0.34, m.position.z);
        cap.rotation.y = m.rotation.y;
        g.add(cap);
      }
    }
  }
  return g;
}
