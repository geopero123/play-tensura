import * as THREE from 'three';
import { Terrain, Colliders, LANDMARKS } from './Terrain';
import { createToonMaterial, globalUniforms } from '../render/ToonMaterial';
import { mulberry, fbm, smoothstep } from '../core/Math';

// ---------------- GRASS ----------------

const grassVert = /* glsl */ `
attribute vec3 iOffset;
attribute vec3 iParams; // scale, rotation, colorVar
attribute float iBend;
uniform float uTime;
uniform vec3 uPlayerPos;
uniform float uWindStrength;
uniform float uFadeDist;
varying float vH;
varying float vShade;
varying float vColorVar;
varying float vFade;
void main() {
  float s = iParams.x; float rot = iParams.y; vColorVar = iParams.z;
  vH = uv.y;
  vec3 p = position;
  p.xz *= mix(1.0, 0.15, vH); // taper
  float c = cos(rot), sn = sin(rot);
  p = vec3(p.x * c - p.z * sn, p.y, p.x * sn + p.z * c) * s;
  // wind
  float ph = iOffset.x * 0.35 + iOffset.z * 0.27 + uTime * 1.8;
  float gust = (sin(ph) * 0.5 + sin(ph * 2.3 + 1.7) * 0.3 + sin(uTime * 4.0 + iOffset.z * 0.5) * 0.2) * uWindStrength;
  float bend = vH * vH;
  p.x += gust * bend * 0.35 * s;
  p.z += cos(ph * 0.8) * bend * 0.12 * s * uWindStrength;
  // lean away from player
  vec2 toP = iOffset.xz - uPlayerPos.xz;
  float d = length(toP);
  float push = (1.0 - smoothstep(0.4, 1.6, d)) * bend * 0.9;
  p.xz += normalize(toP + 0.001) * push;
  p.y -= push * 0.45 * vH;
  p.x += iBend * bend * 0.2;
  vec3 wp = iOffset + p;
  vShade = 0.6 + 0.4 * vH;
  float camD = distance(cameraPosition, wp);
  vFade = 1.0 - smoothstep(uFadeDist * 0.7, uFadeDist, camD);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const grassFrag = /* glsl */ `
precision highp float;
uniform vec3 uColorA; uniform vec3 uColorB; uniform vec3 uTip;
uniform vec3 uFogColor; uniform float uFogNear; uniform float uFogFar; uniform float uNight;
varying float vH; varying float vShade; varying float vColorVar; varying float vFade;
void main() {
  if (vFade < 0.02) discard;
  vec3 base = mix(uColorA, uColorB, vColorVar);
  vec3 col = mix(base * 0.55, base, smoothstep(0.0, 0.7, vH));
  col = mix(col, uTip, smoothstep(0.75, 1.0, vH) * 0.6);
  // dither fade to avoid transparency sorting
  float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  if (dither > vFade) discard;
  col *= mix(vec3(1.0), vec3(0.08, 0.11, 0.24), uNight);
  float depth = gl_FragCoord.z / gl_FragCoord.w;
  float fogF = smoothstep(uFogNear, uFogFar, depth);
  col = mix(col, uFogColor, fogF);
  gl_FragColor = vec4(col, 1.0);
}`;

export class Grass {
  mesh: THREE.Mesh;
  count: number;
  constructor(terrain: Terrain, count: number, fog: THREE.Fog, colliders: Colliders) {
    this.count = count;
    // blade: 4 segment strip
    const segs = 3;
    const w = 0.09, h = 1.0;
    const positions: number[] = [], uvs: number[] = [], index: number[] = [];
    for (let i = 0; i <= segs; i++) {
      const y = (i / segs) * h;
      positions.push(-w, y, 0, w, y, 0);
      uvs.push(0, i / segs, 1, i / segs);
    }
    for (let i = 0; i < segs; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(index);
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    const offsets = new Float32Array(count * 3);
    const params = new Float32Array(count * 3);
    const bends = new Float32Array(count);
    const rnd = mulberry(1234);
    let n = 0;
    let tries = 0;
    while (n < count && tries < count * 6) {
      tries++;
      const x = (rnd() - 0.5) * 440, z = (rnd() - 0.5) * 440;
      const info = terrain.info(x, z);
      const density = (1 - info.path * 0.95) * (1 - smoothstep(0.2, 0.6, info.water)) * (1 - smoothstep(0.3, 0.55, info.slope)) * (1 - info.forest * 0.35);
      const h = terrain.heightAt(x, z);
      if (h > 42) continue;
      const da = Math.hypot(x - LANDMARKS.arena.x, z - LANDMARKS.arena.z);
      if (da < 30) continue;
      if (rnd() > density) continue;
      if (colliders.blocked(x, z, 0.1)) continue;
      offsets[n * 3] = x; offsets[n * 3 + 1] = h - 0.05; offsets[n * 3 + 2] = z;
      const tall = 0.42 + rnd() * 0.45 + (1 - info.forest) * 0.12;
      params[n * 3] = tall * (info.hidden > 0.3 ? 1.3 : 1);
      params[n * 3 + 1] = rnd() * Math.PI * 2;
      params[n * 3 + 2] = fbm(x * 0.05, z * 0.05, 2) + (rnd() - 0.5) * 0.3 + info.hidden * 0.8;
      bends[n] = (rnd() - 0.5) * 2;
      n++;
    }
    this.count = n;
    geo.setAttribute('iOffset', new THREE.InstancedBufferAttribute(offsets, 3));
    geo.setAttribute('iParams', new THREE.InstancedBufferAttribute(params, 3));
    geo.setAttribute('iBend', new THREE.InstancedBufferAttribute(bends, 1));
    geo.instanceCount = n;
    const mat = new THREE.ShaderMaterial({
      vertexShader: grassVert,
      fragmentShader: grassFrag,
      uniforms: {
        uTime: globalUniforms.uTime,
        uPlayerPos: globalUniforms.uPlayerPos,
        uWindStrength: globalUniforms.uWindStrength,
        uNight: globalUniforms.uNight,
        uFadeDist: { value: 120 },
        uColorA: { value: new THREE.Color(0x3d9a3c) },
        uColorB: { value: new THREE.Color(0x7fce56) },
        uTip: { value: new THREE.Color(0xc4ee95) },
        uFogColor: { value: fog.color },
        uFogNear: { value: fog.near },
        uFogFar: { value: fog.far },
      },
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'grass';
  }
  update(fog: THREE.Fog, drawDistance: number) {
    const u = (this.mesh.material as THREE.ShaderMaterial).uniforms;
    u.uFogNear.value = fog.near; u.uFogFar.value = fog.far; u.uFadeDist.value = Math.min(140, drawDistance * 0.45);
  }
}

// ---------------- TREES ----------------

function blobGeometry(radius: number, detail: number, noiseAmp: number, seed: number, squash = 0.85) {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const rnd = mulberry(seed);
  const off = rnd() * 100;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = fbm(x * 0.9 + off, z * 0.9 + y * 0.7 + off, 3) - 0.5;
    const k = 1 + n * noiseAmp;
    pos.setXYZ(i, x * k, y * k * squash, z * k);
  }
  g.computeVertexNormals();
  return g.toNonIndexed(); // flat-ish faceted look
}

function trunkGeometry(height: number, r0: number, r1: number) {
  const g = new THREE.CylinderGeometry(r1, r0, height, 7, 3);
  g.translate(0, height / 2, 0);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const k = y / height;
    pos.setX(i, pos.getX(i) + Math.sin(k * 2.5) * 0.25 * k);
  }
  g.computeVertexNormals();
  return g;
}

interface TreeType {
  name: string;
  trunk: THREE.BufferGeometry;
  trunkColor: number;
  canopy: THREE.BufferGeometry[]; // blobs (already positioned)
  canopyColors: number[];
  radius: number;
  scale: [number, number];
  wind: number;
}

function buildTreeTypes(): TreeType[] {
  const types: TreeType[] = [];
  // round anime oak: trunk + 4 blobs
  {
    const canopy: THREE.BufferGeometry[] = [];
    const offs = [[0, 4.2, 0, 2.3], [1.4, 3.4, 0.6, 1.6], [-1.3, 3.6, -0.5, 1.5], [0.2, 3.2, 1.4, 1.4], [-0.3, 5.3, -0.9, 1.3]];
    offs.forEach((o, i) => { const b = blobGeometry(o[3], 1, 0.35, 10 + i); b.translate(o[0], o[1], o[2]); canopy.push(b); });
    types.push({ name: 'oak', trunk: trunkGeometry(3.6, 0.42, 0.28), trunkColor: 0x6b4a33, canopy, canopyColors: [0x4fae4a, 0x63c14f, 0x3e9a48], radius: 0.6, scale: [0.85, 1.5], wind: 0.7 });
  }
  // tall pine: stacked cones
  {
    const canopy: THREE.BufferGeometry[] = [];
    const levels = [[0, 3.2, 2.4, 2.6], [0, 5.2, 1.9, 2.4], [0, 7.0, 1.4, 2.2], [0, 8.6, 0.9, 1.9]];
    levels.forEach((l, i) => { const c = new THREE.ConeGeometry(l[2], l[3], 8, 1); c.translate(l[0], l[1], 0); const pos = c.attributes.position as THREE.BufferAttribute; const rnd = mulberry(30 + i); for (let v = 0; v < pos.count; v++) { pos.setX(v, pos.getX(v) * (1 + (rnd() - 0.5) * 0.25)); pos.setZ(v, pos.getZ(v) * (1 + (rnd() - 0.5) * 0.25)); } c.computeVertexNormals(); canopy.push(c.toNonIndexed()); });
    types.push({ name: 'pine', trunk: trunkGeometry(3.5, 0.36, 0.2), trunkColor: 0x5a3f2e, trunkColorEnd: 0, canopy, canopyColors: [0x2f8a6a, 0x3a9c78, 0x27735d], radius: 0.55, scale: [1.0, 1.7], wind: 0.35 } as any);
  }
  // blossom tree (pink) for village / hidden area
  {
    const canopy: THREE.BufferGeometry[] = [];
    const offs = [[0, 3.6, 0, 2.0], [1.5, 3.0, 0.4, 1.4], [-1.4, 3.2, -0.3, 1.3], [0.4, 2.8, -1.4, 1.2], [-0.2, 4.6, 0.6, 1.1]];
    offs.forEach((o, i) => { const b = blobGeometry(o[3], 1, 0.4, 50 + i, 0.8); b.translate(o[0], o[1], o[2]); canopy.push(b); });
    types.push({ name: 'blossom', trunk: trunkGeometry(3.0, 0.36, 0.22), trunkColor: 0x5c3d3a, canopy, canopyColors: [0xf7a8c8, 0xffc1d9, 0xf08fb8], radius: 0.5, scale: [0.9, 1.3], wind: 0.8 });
  }
  // dead storm-twisted tree (no leaves) for arena
  {
    const trunk = trunkGeometry(5.5, 0.5, 0.15);
    const branch1 = new THREE.CylinderGeometry(0.08, 0.2, 2.6, 5); branch1.translate(0, 1.3, 0); branch1.rotateZ(0.9); branch1.translate(0.2, 3.5, 0);
    const branch2 = new THREE.CylinderGeometry(0.06, 0.18, 2.2, 5); branch2.translate(0, 1.1, 0); branch2.rotateZ(-1.1); branch2.rotateY(1.2); branch2.translate(-0.1, 4.2, 0);
    types.push({ name: 'dead', trunk, trunkColor: 0x2e2a3a, canopy: [branch1, branch2], canopyColors: [0x2e2a3a], radius: 0.5, scale: [0.9, 1.4], wind: 0.1 });
  }
  return types;
}

export class Trees {
  group = new THREE.Group();
  constructor(terrain: Terrain, colliders: Colliders, detail = 1) {
    const types = buildTreeTypes();
    const rnd = mulberry(77);
    const placements: { type: number; x: number; z: number; s: number; rot: number; tint: number }[] = [];
    const maxTrees = Math.round(1500 * detail);
    let tries = 0;
    while (placements.length < maxTrees && tries < 40000) {
      tries++;
      const x = (rnd() - 0.5) * 460, z = (rnd() - 0.5) * 460;
      const info = terrain.info(x, z);
      const h = terrain.heightAt(x, z);
      if (h > 40) continue;
      let p = info.forest;
      // special zones
      const dh = Math.hypot(x - LANDMARKS.hidden.x, z - LANDMARKS.hidden.z);
      const dv = Math.hypot(x - LANDMARKS.village.x, z - LANDMARKS.village.z);
      const da = Math.hypot(x - LANDMARKS.arena.x, z - LANDMARKS.arena.z);
      let type = 0;
      if (info.plateau > 0.5) type = rnd() < 0.75 ? 1 : 0; // pines up north
      if (dv < 42 && dv > 24 && rnd() < 0.5 && info.path < 0.2) { p = 0.35; type = 2; }
      if (dh < 16 && dh > 7) { p = 0.6; type = 2; }
      if (da < 62 && da > 34) { p = 0.5; type = 3; }
      if (rnd() > p * 0.9) continue;
      const s = types[type].scale[0] + rnd() * (types[type].scale[1] - types[type].scale[0]);
      if (colliders.blocked(x, z, types[type].radius * s + 1.4)) continue;
      placements.push({ type, x, z, s, rot: rnd() * Math.PI * 2, tint: rnd() });
      colliders.add({ x, z, r: types[type].radius * s + 0.15, tag: 'tree' });
    }
    // build instanced meshes per type / part
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    types.forEach((t, ti) => {
      const list = placements.filter((p) => p.type === ti);
      if (!list.length) return;
      const trunkMat = createToonMaterial({ color: t.trunkColor, rimStrength: 0.25, specular: 0.05 });
      const trunk = new THREE.InstancedMesh(t.trunk, trunkMat, list.length);
      trunk.castShadow = true; trunk.receiveShadow = true;
      list.forEach((p, i) => {
        dummy.position.set(p.x, terrain.heightAt(p.x, p.z) - 0.3, p.z);
        dummy.rotation.set(0, p.rot, 0);
        dummy.scale.setScalar(p.s);
        dummy.updateMatrix();
        trunk.setMatrixAt(i, dummy.matrix);
      });
      trunk.computeBoundingSphere();
      this.group.add(trunk);
      t.canopy.forEach((cg, ci) => {
        const mat = createToonMaterial({ color: 0xffffff, wind: t.wind, windScale: 0.22, rimStrength: 0.45, rimColor: 0xd8ffd0, specular: 0.1, shadowTint: 0x4a5aa8 });
        const im = new THREE.InstancedMesh(cg, mat, list.length);
        im.castShadow = true; im.receiveShadow = true;
        list.forEach((p, i) => {
          dummy.position.set(p.x, terrain.heightAt(p.x, p.z) - 0.3, p.z);
          dummy.rotation.set(0, p.rot + ci * 0.7, 0);
          dummy.scale.setScalar(p.s);
          dummy.updateMatrix();
          im.setMatrixAt(i, dummy.matrix);
          color.set(t.canopyColors[(ci + Math.floor(p.tint * 3)) % t.canopyColors.length]);
          color.offsetHSL((p.tint - 0.5) * 0.04, 0, (p.tint - 0.5) * 0.08);
          im.setColorAt(i, color);
        });
        im.computeBoundingSphere();
        this.group.add(im);
      });
    });
  }
}

// ---------------- SMALL FLORA: flowers, glowing plants, mushrooms, bushes ----------------

export class Flora {
  group = new THREE.Group();
  glowMats: THREE.MeshBasicMaterial[] = [];
  constructor(terrain: Terrain, colliders: Colliders, detail = 1) {
    const rnd = mulberry(4242);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    // flowers: small crossed quads
    const flowerGeo = new THREE.ConeGeometry(0.16, 0.12, 5, 1, true); flowerGeo.rotateX(Math.PI); flowerGeo.translate(0, 0.35, 0);
    const stemGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.35, 4); stemGeo.translate(0, 0.17, 0);
    const nF = Math.round(2200 * detail);
    const flowerMat = createToonMaterial({ color: 0xffffff, wind: 0.6, windScale: 1.5, rimStrength: 0.3, specular: 0 });
    const flowers = new THREE.InstancedMesh(flowerGeo, flowerMat, nF);
    const stems = new THREE.InstancedMesh(stemGeo, createToonMaterial({ color: 0x4aa044, wind: 0.6, windScale: 1.5 }), nF);
    const palette = [0xff6fa3, 0xffd166, 0xffffff, 0x9fd0ff, 0xff9f6b, 0xc39bff];
    let fi = 0, tries = 0;
    while (fi < nF && tries < nF * 8) {
      tries++;
      const x = (rnd() - 0.5) * 420, z = (rnd() - 0.5) * 420;
      const info = terrain.info(x, z);
      if (info.path > 0.2 || info.water > 0.2 || info.slope > 0.35 || info.forest > 0.6) continue;
      const h = terrain.heightAt(x, z);
      if (h > 40) continue;
      const cluster = fbm(x * 0.06 + 9, z * 0.06 + 2, 2);
      if (cluster < 0.55 && rnd() > 0.15) continue;
      dummy.position.set(x, h - 0.02, z); dummy.rotation.set(0, rnd() * 6.28, 0); dummy.scale.setScalar(0.8 + rnd() * 0.6); dummy.updateMatrix();
      flowers.setMatrixAt(fi, dummy.matrix); stems.setMatrixAt(fi, dummy.matrix);
      color.set(palette[Math.floor(cluster * 100 + rnd() * 1.5) % palette.length]);
      flowers.setColorAt(fi, color);
      fi++;
    }
    flowers.count = fi; stems.count = fi;
    this.group.add(flowers, stems);

    // bushes: blobs
    const bushGeo = blobGeometry(0.9, 1, 0.45, 99, 0.7);
    const nB = Math.round(700 * detail);
    const bushes = new THREE.InstancedMesh(bushGeo, createToonMaterial({ color: 0xffffff, wind: 0.5, windScale: 0.6, rimStrength: 0.4, rimColor: 0xd0ffc0 }), nB);
    bushes.castShadow = true; bushes.receiveShadow = true;
    let bi = 0; tries = 0;
    while (bi < nB && tries < nB * 10) {
      tries++;
      const x = (rnd() - 0.5) * 440, z = (rnd() - 0.5) * 440;
      const info = terrain.info(x, z);
      if (info.path > 0.15 || info.water > 0.1 || info.slope > 0.4) continue;
      const h = terrain.heightAt(x, z);
      if (h > 38 || (info.forest < 0.25 && rnd() > 0.2)) continue;
      const da = Math.hypot(x - LANDMARKS.arena.x, z - LANDMARKS.arena.z);
      if (da < 42) continue;
      const s = 0.7 + rnd() * 0.9;
      if (colliders.blocked(x, z, s + 0.8)) continue;
      dummy.position.set(x, h + 0.2 * s, z); dummy.rotation.set(0, rnd() * 6.28, 0); dummy.scale.set(s, s * 0.8, s); dummy.updateMatrix();
      bushes.setMatrixAt(bi, dummy.matrix);
      color.setHSL(0.3 + rnd() * 0.06, 0.55, 0.38 + rnd() * 0.1);
      bushes.setColorAt(bi, color);
      colliders.add({ x, z, r: s * 0.7, h: h + s, tag: 'bush' });
      bi++;
    }
    bushes.count = bi;
    this.group.add(bushes);

    // glowing mushrooms & spirit plants (forest, cave, hidden)
    const capGeo = new THREE.SphereGeometry(0.22, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2); capGeo.translate(0, 0.3, 0);
    const stalkGeo = new THREE.CylinderGeometry(0.05, 0.07, 0.3, 6); stalkGeo.translate(0, 0.15, 0);
    const nM = Math.round(500 * detail);
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.glowMats.push(glowMat);
    const caps = new THREE.InstancedMesh(capGeo, glowMat, nM);
    const stalks = new THREE.InstancedMesh(stalkGeo, createToonMaterial({ color: 0xe8e0d0 }), nM);
    let mi = 0; tries = 0;
    const glowPalette = [0x6ff7ff, 0x9d7bff, 0x7fff9f, 0xff8ad8];
    while (mi < nM && tries < nM * 12) {
      tries++;
      const x = (rnd() - 0.5) * 440, z = (rnd() - 0.5) * 440;
      const info = terrain.info(x, z);
      const h = terrain.heightAt(x, z);
      const dc = Math.hypot(x - LANDMARKS.caveEnd.x, z - LANDMARKS.caveEnd.z);
      const inCave = dc < 12 || (Math.abs(x - LANDMARKS.cave.x) < 5 && z < LANDMARKS.cave.z && z > LANDMARKS.caveEnd.z);
      const ok = info.forest > 0.5 && rnd() < 0.5 || info.hidden > 0.3 || inCave;
      if (!ok || info.path > 0.3 || info.water > 0.2 || h > 40) continue;
      const s = 0.6 + rnd() * 1.2;
      dummy.position.set(x, h, z); dummy.rotation.set(0, rnd() * 6.28, 0); dummy.scale.setScalar(s); dummy.updateMatrix();
      caps.setMatrixAt(mi, dummy.matrix); stalks.setMatrixAt(mi, dummy.matrix);
      color.set(glowPalette[Math.floor(rnd() * glowPalette.length)]).multiplyScalar(1.6);
      caps.setColorAt(mi, color);
      mi++;
    }
    caps.count = mi; stalks.count = mi;
    this.group.add(caps, stalks);

    // tall spirit reeds near water & hidden area (glowing tips)
    const reedGeo = new THREE.CylinderGeometry(0.02, 0.05, 1.6, 5); reedGeo.translate(0, 0.8, 0);
    const tipGeo = new THREE.SphereGeometry(0.09, 8, 6); tipGeo.translate(0, 1.6, 0);
    const nR = Math.round(600 * detail);
    const reeds = new THREE.InstancedMesh(reedGeo, createToonMaterial({ color: 0x5fbf8a, wind: 0.9, windScale: 0.8 }), nR);
    const tipMat = new THREE.MeshBasicMaterial({ color: 0xbfffff, toneMapped: false });
    const tips = new THREE.InstancedMesh(tipGeo, tipMat, nR);
    let ri = 0; tries = 0;
    while (ri < nR && tries < nR * 12) {
      tries++;
      const x = (rnd() - 0.5) * 440, z = (rnd() - 0.5) * 440;
      const info = terrain.info(x, z);
      const nearWater = info.water > 0.05 && info.water < 0.55;
      if (!(nearWater || info.hidden > 0.2)) continue;
      const h = terrain.heightAt(x, z);
      if (h > 40) continue;
      const s = 0.7 + rnd() * 0.7;
      dummy.position.set(x, h, z); dummy.rotation.set(0, rnd() * 6.28, 0); dummy.scale.setScalar(s); dummy.updateMatrix();
      reeds.setMatrixAt(ri, dummy.matrix); tips.setMatrixAt(ri, dummy.matrix);
      color.set(info.hidden > 0.2 ? 0xa0f0ff : 0xd8fff0).multiplyScalar(1.4);
      tips.setColorAt(ri, color);
      ri++;
    }
    reeds.count = ri; tips.count = ri;
    this.group.add(reeds, tips);
  }
}
