import * as THREE from 'three';
import { buildHumanoid, CreatureRig, VILLAGER_PRESETS, AnimState } from './CreatureModels';
import { Terrain, Colliders } from '../world/Terrain';
import { DialogueLine } from '../ui/Dialogue';
import { damp, dampAngle, rand } from '../core/Math';

export interface NPCDef {
  id: string;
  name: string;
  preset: number;
  pos: THREE.Vector3;
  waypoints?: THREE.Vector3[];
  /** returns lines for current game state */
  lines: () => DialogueLine[];
  onTalkEnd?: () => void;
  title?: string;
}

function labelSprite(text: string, color = '#ffe3a3') {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 128;
  const ctx = cv.getContext('2d')!;
  ctx.font = '700 44px Cinzel, serif';
  ctx.textAlign = 'center';
  ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.strokeText(text, 256, 78);
  ctx.fillStyle = color;
  ctx.fillText(text, 256, 78);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.scale.set(2.6, 0.65, 1);
  return m;
}

export class NPC {
  rig: CreatureRig;
  root: THREE.Group;
  pos: THREE.Vector3;
  yaw = 0;
  state: AnimState = 'idle';
  private stateT = 0;
  private wpIndex = 0;
  private waitT = 0;
  private label: THREE.Sprite;
  private marker: THREE.Mesh;
  talking = false;
  hasQuestMarker = false;

  constructor(public def: NPCDef, private terrain: Terrain, private colliders: Colliders) {
    this.rig = buildHumanoid(VILLAGER_PRESETS[def.preset]);
    this.root = this.rig.root;
    this.pos = def.pos.clone();
    this.pos.y = terrain.heightAt(this.pos.x, this.pos.z);
    this.root.position.copy(this.pos);
    this.label = labelSprite(def.name);
    this.label.position.y = this.rig.height + 0.5;
    this.root.add(this.label);
    this.marker = new THREE.Mesh(new THREE.OctahedronGeometry(0.18), new THREE.MeshBasicMaterial({ color: 0xffd27f, toneMapped: false }));
    this.marker.position.y = this.rig.height + 1.0;
    this.marker.visible = false;
    this.root.add(this.marker);
    this.waitT = rand(1, 4);
    this.yaw = rand(0, Math.PI * 2);
  }

  setQuestMarker(on: boolean) { this.hasQuestMarker = on; this.marker.visible = on; }

  update(dt: number, time: number, playerPos: THREE.Vector3) {
    this.stateT += dt;
    const dPlayer = playerPos.distanceTo(this.pos);
    this.marker.rotation.y += dt * 2;
    this.marker.position.y = this.rig.height + 1.0 + Math.sin(time * 3) * 0.12;
    if (this.talking) {
      this.state = 'talk';
      const dx = playerPos.x - this.pos.x, dz = playerPos.z - this.pos.z;
      this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 8, dt);
    } else if (dPlayer < 4) {
      // look at the player when they are near
      this.state = 'idle';
      const dx = playerPos.x - this.pos.x, dz = playerPos.z - this.pos.z;
      this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 5, dt);
    } else if (this.def.waypoints && this.def.waypoints.length) {
      if (this.waitT > 0) { this.waitT -= dt; this.state = 'idle'; }
      else {
        const wp = this.def.waypoints[this.wpIndex];
        const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.6) { this.wpIndex = (this.wpIndex + 1) % this.def.waypoints.length; this.waitT = rand(2, 6); }
        else {
          const target = Math.atan2(dx, dz);
          this.yaw = dampAngle(this.yaw, target, 6, dt);
          const sp = 1.6;
          this.pos.x += Math.sin(this.yaw) * sp * dt; this.pos.z += Math.cos(this.yaw) * sp * dt;
          this.colliders.resolve(this.pos, 0.4, this.pos.y + 0.5);
          this.state = 'walk';
        }
      }
    } else this.state = 'idle';
    this.pos.y = this.terrain.heightAt(this.pos.x, this.pos.z);
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    this.rig.animate(this.state, time, dt, 1, this.stateT);
    this.label.material.opacity = damp(this.label.material.opacity, dPlayer < 14 ? 1 : 0, 6, dt);
  }
}
