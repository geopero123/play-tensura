// Opt-in integration check: real server sockets, production gameplay, no WebGL dependency.
import { build } from 'esbuild';
import { strict as assert } from 'node:assert';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const temp=await mkdtemp(path.join(tmpdir(),'tempest-live-'));
const worlds=[];
let timer;
try {
 await build({stdin:{contents:`export {Multiplayer} from './src/multiplayer/Multiplayer';export {WorldTransport} from './src/multiplayer/WorldTransport';export {Progression} from './src/progression/Progression';export * as THREE from 'three';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',outfile:path.join(temp,'live.mjs')});
 class Element {children=[];textContent='';className='';classList={toggle(){}};appendChild(c){this.children.push(c);return c;}setAttribute(){}addEventListener(){}remove(){}}
 globalThis.document=Object.assign(new EventTarget(),{createElement:()=>new Element(),hidden:false});globalThis.window=new EventTarget();
 const {Multiplayer,WorldTransport,Progression,THREE}=await import(path.join(temp,'live.mjs'));
 const topic='tempest-qa-'+crypto.randomUUID();
 for(let i=0;i<3;i++){
  const prog=new Progression();
  const g={prog,state:'playing',dialogue:{active:false},renderer:{scene:new THREE.Scene()},skills:{clear(){}},gcam:{lockTarget:null},notes:{say(){}},prepareDuel(){},menus:{show(){}},resume(){this.state='playing';},combat:{register(){},unregister(){},duelTarget:null},player:{pos:new THREE.Vector3(i*60,0,i*80),yaw:0,facing:new THREE.Vector3(),state:'idle',alive:true,target:null,radius:.45,terrain:{walkableHeightAt(){return 0;},walkableNormalAt(){return new THREE.Vector3(0,1,0);}},colliders:{blocked(){return false;}},spawn(v){this.pos.copy(v);prog.hp=prog.maxHp;prog.mp=prog.maxMp;},takeHit(hit){prog.hp-=hit.damage;return true;}}};
  g.net=new Multiplayer(g,new Element(),new WorldTransport(topic));g.multiplayer=g.net;worlds.push(g);
 }
 timer=setInterval(()=>worlds.forEach(g=>g.net.update(.05)),50);
 const until=async(check,label,ms=18000)=>{const end=Date.now()+ms;while(!check()){if(Date.now()>end)throw Error('Timeout: '+label);await new Promise(r=>setTimeout(r,100));}};
 await until(()=>worlds.every(g=>g.net.playerCount===3&&g.net.friendPositions.length===2),'three real clients see two avatars each');
 for(const g of worlds)for(const v of g.net.visitors.values())assert(v.session.model.root.visible);
 console.log('PASS live: three automatic server connections and six remote avatars');
 const [a,b,c]=worlds;
 a.player.pos.x+=10;
 await until(()=>b.net.friendPositions.some(p=>Math.abs(p.x-a.player.pos.x)<.5),'movement propagation');
 const ab=a.net.visitors.get(b.net.link.id).session,ba=b.net.visitors.get(a.net.link.id).session;
 await until(()=>ab.canChallenge,'readiness');ab.challenge();await until(()=>ba.incoming,'directed challenge');ba.accept();
 await until(()=>a.net.dueling&&b.net.dueling,'duel acceptance');assert(!c.net.dueling);
 console.log('PASS live: movement, directed duel acceptance, spectator isolation');
 b.state='title';b.net.leave();
 await until(()=>a.net.playerCount===2&&c.net.playerCount===2&&!a.net.dueling,'disconnect cleanup');
 b.state='playing';b.net.update(.1);
 await until(()=>worlds.every(g=>g.net.playerCount===3&&g.net.friendPositions.length===2),'rejoin');
 console.log('PASS live: departing player removed, duel restored, remaining world stays online, rejoin');
} finally {clearInterval(timer);worlds.forEach(g=>g.net.leave());await rm(temp,{recursive:true,force:true});}
