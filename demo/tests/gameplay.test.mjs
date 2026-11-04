import { build } from 'esbuild';
import { strict as assert } from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Bundle production TypeScript; fake only signaling and the browser shell.
const temp = await mkdtemp(path.join(tmpdir(), 'tempest-test-'));
const entry = `export { DuelSession as Multiplayer } from './src/multiplayer/DuelSession'; export { Multiplayer as PublicMultiplayer } from './src/multiplayer/Multiplayer'; export { Progression } from './src/progression/Progression'; export { Combat } from './src/combat/Combat'; export * as THREE from 'three';`;
try {
 await build({ stdin:{contents:entry,resolveDir:process.cwd(),loader:'ts'}, bundle:true, platform:'node', format:'esm', outfile:path.join(temp,'game.mjs') });
 class Element {
  children=[]; textContent=''; className=''; classList={toggle(){}};
  appendChild(c){this.children.push(c);return c;}
  setAttribute(){} addEventListener(){} remove(){}
 }
 globalThis.document = Object.assign(new EventTarget(), { createElement:()=>new Element(), hidden:false });
 globalThis.window = new EventTarget();
 globalThis.location = { search:'',origin:'https://example.test',pathname:'/' };
 const {Progression, Multiplayer, PublicMultiplayer, Combat, THREE} = await import(path.join(temp,'game.mjs'));
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
   combat:{register(c){this.rival=c;},unregister(){},duelTarget:null},
   player:{terrain:{walkableHeightAt(){return 0;},walkableNormalAt(){return new THREE.Vector3(0,1,0);}},colliders:{blocked(){return false;}},radius:.45,pos,yaw:0,facing:new THREE.Vector3(),state:'idle',alive:true,target:null,
    spawn(v){this.pos.copy(v);this.alive=true;prog.hp=prog.maxHp;prog.mp=prog.maxMp;},
    takeHit(hit){prog.hp-=hit.damage;if(prog.hp<=0)g.net.defeated();return true;}}
  }; return g;
 };
 class Socket {
  open=true;handlers=new Map();other=null;
  on(n,f){const a=this.handlers.get(n)||[];a.push(f);this.handlers.set(n,a);return this;}
  emit(n,...v){for(const f of this.handlers.get(n)||[])f(...v);}
  send(p){queueMicrotask(()=>{if(this.other.open)this.other.emit('data',structuredClone(p));});}
  close(){if(!this.open)return;this.open=false;this.other.open=false;this.emit('close');this.other.emit('close');}
 }
 const connect=(a,b)=>{const x=new Socket(),y=new Socket();x.other=y;y.other=x;a.attachServer(x,true);b.attachServer(y,false);x.emit('open');y.emit('open');for(const s of [a,b]){const update=s.update.bind(s);s.update=dt=>{s.sendState();update(dt);};}};
 // Different saved positions must rendezvous and render before reporting synced.
 const host=makeGame(),guest=makeGame();
 host.player.pos.set(90,0,80); guest.player.pos.set(-100,0,-80);
 guest.prog.hp=43; guest.prog.mp=17;
 host.net=new Multiplayer(host); guest.net=new Multiplayer(guest);
 const settle=()=>new Promise(r=>setImmediate(r));
 connect(host.net,guest.net); await settle();
 assert(guest.net.meetFriend(false)); await settle();
 host.net.update(.1); guest.net.update(.1); await settle();
 host.net.update(.1); guest.net.update(.1); await settle();
 assert(guest.player.pos.distanceTo(host.player.pos)<8,'meeting moves guest near host instead of their distant save');
 assert.equal(guest.prog.hp,43); assert.equal(guest.prog.mp,17);
 assert(host.net.model.root.visible&&guest.net.model.root.visible,'both remote avatars visible');
 assert(host.net.model.root.position.distanceTo(guest.player.pos)<8);
 assert(host.net.status.includes('synced')); assert(guest.net.status.includes('beside'));
 guest.player.pos.set(-60,0,-50); guest.net.update(.1); await settle();
 assert(guest.player.pos.distanceTo(host.player.pos)>100,'ordinary state updates do not teleport players');
 assert(guest.net.meetFriend()); await settle();
 assert(guest.player.pos.distanceTo(host.player.pos)<8); assert.equal(guest.prog.hp,43);
 const before=guest.player.pos.clone(); guest.player.colliders.blocked=()=>true;
 assert.equal(guest.net.meetFriend(),false); assert(guest.player.pos.equals(before),'blocked meetup does not teleport');
 host.net.leave(); guest.net.leave();
 console.log('PASS: distant saves meet up, both avatars visible, resource preservation, manual meetup, unsafe placement refusal');
 const a=makeGame(),b=makeGame(); a.net=new Multiplayer(a); b.net=new Multiplayer(b);
 const flush=()=>new Promise(r=>setImmediate(r));
 connect(a.net,b.net); await flush();
 assert(a.net.connected&&b.net.connected); a.net.update(.1); b.net.update(.1); await flush();
 assert(a.net.friendPosition&&b.net.friendPosition);
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
 console.log('PASS: directed session, mutual consent, countdown, damage, malformed packets, victory, rematch, disconnect restoration');

 // Public world uses one shared server transport, automatic join, and distinct avatars.
 const links=new Map();let nextId=1;
 const sync=()=>{for(const l of links.values())l.onPlayers([...links.keys()].filter(id=>id!==l.id));};
 class Link {
   id=(nextId++).toString(16).padStart(32,'0');connected=false;
   onStatus=()=>{};onPlayers=()=>{};onPacket=()=>{};
   connect(){this.connected=true;links.set(this.id,this);queueMicrotask(()=>{this.onStatus(true,'Public world connected');sync();});}
   send(packet,to){for(const l of links.values())if(l!==this&&(!to||to===l.id))queueMicrotask(()=>{if(l.connected)l.onPacket(this.id,structuredClone(packet));});}
   close(){this.connected=false;links.delete(this.id);sync();}
 }
 const worlds=[makeGame(),makeGame(),makeGame()];
 for(const [i,g] of worlds.entries()){
   g.player.pos.set(i*90,0,-i*80);g.prog.hp=40+i;g.prog.mp=10+i;
   g.net=new PublicMultiplayer(g,new Element(),new Link());g.multiplayer=g.net;g.net.update(.2);
 }
 await flush();
 for(let i=0;i<3;i++){worlds.forEach(g=>g.net.update(.2));await flush();}
 for(const [i,g] of worlds.entries()){
   assert.equal(g.net.playerCount,3);assert.equal(g.net.friendPositions.length,2);
   assert.equal(g.prog.hp,40+i);assert.equal(g.prog.mp,10+i);
   for(const v of g.net.visitors.values())assert(v.session.model.root.visible);
   for(const h of worlds)assert(g.player.pos.distanceTo(h.player.pos)<18,'common multiplayer spawn');
   assert(!JSON.stringify(g.net.panel()).includes('CREATE ROOM'),'no room-code flow');
 }
 const [wa,wb,wc]=worlds;
 const idle=wa.net.visitors.get(wb.net.link.id);idle.seen=performance.now()-21000;wa.net.update(0);
 assert(!wa.net.visitors.has(wb.net.link.id),'stale avatar hidden');
 wb.net.update(.2);await flush();assert(wa.net.visitors.get(wb.net.link.id).session.friendPosition,'resuming tab returns without a new presence event');
 const ab=wa.net.visitors.get(wb.net.link.id).session;
 const ba=wb.net.visitors.get(wa.net.link.id).session;
 ab.challenge();await flush();assert(ba.incoming);
 ba.accept();await flush();assert(wa.net.dueling&&wb.net.dueling);assert(!wc.net.dueling);
 const ca=wc.net.visitors.get(wa.net.link.id).session;
 ca.challenge();await flush();assert(!ca.busy,'busy player declines additional challenge');
 const outsider=wc.net.visitors.get(wb.net.link.id).session;
 outsider.receive({t:'start',id:'unsolicited'});assert(!wc.net.dueling,'spectator cannot be forced into another duel');
 wb.net.leave();await flush();
 assert(!wa.net.dueling);assert.equal(wa.net.playerCount,2);assert.equal(wc.net.playerCount,2);
 assert(wa.net.connected&&wc.net.connected,'host leaving does not close public world');
 wb.net.update(.2);await flush();worlds.forEach(g=>g.net.update(.2));await flush();
 assert.equal(wa.net.playerCount,3);assert.equal(wb.net.friendPositions.length,2);
 worlds.forEach(g=>g.net.leave());
 console.log('PASS: automatic three-player public world, shared spawn, distinct avatars, directed duels, spectator isolation, departure and rejoin');
} finally { await rm(temp,{recursive:true,force:true}); }
