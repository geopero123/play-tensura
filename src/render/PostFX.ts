import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const animeFrag = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uTime;
uniform float uVignette;
uniform float uRadial;
uniform vec2 uRadialCenter;
uniform float uChroma;
uniform float uSpeedLines;
uniform float uFlash;
uniform vec3 uFlashColor;
uniform float uImpact;
uniform float uFade;
uniform float uSaturation;
uniform float uContrast;
uniform vec3 uTint;
uniform float uDesat;
uniform float uAspect;
uniform float uHurt;
varying vec2 vUv;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(float x){ float i = floor(x); float f = fract(x); return mix(hash(vec2(i,0.)), hash(vec2(i+1.,0.)), f*f*(3.-2.*f)); }

vec3 sampleScene(vec2 uv) {
  if (uRadial > 0.001) {
    vec2 dir = uv - uRadialCenter;
    vec3 acc = vec3(0.0);
    const int N = 8;
    for (int i = 0; i < N; i++) {
      float t = float(i) / float(N - 1);
      acc += texture2D(tDiffuse, uv - dir * t * uRadial).rgb;
    }
    return acc / float(N);
  }
  return texture2D(tDiffuse, uv).rgb;
}

void main() {
  vec2 uv = vUv;
  vec2 c = uv - 0.5;
  float r2 = dot(c * vec2(uAspect, 1.0), c * vec2(uAspect, 1.0));
  vec3 col;
  if (uChroma > 0.0005) {
    vec2 off = c * uChroma * (0.3 + r2 * 2.0);
    col.r = sampleScene(uv + off).r;
    col.g = sampleScene(uv).g;
    col.b = sampleScene(uv - off).b;
  } else {
    col = sampleScene(uv);
  }

  // filmic-ish tonemap tuned for anime: keep midtones bright, roll highlights softly
  col = max(col, 0.0);
  col = col / (col + 0.72) * 1.52;
  // contrast around 0.5
  col = (col - 0.5) * uContrast + 0.5;
  // saturation
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(lum), col, uSaturation);
  col *= uTint;
  // desaturate (death / flashback)
  col = mix(col, vec3(lum) * 0.9, uDesat);

  // speed lines: radial streaks from center, animated
  if (uSpeedLines > 0.001) {
    float ang = atan(c.y, c.x * uAspect);
    float dist = length(c * vec2(uAspect, 1.0));
    float n = noise(ang * 40.0 + floor(uTime * 24.0) * 3.0);
    float n2 = noise(ang * 90.0 - floor(uTime * 24.0) * 5.0 + 50.0);
    float lines = smoothstep(0.72, 0.9, n) * 0.7 + smoothstep(0.8, 0.95, n2) * 0.5;
    float mask = smoothstep(0.22, 0.62, dist);
    col = mix(col, vec3(1.0), lines * mask * uSpeedLines * 0.9);
  }

  // impact frame: high-contrast stylized two-tone
  if (uImpact > 0.001) {
    float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
    vec3 ink = vec3(0.05, 0.02, 0.1);
    vec3 paper = vec3(1.0, 0.97, 0.9);
    vec3 two = mix(ink, paper, step(0.42, l));
    col = mix(col, two, uImpact);
  }

  // hurt vignette (red pulse)
  if (uHurt > 0.001) {
    col = mix(col, vec3(0.8, 0.05, 0.08), smoothstep(0.15, 0.7, r2) * uHurt * 0.7);
  }

  // vignette
  float vig = 1.0 - smoothstep(0.35, 1.25, r2) * uVignette;
  col *= vig;

  // flash
  col = mix(col, uFlashColor, clamp(uFlash, 0.0, 1.0));
  // fade to black
  col *= (1.0 - uFade);
  gl_FragColor = vec4(col, 1.0);
}`;

export class PostFX {
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  anime: ShaderPass;
  u: Record<string, THREE.IUniform>;
  // transient effect state
  radialTarget = 0;
  chromaTarget = 0;
  speedLinesTarget = 0;
  enabled = true;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, w: number, h: number) {
    const target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.42, 0.55, 0.82);
    this.composer.addPass(this.bloom);
    this.u = {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uVignette: { value: 0.35 },
      uRadial: { value: 0 },
      uRadialCenter: { value: new THREE.Vector2(0.5, 0.5) },
      uChroma: { value: 0 },
      uSpeedLines: { value: 0 },
      uFlash: { value: 0 },
      uFlashColor: { value: new THREE.Color(1, 1, 1) },
      uImpact: { value: 0 },
      uFade: { value: 1 },
      uSaturation: { value: 1.18 },
      uContrast: { value: 1.06 },
      uTint: { value: new THREE.Color(1, 1, 1) },
      uDesat: { value: 0 },
      uAspect: { value: w / h },
      uHurt: { value: 0 },
    };
    this.anime = new ShaderPass(
      new THREE.ShaderMaterial({
        uniforms: this.u,
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: animeFrag,
      })
    );
    this.composer.addPass(this.anime);
    this.composer.addPass(new OutputPass());
  }

  setSize(w: number, h: number) {
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.u.uAspect.value = w / h;
  }

  flash(amount = 1, color: THREE.ColorRepresentation = 0xffffff) {
    this.u.uFlash.value = Math.max(this.u.uFlash.value, amount);
    this.u.uFlashColor.value.set(color);
  }
  impactFrame(amount = 1) {
    this.u.uImpact.value = Math.max(this.u.uImpact.value, amount);
  }
  hurt(amount = 1) {
    this.u.uHurt.value = Math.max(this.u.uHurt.value, amount);
  }

  /** 0 = fully visible, 1 = black. Eased every frame. */
  fadeTarget = 0;

  update(time: number, dt: number) {
    const u = this.u;
    u.uTime.value = time;
    u.uFade.value += (this.fadeTarget - u.uFade.value) * (1 - Math.exp(-dt * 2.5));
    u.uFlash.value = Math.max(0, u.uFlash.value - dt * 5.5);
    u.uImpact.value = Math.max(0, u.uImpact.value - dt * 9);
    u.uHurt.value = Math.max(0, u.uHurt.value - dt * 2.2);
    const k = 1 - Math.exp(-dt * 10);
    u.uRadial.value += (this.radialTarget - u.uRadial.value) * k;
    u.uChroma.value += (this.chromaTarget - u.uChroma.value) * k;
    u.uSpeedLines.value += (this.speedLinesTarget - u.uSpeedLines.value) * (1 - Math.exp(-dt * 14));
  }

  render() {
    this.composer.render();
  }
}
