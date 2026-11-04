import * as THREE from 'three';
import type { Game } from '../core/Game';
import { type Combatant, type HitInfo, newId } from '../combat/Combat';
import { PlayerModel } from '../entities/PlayerModel';
import { LANDMARKS } from '../world/Terrain';

const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
const finite = (n: unknown, min: number, max: number): n is number => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
const vector = (v: unknown): v is number[] => Array.isArray(v) && v.length === 3 && v.every(n => finite(n, -2000, 2000));
export interface DuelConnection {
  open: boolean;
  send(packet: object): void;
  close(): void;
  on(event: string, fn: (...args: any[]) => void): unknown;
}

/** Per-player avatar and consensual duel state carried over the public server relay.
 * PvE is deliberately local: no fake shared monsters, XP, or quest completion.
 * The shared relay carries messages; clients still own their character state.
 */
export class DuelSession {
  private conn: DuelConnection | null = null;
  private host = false;
  status = 'Waiting for a player position…';
  private pending: 'incoming' | 'outgoing' | null = null;
  private requestId = '';
  private accepted = false;
  private round = '';
  private countdownEnd = 0;
  private endAt = 0;
  private lastReceived = 0;
  private saved: { pos: THREE.Vector3; hp: number; mp: number; cooldowns: number[] } | null = null;
  private target = new THREE.Vector3();
  private targetYaw = 0;
  private remoteReady = false;
  private hasSnapshot = false;
  private openedAt = 0;
  private syncWarned = false;
  private model = new PlayerModel();
  private rival: Combatant & { devourable: boolean };
  private badge: HTMLElement;
  private badgeText = '';
  private packetBudget = 0;
  private budgetAt = 0;
  private lastHitAt = 0;
  private timeout: ReturnType<typeof setTimeout> | undefined;
  onChange = () => {};

  constructor(private game: Game, label?: string) {
    this.model.bodyColor.set(0xc39bff);
    if (label) {
      const canvas = document.createElement('canvas');
      canvas.width = 256; canvas.height = 64;
      const ink = canvas.getContext?.('2d');
      if (ink) {
        ink.fillStyle = '#171328df'; ink.fillRect(8, 7, 240, 50);
        ink.fillStyle = '#e5d6ff'; ink.font = 'bold 25px sans-serif';
        ink.textAlign = 'center'; ink.fillText(label, 128, 41);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthWrite: false, toneMapped: false }));
        tag.position.y = 1.65; tag.scale.set(2.4, .6, 1);
        this.model.root.add(tag);
      }
    }
    this.model.root.visible = false;
    game.renderer.scene.add(this.model.root);
    this.rival = {
      id: newId(), name: 'Friend', team: 'player', pos: new THREE.Vector3(), radius: 0.45, height: 1,
      hp: 100, maxHp: 100, alive: true, targetable: false, root: this.model.root, devourable: false,
      takeHit: hit => {
        if (!this.fighting || hit.source !== game.player || !this.rival.alive) return false;
        this.send({ t: 'hit', round: this.round, damage: hit.damage, type: hit.type, element: hit.element,
          dir: hit.dir.toArray(), knockback: hit.knockback, launch: hit.launch, stagger: hit.stagger, skillId: hit.skillId });
        return true;
      },
    };
    game.combat.register(this.rival);
    this.badge = document.createElement('div'); this.badge.className = 'network-badge';

  }
  get friendPosition() { return this.connected && this.hasSnapshot ? this.rival.pos : null; }
  get connected() { return !!this.conn?.open; }
  get dueling() { return !!this.saved; }
  get fighting() { return this.dueling && performance.now() >= this.countdownEnd; }
  private get ready() {
    const g = this.game;
    return !(g.multiplayer?.busyFor?.(this)) && g.player.alive && (g.state === 'playing' || g.state === 'paused') && !g.dialogue.active;
  }
  private changed(s?: string) { if (s) this.status = s; this.onChange(); }
  private send(packet: object) { if (this.conn?.open) { try { this.conn.send(packet); } catch { this.leave('Connection lost. Reconnect to the public world.'); } } }

  get badgeLabel() { return this.badgeText; }
  get busy() { return this.dueling || !!this.pending; }
  get incoming() { return this.pending === 'incoming'; }
  get canChallenge() { return this.connected && this.hasSnapshot && this.ready && this.remoteReady && !this.busy; }
  get canMeet() { return this.connected && this.hasSnapshot && this.ready && this.remoteReady && !this.busy; }
  accept() {
    if (this.pending !== 'incoming' || !this.ready || this.accepted) return;
    this.accepted = true; this.send({t:'accept', id:this.requestId}); this.changed('Accepted · waiting for the arena.');
  }
  cancel() { if (!this.pending) return; this.send({t:'decline',id:this.requestId}); this.pending=null; this.changed('Challenge cancelled.'); }
  attachServer(c: DuelConnection, host: boolean) { this.host=host; this.attach(c); }
  destroy() {
    this.leave(); this.game.combat.unregister(this.rival); this.game.renderer.scene.remove(this.model.root);
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
    this.model.root.traverse(o => { if (o instanceof THREE.Sprite) { o.material.map?.dispose(); o.material.dispose(); } if (o instanceof THREE.Mesh) { geometries.add(o.geometry); for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m); } });
    geometries.forEach(g=>g.dispose()); materials.forEach(m=>m.dispose()); this.badge.remove();
  }
  private attach(c: DuelConnection) {
    this.conn = c;
    clearTimeout(this.timeout);
    this.timeout = setTimeout(() => { if (this.conn === c && !c.open) this.leave('Player connection timed out. Reconnect to the public world.'); }, 25000);
    c.on('open', () => {
      if (this.conn !== c) return;
      clearTimeout(this.timeout); this.lastReceived = this.openedAt = performance.now();
      this.syncWarned = false;
      this.sendState();
      this.changed('Connection open · waiting for your friend’s position…');
    });
    c.on('data', data => {
      if (this.conn !== c) return;
      const now = performance.now();
      if (now - this.budgetAt > 1000) { this.budgetAt = now; this.packetBudget = 0; }
      if (++this.packetBudget > 100) return;
      this.receive(data);
    });
    c.on('close', () => { if (this.conn === c) this.leave('Player left the public world.'); });
    c.on('error', () => { if (this.conn === c) this.leave('Public world connection interrupted. Reconnecting…'); });
  }
  private receive(data: unknown) {
    if (!data || typeof data !== 'object') return;
    const p = data as Record<string, any>;
    this.lastReceived = performance.now();
    switch (p.t) {
      case 'state': {
        if (!vector(p.pos) || !finite(p.yaw, -1000, 1000) || !finite(p.hp, 0, 1000000) || !finite(p.maxHp, 1, 1000000)) return;
        this.target.fromArray(p.pos); this.targetYaw = p.yaw;
        this.rival.hp = p.hp; this.rival.maxHp = p.maxHp; this.rival.alive = p.hp > 0;
        const wasReady = this.remoteReady, first = !this.hasSnapshot;
        this.remoteReady = p.ready === true;
        if (!this.hasSnapshot || this.rival.pos.distanceToSquared(this.target) > 400) this.rival.pos.copy(this.target);
        this.hasSnapshot = true;
        this.model.showBlade(p.attacking === true);
        this.model.root.position.copy(this.rival.pos);
        this.model.root.visible = this.game.state !== 'title';
        if (first || wasReady !== this.remoteReady || this.syncWarned) {
          this.syncWarned = false;
          this.changed('Friend synced · resume to explore together, or challenge them to a duel.');
        }
        break;
      }
      case 'challenge':
        if (!this.ready || this.dueling || this.pending || typeof p.id !== 'string' || p.id.length > 64) { this.send({ t: 'decline', id: p.id }); return; }
        this.pending = 'incoming'; this.accepted = false; this.requestId = p.id; this.changed('Your friend challenges you to a 1v1 duel. Open Multiplayer to accept.'); break;
      case 'decline':
        if (p.id === this.requestId) { this.pending = null; this.changed('Challenge declined or cancelled.'); } break;
      case 'accept':
        if (this.pending === 'outgoing' && p.id === this.requestId && this.ready && this.remoteReady) {
          this.send({ t: 'start', id: this.requestId }); this.begin(this.requestId);
        } break;
      case 'start':
        if (this.pending === 'incoming' && this.accepted && p.id === this.requestId && this.ready) this.begin(p.id);
        break;
      case 'hit': this.applyHit(p); break;
      case 'result':
        if (this.dueling && p.round === this.round && (p.winner === 'sender' || p.winner === 'receiver' || p.winner === 'draw')) this.finish(p.winner === 'draw' ? 'DRAW · TIME LIMIT' : p.winner === 'receiver' ? 'VICTORY' : 'DEFEAT');
        break;
    }
  }
  challenge() {
    if (!this.connected || !this.ready || !this.remoteReady || this.dueling || this.pending) return;
    this.requestId = randomId(); this.pending = 'outgoing';
    this.send({ t: 'challenge', id: this.requestId }); this.changed('Challenge sent · waiting for your friend.');
  }
  private begin(id: string) {
    const g = this.game, p = g.player;
    if (!this.ready || this.dueling) return;
    this.round = id; this.pending = null;
    this.saved = { pos: p.pos.clone(), hp: g.prog.hp, mp: g.prog.mp, cooldowns: [...g.prog.skills.values()].map(s => s.cooldown) };
    g.prog.allocationLocked = true;
    g.prepareDuel();
    // Discard lingering projectiles / delayed spell damage before entering the arena.
    g.skills.clear();
    const a = LANDMARKS.training;
    p.spawn(new THREE.Vector3(a.x + (this.host ? -4 : 4), 0, a.z));
    p.yaw = this.host ? Math.PI / 2 : -Math.PI / 2; p.facing.set(Math.sin(p.yaw), 0, Math.cos(p.yaw));
    for (const s of g.prog.skills.values()) s.cooldown = 0;
    p.target = null; g.gcam.lockTarget = null;
    this.rival.team = 'enemy'; this.rival.targetable = true;
    g.combat.duelTarget = this.rival.id;
    g.menus.show('none'); g.resume();
    this.countdownEnd = performance.now() + 3000; this.endAt = performance.now() + 123000;
    this.changed('Duel starting · 3 seconds.');
  }
  private applyHit(p: Record<string, any>) {
    if (!this.fighting || p.round !== this.round || !vector(p.dir) || !finite(p.damage, 0, 10000)) return;
    if (!['light', 'heavy', 'spell', 'ult'].includes(p.type) || !['physical', 'water', 'fire', 'wind', 'lightning', 'dark', 'meteor', 'light'].includes(p.element)) return;
    if (![p.knockback, p.launch, p.stagger].every(n => finite(n, 0, 100))) return;
    const now = performance.now();
    if (now - this.lastHitAt < 40) return;
    const g = this.game;
    const distance = g.player.pos.distanceTo(this.target);
    if (distance > (p.type === 'light' || p.type === 'heavy' ? 9 : 95)) return;
    this.lastHitAt = now;
    g.player.takeHit({ damage: p.damage, type: p.type, element: p.element, source: this.rival,
      dir: new THREE.Vector3().fromArray(p.dir).normalize(), point: g.player.pos.clone(),
      knockback: Math.min(10, p.knockback), launch: Math.min(12, p.launch), stagger: Math.min(0.5, p.stagger), crit: false, hitstop: 0.025 });
    // onDeath resolves a lethal hit without touching story progression.
  }
  defeated() {
    if (!this.dueling) return;
    this.send({ t: 'result', round: this.round, winner: 'receiver' }); this.finish('DEFEAT');
  }
  forfeit() {
    if (!this.dueling) return;
    this.send({ t: 'result', round: this.round, winner: 'receiver' }); this.finish('DUEL ENDED · YOU FORFEITED');
  }
  private finish(text: string) {
    const saved = this.saved; if (!saved) return;
    const g = this.game;
    this.saved = null; this.round = ''; g.prog.allocationLocked = false;
    g.combat.duelTarget = null; this.rival.team = 'player'; this.rival.targetable = false;
    g.skills.clear(); g.player.spawn(saved.pos); g.prog.hp = saved.hp; g.prog.mp = saved.mp;
    [...g.prog.skills.values()].forEach((s, i) => s.cooldown = saved.cooldowns[i] ?? 0);
    g.player.target = null; g.gcam.lockTarget = null;
    this.changed(text + ' · Your adventure position and resources were restored.');
    g.notes.say(text);
  }
  leave(message = 'Player disconnected.') {
    clearTimeout(this.timeout);
    if (this.dueling) this.finish('DUEL CANCELLED');
    const c = this.conn; this.conn = null;
    c?.close();
    this.pending = null; this.remoteReady = false; this.hasSnapshot = false;
    this.syncWarned = false;
    this.model.root.visible = false; this.changed(message);
  }
  private sendState() {
    const g = this.game;
    this.send({ t: 'state', pos: g.player.pos.toArray(), yaw: g.player.yaw, hp: Math.max(0, g.prog.hp), maxHp: g.prog.maxHp, ready: this.ready, attacking: ['attack', 'heavy', 'cast'].includes(g.player.state) });
  }
  /** Only move the local player; preserve their adventure resources. */
  meetFriend(resume = true) {
    if (!this.connected || !this.hasSnapshot || !this.remoteReady || !this.ready || this.dueling || this.pending) return false;
    const g = this.game, p = g.player;
    let spot: THREE.Vector3 | null = null;
    for (const radius of [3, 5, 7]) {
      for (let i = 0; i < 12; i++) {
        const angle = this.targetYaw + Math.PI + i * Math.PI / 6;
        const x = this.target.x + Math.sin(angle) * radius, z = this.target.z + Math.cos(angle) * radius;
        const y = p.terrain.walkableHeightAt(x, z);
        if (Math.abs(x) > 230 || Math.abs(z) > 230 || Math.abs(y - this.target.y) > 3 || p.terrain.walkableNormalAt(x, z).y < 0.7 || p.colliders.blocked(x, z, p.radius + 0.25)) continue;
        spot = new THREE.Vector3(x, y, z); break;
      }
      if (spot) break;
    }
    if (!spot) { this.changed('No safe spot beside your friend. Ask them to move onto open ground, then try GO TO FRIEND.'); return false; }
    const hp = g.prog.hp, mp = g.prog.mp;
    p.spawn(spot); g.prog.hp = hp; g.prog.mp = mp;
    p.yaw = Math.atan2(this.target.x - spot.x, this.target.z - spot.z);
    p.facing.set(Math.sin(p.yaw), 0, Math.cos(p.yaw));
    p.target = null; g.gcam.lockTarget = null;
    this.sendState();
    this.changed('You are beside your friend. Look for the purple slime.');
    if (resume) { g.menus.show('none'); g.resume(); }
    return true;
  }
  update(dt: number) {
    const g = this.game, now = performance.now();
    if (this.connected) {
      if (!this.hasSnapshot && !this.syncWarned && now - this.openedAt > 5000) {
        this.syncWarned = true;
        this.changed('Connection opened but no player position arrived. Keep both games active; leave and rejoin if this persists.');
      }
      if (now - this.lastReceived > 20000) { this.leave('Friend stopped responding. Rejoin when both tabs are active.'); return; }
      this.model.root.visible = this.hasSnapshot && g.state !== 'title';
      this.rival.pos.lerp(this.target, 1 - Math.exp(-16 * dt));
      this.model.root.position.copy(this.rival.pos); this.model.root.rotation.y = this.targetYaw;
      this.model.update(dt, now / 1000);
      if (this.dueling) {
        const center = LANDMARKS.training;
        if (g.player.pos.distanceTo(center) > 32) { this.forfeit(); return; }
        if (now > this.endAt) { this.send({ t: 'result', round: this.round, winner: 'draw' }); this.finish('DRAW · TIME LIMIT'); }
      }
    }
    const text = this.dueling ? now < this.countdownEnd ? `DUEL · ${Math.ceil((this.countdownEnd - now) / 1000)}` : `1v1 · ${Math.ceil((this.endAt - now) / 1000)}s · FRIEND ${Math.ceil(this.rival.hp)}/${this.rival.maxHp} HP`
      : this.pending === 'incoming' ? 'DUEL INVITE · PAUSE → MULTIPLAYER' : this.connected ? this.hasSnapshot ? `FRIEND · ${Math.round(g.player.pos.distanceTo(this.target))}m · PAUSE → MULTIPLAYER` : 'SYNCING FRIEND…' : '';
    if (text !== this.badgeText) { this.badgeText = text; this.badge.textContent = text; this.badge.classList.toggle('visible', !!text); }
  }
}
