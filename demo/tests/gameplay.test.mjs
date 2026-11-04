import { build } from 'esbuild';
import { strict as assert } from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Bundle production TypeScript; fake only signaling and the browser shell.
const temp = await mkdtemp(path.join(tmpdir(), 'tempest-test-'));
const signaling = `
const peers = new Map(); let id = 0;
class Events {
 handlers = new Map();
 on(n,f) { const a=this.handlers.get(n)||[]; a.push(f); this.handlers.set(n,a); return this; }
 emit(n,...v) { for(const f of this.handlers.get(n)||[]) f(...v); }
}
class Connection extends Events {
 open=false;
 send(p) { queueMicrotask(()=>this.other.emit('data',structuredClone(p))); }
 close() { if(!this.open) return; this.open=false; this.other.open=false; this.emit('close'); this.other.emit('close'); }
}
export default class Peer extends Events {
 constructor(name) { super(); this.id=name||'peer-'+(++id); peers.set(this.id,this); queueMicrotask(()=>this.emit('open',this.id)); }
 connect(name) { const a=new Connection(), b=new Connection(); a.other=b; b.other=a;
 queueMicrotask(()=>{ const dest=peers.get(name); if(!dest) return this.emit('error',{type:'peer-unavailable'}); dest.emit('connection',b); a.open=b.open=true; b.emit('open'); a.emit('open'); }); return a; }
 destroy() { peers.delete(this.id); }
}`;
const entry = `export { Multiplayer } from './src/multiplayer/Multiplayer'; export { Progression } from './src/progression/Progression'; export { Combat } from './src/combat/Combat'; export * as THREE from 'three';`;
try {
 await build({ stdin:{contents:entry,resolveDir:process.cwd(),loader:'ts'}, bundle:true, platform:'node', format:'esm', outfile:path.join(temp,'game.mjs'), plugins:[{name:'mock-signaling',setup(b){ b.onResolve({filter:/^peerjs$/},()=>({path:'peerjs',namespace:'fake'})); b.onLoad({filter:/.*/,namespace:'fake'},()=>({contents:signaling,loader:'js'})); }}] });
 class Element {
  children=[]; textContent=''; className=''; classList={toggle(){}};
  appendChild(c){this.children.push(c);return c;}
  setAttribute(){} addEventListener(){}
 }
 globalThis.document = Object.assign(new EventTarget(), { createElement:()=>new Element(), hidden:false });
 globalThis.window = new EventTarget();
 globalThis.location = { search:'',origin:'https://example.test',pathname:'/' };
 const {Progression, Multiplayer, Combat, THREE} = await import(path.join(temp,'game.mjs'));
 const p = new Progression();
 assert.equal(p.statPoints,5); assert.equal(p.maxHp,100);
 p.allocate('vitality'); assert.equal(p.maxHp,112); assert.equal(p.hp,100);
 p.allocate('strength'); assert.equal(p.atk,11.5); assert.equal(p.magicAtk,10);
 p.allocate('intelligence'); assert.equal(p.magicAtk,11.5);
 p.allocate('spirit'); assert.equal(p.maxMp,68); assert.equal(p.mpRegen,3.15);
 p.allocate('agility'); assert.equal(p.statPoints,0); assert.equal(p.allocate('defense'),false);
 p.addXp(p.xpToNext); assert.equal(p.statPoints,3);
 p.resetAttributes(); assert.equal(p.statPoints,8); assert.equal(p.maxHp,114);
 p.allocationLocked=true; assert.equal(p.allocate('strength'),false); p.resetAttributes(); assert.equal(p.attributes.strength,0);
 p.allocationLocked=false; p.attributes.defense=100; assert.equal(p.def,0.6);
 console.log('PASS: attributes, point budget, level rewards, resource caps, duel lock, defense cap');
 const makeGame=()=>{
  const prog=new Progression(), pos=new THREE.Vector3(0,0,4);
  const g={prog,state:'paused',dialogue:{active:false},renderer:{scene:new THREE.Scene()},
   skills:{clear(){}},gcam:{lockTarget:null},notes:{say(){}},prepareDuel(){},
   menus:{show(){}},resume(){this.state='playing';},
   combat:{register(c){this.rival=c;},duelTarget:null},
   player:{terrain:{walkableHeightAt(){return 0;},walkableNormalAt(){return new THREE.Vector3(0,1,0);}},colliders:{blocked(){return false;}},radius:.45,pos,yaw:0,facing:new THREE.Vector3(),state:'idle',alive:true,target:null,
    spawn(v){this.pos.copy(v);this.alive=true;prog.hp=prog.maxHp;prog.mp=prog.maxMp;},
    takeHit(hit){prog.hp-=hit.damage;if(prog.hp<=0)g.net.defeated();return true;}}
  }; return g;
 };
 // Different saved positions must rendezvous and render before reporting synced.
 const host=makeGame(),guest=makeGame();
 host.player.pos.set(90,0,80); guest.player.pos.set(-100,0,-80);
 guest.prog.hp=43; guest.prog.mp=17;
 host.net=new Multiplayer(host,new Element()); guest.net=new Multiplayer(guest,new Element());
 const settle=()=>new Promise(r=>setImmediate(r));
 await host.net.open(); await settle(); await guest.net.open(host.net.code); await settle();
 host.net.update(.1); guest.net.update(.1); await settle();
 host.net.update(.1); guest.net.update(.1); await settle();
 assert(guest.player.pos.distanceTo(host.player.pos)<8,'guest joins near host instead of their distant save');
 assert.equal(guest.prog.hp,43); assert.equal(guest.prog.mp,17);
 assert(host.net.model.root.visible&&guest.net.model.root.visible,'both remote avatars visible');
 assert(host.net.model.root.position.distanceTo(guest.player.pos)<8);
 assert(host.net.status.includes('synced')); assert(guest.net.status.includes('synced'));
 guest.player.pos.set(-60,0,-50); guest.net.update(.1); await settle();
 assert(guest.player.pos.distanceTo(host.player.pos)>100,'automatic meetup happens only once');
 assert(guest.net.meetFriend()); await settle();
 assert(guest.player.pos.distanceTo(host.player.pos)<8); assert.equal(guest.prog.hp,43);
 const before=guest.player.pos.clone(); guest.player.colliders.blocked=()=>true;
 assert.equal(guest.net.meetFriend(),false); assert(guest.player.pos.equals(before),'blocked meetup does not teleport');
 host.net.leave(); guest.net.leave();
 console.log('PASS: distant saves meet up, both avatars visible, resource preservation, manual meetup, unsafe placement refusal');
 const a=makeGame(),b=makeGame(); a.net=new Multiplayer(a,new Element()); b.net=new Multiplayer(b,new Element());
 const flush=()=>new Promise(r=>setImmediate(r));
 await a.net.open(); await flush(); await b.net.open(a.net.code); await flush();
 assert(a.net.connected&&b.net.connected); a.net.update(.1); b.net.update(.1); await flush();
 assert(a.net.friendPosition&&b.net.friendPosition);
 // Room capacity: a third peer must not replace either connected player.
 const c=makeGame(); c.net=new Multiplayer(c,new Element()); await c.net.open(a.net.code); await flush();
 assert(!c.net.connected); assert(a.net.connected&&b.net.connected); c.net.leave();
 const bAdventure=b.player.pos.clone();
 a.net.challenge(); await flush(); assert.equal(b.net.pending,'incoming');
 // An unsolicited start cannot force a duel before the accept button was pressed.
 b.net.receive({t:'start',id:b.net.requestId}); assert.equal(b.net.dueling,false);
 b.net.accepted=true; b.net.send({t:'accept',id:b.net.requestId}); await flush();
 assert(a.net.dueling&&b.net.dueling); assert(a.prog.allocationLocked); assert.equal(a.combat.duelTarget,a.combat.rival.id);
 assert.equal(a.net.fighting,false); a.net.countdownEnd=0; b.net.countdownEnd=0;
 a.net.update(.1); b.net.update(.1); await flush();
 b.net.lastHitAt=-1000;
 a.combat.rival.takeHit({source:a.player,damage:20,type:'light',element:'physical',dir:new THREE.Vector3(1,0,0),knockback:2,launch:0,stagger:.2});
 await flush(); assert.equal(b.prog.hp,80);
 b.net.lastHitAt=-1000; b.net.receive({t:'hit',round:b.net.round,damage:Infinity,dir:[1,0,0]}); assert.equal(b.prog.hp,80);
 b.net.lastHitAt=-1000;
 a.combat.rival.takeHit({source:a.player,damage:100,type:'heavy',element:'physical',dir:new THREE.Vector3(1,0,0),knockback:2,launch:0,stagger:.2});
 await flush(); assert(!a.net.dueling&&!b.net.dueling); assert.equal(b.prog.hp,100); assert(b.player.pos.equals(bAdventure)); assert.equal(b.combat.duelTarget,null);
 a.net.update(.1); b.net.update(.1); await flush();
 a.net.challenge(); await flush(); b.net.accepted=true; b.net.send({t:'accept',id:b.net.requestId}); await flush();
 assert(a.net.dueling&&b.net.dueling); b.net.leave(); await flush();
 assert(!a.net.dueling&&!a.net.connected); assert.equal(a.player.pos.z,4); assert(!a.prog.allocationLocked);
 console.log('PASS: two-peer room, third-player rejection, mutual consent, countdown, damage, malformed packets, victory, rematch, disconnect restoration');
} finally { await rm(temp,{recursive:true,force:true}); }
