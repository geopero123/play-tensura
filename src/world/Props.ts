import * as THREE from 'three';
import { Terrain, Colliders, LANDMARKS, riverX } from './Terrain';
import { createToonMaterial, addOutline } from '../render/ToonMaterial';
import { mulberry, fbm, rand } from '../core/Math';

/** Interactable world objects (spring, crystal, campfire, signs). */
export interface Interactable {
  id: string;
  pos: THREE.Vector3;
  radius: number;
  label: string;
  obj?: THREE.Object3D;
  used?: boolean;
  onUse?: () => void;
}

function rockGeo(seed: number, r = 1, detail = 1) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const rnd = mulberry(seed);
  const o = rnd() * 50;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = fbm(x * 1.3 + o, z * 1.3 + y + o, 2) - 0.5;
    const k = 1 + n * 0.7;
    pos.setXYZ(i, x * k * 1.2, Math.max(y * k * 0.75, -r * 0.3), z * k);
  }
  g.computeVertexNormals();
  return g.toNonIndexed();
}

export class Props {
  group = new THREE.Group();
  interactables: Interactable[] = [];
  lights: THREE.PointLight[] = [];
  campfires: THREE.Vector3[] = [];
  crystalMeshes: THREE.Mesh[] = [];
  chimneys: THREE.Vector3[] = [];
  private t = 0;
  starShard!: THREE.Group;
  springObj!: THREE.Group;

  constructor(private terrain: Terrain, private colliders: Colliders) {
    this.buildRocks();
    this.buildVillage();
    this.buildTraining();
    this.buildRuins();
    this.buildCave();
    this.buildSpring();
    this.buildHiddenPool();
    this.buildArena();
    this.buildBridge();
    this.buildCliffRocks();
  }

  private h(x: number, z: number) { return this.terrain.heightAt(x, z); }

  private buildRocks() {
    const rnd = mulberry(555);
    const geos = [rockGeo(1, 1, 1), rockGeo(2, 1, 1), rockGeo(3, 1, 0), rockGeo(4, 1, 1)];
    const mat = createToonMaterial({ color: 0xffffff, rimStrength: 0.4, rimColor: 0xcfe0ff, specular: 0.15, shadowTint: 0x505a90 });
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const per = 90;
    geos.forEach((g, gi) => {
      const im = new THREE.InstancedMesh(g, mat, per);
      im.castShadow = true; im.receiveShadow = true;
      let n = 0, tries = 0;
      while (n < per && tries < 3000) {
        tries++;
        const x = (rnd() - 0.5) * 440, z = (rnd() - 0.5) * 440;
        const info = this.terrain.info(x, z);
        const h = this.h(x, z);
        if (h > 40 || info.path > 0.2 || info.water > 0.3 || info.village > 0.3) continue;
        if (Math.hypot(x, z) < 20) continue;
        const s = 0.5 + rnd() * (info.slope > 0.3 ? 2.6 : 1.4);
        if (this.colliders.blocked(x, z, s + 0.5)) continue;
        dummy.position.set(x, h - s * 0.25, z);
        dummy.rotation.set(0, rnd() * 6.28, 0);
        dummy.scale.set(s, s * (0.7 + rnd() * 0.5), s);
        dummy.updateMatrix();
        im.setMatrixAt(n, dummy.matrix);
        color.setHSL(0.62, 0.12 + rnd() * 0.1, 0.5 + rnd() * 0.2);
        if (info.plateau > 0.5) color.setHSL(0.65, 0.18, 0.42 + rnd() * 0.15);
        im.setColorAt(n, color);
        this.colliders.add({ x, z, r: s * 0.95, h: h + s, tag: 'rock' });
        n++;
      }
      im.count = n;
      this.group.add(im);
    });
  }

  private house(x: number, z: number, rot: number, w: number, d: number, hgt: number, roofColor: number, wallColor = 0xf3e6cf) {
    const g = new THREE.Group();
    const y = this.h(x, z);
    const wall = createToonMaterial({ color: wallColor, rimStrength: 0.2 });
    const wood = createToonMaterial({ color: 0x6a4a35, rimStrength: 0.2 });
    const roof = createToonMaterial({ color: roofColor, rimStrength: 0.35, rimColor: 0xffe0c0 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, d), wall);
    base.position.y = hgt / 2;
    base.castShadow = true; base.receiveShadow = true;
    addOutline(base, 0.025);
    g.add(base);
    // timber beams
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.22, hgt, 0.22), wood);
      beam.position.set(sx * w * 0.5, hgt / 2, sz * d * 0.5);
      g.add(beam);
    }
    const midBeam = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.2, d + 0.1), wood);
    midBeam.position.y = hgt * 0.55;
    g.add(midBeam);
    // roof: prism
    const roofG = new THREE.CylinderGeometry(0, 1, 1, 4, 1);
    const rmesh = new THREE.Mesh(roofG, roof);
    rmesh.rotation.y = Math.PI / 4;
    rmesh.scale.set(w * 0.85, hgt * 0.7, d * 0.85);
    rmesh.position.y = hgt + hgt * 0.35;
    rmesh.castShadow = true;
    addOutline(rmesh, 0.03);
    g.add(rmesh);
    // door
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.6, 0.12), wood);
    door.position.set(0, 0.8, d / 2 + 0.02);
    g.add(door);
    // windows glowing
    const winMat = new THREE.MeshBasicMaterial({ color: 0xffd489, toneMapped: false });
    for (const sx of [-1, 1]) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.08), winMat);
      win.position.set(sx * w * 0.3, hgt * 0.6, d / 2 + 0.02);
      g.add(win);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.72, 0.06), wood);
      frame.position.set(sx * w * 0.3, hgt * 0.6, d / 2 + 0.01);
      g.add(frame);
    }
    // chimney
    const chim = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.2, 0.5), createToonMaterial({ color: 0x8a8a95 }));
    chim.position.set(w * 0.28, hgt + hgt * 0.55, -d * 0.2);
    g.add(chim);
    g.position.set(x, y - 0.1, z);
    g.rotation.y = rot;
    this.group.add(g);
    const cw = Math.max(w, d) * 0.62;
    this.colliders.add({ x, z, r: cw, h: y + hgt + 2, tag: 'house' });
    const cp = new THREE.Vector3(w * 0.28, hgt + hgt * 0.55 + 0.6, -d * 0.2).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot).add(g.position);
    this.chimneys.push(cp);
  }

  private buildVillage() {
    const v = LANDMARKS.village;
    const houses = [
      [v.x - 14, v.z - 12, 0.4, 5, 4.5, 3, 0xc9553f],
      [v.x + 12, v.z - 10, -0.5, 4.5, 4, 2.8, 0x4a78b8],
      [v.x - 16, v.z + 10, 1.2, 4, 4, 2.6, 0x7a9b4a],
      [v.x + 15, v.z + 9, -1.0, 5.5, 4.5, 3.2, 0xc9553f],
      [v.x - 2, v.z + 20, 0.1, 6, 5, 3.6, 0x9a5fc0],
      [v.x + 3, v.z - 22, 3.1, 4.5, 4, 2.8, 0x4a78b8],
    ];
    for (const h of houses) this.house(h[0], h[1], h[2], h[3], h[4], h[5], h[6]);
    // well in the center
    const wellY = this.h(v.x, v.z);
    const well = new THREE.Group();
    const stone = createToonMaterial({ color: 0x9a9aa8, rimStrength: 0.3 });
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.2, 0.9, 12, 1, true), stone);
    ring.position.y = 0.45; ring.castShadow = true;
    well.add(ring);
    const water = new THREE.Mesh(new THREE.CircleGeometry(1.0, 16), new THREE.MeshBasicMaterial({ color: 0x4fb8e8 }));
    water.rotation.x = -Math.PI / 2; water.position.y = 0.5; well.add(water);
    const wood = createToonMaterial({ color: 0x6a4a35 });
    for (const sx of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.4, 0.16), wood); post.position.set(sx * 1.0, 1.2, 0); well.add(post); }
    const roofW = new THREE.Mesh(new THREE.ConeGeometry(1.7, 0.9, 4), createToonMaterial({ color: 0x8a4a3a })); roofW.position.y = 2.75; roofW.rotation.y = Math.PI / 4; well.add(roofW);
    well.position.set(v.x, wellY, v.z);
    this.group.add(well);
    this.colliders.add({ x: v.x, z: v.z, r: 1.4, tag: 'well' });
    // campfire near the well
    this.campfire(v.x + 6, v.z + 3);
    // lanterns on posts
    const lanternPos = [[v.x - 8, v.z - 4], [v.x + 8, v.z - 5], [v.x - 7, v.z + 8], [v.x + 8, v.z + 7], [v.x - 24, v.z + 2], [v.x + 24, v.z - 2]];
    for (const [lx, lz] of lanternPos) this.lantern(lx, lz);
    // fences
    const fenceMat = createToonMaterial({ color: 0x8a6a4a });
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      if (a > 0.6 && a < 1.3) continue; // gaps
      if (a > 3.4 && a < 4.1) continue;
      const fx = v.x + Math.cos(a) * 30, fz = v.z + Math.sin(a) * 30;
      const f = new THREE.Mesh(new THREE.BoxGeometry(6, 0.12, 0.12), fenceMat);
      f.position.set(fx, this.h(fx, fz) + 0.9, fz);
      f.rotation.y = -a + Math.PI / 2;
      this.group.add(f);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.2, 0.2), fenceMat);
      post.position.set(fx, this.h(fx, fz) + 0.6, fz);
      this.group.add(post);
    }
    // market stall
    const stall = new THREE.Group();
    const table = new THREE.Mesh(new THREE.BoxGeometry(3, 0.15, 1.2), wood); table.position.y = 0.9; stall.add(table);
    for (const sx of [-1, 1]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.4, 0.15), wood); leg.position.set(sx * 1.4, 1.2, -0.5); stall.add(leg); }
    const awning = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.1, 1.8), createToonMaterial({ color: 0xe25f5f })); awning.position.set(0, 2.4, 0); awning.rotation.x = 0.25; stall.add(awning);
    for (let i = 0; i < 5; i++) { const fruit = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), createToonMaterial({ color: [0xff6b6b, 0xffc93c, 0x8bd35b][i % 3] })); fruit.position.set(-1 + i * 0.5, 1.15, 0.1); stall.add(fruit); }
    stall.position.set(v.x - 6, this.h(v.x - 6, v.z - 6), v.z - 6);
    stall.rotation.y = 0.4;
    this.group.add(stall);
    this.colliders.add({ x: v.x - 6, z: v.z - 6, r: 1.6, tag: 'stall' });
    // signpost at village entrance
    this.signpost(v.x + 24, v.z - 16, 'Hollow Pine Village');
  }

  private campfire(x: number, z: number) {
    const y = this.h(x, z);
    const g = new THREE.Group();
    const stone = createToonMaterial({ color: 0x7a7a88 });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const s = new THREE.Mesh(rockGeo(100 + i, 0.3, 0), stone);
      s.position.set(Math.cos(a) * 1.0, 0.1, Math.sin(a) * 1.0);
      g.add(s);
    }
    const wood = createToonMaterial({ color: 0x4a3222 });
    for (let i = 0; i < 3; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.4, 6), wood);
      log.rotation.z = Math.PI / 2; log.rotation.y = (i / 3) * Math.PI;
      log.position.y = 0.15;
      g.add(log);
    }
    const light = new THREE.PointLight(0xff9a3c, 6, 14, 1.6);
    light.position.y = 0.8;
    g.add(light);
    this.lights.push(light);
    g.position.set(x, y, z);
    this.group.add(g);
    this.campfires.push(new THREE.Vector3(x, y + 0.2, z));
    this.colliders.add({ x, z, r: 1.1, tag: 'campfire' });
  }

  private lantern(x: number, z: number) {
    const y = this.h(x, z);
    const g = new THREE.Group();
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 2.6, 6), createToonMaterial({ color: 0x4a3a32 }));
    post.position.y = 1.3; g.add(post);
    const cage = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.4), createToonMaterial({ color: 0x3a3a44 }));
    cage.position.y = 2.7; g.add(cage);
    const glow = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.36, 0.28), new THREE.MeshBasicMaterial({ color: 0xffd080, toneMapped: false }));
    glow.position.y = 2.7; g.add(glow);
    const light = new THREE.PointLight(0xffb060, 3, 9, 1.8);
    light.position.y = 2.7; g.add(light);
    this.lights.push(light);
    g.position.set(x, y, z);
    this.group.add(g);
    this.colliders.add({ x, z, r: 0.25, tag: 'lantern' });
  }

  private signpost(x: number, z: number, text: string) {
    const y = this.h(x, z);
    const g = new THREE.Group();
    const wood = createToonMaterial({ color: 0x7a5a3a });
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.2, 0.18), wood); post.position.y = 1.1; g.add(post);
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.45, 0.08), createToonMaterial({ color: 0xc8a36a })); board.position.y = 1.9; g.add(board);
    g.position.set(x, y, z);
    this.group.add(g);
    this.interactables.push({ id: 'sign-' + text, pos: new THREE.Vector3(x, y, z), radius: 2.2, label: text, obj: g });
  }

  private buildTraining() {
    const t = LANDMARKS.training;
    // wooden ring + targets area; dummies are enemies spawned by the game
    const wood = createToonMaterial({ color: 0x8a6a4a });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      if (a > 2.2 && a < 3.0) continue;
      const fx = t.x + Math.cos(a) * 18, fz = t.z + Math.sin(a) * 18;
      const f = new THREE.Mesh(new THREE.BoxGeometry(6, 0.12, 0.12), wood);
      f.position.set(fx, this.h(fx, fz) + 0.9, fz);
      f.rotation.y = -a + Math.PI / 2;
      this.group.add(f);
    }
    // archery target boards
    for (let i = 0; i < 3; i++) {
      const bx = t.x + 10 + i * 3, bz = t.z - 12;
      const y = this.h(bx, bz);
      const board = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.15, 16), createToonMaterial({ color: 0xf0e0c0 }));
      board.rotation.x = Math.PI / 2; board.position.set(bx, y + 1.2, bz);
      const red = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.17, 16), createToonMaterial({ color: 0xe04040 }));
      red.rotation.x = Math.PI / 2; red.position.set(bx, y + 1.2, bz);
      const stand = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.3, 0.2), wood); stand.position.set(bx, y + 0.6, bz);
      this.group.add(board, red, stand);
      this.colliders.add({ x: bx, z: bz, r: 0.6, tag: 'target' });
    }
    this.signpost(t.x - 20, t.z + 4, 'Training Field');
  }

  private buildRuins() {
    const r = LANDMARKS.ruins;
    const stone = createToonMaterial({ color: 0xb8b8c8, rimStrength: 0.35, shadowTint: 0x4a5aa0 });
    const moss = createToonMaterial({ color: 0x7fb070 });
    // platform
    const base = new THREE.Mesh(new THREE.CylinderGeometry(14, 15, 1.2, 10), stone);
    base.position.set(r.x, this.h(r.x, r.z) + 0.4, r.z); base.receiveShadow = true; base.castShadow = true;
    this.group.add(base);
    const step = new THREE.Mesh(new THREE.CylinderGeometry(16, 17, 0.6, 10), stone);
    step.position.set(r.x, this.h(r.x, r.z) - 0.1, r.z); step.receiveShadow = true;
    this.group.add(step);
    // pillars ring (some broken)
    const rnd = mulberry(999);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const px = r.x + Math.cos(a) * 11, pz = r.z + Math.sin(a) * 11;
      const hgt = rnd() < 0.35 ? 1.5 + rnd() * 2 : 6 + rnd() * 1.5;
      const pil = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.75, hgt, 8), stone);
      pil.position.set(px, this.h(r.x, r.z) + 1 + hgt / 2, pz);
      pil.castShadow = true; pil.receiveShadow = true;
      addOutline(pil, 0.02, 0x3a3050);
      this.group.add(pil);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.4, 1.6), stone);
      cap.position.set(px, this.h(r.x, r.z) + 1 + hgt + 0.2, pz);
      this.group.add(cap);
      if (hgt > 5 && i % 2 === 0) {
        const nx = r.x + Math.cos(a + Math.PI * 0.2) * 11, nz = r.z + Math.sin(a + Math.PI * 0.2) * 11;
        const lintel = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(nx - px, nz - pz) + 1, 0.6, 1.2), stone);
        lintel.position.set((px + nx) / 2, this.h(r.x, r.z) + 1 + hgt + 0.7, (pz + nz) / 2);
        lintel.rotation.y = -Math.atan2(nz - pz, nx - px);
        lintel.castShadow = true;
        this.group.add(lintel);
      }
      this.colliders.add({ x: px, z: pz, r: 0.9, tag: 'pillar' });
      // moss patches
      const mp = new THREE.Mesh(new THREE.SphereGeometry(0.5, 6, 4), moss);
      mp.position.set(px + rnd() - 0.5, this.h(r.x, r.z) + 1.1, pz + rnd() - 0.5); mp.scale.y = 0.3;
      this.group.add(mp);
    }
    // central altar with a floating relic (glow)
    const altar = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.4, 2.4), stone);
    altar.position.set(r.x, this.h(r.x, r.z) + 1.7, r.z); altar.castShadow = true;
    this.group.add(altar);
    this.colliders.add({ x: r.x, z: r.z, r: 1.7, tag: 'altar' });
    const relic = new THREE.Mesh(new THREE.OctahedronGeometry(0.5), new THREE.MeshBasicMaterial({ color: 0xa0ffe0, toneMapped: false }));
    relic.position.set(r.x, this.h(r.x, r.z) + 3.2, r.z);
    relic.name = 'relic';
    this.crystalMeshes.push(relic);
    this.group.add(relic);
    const relicLight = new THREE.PointLight(0x80ffd0, 4, 16, 1.5);
    relicLight.position.copy(relic.position);
    this.group.add(relicLight); this.lights.push(relicLight);
    this.interactables.push({ id: 'relic', pos: relic.position.clone(), radius: 3.2, label: 'Examine the ancient relic', obj: relic });
    // broken rubble
    for (let i = 0; i < 12; i++) {
      const a = rnd() * Math.PI * 2, d = 14 + rnd() * 8;
      const rx = r.x + Math.cos(a) * d, rz = r.z + Math.sin(a) * d;
      const rb = new THREE.Mesh(new THREE.BoxGeometry(0.6 + rnd(), 0.5 + rnd() * 0.6, 0.6 + rnd()), stone);
      rb.position.set(rx, this.h(rx, rz) + 0.25, rz); rb.rotation.set(rnd() * 0.5, rnd() * 3, rnd() * 0.5);
      rb.castShadow = true;
      this.group.add(rb);
    }
    this.signpost(r.x - 20, r.z + 12, 'Ancient Ruins');
  }

  private buildCave() {
    const c = LANDMARKS.cave;
    const rock = createToonMaterial({ color: 0x5a5f78, rimStrength: 0.3, shadowTint: 0x303050 });
    // arches along the corridor forming a ceiling
    const z0 = c.z + 4, z1 = LANDMARKS.caveEnd.z - 2;
    const floorY = this.h(c.x, c.z - 6);
    for (let z = z0; z > z1; z -= 4) {
      const arch = new THREE.Mesh(new THREE.TorusGeometry(6.2, 1.6, 6, 10, Math.PI), rock);
      arch.position.set(c.x, floorY + 0.5, z);
      arch.castShadow = true; arch.receiveShadow = true;
      this.group.add(arch);
    }
    // ceiling slab over corridor
    const ceil = new THREE.Mesh(new THREE.BoxGeometry(16, 3, z0 - z1 + 4), rock);
    ceil.position.set(c.x, floorY + 8.3, (z0 + z1) / 2);
    ceil.receiveShadow = true; ceil.castShadow = true;
    this.group.add(ceil);
    // chamber dome
    const dome = new THREE.Mesh(new THREE.SphereGeometry(13, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), createToonMaterial({ color: 0x4a4f68, side: THREE.BackSide }));
    dome.position.set(LANDMARKS.caveEnd.x, floorY + 0.2, LANDMARKS.caveEnd.z);
    this.group.add(dome);
    // crystals in the chamber
    const rnd = mulberry(31);
    const crystalMat = new THREE.MeshBasicMaterial({ color: 0x8ad4ff, transparent: true, opacity: 0.9, toneMapped: false });
    const crystalMat2 = new THREE.MeshBasicMaterial({ color: 0xc08aff, transparent: true, opacity: 0.9, toneMapped: false });
    for (let i = 0; i < 26; i++) {
      const a = rnd() * Math.PI * 2, d = 4 + rnd() * 7;
      const cx = LANDMARKS.caveEnd.x + Math.cos(a) * d, cz = LANDMARKS.caveEnd.z + Math.sin(a) * d;
      const h = 0.8 + rnd() * 2.5;
      const cr = new THREE.Mesh(new THREE.ConeGeometry(0.25 + rnd() * 0.3, h, 6), rnd() < 0.6 ? crystalMat : crystalMat2);
      cr.position.set(cx, this.h(cx, cz) + h / 2 - 0.2, cz);
      cr.rotation.set((rnd() - 0.5) * 0.6, rnd() * 3, (rnd() - 0.5) * 0.6);
      this.group.add(cr);
      this.crystalMeshes.push(cr);
      addOutline(cr, 0.02, 0x203060);
    }
    // corridor crystals
    for (let z = c.z - 6; z > LANDMARKS.caveEnd.z + 8; z -= 6) {
      for (const sx of [-1, 1]) {
        const cx = c.x + sx * 4.5;
        const cr = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.6, 6), crystalMat);
        cr.position.set(cx, this.h(cx, z) + 0.6, z); cr.rotation.z = -sx * 0.5;
        this.group.add(cr); this.crystalMeshes.push(cr);
      }
    }
    const light = new THREE.PointLight(0x8ad4ff, 10, 30, 1.4);
    light.position.set(LANDMARKS.caveEnd.x, floorY + 3, LANDMARKS.caveEnd.z);
    this.group.add(light); this.lights.push(light);
    const light2 = new THREE.PointLight(0x8ad4ff, 5, 22, 1.4);
    light2.position.set(c.x, floorY + 3, c.z - 22);
    this.group.add(light2); this.lights.push(light2);
    // heart crystal (interactable)
    const heart = new THREE.Mesh(new THREE.OctahedronGeometry(1.1, 0), new THREE.MeshBasicMaterial({ color: 0xc8f0ff, toneMapped: false }));
    heart.position.set(LANDMARKS.caveEnd.x, floorY + 2.4, LANDMARKS.caveEnd.z);
    heart.name = 'caveHeart';
    this.crystalMeshes.push(heart);
    this.group.add(heart);
    this.interactables.push({ id: 'caveHeart', pos: heart.position.clone(), radius: 3.5, label: 'Absorb the resonating crystal', obj: heart });
    this.signpost(c.x + 8, c.z + 10, 'Whisper Cave');
  }

  private buildSpring() {
    const s = LANDMARKS.spring;
    const y = this.h(s.x, s.z);
    const g = new THREE.Group();
    const stone = createToonMaterial({ color: 0xa8b0c8, rimStrength: 0.4 });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const st = new THREE.Mesh(rockGeo(200 + i, 0.55, 0), stone);
      st.position.set(Math.cos(a) * 3.2, 0.1, Math.sin(a) * 3.2);
      st.castShadow = true;
      g.add(st);
    }
    const water = new THREE.Mesh(new THREE.CircleGeometry(3, 32), new THREE.MeshBasicMaterial({ color: 0x8ff4ff, transparent: true, opacity: 0.85, toneMapped: false }));
    water.rotation.x = -Math.PI / 2; water.position.y = 0.25; g.add(water);
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 12), new THREE.MeshBasicMaterial({ color: 0xc8ffff, toneMapped: false }));
    orb.position.y = 1.6; orb.name = 'springOrb'; g.add(orb); this.crystalMeshes.push(orb);
    const light = new THREE.PointLight(0x7fe8ff, 5, 16, 1.5); light.position.y = 1.8; g.add(light); this.lights.push(light);
    g.position.set(s.x, y, s.z);
    this.group.add(g);
    this.springObj = g;
    this.colliders.add({ x: s.x, z: s.z, r: 3.4, tag: 'spring' });
    this.interactables.push({ id: 'spring', pos: new THREE.Vector3(s.x, y, s.z), radius: 5.2, label: 'Touch the Spirit Spring', obj: g });
  }

  private buildHiddenPool() {
    const hp = LANDMARKS.hidden;
    const y = this.h(hp.x, hp.z);
    const g = new THREE.Group();
    const pool = new THREE.Mesh(new THREE.CircleGeometry(5, 32), new THREE.MeshBasicMaterial({ color: 0x6fe0ff, transparent: true, opacity: 0.75, toneMapped: false }));
    pool.rotation.x = -Math.PI / 2; pool.position.y = 0.2; g.add(pool);
    const crystalMat = new THREE.MeshBasicMaterial({ color: 0x9fe8ff, toneMapped: false });
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const cr = new THREE.Mesh(new THREE.ConeGeometry(0.4, 2.2 + (i % 2), 6), crystalMat);
      cr.position.set(Math.cos(a) * 6, 1, Math.sin(a) * 6); cr.rotation.set(0.2 * Math.sin(a), 0, 0.2 * Math.cos(a));
      g.add(cr); this.crystalMeshes.push(cr); addOutline(cr, 0.02, 0x204070);
      this.colliders.add({ x: hp.x + Math.cos(a) * 6, z: hp.z + Math.sin(a) * 6, r: 0.5, tag: 'crystal' });
    }
    const moon = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.12, 8, 32), crystalMat);
    moon.position.y = 3.2; moon.name = 'moonRing'; g.add(moon); this.crystalMeshes.push(moon);
    const light = new THREE.PointLight(0x8fe8ff, 8, 24, 1.4); light.position.y = 3; g.add(light); this.lights.push(light);
    g.position.set(hp.x, y, hp.z);
    this.group.add(g);
    this.interactables.push({ id: 'moonwell', pos: new THREE.Vector3(hp.x, y, hp.z), radius: 5, label: 'Drink from the Moonwell', obj: g });
  }

  private buildArena() {
    const a = LANDMARKS.arena;
    const y = this.h(a.x, a.z);
    // star shard (magic source) floating in the center
    const shard = new THREE.Group();
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(1.6, 0), new THREE.MeshBasicMaterial({ color: 0xd0c0ff, toneMapped: false }));
    core.name = 'shardCore';
    shard.add(core);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xb08cff, toneMapped: false, transparent: true, opacity: 0.8 });
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.6 + i * 0.7, 0.07, 6, 48), ringMat);
      ring.rotation.set(i * 1.1, i * 0.7, 0);
      ring.name = 'shardRing' + i;
      shard.add(ring);
    }
    shard.position.set(a.x, y + 5, a.z);
    this.group.add(shard);
    this.starShard = shard;
    const light = new THREE.PointLight(0xa080ff, 14, 40, 1.3);
    light.position.copy(shard.position);
    this.group.add(light); this.lights.push(light);
    this.interactables.push({ id: 'starShard', pos: new THREE.Vector3(a.x, y, a.z), radius: 5, label: 'Analyze the Star Shard', obj: shard });
    // standing stones ring
    const stone = createToonMaterial({ color: 0x5a5a72, rimStrength: 0.4, rimColor: 0xb0a0ff, shadowTint: 0x302850 });
    const rnd = mulberry(77);
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2;
      const sx = a.x + Math.cos(ang) * 30, sz = a.z + Math.sin(ang) * 30;
      const h = 3 + rnd() * 3;
      const st = new THREE.Mesh(new THREE.BoxGeometry(1.6, h, 1.0), stone);
      st.position.set(sx, this.h(sx, sz) + h / 2 - 0.3, sz);
      st.rotation.y = ang; st.rotation.z = (rnd() - 0.5) * 0.2;
      st.castShadow = true; st.receiveShadow = true;
      addOutline(st, 0.03, 0x1a1030);
      this.group.add(st);
      this.colliders.add({ x: sx, z: sz, r: 1.1, tag: 'stone' });
      const rune = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.6), new THREE.MeshBasicMaterial({ color: 0x9f7fff, toneMapped: false, transparent: true, opacity: 0.8 }));
      rune.position.set(sx - Math.cos(ang) * 0.55, this.h(sx, sz) + h * 0.5, sz - Math.sin(ang) * 0.55);
      rune.rotation.y = -ang - Math.PI / 2;
      rune.name = 'arenaRune';
      this.crystalMeshes.push(rune);
      this.group.add(rune);
    }
    this.signpost(LANDMARKS.wolfWoods.x - 6, LANDMARKS.wolfWoods.z + 14, 'Wolf Territory - Danger');
  }

  private buildBridge() {
    // plank bridge across the river on the glade->ruins path
    const z = -24;
    const cx = riverX(z);
    const wood = createToonMaterial({ color: 0x8a5f3a, rimStrength: 0.3 });
    const y = this.h(cx - 8, z) + 0.6;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(18, 0.25, 3.2), wood);
    deck.position.set(cx, y, z); deck.rotation.y = -Math.atan2(riverX(z + 1) - cx, 1);
    deck.castShadow = true; deck.receiveShadow = true;
    this.group.add(deck);
    for (const sz of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(18, 0.1, 0.1), wood);
      rail.position.set(0, 1.0, sz * 1.5); deck.add(rail);
      for (let i = -3; i <= 3; i++) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.1, 0.15), wood); post.position.set(i * 2.6, 0.55, sz * 1.5); deck.add(post); }
    }
    this.bridge = { x: cx, z, y, halfLen: 9, halfW: 1.6, rot: deck.rotation.y };
  }
  bridge!: { x: number; z: number; y: number; halfLen: number; halfW: number; rot: number };

  private buildCliffRocks() {
    // large rocks along the plateau cliff and waterfall sides for a painterly cliff look
    const rnd = mulberry(808);
    const mat = createToonMaterial({ color: 0x8890a8, rimStrength: 0.4, rimColor: 0xd0e0ff, shadowTint: 0x404870 });
    const geo = rockGeo(9, 1, 1);
    const im = new THREE.InstancedMesh(geo, mat, 140);
    const dummy = new THREE.Object3D();
    let n = 0;
    for (let x = -190; x < 190 && n < 140; x += 5 + rnd() * 4) {
      if (Math.abs(x - 120) < 14 || Math.abs(x + 82) < 12) continue; // ramps
      const z = LANDMARKS.plateauEdgeZ + 2 + (rnd() - 0.5) * 6 + Math.sin(x * 0.05) * 4;
      const s = 2 + rnd() * 3.5;
      dummy.position.set(x, this.h(x, z) - s * 0.2, z);
      dummy.rotation.set(rnd() * 0.4, rnd() * 6.28, rnd() * 0.3);
      dummy.scale.set(s, s * (0.9 + rnd() * 0.6), s);
      dummy.updateMatrix();
      im.setMatrixAt(n, dummy.matrix);
      n++;
    }
    im.count = n; im.castShadow = true; im.receiveShadow = true;
    this.group.add(im);
  }

  update(dt: number, time: number) {
    this.t = time;
    for (const c of this.crystalMeshes) {
      if (c.name === 'relic' || c.name === 'springOrb' || c.name === 'caveHeart') {
        c.rotation.y += dt * 0.8;
        c.position.y += Math.sin(time * 2 + c.position.x) * 0.002;
      } else if (c.name === 'moonRing') {
        c.rotation.y += dt * 0.5; c.rotation.x = Math.sin(time * 0.7) * 0.5;
      } else if (c.name === 'arenaRune') {
        (c.material as THREE.MeshBasicMaterial).opacity = 0.5 + Math.sin(time * 2 + c.position.x) * 0.3;
      }
    }
    if (this.starShard) {
      this.starShard.rotation.y += dt * 0.6;
      this.starShard.position.y += Math.sin(time * 1.5) * 0.004;
      this.starShard.children.forEach((c, i) => { if (i > 0) { c.rotation.x += dt * (0.4 + i * 0.3); c.rotation.z += dt * 0.5; } });
    }
    for (const l of this.lights) {
      if (l.color.r > 0.9 && l.color.g < 0.7) l.intensity = 5 + Math.sin(time * 9 + l.position.x) * 1.2 + Math.sin(time * 23) * 0.5;
    }
  }
}
