import * as THREE from 'three';
import { fbm, noise2, smoothstep, clamp, lerp } from '../core/Math';
import { createToonMaterial } from '../render/ToonMaterial';

export const WORLD_SIZE = 480; // world spans -240..240
export const WORLD_HALF = WORLD_SIZE / 2;

/** Landmark positions used by world building, quests and enemies. */
export const LANDMARKS = {
  glade: new THREE.Vector3(0, 0, 0),
  spring: new THREE.Vector3(14, 0, -18),
  village: new THREE.Vector3(-95, 0, 70),
  training: new THREE.Vector3(-52, 0, 108),
  ruins: new THREE.Vector3(108, 0, -42),
  cave: new THREE.Vector3(-92, 0, -128),
  caveEnd: new THREE.Vector3(-92, 0, -170),
  waterfall: new THREE.Vector3(48, 0, -112),
  hidden: new THREE.Vector3(48, 0, -122),
  wolfWoods: new THREE.Vector3(105, 0, -150),
  arena: new THREE.Vector3(150, 0, -185),
  plateauEdgeZ: -110,
};

const PLATEAU_H = 14;

/** River centerline x for a given z */
export function riverX(z: number) {
  return 46 + Math.sin(z * 0.021) * 16 + Math.sin(z * 0.053 + 1.3) * 5;
}

// paths between landmarks (polyline)
const PATHS: THREE.Vector2[][] = [
  // glade -> village
  [new THREE.Vector2(0, 4), new THREE.Vector2(-22, 24), new THREE.Vector2(-50, 40), new THREE.Vector2(-72, 58), new THREE.Vector2(-95, 70)],
  // village -> training
  [new THREE.Vector2(-95, 70), new THREE.Vector2(-75, 92), new THREE.Vector2(-52, 108)],
  // glade -> ruins
  [new THREE.Vector2(6, -4), new THREE.Vector2(30, -14), new THREE.Vector2(60, -28), new THREE.Vector2(85, -38), new THREE.Vector2(108, -42)],
  // glade -> waterfall (along river west bank)
  [new THREE.Vector2(4, -10), new THREE.Vector2(14, -40), new THREE.Vector2(22, -70), new THREE.Vector2(30, -95), new THREE.Vector2(36, -108)],
  // ruins -> wolf woods (ramp up to plateau)
  [new THREE.Vector2(108, -42), new THREE.Vector2(118, -70), new THREE.Vector2(122, -100), new THREE.Vector2(112, -128), new THREE.Vector2(105, -150)],
  // wolf woods -> arena
  [new THREE.Vector2(105, -150), new THREE.Vector2(125, -168), new THREE.Vector2(150, -185)],
  // glade -> cave (ramp west)
  [new THREE.Vector2(-6, -10), new THREE.Vector2(-30, -40), new THREE.Vector2(-55, -75), new THREE.Vector2(-75, -100), new THREE.Vector2(-92, -118), new THREE.Vector2(-92, -170)],
];

function distToSegment(px: number, pz: number, a: THREE.Vector2, b: THREE.Vector2) {
  const abx = b.x - a.x, abz = b.y - a.y;
  const apx = px - a.x, apz = pz - a.y;
  const l2 = abx * abx + abz * abz;
  let t = l2 > 0 ? (apx * abx + apz * abz) / l2 : 0;
  t = clamp(t, 0, 1);
  const cx = a.x + abx * t, cz = a.y + abz * t;
  return Math.hypot(px - cx, pz - cz);
}

export function pathDistance(x: number, z: number) {
  let d = Infinity;
  for (const path of PATHS) for (let i = 0; i < path.length - 1; i++) d = Math.min(d, distToSegment(x, z, path[i], path[i + 1]));
  return d;
}

const flatSpots = [
  { p: LANDMARKS.glade, r: 34, h: 0, soft: 22 },
  { p: LANDMARKS.village, r: 38, h: 3.5, soft: 18 },
  { p: LANDMARKS.training, r: 22, h: 3, soft: 14 },
  { p: LANDMARKS.ruins, r: 24, h: 9, soft: 16 },
  { p: LANDMARKS.spring, r: 6, h: -0.4, soft: 4 },
];

/** Raw analytic height (design + noise). */
export function computeHeight(x: number, z: number): number {
  // rolling base
  let h = (fbm(x * 0.012 + 3, z * 0.012 + 7, 4) - 0.5) * 12;
  h += (fbm(x * 0.045, z * 0.045, 3) - 0.5) * 2.2;

  // plateau to the north with a cliff
  const plat = smoothstep(LANDMARKS.plateauEdgeZ + 8, LANDMARKS.plateauEdgeZ - 6, z + Math.sin(x * 0.05) * 4);
  h += plat * PLATEAU_H;
  // ramps up to the plateau along east path (x ~118..122) and west path (x ~ -80)
  const rampE = 1 - smoothstep(0, 18, Math.abs(x - 120));
  const rampW = 1 - smoothstep(0, 16, Math.abs(x + 82));
  const ramp = Math.max(rampE, rampW);
  if (ramp > 0) {
    const zt = smoothstep(LANDMARKS.plateauEdgeZ + 40, LANDMARKS.plateauEdgeZ - 6, z);
    const smoothPlat = zt * PLATEAU_H;
    h = lerp(h, h - plat * PLATEAU_H + smoothPlat, ramp);
  }

  // flat spots
  for (const f of flatSpots) {
    const d = Math.hypot(x - f.p.x, z - f.p.z);
    const k = 1 - smoothstep(f.r, f.r + f.soft, d);
    h = lerp(h, f.h, k);
  }

  // boss crater on the plateau
  {
    const a = LANDMARKS.arena;
    const d = Math.hypot(x - a.x, z - a.z);
    const rim = Math.exp(-Math.pow((d - 40) / 9, 2)) * 7;
    const floorK = 1 - smoothstep(26, 36, d);
    const floorH = PLATEAU_H + 1.5;
    h = lerp(h + rim, floorH, floorK);
    // entrance gap in the rim toward wolf woods
    const ang = Math.atan2(z - a.z, x - a.x);
    const gap = 1 - smoothstep(0.25, 0.6, Math.abs(ang - Math.atan2(LANDMARKS.wolfWoods.z - a.z, LANDMARKS.wolfWoods.x - a.x)));
    h -= rim * gap * 0.95;
  }

  // cave hill: raised mound with a corridor
  {
    const c = LANDMARKS.cave;
    const d = Math.hypot(x - c.x, z - (c.z - 25));
    const mound = (1 - smoothstep(18, 46, d)) * 26;
    const corridor = 1 - smoothstep(4.5, 7.5, Math.abs(x - c.x));
    const inZ = z < c.z + 6 && z > LANDMARKS.caveEnd.z - 10 ? 1 : 0;
    const chamber = 1 - smoothstep(8, 12, Math.hypot(x - LANDMARKS.caveEnd.x, z - LANDMARKS.caveEnd.z));
    const hollow = Math.max(corridor * inZ, chamber);
    h += mound * (1 - hollow);
    if (hollow > 0) h = lerp(h, PLATEAU_H + 0.5, hollow);
  }

  // river channel
  {
    const rx = riverX(z);
    const d = Math.abs(x - rx);
    const width = 7.5;
    const depth = 2.6;
    const k = 1 - smoothstep(width * 0.5, width, d);
    h -= k * depth;
    // gentle banks
    h -= (1 - smoothstep(width, width + 6, d)) * 0.6;
  }

  // world edge mountains
  {
    const ex = Math.max(0, Math.abs(x) - 195), ez = Math.max(0, Math.abs(z) - 205);
    const e = Math.hypot(ex, ez);
    h += smoothstep(0, 40, e) * 70 + Math.pow(e / 40, 2) * 10;
  }
  return h;
}

export interface GroundInfo {
  path: number; // 0..1 dirt path mask
  water: number; // 0..1 inside river
  slope: number; // 0..1
  forest: number; // 0..1 tree density
  plateau: number;
  hidden: number;
  village: number;
}

export class Terrain {
  mesh: THREE.Mesh;
  private grid: Float32Array;
  private res: number;
  private cell: number;
  material: ReturnType<typeof createToonMaterial>;

  constructor() {
    // height cache at 1 unit resolution
    this.res = WORLD_SIZE + 1;
    this.cell = 1;
    this.grid = new Float32Array(this.res * this.res);
    for (let j = 0; j < this.res; j++)
      for (let i = 0; i < this.res; i++) this.grid[j * this.res + i] = computeHeight(i - WORLD_HALF, j - WORLD_HALF);

    const segs = 300;
    const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, segs, segs);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    const grassA = new THREE.Color(0x5fbf4a), grassB = new THREE.Color(0x8fd85c), grassC = new THREE.Color(0x3f9a4a);
    const dirt = new THREE.Color(0xb8925e), dirtB = new THREE.Color(0xd2b07a);
    const stone = new THREE.Color(0x8d93a6), stoneB = new THREE.Color(0x6a7088);
    const sand = new THREE.Color(0xdcc89a);
    const riverBed = new THREE.Color(0x4f8fa8);
    const forestFloor = new THREE.Color(0x3d8a46);
    const hiddenGlow = new THREE.Color(0x7fe8ff);
    const villageGrass = new THREE.Color(0x7fcf5c);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = this.heightAt(x, z);
      pos.setY(i, h);
      const info = this.info(x, z);
      const n = noise2(x * 0.08, z * 0.08);
      const n2 = fbm(x * 0.03 + 50, z * 0.03, 3);
      c.copy(grassA).lerp(grassB, n).lerp(grassC, n2 * 0.7);
      c.lerp(forestFloor, info.forest * 0.55);
      c.lerp(villageGrass, info.village * 0.7);
      // stone on slopes / cliffs
      c.lerp(stone, smoothstep(0.35, 0.6, info.slope));
      c.lerp(stoneB, smoothstep(0.6, 0.85, info.slope) * 0.8);
      // high edges snowy
      if (h > 45) c.lerp(new THREE.Color(0xeef3ff), smoothstep(45, 75, h));
      // path
      c.lerp(n > 0.5 ? dirt : dirtB, info.path);
      // river
      c.lerp(sand, smoothstep(0.0, 1, info.water) * 0.8);
      c.lerp(riverBed, smoothstep(0.5, 1, info.water));
      // hidden area glow tint
      c.lerp(hiddenGlow, info.hidden * 0.5);
      // arena floor darker ash
      const da = Math.hypot(x - LANDMARKS.arena.x, z - LANDMARKS.arena.z);
      if (da < 40) c.lerp(new THREE.Color(0x6e6a78), (1 - smoothstep(20, 40, da)) * 0.65);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    this.material = createToonMaterial({ color: 0xffffff, vertexColors: true, rimStrength: 0.12, specular: 0.0, shadowTint: 0x5a4a98 });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.name = 'terrain';
  }

  heightAt(x: number, z: number): number {
    const gx = clamp(x + WORLD_HALF, 0, this.res - 1.001), gz = clamp(z + WORLD_HALF, 0, this.res - 1.001);
    const i = Math.floor(gx), j = Math.floor(gz);
    const fx = gx - i, fz = gz - j;
    const g = this.grid, r = this.res;
    const h00 = g[j * r + i], h10 = g[j * r + i + 1], h01 = g[(j + 1) * r + i], h11 = g[(j + 1) * r + i + 1];
    return lerp(lerp(h00, h10, fx), lerp(h01, h11, fx), fz);
  }

  normalAt(x: number, z: number, out = new THREE.Vector3()) {
    const e = 0.6;
    const hl = this.heightAt(x - e, z), hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e), hu = this.heightAt(x, z + e);
    return out.set(hl - hr, 2 * e, hd - hu).normalize();
  }

  info(x: number, z: number): GroundInfo {
    const n = this.normalAt(x, z);
    const slope = 1 - n.y;
    const pd = pathDistance(x, z);
    const path = 1 - smoothstep(2.2, 4.2, pd + noise2(x * 0.3, z * 0.3) * 1.2);
    const rd = Math.abs(x - riverX(z));
    const water = 1 - smoothstep(3.0, 6.0, rd);
    const plateau = smoothstep(LANDMARKS.plateauEdgeZ + 4, LANDMARKS.plateauEdgeZ - 4, z);
    // forest density: everywhere except clearings, paths, water, village
    let forest = smoothstep(0.35, 0.7, fbm(x * 0.02 + 11, z * 0.02 + 5, 3));
    const dGlade = Math.hypot(x, z);
    forest *= smoothstep(30, 48, dGlade);
    const dv = Math.hypot(x - LANDMARKS.village.x, z - LANDMARKS.village.z);
    forest *= smoothstep(40, 55, dv);
    const dt = Math.hypot(x - LANDMARKS.training.x, z - LANDMARKS.training.z);
    forest *= smoothstep(22, 32, dt);
    const dr = Math.hypot(x - LANDMARKS.ruins.x, z - LANDMARKS.ruins.z);
    forest *= smoothstep(24, 36, dr);
    const da = Math.hypot(x - LANDMARKS.arena.x, z - LANDMARKS.arena.z);
    forest *= smoothstep(44, 56, da);
    const dw = Math.hypot(x - LANDMARKS.wolfWoods.x, z - LANDMARKS.wolfWoods.z);
    forest = Math.max(forest, (1 - smoothstep(10, 40, dw)) * 0.9 * smoothstep(44, 56, da));
    forest *= 1 - path;
    forest *= 1 - smoothstep(0.5, 1, water);
    forest *= 1 - smoothstep(0.3, 0.5, slope);
    const dh = Math.hypot(x - LANDMARKS.hidden.x, z - LANDMARKS.hidden.z);
    const hidden = (1 - smoothstep(6, 12, dh)) * plateau;
    const dCave = Math.hypot(x - LANDMARKS.cave.x, z - (LANDMARKS.cave.z - 25));
    forest *= smoothstep(30, 50, dCave);
    const village = 1 - smoothstep(30, 42, dv);
    return { path, water, slope, forest, plateau, hidden, village };
  }
}

/** Circle colliders in a spatial hash for trees, rocks, buildings. */
export interface Collider { x: number; z: number; r: number; h?: number; tag?: string }

export class Colliders {
  private cellSize = 12;
  private cells = new Map<string, Collider[]>();
  all: Collider[] = [];
  private key(cx: number, cz: number) { return cx + ',' + cz; }
  add(c: Collider) {
    this.all.push(c);
    const cx0 = Math.floor((c.x - c.r) / this.cellSize), cx1 = Math.floor((c.x + c.r) / this.cellSize);
    const cz0 = Math.floor((c.z - c.r) / this.cellSize), cz1 = Math.floor((c.z + c.r) / this.cellSize);
    for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
      const k = this.key(cx, cz);
      if (!this.cells.has(k)) this.cells.set(k, []);
      this.cells.get(k)!.push(c);
    }
  }
  near(x: number, z: number, out: Collider[] = []) {
    out.length = 0;
    const cx = Math.floor(x / this.cellSize), cz = Math.floor(z / this.cellSize);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const arr = this.cells.get(this.key(cx + i, cz + j));
      if (arr) for (const c of arr) out.push(c);
    }
    return out;
  }
  /** Push a point (with radius) out of colliders. Returns true if collided. */
  resolve(pos: THREE.Vector3, radius: number, y = 0): boolean {
    const near = this.near(pos.x, pos.z, scratch);
    let hit = false;
    for (const c of near) {
      if (c.h !== undefined && y > c.h) continue;
      const dx = pos.x - c.x, dz = pos.z - c.z;
      const d = Math.hypot(dx, dz);
      const min = c.r + radius;
      if (d < min && d > 0.0001) {
        const push = (min - d) / d;
        pos.x += dx * push;
        pos.z += dz * push;
        hit = true;
      } else if (d <= 0.0001) {
        pos.x += min;
        hit = true;
      }
    }
    return hit;
  }
  /** is a point blocked (used for placement) */
  blocked(x: number, z: number, radius: number) {
    const near = this.near(x, z, scratch);
    for (const c of near) if (Math.hypot(x - c.x, z - c.z) < c.r + radius) return true;
    return false;
  }
}
const scratch: Collider[] = [];
