import * as THREE from 'three';
import { Terrain, WORLD_HALF, WORLD_SIZE } from '../world/Terrain';

export interface MinimapBlip { x: number; z: number; kind: 'enemy' | 'elite' | 'boss' | 'npc' | 'quest' | 'landmark' | 'essence'; label?: string }
export interface MinimapState {
  /** player world position */
  x: number; z: number;
  /** player facing yaw (facing = sin(yaw), cos(yaw)) */
  playerYaw: number;
  /** camera forward vector (xz) */
  camFx: number; camFz: number;
  blips: MinimapBlip[];
  /** world position of the current quest objective, if any */
  objective: { x: number; z: number } | null;
  zone: string;
}

/**
 * Circular minimap in the corner. The terrain image is rasterized once from the world mesh's
 * vertex colors (so it matches what the player sees), then each frame we blit a rotated,
 * cropped window of it and draw blips on top. Cheap: one drawImage + a handful of arcs.
 */
export class Minimap {
  root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement | null = null;
  private zoneEl: HTMLElement;
  private size = 176;
  /** world units shown across the map diameter */
  private zooms = [90, 150, 240];
  private zoomIdx = 0;
  private t = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'minimap';
    this.zoneEl = document.createElement('div');
    this.zoneEl.className = 'minimap-zone';
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = this.size * 2; // 2x for crisp rendering
    this.canvas.className = 'minimap-canvas';
    const ring = document.createElement('div');
    ring.className = 'minimap-ring';
    const n = document.createElement('div');
    n.className = 'minimap-n';
    n.textContent = 'N';
    this.root.append(this.zoneEl, this.canvas, ring, n);
    parent.appendChild(this.root);
    this.ctx = this.canvas.getContext('2d')!;
  }

  /** rasterize the terrain once from the mesh vertex colors */
  build(terrain: Terrain) {
    const geo = terrain.mesh.geometry as THREE.BufferGeometry;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const col = geo.attributes.color as THREE.BufferAttribute;
    const res = 240; // 2 world units per pixel
    const c = document.createElement('canvas');
    c.width = c.height = res;
    const g = c.getContext('2d')!;
    const img = g.createImageData(res, res);
    const d = img.data;
    const scale = res / WORLD_SIZE;
    // splat every vertex into the pixel it falls in; later vertices overwrite (fine for a map)
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), y = pos.getY(i);
      const px = Math.min(res - 1, Math.max(0, Math.floor((x + WORLD_HALF) * scale)));
      const pz = Math.min(res - 1, Math.max(0, Math.floor((z + WORLD_HALF) * scale)));
      const idx = (pz * res + px) * 4;
      // subtle height shading so plateaus and the crater read as relief
      const shade = 0.72 + Math.min(0.45, Math.max(0, y) / 60);
      const info = terrain.info(x, z);
      let r = col.getX(i) * shade, gg = col.getY(i) * shade, b = col.getZ(i) * shade;
      if (info.water > 0.5) { r = 0.25; gg = 0.55; b = 0.95; }
      d[idx] = Math.min(255, r * 255); d[idx + 1] = Math.min(255, gg * 255); d[idx + 2] = Math.min(255, b * 255); d[idx + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    // upscale with smoothing into the final base so the blit each frame is a single drawImage
    const base = document.createElement('canvas');
    base.width = base.height = WORLD_SIZE;
    const bg = base.getContext('2d')!;
    bg.imageSmoothingEnabled = true;
    bg.drawImage(c, 0, 0, WORLD_SIZE, WORLD_SIZE);
    this.base = base;
  }

  setVisible(v: boolean) { this.root.classList.toggle('visible', v); }
  cycleZoom() { this.zoomIdx = (this.zoomIdx + 1) % this.zooms.length; }

  update(s: MinimapState, dt: number) {
    this.t += dt;
    const ctx = this.ctx;
    const S = this.canvas.width, R = S / 2;
    ctx.clearRect(0, 0, S, S);
    if (this.zoneEl.textContent !== s.zone) this.zoneEl.textContent = s.zone;
    // rotate so the camera's forward points up
    const rot = -Math.PI / 2 - Math.atan2(s.camFz, s.camFx);
    const span = this.zooms[this.zoomIdx];
    const pxPerUnit = S / span;
    ctx.save();
    ctx.beginPath(); ctx.arc(R, R, R - 4, 0, Math.PI * 2); ctx.clip();
    // background so the map edge reads even at the world border
    ctx.fillStyle = '#0a1024';
    ctx.fillRect(0, 0, S, S);
    ctx.translate(R, R);
    ctx.rotate(rot);
    if (this.base) {
      ctx.imageSmoothingEnabled = true;
      // source window in base-canvas pixels (1px = 1 world unit)
      const half = span / 2 * 1.45; // overdraw so the rotated corners are covered
      const sx = s.x + WORLD_HALF - half, sz = s.z + WORLD_HALF - half;
      ctx.drawImage(this.base, sx, sz, half * 2, half * 2, -half * pxPerUnit, -half * pxPerUnit, half * 2 * pxPerUnit, half * 2 * pxPerUnit);
    }
    // blips
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 5);
    for (const b of s.blips) {
      const dx = (b.x - s.x) * pxPerUnit, dz = (b.z - s.z) * pxPerUnit;
      if (dx * dx + dz * dz > (R - 10) * (R - 10)) continue;
      ctx.save();
      ctx.translate(dx, dz);
      ctx.rotate(-rot); // keep glyphs upright
      switch (b.kind) {
        case 'enemy': this.dot(ctx, 5, '#ff5a6a', '#2a0a10'); break;
        case 'elite': this.diamond(ctx, 7, '#ff9a3c', '#2a1000'); break;
        case 'boss': this.diamond(ctx, 9 + pulse * 2, '#ff3a4a', '#fff'); break;
        case 'npc': this.dot(ctx, 5, '#7fdfff', '#0a2030'); break;
        case 'essence': this.dot(ctx, 4 + pulse * 2, '#c39bff', '#fff'); break;
        case 'landmark': this.landmark(ctx, b.label ?? ''); break;
        case 'quest': this.diamond(ctx, 8 + pulse * 2, '#ffd27f', '#fff'); break;
      }
      ctx.restore();
    }
    // objective marker: drawn inside the map or clamped to the rim with an arrow
    if (s.objective) {
      let dx = (s.objective.x - s.x) * pxPerUnit, dz = (s.objective.z - s.z) * pxPerUnit;
      const dist = Math.hypot(dx, dz), max = R - 16;
      const clamped = dist > max;
      if (clamped) { dx *= max / dist; dz *= max / dist; }
      ctx.save();
      ctx.translate(dx, dz);
      ctx.rotate(-rot);
      if (clamped) {
        // arrow pointing outward
        ctx.rotate(rot + Math.atan2(dz, dx));
        ctx.fillStyle = '#ffd27f';
        ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-4, -7); ctx.lineTo(-4, 7); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#3a2a00'; ctx.lineWidth = 1.5; ctx.stroke();
      } else this.diamond(ctx, 8 + pulse * 2, '#ffd27f', '#fff');
      ctx.restore();
    }
    // player arrow (facing)
    ctx.save();
    ctx.rotate(Math.atan2(Math.cos(s.playerYaw), Math.sin(s.playerYaw)));
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#1e2a5a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-8, -8); ctx.lineTo(-4, 0); ctx.lineTo(-8, 8); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    ctx.restore();
    // view cone (camera forward = up)
    ctx.save();
    ctx.translate(R, R);
    const grad = ctx.createLinearGradient(0, 0, 0, -R);
    grad.addColorStop(0, 'rgba(127,223,255,0.28)'); grad.addColorStop(1, 'rgba(127,223,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-R * 0.55, -R); ctx.lineTo(R * 0.55, -R); ctx.closePath(); ctx.fill();
    ctx.restore();
    // north indicator sits on the rim
    const nAng = rot; // world -z is north; angle of (0,-1) after rotation
    const nx = R + Math.cos(nAng - Math.PI / 2) * (R - 14), ny = R + Math.sin(nAng - Math.PI / 2) * (R - 14);
    this.root.style.setProperty('--nx', `${nx / 2}px`);
    this.root.style.setProperty('--ny', `${ny / 2}px`);
  }

  private dot(ctx: CanvasRenderingContext2D, r: number, fill: string, stroke: string) {
    ctx.fillStyle = fill; ctx.strokeStyle = stroke; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  private diamond(ctx: CanvasRenderingContext2D, r: number, fill: string, stroke: string) {
    ctx.fillStyle = fill; ctx.strokeStyle = stroke; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  private landmark(ctx: CanvasRenderingContext2D, label: string) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.strokeStyle = '#1e2a5a'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(5, 0); ctx.lineTo(0, 6); ctx.lineTo(-5, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    if (label) {
      ctx.font = '700 15px Nunito, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.strokeText(label, 0, -10);
      ctx.fillStyle = '#ffe3a3';
      ctx.fillText(label, 0, -10);
    }
  }
}
