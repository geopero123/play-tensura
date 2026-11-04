import * as THREE from 'three';
import type { Game } from '../core/Game';
import { DuelSession } from './DuelSession';
import { WorldTransport, type WorldLink } from './WorldTransport';
import { LANDMARKS } from '../world/Terrain';

// Each remote player has an independent avatar and a directed duel connection.
// All positions travel once through the shared server, rather than a peer mesh.
class ServerConnection {
  open = true;
  private handlers = new Map<string, ((...args: any[]) => void)[]>();
  constructor(private link: WorldLink, readonly id: string) {}
  on(event: string, fn: (...args: any[]) => void) { const list = this.handlers.get(event) ?? []; list.push(fn); this.handlers.set(event, list); return this; }
  emit(event: string, ...args: any[]) { for (const fn of this.handlers.get(event) ?? []) fn(...args); }
  send(packet: object) { if (this.open) this.link.send(packet, this.id); }
  close() { if (!this.open) return; this.open = false; this.emit('close'); }
}
interface Visitor { session: DuelSession; connection: ServerConnection; seen: number; budget: number; budgetAt: number }
export class Multiplayer {
  private roster = new Set<string>();
  private visitors = new Map<string, Visitor>();
  private started = false;
  private online = false;
  private joiningPlaced = false;
  private selected = '';
  private sendT = 0;
  private badge: HTMLElement;
  private badgeText = '';
  status = 'Joining public world automatically when your adventure starts.';
  onChange = () => {};
  constructor(private game: Game, private root: HTMLElement, private link: WorldLink = new WorldTransport()) {
    this.badge = document.createElement('div'); this.badge.className = 'network-badge'; root.appendChild(this.badge);
    link.onStatus = (online, message) => {
      this.online = online; this.status = message;
      if (!online) this.clearVisitors();
      else { this.placeAtLobby(); this.sendState(); }
      this.onChange();
    };
    link.onPlayers = ids => this.syncPlayers(ids);
    link.onPacket = (id, packet) => {
      if (!this.visitors.has(id) && this.online && this.roster.has(id)) this.syncPlayers([...this.roster]);
      const visitor = this.visitors.get(id);
      if (!visitor || !packet || typeof packet !== 'object') return;
      const now = performance.now();
      if (now - visitor.budgetAt > 1000) { visitor.budget = 0; visitor.budgetAt = now; }
      if (++visitor.budget > 40) return;
      visitor.seen = now; visitor.connection.emit('data', packet);
    };
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.forfeit(); });
    window.addEventListener('pagehide', () => this.leave());
    window.addEventListener('pageshow', () => { if (this.game.state !== 'title' && !this.started) this.start(); });
  }
  get connected() { return this.online; }
  get playerCount() { return this.online ? this.visitors.size + 1 : 0; }
  get friendPositions() { return [...this.visitors.values()].map(v=>v.session.friendPosition).filter((p): p is THREE.Vector3 => !!p); }
  get friendPosition() { return this.friendPositions[0] ?? null; }
  private get active() { return [...this.visitors.values()].find(v=>v.session.busy)?.session; }
  get dueling() { return [...this.visitors.values()].some(v=>v.session.dueling); }
  get fighting() { return this.active?.fighting ?? false; }
  busyFor(session: DuelSession) { return [...this.visitors.values()].some(v=>v.session !== session && v.session.busy); }
  forfeit() { this.active?.forfeit(); }
  defeated() { this.active?.defeated(); }
  private start() { if (this.started) return; this.started = true; this.link.connect(); }
  private syncPlayers(ids: string[]) {
    if (!this.started) return;
    const present = new Set(ids.filter(id=>id!==this.link.id));
    this.roster = present;
    for (const [id, v] of this.visitors) if (!present.has(id)) { this.visitors.delete(id); v.session.destroy(); }
    for (const id of present) {
      if (this.visitors.has(id) || this.visitors.size >= 31) continue;
      const session = new DuelSession(this.game), connection = new ServerConnection(this.link, id);
      const visitor = {session, connection, seen:performance.now(), budget:0, budgetAt:0};
      this.visitors.set(id, visitor);
      session.onChange = () => { if (session.busy) this.selected=id; this.onChange(); };
      session.attachServer(connection, this.link.id < id);
      connection.emit('open');
    }
    this.sendState(); this.onChange();
  }
  private clearVisitors() {
    const old = [...this.visitors.values()]; this.visitors.clear(); this.roster.clear();
    for (const v of old) v.session.destroy();
  }
  leave() {
    this.started = false; this.online = false; this.joiningPlaced = false;
    this.link.close(); this.clearVisitors(); this.selected=''; this.sendT=0;
    this.status='Public world disconnected.'; this.badge.classList.toggle('visible', false); this.onChange();
  }
  private placeAtLobby() {
    const g = this.game, p = g.player;
    if (this.joiningPlaced || !p.alive || g.dialogue.active || !['playing','paused'].includes(g.state)) return;
    // Everyone starts in the same open clearing. Use a stable per-visitor offset.
    const center = LANDMARKS.training;
    const seed = parseInt(this.link.id.slice(0, 4), 16);
    for (let i=0;i<24;i++) {
      const angle = seed / 65536 * Math.PI * 2 + i * Math.PI / 6;
      const r = 5 + Math.floor(i / 12) * 3;
      const x=center.x+Math.sin(angle)*r,z=center.z+Math.cos(angle)*r,y=p.terrain.walkableHeightAt(x,z);
      if (p.colliders.blocked(x,z,p.radius+.25) || p.terrain.walkableNormalAt(x,z).y<.7) continue;
      const hp=g.prog.hp,mp=g.prog.mp; p.spawn(new THREE.Vector3(x,y,z)); g.prog.hp=hp;g.prog.mp=mp;
      p.target=null;g.gcam.lockTarget=null; this.joiningPlaced=true; return;
    }
    this.joiningPlaced=true; // no safe candidate: keep the saved position and offer GO TO PLAYER.
  }
  private sendState() {
    const g=this.game;
    if (!this.online) return;
    this.link.send({ t:'state',pos:g.player.pos.toArray(),yaw:g.player.yaw,hp:Math.max(0,g.prog.hp),maxHp:g.prog.maxHp,
      ready:g.player.alive && ['playing','paused'].includes(g.state) && !g.dialogue.active,
      attacking:['attack','heavy','cast'].includes(g.player.state) });
  }
  update(dt: number) {
    const g=this.game;
    if (['playing','paused'].includes(g.state)) this.start();
    if (!this.started) return;
    if (this.online) {
      this.placeAtLobby(); this.sendT+=dt;
      if(this.sendT>=.125){this.sendT=0;this.sendState();}
    }
    for(const [id,v] of this.visitors){
      // Backgrounded clients stop sending; do not leave frozen avatars in the world.
      if(performance.now()-v.seen>20000){this.visitors.delete(id);v.session.destroy();this.onChange();continue;}
      v.session.update(dt);
    }
    const active=this.active;
    const text = active?.dueling ? active.badgeLabel : active?.incoming ? 'DUEL INVITE · PAUSE → MULTIPLAYER' : this.online ? `PUBLIC WORLD · ${this.playerCount} ONLINE` : 'PUBLIC WORLD · CONNECTING…';
    if(text!==this.badgeText){this.badgeText=text;this.badge.textContent=text;this.badge.classList.toggle('visible',true);}
  }
  panel() {
    const body=document.createElement('div');body.className='room-panel';
    const note=(text:string)=>{const p=document.createElement('p');p.className='hint-row';p.textContent=text;body.appendChild(p);};
    const button=(label:string,fn:()=>void,disabled=false)=>{const b=document.createElement('button');b.className='room-button';b.textContent=label;b.disabled=disabled;b.onclick=fn;body.appendChild(b);};
    note(this.status);note(this.online?`${this.playerCount} player${this.playerCount===1?'':'s'} online · Public world`:'Connecting automatically…');
    if(!this.online) button('RECONNECT',()=>{this.leave();this.start();});
    if(this.online&&!this.visitors.size) note('You are the first player here. Others will appear automatically when they start the demo.');
    for(const [id,v] of this.visitors){
      const s=v.session, pos=s.friendPosition;
      note(`Player ${id.slice(0,4).toUpperCase()}${pos?' · '+Math.round(gap(this.game.player.pos,pos))+'m away':' · syncing…'}`);
      button('GO TO PLAYER',()=>{this.selected=id;s.meetFriend();},!s.canMeet||!!this.active);
      button(s.busy?'CHALLENGE PENDING…':'CHALLENGE TO 1v1',()=>{this.selected=id;s.challenge();},!s.canChallenge||!!this.active);
    }
    const selected=this.active??this.visitors.get(this.selected)?.session;
    if(selected){note(selected.status);if(selected.incoming)button('ACCEPT 1v1 DUEL',()=>selected.accept());if(selected.busy&&!selected.dueling)button('CANCEL CHALLENGE',()=>selected.cancel());}
    note('Everyone joins automatically. Purple slimes and minimap diamonds are other players. Enemies and quests are local; 1v1 requires acceptance. Pausing or switching apps during a duel forfeits.');
    return body;
  }
}
const gap=(a:THREE.Vector3,b:THREE.Vector3)=>a.distanceTo(b);
