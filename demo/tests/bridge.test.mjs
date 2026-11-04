import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const temp=await mkdtemp(path.join(tmpdir(),'tempest-bridge-'));
try {
 const outfile=path.join(temp,'world.mjs');
 await build({stdin:{contents:"export {Terrain,Colliders,riverX} from './src/world/Terrain';export {Props} from './src/world/Props';export {Player} from './src/entities/Player';export * as THREE from 'three';",resolveDir:process.cwd(),loader:'ts'},outfile,bundle:true,platform:'node',format:'esm'});
 const {Terrain,Colliders,riverX,Props,Player,THREE}=await import(outfile);
 const terrain=new Terrain(),colliders=new Colliders();
 const props=new Props(terrain,colliders),bridge=terrain.bridge;
 assert(bridge);assert(Math.abs(bridge.x-riverX(bridge.z))<1e-7);
 assert(Math.abs(bridge.z-(-14-(bridge.x-30)*14/30))<1e-7);
 const end=bridge.halfLength+bridge.rampLength;
 for(const sign of [-1,1]) for(const v of [-1.8,0,1.8]){
  const p=bridge.worldPoint(sign*end,v);
  assert(Math.abs(bridge.localHeight(sign*end,v)-terrain.heightAt(p.x,p.z))<1e-8);
 }
 for(let u=-end+.2;u<end-.2;u+=.2){const p=bridge.worldPoint(u);assert(terrain.walkableHeightAt(p.x,p.z)>=bridge.localHeight(u)-1e-8);assert(terrain.walkableNormalAt(p.x,p.z).y>.62,'bridge must be walkable without slope sliding');}
 const middle=bridge.worldPoint(0);assert(terrain.walkableHeightAt(middle.x,middle.z)>terrain.heightAt(middle.x,middle.z)+.5,'riverbed and bridge must be separate surfaces');
 const group=props.group.getObjectByName('river-bridge');assert(group?.getObjectByName('bridge-walking-deck'));
 group.updateMatrixWorld(true);const local=bridge.localPoint(middle.x,middle.z);assert(Math.abs(local.u)+Math.abs(local.v)<1e-8);
 function body(u){const p=Object.create(Player.prototype);const w=bridge.worldPoint(u);Object.assign(p,{pos:new THREE.Vector3(w.x,terrain.walkableHeightAt(w.x,w.z),w.z),vel:new THREE.Vector3(),terrain,colliders,root:new THREE.Group(),tmp:new THREE.Vector3(),radius:.45,grounded:true,state:'move',stateT:0,coyote:0,land(){}});return p;}
 for(const sign of [-1,1]){
  const player=body(-sign*(end+1));const dir=bridge.worldPoint(sign);player.vel.set((dir.x-bridge.x)*7.2,0,(dir.z-bridge.z)*7.2);
  for(let frame=0;frame<340;frame++){
   const before=player.pos.y;player.applyPhysics(1/60,0);const p=bridge.localPoint(player.pos.x,player.pos.z);
   if(Math.abs(p.u)<end-.2){assert(player.pos.y>=bridge.localHeight(p.u,p.v)-.03,'player sank below bridge');assert(Math.abs(player.pos.y-before)<.3,'unexpected height jump while crossing');}
  }
  assert(sign*bridge.localPoint(player.pos.x,player.pos.z).u>end,'crossing should reach opposite bank');
 }
 const falling=body(0);falling.pos.y+=3;falling.vel.y=-8;falling.grounded=false;
 for(let i=0;i<90&&!falling.grounded;i++)falling.applyPhysics(1/60,0);
 assert(falling.grounded);assert(Math.abs(falling.pos.y-bridge.localHeight(0))<.02);
 for(const sign of [-1,1]){const p=bridge.worldPoint(0,sign*1.65);const pos=new THREE.Vector3(p.x,bridge.localHeight(0),p.z);colliders.resolve(pos,.45,pos.y+.5);assert(Math.abs(bridge.localPoint(pos.x,pos.z).v)<1.4,'rail should stop walking off the side');}
 const ruins={x:108,z:-42};
 for(const [x,z,height] of [[ruins.x+5,ruins.z,1],[ruins.x,ruins.z,2.4]]){
   const player=body(0);player.pos.set(x,terrain.heightAt(ruins.x,ruins.z)+8,z);
   player.vel.set(0,-3,0);player.grounded=false;
   for(let i=0;i<180&&!player.grounded;i++)player.applyPhysics(1/60,0);
   assert(player.grounded);assert(Math.abs(player.pos.y-terrain.heightAt(ruins.x,ruins.z)-height)<.02,'ruins surface should support player');
 }
 console.log('PASS: ruins platform and altar jump landing');
 console.log('PASS: bridge/path alignment, connected bank ramps, separate riverbed, walkable slopes, crossing both ways with real player physics, jump landing, rail collision');
}finally{await rm(temp,{recursive:true,force:true});}
