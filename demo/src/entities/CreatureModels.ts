import * as THREE from 'three';
import { createToonMaterial, createOutlineMaterial, createGlowMaterial, ToonMat } from '../render/ToonMaterial';
import { damp, lerp } from '../core/Math';

export type AnimState = 'idle' | 'walk' | 'run' | 'attack' | 'attack2' | 'hit' | 'die' | 'stagger' | 'cast' | 'lunge' | 'howl' | 'talk' | 'launch';

export interface CreatureRig {
  root: THREE.Group;
  mats: ToonMat[];
  outlines: ReturnType<typeof createOutlineMaterial>[];
  /** height of the visual (for hp bars, targeting) */
  height: number;
  radius: number;
  animate: (state: AnimState, t: number, dt: number, speed: number, stateTime: number) => void;
  setFlash: (v: number) => void;
  setDissolve: (v: number) => void;
  setTint: (c: THREE.ColorRepresentation) => void;
  eyes?: THREE.MeshBasicMaterial;
  extra?: Record<string, any>;
}

function outlined(mesh: THREE.Mesh, rig: { mats: ToonMat[]; outlines: any[] }, thickness = 0.03, color = 0x1a1030) {
  const om = createOutlineMaterial(thickness, color);
  const o = new THREE.Mesh(mesh.geometry, om);
  mesh.add(o);
  rig.outlines.push(om);
  if ((mesh.material as any).u) rig.mats.push(mesh.material as ToonMat);
  mesh.castShadow = true;
  return mesh;
}

function capsule(r: number, len: number, mat: THREE.Material) {
  const g = new THREE.CapsuleGeometry(r, len, 4, 10);
  return new THREE.Mesh(g, mat);
}

function baseRig(): Pick<CreatureRig, 'mats' | 'outlines' | 'setFlash' | 'setDissolve' | 'setTint'> & { root: THREE.Group } {
  const rig: any = { root: new THREE.Group(), mats: [], outlines: [] };
  rig.setFlash = (v: number) => rig.mats.forEach((m: ToonMat) => (m.u.uFlash.value = v));
  rig.setDissolve = (v: number) => { rig.mats.forEach((m: ToonMat) => (m.u.uDissolve.value = v)); rig.outlines.forEach((o: any) => (o.u.uDissolve.value = v)); };
  rig.setTint = (c: THREE.ColorRepresentation) => rig.mats.forEach((m: ToonMat) => m.u.uTint.value.set(c));
  return rig;
}

// ---------------------------------------------------------------- HUMANOID
export interface HumanoidOptions {
  skin: number;
  hair?: number;
  cloth: number;
  cloth2?: number;
  scale?: number;
  goblin?: boolean;
  weapon?: 'club' | 'axe' | 'none' | 'bow' | 'staff';
  armor?: boolean;
  eyeColor?: number;
  headScale?: number;
  child?: boolean;
  hood?: boolean;
}

export function buildHumanoid(o: HumanoidOptions): CreatureRig {
  const rig = baseRig();
  const s = o.scale ?? 1;
  const skinMat = createToonMaterial({ color: o.skin, rimStrength: 0.5, specular: 0.2 });
  const clothMat = createToonMaterial({ color: o.cloth, rimStrength: 0.4, specular: 0.05 });
  const cloth2Mat = createToonMaterial({ color: o.cloth2 ?? o.cloth, rimStrength: 0.4, specular: 0.05 });
  const hairMat = createToonMaterial({ color: o.hair ?? 0x3a2a2a, rimStrength: 0.7, rimColor: 0xffffff, specular: 0.5 });
  const metal = createToonMaterial({ color: 0x8a8ea0, rimStrength: 0.6, specular: 0.8 });
  const wood = createToonMaterial({ color: 0x6a4a30 });

  const pelvis = new THREE.Group();
  pelvis.position.y = 0.95 * s;
  rig.root.add(pelvis);
  // torso
  const torso = outlined(capsule(0.28 * s, 0.45 * s, clothMat), rig, 0.03 * s);
  torso.position.y = 0.4 * s;
  torso.scale.set(1, 1, 0.8);
  pelvis.add(torso);
  // belt / skirt
  const belt = outlined(new THREE.Mesh(new THREE.CylinderGeometry(0.3 * s, 0.36 * s, 0.3 * s, 10), cloth2Mat), rig, 0.03 * s);
  belt.position.y = 0.05 * s;
  pelvis.add(belt);
  // head
  const headG = new THREE.Group();
  headG.position.y = 0.95 * s;
  pelvis.add(headG);
  const hs = (o.headScale ?? 1) * (o.child ? 1.2 : 1);
  const head = outlined(new THREE.Mesh(new THREE.SphereGeometry(0.3 * s * hs, 20, 14), skinMat), rig, 0.03 * s);
  head.scale.set(1, 1.05, 0.95);
  headG.add(head);
  // eyes (anime): white ovals + colored iris
  const eyeMat = new THREE.MeshBasicMaterial({ color: o.eyeColor ?? 0x3060c0, toneMapped: false });
  for (const side of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.SphereGeometry(0.075 * s * hs, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
    w.scale.set(0.7, 1.2, 0.3); w.position.set(side * 0.11 * s * hs, 0.02, 0.27 * s * hs);
    headG.add(w);
    const ir = new THREE.Mesh(new THREE.SphereGeometry(0.045 * s * hs, 10, 8), eyeMat);
    ir.scale.set(0.8, 1.2, 0.3); ir.position.set(side * 0.11 * s * hs, 0.01, 0.29 * s * hs);
    headG.add(ir);
    const pu = new THREE.Mesh(new THREE.SphereGeometry(0.02 * s * hs, 8, 6), new THREE.MeshBasicMaterial({ color: 0x100818, toneMapped: false }));
    pu.position.set(side * 0.11 * s * hs, 0.01, 0.305 * s * hs);
    headG.add(pu);
    if (o.goblin) {
      // brow
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.16 * s, 0.03 * s, 0.03 * s), new THREE.MeshBasicMaterial({ color: 0x1a1a10 }));
      brow.position.set(side * 0.11 * s, 0.12 * s, 0.27 * s); brow.rotation.z = -side * 0.4;
      headG.add(brow);
    }
  }
  // mouth
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.1 * s, 0.02 * s, 0.02 * s), new THREE.MeshBasicMaterial({ color: 0x40202a }));
  mouth.position.set(0, -0.12 * s * hs, 0.28 * s * hs);
  headG.add(mouth);
  if (o.goblin) {
    // big ears, nose, teeth
    for (const side of [-1, 1]) {
      const ear = outlined(new THREE.Mesh(new THREE.ConeGeometry(0.09 * s, 0.4 * s, 6), skinMat), rig, 0.02 * s);
      ear.position.set(side * 0.34 * s, 0.05 * s, 0);
      ear.rotation.z = -side * 1.35;
      headG.add(ear);
    }
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.05 * s, 0.16 * s, 6), skinMat);
    nose.rotation.x = Math.PI / 2; nose.position.set(0, -0.03 * s, 0.34 * s);
    headG.add(nose);
    const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.02 * s, 0.06 * s, 4), new THREE.MeshBasicMaterial({ color: 0xffffee }));
    tooth.position.set(0.04 * s, -0.1 * s, 0.29 * s);
    headG.add(tooth);
  } else {
    // hair
    const hair = outlined(new THREE.Mesh(new THREE.SphereGeometry(0.33 * s * hs, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat), rig, 0.03 * s);
    hair.position.y = 0.04 * s;
    headG.add(hair);
    // bangs
    const bangs = new THREE.Mesh(new THREE.BoxGeometry(0.5 * s * hs, 0.14 * s, 0.14 * s), hairMat);
    bangs.position.set(0, 0.18 * s * hs, 0.24 * s * hs);
    headG.add(bangs);
    if (o.hood) {
      const hood = outlined(new THREE.Mesh(new THREE.SphereGeometry(0.38 * s, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.6), cloth2Mat), rig, 0.03 * s);
      hood.position.y = 0.05 * s;
      headG.add(hood);
    }
  }
  if (o.armor) {
    const helm = outlined(new THREE.Mesh(new THREE.SphereGeometry(0.34 * s, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), metal), rig, 0.03 * s);
    helm.position.y = 0.06 * s;
    headG.add(helm);
    for (const side of [-1, 1]) {
      const horn = outlined(new THREE.Mesh(new THREE.ConeGeometry(0.06 * s, 0.35 * s, 6), createToonMaterial({ color: 0xe8e0c8 })), rig, 0.02 * s);
      horn.position.set(side * 0.3 * s, 0.2 * s, 0); horn.rotation.z = -side * 0.8;
      headG.add(horn);
      const pad = outlined(new THREE.Mesh(new THREE.SphereGeometry(0.2 * s, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), metal), rig, 0.03 * s);
      pad.position.set(side * 0.36 * s, 0.68 * s, 0);
      pelvis.add(pad);
    }
    const chest = outlined(new THREE.Mesh(new THREE.BoxGeometry(0.56 * s, 0.4 * s, 0.4 * s), metal), rig, 0.03 * s);
    chest.position.y = 0.48 * s;
    pelvis.add(chest);
  }
  // arms
  const arms: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.34 * s, 0.68 * s, 0);
    pelvis.add(shoulder);
    const upper = outlined(capsule(0.09 * s, 0.32 * s, o.goblin ? skinMat : clothMat), rig, 0.025 * s);
    upper.position.y = -0.2 * s;
    shoulder.add(upper);
    const elbow = new THREE.Group();
    elbow.position.y = -0.4 * s;
    shoulder.add(elbow);
    const fore = outlined(capsule(0.08 * s, 0.3 * s, skinMat), rig, 0.025 * s);
    fore.position.y = -0.18 * s;
    elbow.add(fore);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.09 * s, 8, 6), skinMat);
    hand.position.y = -0.38 * s;
    elbow.add(hand);
    (shoulder as any).elbow = elbow;
    arms.push(shoulder);
  }
  // weapon on right hand
  let weapon: THREE.Group | null = null;
  if (o.weapon && o.weapon !== 'none') {
    weapon = new THREE.Group();
    weapon.position.y = -0.38 * s;
    (arms[1] as any).elbow.add(weapon);
    if (o.weapon === 'club') {
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.04 * s, 0.05 * s, 0.9 * s, 6), wood);
      handle.position.y = 0.3 * s;
      const knob = outlined(new THREE.Mesh(new THREE.SphereGeometry(0.16 * s, 8, 6), wood), rig, 0.03 * s);
      knob.position.y = 0.75 * s; knob.scale.set(1, 1.3, 1);
      weapon.add(handle, knob);
      weapon.rotation.x = -Math.PI / 2;
    } else if (o.weapon === 'axe') {
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.05 * s, 0.06 * s, 1.5 * s, 6), wood);
      handle.position.y = 0.5 * s;
      const blade = outlined(new THREE.Mesh(new THREE.CylinderGeometry(0.42 * s, 0.42 * s, 0.08 * s, 3), metal), rig, 0.03 * s);
      blade.rotation.x = Math.PI / 2; blade.position.set(0.25 * s, 1.05 * s, 0); blade.scale.set(1.4, 1, 1);
      weapon.add(handle, blade);
      weapon.rotation.x = -Math.PI / 2;
    } else if (o.weapon === 'staff') {
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03 * s, 0.04 * s, 1.6 * s, 6), wood);
      handle.position.y = 0.4 * s;
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.12 * s, 10, 8), new THREE.MeshBasicMaterial({ color: 0x9fe8ff, toneMapped: false }));
      orb.position.y = 1.25 * s;
      weapon.add(handle, orb);
    } else if (o.weapon === 'bow') {
      const bow = new THREE.Mesh(new THREE.TorusGeometry(0.5 * s, 0.03 * s, 6, 16, Math.PI), wood);
      bow.position.set(0, 0.5 * s, -0.2 * s); bow.rotation.z = Math.PI / 2; bow.rotation.y = Math.PI / 2;
      weapon.add(bow);
      weapon.position.set(0, 0, 0);
      (arms[1] as any).elbow.remove(weapon);
      pelvis.add(weapon); weapon.position.set(0, 0.5 * s, -0.32 * s); weapon.rotation.set(0, 0, 0.3);
    }
  }
  // legs
  const legs: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.14 * s, -0.05 * s, 0);
    pelvis.add(hip);
    const thigh = outlined(capsule(0.11 * s, 0.35 * s, o.goblin ? skinMat : cloth2Mat), rig, 0.025 * s);
    thigh.position.y = -0.22 * s;
    hip.add(thigh);
    const knee = new THREE.Group();
    knee.position.y = -0.45 * s;
    hip.add(knee);
    const shin = outlined(capsule(0.09 * s, 0.32 * s, o.goblin ? skinMat : cloth2Mat), rig, 0.025 * s);
    shin.position.y = -0.2 * s;
    knee.add(shin);
    const foot = outlined(new THREE.Mesh(new THREE.BoxGeometry(0.16 * s, 0.1 * s, 0.28 * s), o.goblin ? skinMat : wood), rig, 0.02 * s);
    foot.position.set(0, -0.42 * s, 0.06 * s);
    knee.add(foot);
    (hip as any).knee = knee;
    legs.push(hip);
  }

  const height = 1.95 * s * (o.child ? 0.9 : 1);
  const r: CreatureRig = {
    root: rig.root, mats: rig.mats, outlines: rig.outlines, height, radius: 0.42 * s,
    setFlash: rig.setFlash, setDissolve: rig.setDissolve, setTint: rig.setTint,
    eyes: eyeMat,
    extra: { pelvis, headG, arms, legs, weapon },
    animate: (state, t, dt, speed, st) => {
      const k = dt * 14;
      const L = legs[0], R = legs[1], AL = arms[0], AR = arms[1];
      const set = (obj: THREE.Object3D, x: number, y = 0, z = 0) => { obj.rotation.x = damp(obj.rotation.x, x, 14, dt); obj.rotation.y = damp(obj.rotation.y, y, 14, dt); obj.rotation.z = damp(obj.rotation.z, z, 14, dt); };
      let pelvisY = 0.95 * s, lean = 0;
      switch (state) {
        case 'idle': case 'talk': {
          const b = Math.sin(t * 2.2) * 0.02;
          pelvisY += b * s;
          set(L, 0); set(R, 0); set((L as any).knee, 0); set((R as any).knee, 0);
          set(AL, 0.05 + b * 2, 0, 0.12); set(AR, 0.05 - b * 2, 0, -0.12);
          set((AL as any).elbow, -0.3); set((AR as any).elbow, -0.3);
          if (state === 'talk') { set(AR, -0.8 + Math.sin(t * 6) * 0.3, 0, -0.3); set((AR as any).elbow, -1.2 + Math.sin(t * 8) * 0.2); headG.rotation.x = Math.sin(t * 5) * 0.08; headG.rotation.z = Math.sin(t * 3) * 0.06; }
          else { headG.rotation.x = damp(headG.rotation.x, Math.sin(t * 1.3) * 0.04, 6, dt); headG.rotation.z = damp(headG.rotation.z, 0, 6, dt); }
          break;
        }
        case 'walk': case 'run': {
          const f = state === 'run' ? 11 : 7;
          const amp = state === 'run' ? 0.9 : 0.55;
          const ph = t * f;
          const sw = Math.sin(ph);
          set(L, sw * amp); set(R, -sw * amp);
          set((L as any).knee, Math.max(0, -Math.sin(ph)) * 1.0 + 0.1); set((R as any).knee, Math.max(0, Math.sin(ph)) * 1.0 + 0.1);
          set(AL, -sw * amp * 0.8, 0, 0.15); set(AR, sw * amp * 0.8, 0, -0.15);
          set((AL as any).elbow, -0.6); set((AR as any).elbow, -0.6);
          pelvisY += Math.abs(Math.cos(ph)) * 0.06 * s;
          lean = state === 'run' ? 0.25 : 0.08;
          headG.rotation.x = damp(headG.rotation.x, -lean * 0.5, 8, dt);
          break;
        }
        case 'attack': {
          // overhead swing: wind-up then slam
          const p = st;
          if (p < 0.35) { const u = p / 0.35; set(AR, -2.4 * u, 0, -0.4); set((AR as any).elbow, -0.4); lean = -0.2 * u; }
          else if (p < 0.5) { const u = (p - 0.35) / 0.15; set(AR, lerp(-2.4, 0.9, u), 0, -0.2); set((AR as any).elbow, -0.2); lean = lerp(-0.2, 0.35, u); }
          else { set(AR, 0.9, 0, -0.2); lean = damp(lean, 0.3, 4, dt); }
          set(AL, -0.5, 0, 0.5); set(L, -0.3); set(R, 0.3);
          break;
        }
        case 'attack2': {
          // horizontal sweep
          const p = st;
          if (p < 0.3) { const u = p / 0.3; set(AR, -1.3, -1.6 * u, -0.6); pelvis.rotation.y = damp(pelvis.rotation.y, -0.7 * u, 14, dt); }
          else if (p < 0.5) { const u = (p - 0.3) / 0.2; set(AR, -1.3, lerp(-1.6, 1.4, u), -0.6); pelvis.rotation.y = damp(pelvis.rotation.y, lerp(-0.7, 0.8, u), 20, dt); }
          else { set(AR, -1.3, 1.4, -0.6); pelvis.rotation.y = damp(pelvis.rotation.y, 0.6, 5, dt); }
          set((AR as any).elbow, -0.3);
          break;
        }
        case 'cast': {
          set(AL, -1.6, 0, 0.5); set(AR, -1.6, 0, -0.5);
          set((AL as any).elbow, -0.6); set((AR as any).elbow, -0.6);
          pelvisY += Math.sin(t * 8) * 0.02 * s;
          break;
        }
        case 'hit': case 'stagger': {
          lean = -0.35; set(AL, -0.6, 0, 0.6); set(AR, -0.6, 0, -0.6); headG.rotation.x = damp(headG.rotation.x, -0.4, 14, dt);
          break;
        }
        case 'launch': {
          lean = -1.2; set(AL, -2.5, 0, 0.6); set(AR, -2.5, 0, -0.6); set(L, -0.8); set(R, -0.5);
          break;
        }
        case 'die': {
          const u = Math.min(1, st / 0.6);
          rig.root.rotation.x = damp(rig.root.rotation.x, -Math.PI / 2 * 0.95, 8, dt);
          pelvisY = lerp(0.95 * s, 0.35 * s, u);
          set(AL, -1.2, 0, 1.2); set(AR, -1.2, 0, -1.2);
          break;
        }
        case 'howl': case 'lunge': {
          lean = -0.3; set(AL, -2.8, 0, 0.8); set(AR, -2.8, 0, -0.8);
          break;
        }
      }
      if (state !== 'attack2') pelvis.rotation.y = damp(pelvis.rotation.y, 0, 8, dt);
      pelvis.rotation.x = damp(pelvis.rotation.x, lean, 12, dt);
      pelvis.position.y = damp(pelvis.position.y, pelvisY, 14, dt);
      void k; void speed;
    },
  };
  return r;
}

// ---------------------------------------------------------------- QUADRUPED (wolf / boss)
export interface WolfOptions {
  fur: number;
  fur2?: number;
  scale?: number;
  eye?: number;
  corrupted?: boolean;
  boss?: boolean;
}

export function buildWolf(o: WolfOptions): CreatureRig {
  const rig = baseRig();
  const s = o.scale ?? 1;
  const furMat = createToonMaterial({ color: o.fur, rimStrength: 0.6, rimColor: o.corrupted ? 0xa080ff : 0xffffff, specular: 0.15, shadowTint: o.corrupted ? 0x30105a : 0x5a5aa8 });
  const fur2Mat = createToonMaterial({ color: o.fur2 ?? o.fur, rimStrength: 0.5, specular: 0.1 });
  const body = new THREE.Group();
  body.position.y = 0.95 * s;
  rig.root.add(body);
  const torso = outlined(capsule(0.36 * s, 0.9 * s, furMat), rig, 0.03 * s);
  torso.rotation.x = Math.PI / 2;
  torso.scale.set(1, 1, 1.15);
  body.add(torso);
  const chest = outlined(new THREE.Mesh(new THREE.SphereGeometry(0.42 * s, 14, 10), furMat), rig, 0.03 * s);
  chest.position.set(0, 0.05 * s, 0.45 * s); chest.scale.set(1, 1, 1.1);
  body.add(chest);
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.34 * s, 12, 8), fur2Mat);
  belly.position.set(0, -0.12 * s, 0.1 * s); belly.scale.set(0.9, 0.7, 1.5);
  body.add(belly);
  // neck & head
  const neck = new THREE.Group();
  neck.position.set(0, 0.2 * s, 0.75 * s);
  body.add(neck);
  const headG = new THREE.Group();
  headG.position.set(0, 0.15 * s, 0.3 * s);
  neck.add(headG);
  const head = outlined(new THREE.Mesh(new THREE.SphereGeometry(0.3 * s, 16, 12), furMat), rig, 0.03 * s);
  head.scale.set(1, 0.95, 1.1);
  headG.add(head);
  const snout = outlined(new THREE.Mesh(new THREE.BoxGeometry(0.26 * s, 0.2 * s, 0.4 * s), fur2Mat), rig, 0.03 * s);
  snout.position.set(0, -0.06 * s, 0.4 * s);
  headG.add(snout);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.06 * s, 8, 6), new THREE.MeshBasicMaterial({ color: 0x1a1020 }));
  nose.position.set(0, 0.0, 0.6 * s);
  headG.add(nose);
  // jaw
  const jaw = outlined(new THREE.Mesh(new THREE.BoxGeometry(0.22 * s, 0.1 * s, 0.34 * s), fur2Mat), rig, 0.02 * s);
  jaw.position.set(0, -0.16 * s, 0.36 * s);
  headG.add(jaw);
  // teeth
  for (const side of [-1, 1]) { const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.025 * s, 0.08 * s, 4), new THREE.MeshBasicMaterial({ color: 0xffffff })); tooth.position.set(side * 0.08 * s, -0.12 * s, 0.55 * s); tooth.rotation.x = Math.PI; headG.add(tooth); }
  // eyes (glowing)
  const eyeMat = new THREE.MeshBasicMaterial({ color: o.eye ?? 0xffcc40, toneMapped: false });
  for (const side of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.06 * s, 8, 6), eyeMat);
    e.position.set(side * 0.14 * s, 0.08 * s, 0.24 * s); e.scale.set(1, 0.7, 0.6);
    headG.add(e);
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.14 * s, 0.03 * s, 0.03 * s), new THREE.MeshBasicMaterial({ color: 0x1a1020 }));
    brow.position.set(side * 0.14 * s, 0.15 * s, 0.25 * s); brow.rotation.z = side * 0.4;
    headG.add(brow);
    // ears
    const ear = outlined(new THREE.Mesh(new THREE.ConeGeometry(0.08 * s, 0.25 * s, 6), furMat), rig, 0.02 * s);
    ear.position.set(side * 0.16 * s, 0.32 * s, 0.0);
    ear.rotation.z = -side * 0.25; ear.rotation.x = -0.2;
    headG.add(ear);
  }
  // mane / crest
  if (o.boss) {
    const crestMat = new THREE.MeshBasicMaterial({ color: 0x9fe8ff, toneMapped: false, transparent: true, opacity: 0.9 });
    for (let i = 0; i < 6; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.1 * s, (0.5 - i * 0.05) * s, 5), crestMat);
      spike.position.set(0, 0.42 * s, (0.5 - i * 0.22) * s);
      spike.rotation.x = -0.5;
      body.add(spike);
    }
    const mane = outlined(new THREE.Mesh(new THREE.SphereGeometry(0.5 * s, 12, 8), fur2Mat), rig, 0.03 * s);
    mane.position.set(0, 0.15 * s, 0.6 * s); mane.scale.set(1.1, 1.0, 0.8);
    body.add(mane);
    for (const side of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.07 * s, 0.5 * s, 6), crestMat);
      horn.position.set(side * 0.2 * s, 0.35 * s, 0.05 * s); horn.rotation.z = -side * 0.5; horn.rotation.x = -0.4;
      headG.add(horn);
    }
  } else if (o.corrupted) {
    const crestMat = new THREE.MeshBasicMaterial({ color: 0xa080ff, toneMapped: false });
    for (let i = 0; i < 3; i++) { const spike = new THREE.Mesh(new THREE.ConeGeometry(0.06 * s, 0.3 * s, 5), crestMat); spike.position.set(0, 0.38 * s, (0.3 - i * 0.25) * s); spike.rotation.x = -0.5; body.add(spike); }
  }
  // legs
  const legs: THREE.Group[] = [];
  const legPos = [[-0.22, 0.5], [0.22, 0.5], [-0.22, -0.45], [0.22, -0.45]];
  for (const [lx, lz] of legPos) {
    const hip = new THREE.Group();
    hip.position.set(lx * s, -0.15 * s, lz * s);
    body.add(hip);
    const upper = outlined(capsule(0.1 * s, 0.35 * s, furMat), rig, 0.025 * s);
    upper.position.y = -0.2 * s;
    hip.add(upper);
    const knee = new THREE.Group();
    knee.position.y = -0.42 * s;
    hip.add(knee);
    const lower = outlined(capsule(0.08 * s, 0.32 * s, fur2Mat), rig, 0.025 * s);
    lower.position.y = -0.18 * s;
    knee.add(lower);
    const paw = new THREE.Mesh(new THREE.SphereGeometry(0.1 * s, 8, 6), fur2Mat);
    paw.position.set(0, -0.38 * s, 0.04 * s); paw.scale.set(1, 0.7, 1.3);
    knee.add(paw);
    (hip as any).knee = knee;
    legs.push(hip);
  }
  // tail
  const tail = new THREE.Group();
  tail.position.set(0, 0.15 * s, -0.75 * s);
  body.add(tail);
  const tailM = outlined(capsule(0.09 * s, 0.5 * s, furMat), rig, 0.025 * s);
  tailM.position.set(0, 0.1 * s, -0.25 * s); tailM.rotation.x = 1.2;
  tail.add(tailM);

  const height = 1.5 * s;
  const r: CreatureRig = {
    root: rig.root, mats: rig.mats, outlines: rig.outlines, height, radius: 0.55 * s,
    setFlash: rig.setFlash, setDissolve: rig.setDissolve, setTint: rig.setTint,
    eyes: eyeMat,
    extra: { body, headG, neck, legs, tail, jaw },
    animate: (state, t, dt, speed, st) => {
      const set = (obj: THREE.Object3D, x: number, y = 0, z = 0, l = 16) => { obj.rotation.x = damp(obj.rotation.x, x, l, dt); obj.rotation.y = damp(obj.rotation.y, y, l, dt); obj.rotation.z = damp(obj.rotation.z, z, l, dt); };
      let bodyY = 0.95 * s, pitch = 0;
      const FL = legs[0], FR = legs[1], BL = legs[2], BR = legs[3];
      switch (state) {
        case 'idle': {
          const b = Math.sin(t * 2.5) * 0.02;
          bodyY += b * s;
          for (const l of legs) { set(l, 0); set((l as any).knee, 0); }
          set(tail, 0, Math.sin(t * 3) * 0.4);
          set(neck, Math.sin(t * 1.2) * 0.05, Math.sin(t * 0.7) * 0.2);
          set(jaw, 0);
          break;
        }
        case 'walk': case 'run': {
          const f = state === 'run' ? 13 : 7;
          const amp = state === 'run' ? 0.8 : 0.45;
          const ph = t * f;
          // gallop: front pair and back pair offset
          set(FL, Math.sin(ph) * amp); set(FR, Math.sin(ph + 0.5) * amp);
          set(BL, Math.sin(ph + Math.PI) * amp); set(BR, Math.sin(ph + Math.PI + 0.5) * amp);
          for (const l of legs) set((l as any).knee, Math.max(0, -Math.sin(ph + (l === BL || l === BR ? Math.PI : 0))) * 0.9);
          bodyY += Math.abs(Math.sin(ph)) * 0.08 * s * (state === 'run' ? 1.4 : 1);
          pitch = state === 'run' ? Math.sin(ph) * 0.12 : 0;
          set(tail, 0.3, Math.sin(ph * 0.5) * 0.3);
          set(neck, -0.1, 0);
          set(jaw, state === 'run' ? 0.25 : 0);
          break;
        }
        case 'attack': {
          // bite: neck lunges forward, jaw snaps
          const p = st;
          if (p < 0.3) { set(neck, 0.35 * (p / 0.3), 0, 0, 20); set(jaw, 0.6, 0, 0, 20); pitch = -0.1; }
          else if (p < 0.45) { set(neck, -0.4, 0, 0, 30); set(jaw, 0, 0, 0, 40); pitch = 0.2; }
          else { set(neck, -0.2, 0, 0, 10); set(jaw, 0.1); }
          set(FL, -0.6); set(FR, -0.6); set(BL, 0.4); set(BR, 0.4);
          break;
        }
        case 'attack2': {
          // claw swipe: front leg sweeps
          const p = st;
          const arm = p < 0.3 ? -1.8 * (p / 0.3) : p < 0.5 ? lerp(-1.8, 1.2, (p - 0.3) / 0.2) : 1.2;
          set(FR, arm, 0, -0.3, 24); set(FL, -0.4); set(BL, 0.3); set(BR, 0.3);
          bodyY += 0.15 * s; pitch = -0.25;
          set(neck, -0.2, -0.3);
          break;
        }
        case 'lunge': {
          set(FL, -1.2); set(FR, -1.2); set(BL, 1.1); set(BR, 1.1);
          for (const l of legs) set((l as any).knee, 0.3);
          pitch = -0.15; set(neck, 0.2); set(jaw, 0.7);
          set(tail, 0.8);
          break;
        }
        case 'howl': case 'cast': {
          set(neck, -0.9, 0, 0, 8); set(headG, -0.4, 0, 0, 8); set(jaw, 0.6);
          set(FL, -0.5); set(FR, -0.5); set(BL, 0.6); set(BR, 0.6);
          bodyY += 0.2 * s; pitch = -0.35;
          break;
        }
        case 'hit': case 'stagger': {
          pitch = 0.15; set(neck, 0.3, 0.4); bodyY -= 0.05 * s;
          break;
        }
        case 'launch': {
          pitch = -0.9; set(neck, 0.5); for (const l of legs) set(l, -0.6);
          break;
        }
        case 'die': {
          rig.root.rotation.z = damp(rig.root.rotation.z, Math.PI / 2 * 0.9, 6, dt);
          bodyY = lerp(0.95 * s, 0.4 * s, Math.min(1, st / 0.5));
          for (const l of legs) set(l, 0.4);
          set(neck, 0.3); set(jaw, 0.4);
          break;
        }
      }
      if (state !== 'howl' && state !== 'cast') set(headG, 0, 0, 0, 8);
      body.rotation.x = damp(body.rotation.x, pitch, 12, dt);
      body.position.y = damp(body.position.y, bodyY, 14, dt);
      void speed;
    },
  };
  return r;
}

// ---------------------------------------------------------------- SLIME ENEMY
export function buildSlime(color: number, scale = 0.8, eye = 0xff4040): CreatureRig {
  const rig = baseRig();
  const s = scale;
  const mat = createToonMaterial({ color, rimStrength: 0.8, rimColor: 0xffffff, specular: 0.8, jelly: true });
  const geo = new THREE.SphereGeometry(0.55 * s, 24, 16);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); pos.setY(i, y * 0.85 * (y < -0.25 * s ? 0.8 : 1)); }
  geo.computeVertexNormals();
  geo.translate(0, 0.48 * s, 0);
  const body = outlined(new THREE.Mesh(geo, mat), rig, 0.03 * s);
  rig.root.add(body);
  const eyeMat = new THREE.MeshBasicMaterial({ color: eye, toneMapped: false });
  for (const side of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.SphereGeometry(0.1 * s, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
    w.scale.set(0.8, 1.2, 0.4); w.position.set(side * 0.18 * s, 0.62 * s, 0.45 * s);
    rig.root.add(w);
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.055 * s, 8, 6), eyeMat);
    p.scale.set(0.8, 1.2, 0.4); p.position.set(side * 0.18 * s, 0.62 * s, 0.49 * s);
    rig.root.add(p);
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.16 * s, 0.03 * s, 0.03 * s), new THREE.MeshBasicMaterial({ color: 0x201030 }));
    brow.position.set(side * 0.18 * s, 0.78 * s, 0.45 * s); brow.rotation.z = -side * 0.5;
    rig.root.add(brow);
  }
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.06 * s, 0.012 * s, 6, 12, Math.PI), new THREE.MeshBasicMaterial({ color: 0x201030 }));
  mouth.position.set(0, 0.4 * s, 0.53 * s);
  rig.root.add(mouth);
  const hl = new THREE.Mesh(new THREE.CircleGeometry(0.08 * s, 12), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, toneMapped: false }));
  hl.position.set(-0.2 * s, 0.8 * s, 0.35 * s); hl.lookAt(-0.6, 1.6, 1.2); hl.scale.set(1.4, 0.7, 1);
  rig.root.add(hl);
  const outlineMat = rig.outlines[0];
  const r: CreatureRig = {
    root: rig.root, mats: rig.mats, outlines: rig.outlines, height: 1.0 * s, radius: 0.5 * s,
    setFlash: rig.setFlash, setDissolve: rig.setDissolve, setTint: rig.setTint,
    eyes: eyeMat,
    animate: (state, t, dt, speed, st) => {
      let sx = 1, sy = 1;
      switch (state) {
        case 'idle': sy = 1 + Math.sin(t * 3) * 0.05; sx = 1 - Math.sin(t * 3) * 0.03; break;
        case 'walk': case 'run': { const ph = (t * 6) % (Math.PI * 2); const hop = Math.max(0, Math.sin(ph)); rig.root.position.y = hop * 0.35 * s; sy = 1 + (Math.sin(ph) > 0 ? hop * 0.35 : Math.sin(ph) * 0.25); sx = 1 / Math.sqrt(sy); break; }
        case 'attack': case 'lunge': { sy = st < 0.3 ? 1 - st : 1.4; sx = 1 / Math.sqrt(sy); break; }
        case 'hit': case 'stagger': sy = 0.7; sx = 1.2; break;
        case 'die': sy = Math.max(0.05, 1 - st * 2.5); sx = 1 + st; break;
        case 'launch': sy = 1.4; sx = 0.85; break;
      }
      mat.u.uSquash.value.set(sx, sy, sx);
      mat.u.uWobble.value = damp(mat.u.uWobble.value, state === 'hit' ? 1 : 0.2, 6, dt);
      mat.u.uWobblePhase.value += dt * 20;
      outlineMat.u.uSquash.value.copy(mat.u.uSquash.value);
      outlineMat.u.uWobble.value = mat.u.uWobble.value;
      outlineMat.u.uWobblePhase.value = mat.u.uWobblePhase.value;
      void speed;
    },
  };
  return r;
}

// ---------------------------------------------------------------- WISP (magic creature)
export function buildWisp(color = 0x9040ff, core = 0x1a0a30, scale = 1): CreatureRig {
  const rig = baseRig();
  const s = scale;
  const g = new THREE.Group();
  g.position.y = 1.2 * s;
  rig.root.add(g);
  const coreMat = createToonMaterial({ color: core, rimStrength: 1.2, rimColor: color, specular: 0.4, emissive: color, emissiveIntensity: 0.25 });
  const coreM = outlined(new THREE.Mesh(new THREE.IcosahedronGeometry(0.32 * s, 1), coreMat), rig, 0.03 * s, 0x100020);
  g.add(coreM);
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.5 * s, 16, 12), createGlowMaterial(color, 0.35));
  g.add(glow);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  for (const side of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.06 * s, 8, 6), eyeMat);
    e.position.set(side * 0.12 * s, 0.05 * s, 0.28 * s); e.scale.set(0.6, 1.4, 0.5);
    g.add(e);
  }
  const ringMat = createGlowMaterial(color, 0.9);
  const rings: THREE.Mesh[] = [];
  for (let i = 0; i < 2; i++) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.55 * s + i * 0.15 * s, 0.03 * s, 6, 32), ringMat);
    r.rotation.x = 1.2 + i; g.add(r); rings.push(r);
  }
  const r: CreatureRig = {
    root: rig.root, mats: rig.mats, outlines: rig.outlines, height: 1.8 * s, radius: 0.5 * s,
    setFlash: rig.setFlash, setDissolve: rig.setDissolve, setTint: rig.setTint,
    eyes: eyeMat,
    extra: { glow, rings, core: coreM },
    animate: (state, t, dt, speed, st) => {
      g.position.y = 1.2 * s + Math.sin(t * 2.5) * 0.15 * s;
      rings[0].rotation.z += dt * 1.5; rings[1].rotation.y += dt * 2.2;
      coreM.rotation.y += dt; coreM.rotation.x += dt * 0.7;
      let sc = 1;
      switch (state) {
        case 'cast': case 'attack': sc = 1 + Math.sin(st * Math.PI) * 0.5; break;
        case 'hit': case 'stagger': sc = 0.7; break;
        case 'die': sc = Math.max(0.01, 1 - st * 2); break;
      }
      g.scale.setScalar(damp(g.scale.x, sc, 12, dt));
      (glow.material as THREE.MeshBasicMaterial).opacity = 0.3 + Math.sin(t * 6) * 0.1 + (state === 'cast' ? 0.4 : 0);
      void speed;
    },
  };
  return r;
}

// ---------------------------------------------------------------- TRAINING DUMMY
export function buildDummy(): CreatureRig {
  const rig = baseRig();
  const wood = createToonMaterial({ color: 0x8a6a4a });
  const straw = createToonMaterial({ color: 0xd9b96a, rimStrength: 0.3 });
  const pivot = new THREE.Group();
  rig.root.add(pivot);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.0, 6), wood); post.position.y = 0.5; rig.root.add(post);
  const body = outlined(new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.3, 1.0, 10), straw), rig, 0.03); body.position.y = 1.5; pivot.add(body);
  const head = outlined(new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), straw), rig, 0.03); head.position.y = 2.25; pivot.add(head);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 0.1), wood); bar.position.y = 1.75; pivot.add(bar);
  const face = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.03, 0.03), new THREE.MeshBasicMaterial({ color: 0x402010 })); face.position.set(0, 2.25, 0.3); pivot.add(face);
  for (const side of [-1, 1]) { const x = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.03), new THREE.MeshBasicMaterial({ color: 0x402010 })); x.position.set(side * 0.1, 2.35, 0.29); x.rotation.z = side * 0.6; pivot.add(x); }
  let wob = 0, wobV = 0;
  const r: CreatureRig = {
    root: rig.root, mats: rig.mats, outlines: rig.outlines, height: 2.5, radius: 0.45,
    setFlash: rig.setFlash, setDissolve: rig.setDissolve, setTint: rig.setTint,
    animate: (state, t, dt) => {
      if (state === 'hit' || state === 'stagger') wobV += (0.6 - wobV) * 0.5;
      wobV += -wob * 40 * dt; wobV *= Math.max(0, 1 - 4 * dt); wob += wobV * dt;
      pivot.rotation.x = wob; pivot.rotation.z = wob * 0.5 * Math.sin(t * 7);
    },
  };
  return r;
}

export const VILLAGER_PRESETS: HumanoidOptions[] = [
  { skin: 0xffd9b8, hair: 0xc84a3a, cloth: 0x3d6b4f, cloth2: 0x6a4a35, weapon: 'bow', eyeColor: 0x3a8a5a },          // Mira the hunter
  { skin: 0xf3d2b3, hair: 0xd8d8e0, cloth: 0x6a4a8a, cloth2: 0x3a2a4a, weapon: 'staff', eyeColor: 0x4060a0, hood: true }, // Elder
  { skin: 0xffe0c4, hair: 0xf0c060, cloth: 0xe8a0b0, cloth2: 0xffffff, child: true, scale: 0.7, eyeColor: 0x60a0ff },  // child
  { skin: 0xf0c8a8, hair: 0x2a2a3a, cloth: 0xb8623a, cloth2: 0x4a3a2a, eyeColor: 0x6a4a2a },                       // villager A
  { skin: 0xffd6b0, hair: 0x7a4a2a, cloth: 0x4a7ab8, cloth2: 0x3a3a4a, eyeColor: 0x2a6a9a },                       // villager B
];
