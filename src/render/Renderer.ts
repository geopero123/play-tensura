import * as THREE from 'three';
import { PostFX } from './PostFX';
import { Sky, createMountains } from './Sky';
import { globalUniforms } from './ToonMaterial';
import type { GraphicsPreset } from '../core/Settings';

export class Renderer {
  gl: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  post: PostFX;
  sky: Sky;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  ambient: THREE.AmbientLight;
  fog: THREE.Fog;
  mountains: THREE.Group;
  width = 1;
  height = 1;
  preset!: GraphicsPreset;
  private baseFogFar = 320;
  private baseSunColor = new THREE.Color(0xfff1d6);
  private baseSunIntensity = 1.9;
  private baseHemiIntensity = 0.7;
  private baseFogColor = new THREE.Color(0xbfe0f5);
  private stormFog = new THREE.Color(0x3a3d52);
  private tmpSun = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement, preset: GraphicsPreset) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.NoToneMapping;
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.gl.setClearColor(0xbfe0f5);

    this.camera = new THREE.PerspectiveCamera(58, 1, 0.1, 1600);
    this.camera.position.set(0, 3, 8);

    this.fog = new THREE.Fog(0xbfe0f5, 40, 320);
    this.scene.fog = this.fog;

    this.sky = new Sky();
    this.scene.add(this.sky.mesh);
    this.mountains = createMountains();
    this.scene.add(this.mountains);

    this.sun = new THREE.DirectionalLight(0xfff1d6, this.baseSunIntensity);
    this.sun.position.copy(this.sky.sunDir).multiplyScalar(120);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -55; sc.right = 55; sc.top = 55; sc.bottom = -55;
    sc.near = 10; sc.far = 320;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.05;
    this.sun.shadow.radius = 2;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0x9fd0ff, 0x5a7c3a, this.baseHemiIntensity);
    this.scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0x8090c0, 0.12);
    this.scene.add(this.ambient);

    this.post = new PostFX(this.gl, this.scene, this.camera, 2, 2);
    this.applyPreset(preset);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  applyPreset(p: GraphicsPreset) {
    this.preset = p;
    this.gl.setPixelRatio(p.pixelRatio);
    this.sun.shadow.mapSize.set(p.shadowSize, p.shadowSize);
    if (this.sun.shadow.map) {
      this.sun.shadow.map.dispose();
      (this.sun.shadow as any).map = null;
    }
    this.post.bloom.enabled = p.bloom;
    this.post.anime.enabled = p.postFX;
    this.baseFogFar = p.drawDistance;
    this.fog.far = p.drawDistance;
    this.fog.near = p.drawDistance * 0.16;
    this.camera.far = Math.max(1600, p.drawDistance * 4);
    this.camera.updateProjectionMatrix();
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    if (w < 2 || h < 2) return; // hidden / collapsed viewport: keep the last valid size
    this.width = w; this.height = h;
    this.gl.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const pr = this.gl.getPixelRatio();
    this.post.setSize(Math.floor(w * pr), Math.floor(h * pr));
  }

  /** storm 0..1 darkens the sky, fog, and light. */
  setStorm(s: number) {
    this.sky.storm = s;
    this.fog.color.copy(this.baseFogColor).lerp(this.stormFog, s);
    this.gl.setClearColor(this.fog.color);
    this.sun.intensity = this.baseSunIntensity * (1 - s * 0.55);
    this.sun.color.copy(this.baseSunColor).lerp(new THREE.Color(0xb9c2ff), s);
    this.hemi.intensity = this.baseHemiIntensity * (1 - s * 0.35);
    this.fog.far = this.baseFogFar * (1 - s * 0.45);
    globalUniforms.uStorm.value = s;
  }

  /** Follow shadow camera to a focus point and snap to texel grid to prevent shimmering */
  updateShadowFocus(focus: THREE.Vector3) {
    const s = this.sun;
    const size = 110;
    const texel = size / s.shadow.mapSize.x;
    const fx = Math.round(focus.x / texel) * texel;
    const fz = Math.round(focus.z / texel) * texel;
    s.target.position.set(fx, focus.y, fz);
    s.position.copy(this.sky.sunDir).multiplyScalar(120).add(s.target.position);
    s.target.updateMatrixWorld();
  }

  update(time: number, dt: number) {
    globalUniforms.uTime.value = time;
    // the pane can start at zero size; recover if the window size changed without a resize event
    if ((window.innerWidth !== this.width || window.innerHeight !== this.height) && window.innerWidth > 0) this.resize();
    // sun direction in view space for toon materials
    this.tmpSun.copy(this.sky.sunDir).transformDirection(this.camera.matrixWorldInverse);
    globalUniforms.uSunDirView.value.copy(this.tmpSun);
    this.sky.update(time, this.camera.position, dt);
    this.mountains.position.set(this.camera.position.x * 0.9, 0, this.camera.position.z * 0.9);
    this.post.update(time, dt);
  }

  render() {
    if (window.innerWidth < 2 || window.innerHeight < 2) return; // nothing to draw into
    this.post.render();
  }
}
