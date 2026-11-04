import * as THREE from 'three';
import type { PlayerModel } from './PlayerModel';
export const SKIN_COLORS = [0x86d3ff,0xc39bff,0xffb3c7,0x90e3b2,0xffd787] as const;
export const ACCESSORIES = ['None','Halo','Horns'] as const;
const applied = new WeakMap<PlayerModel,string>();
export function dress(model:PlayerModel, skin:number, accessory:number) {
  skin=Number.isInteger(skin)&&skin>=0&&skin<SKIN_COLORS.length?skin:0;
  accessory=Number.isInteger(accessory)&&accessory>=0&&accessory<ACCESSORIES.length?accessory:0;
  const key=skin+':'+accessory;
  if(applied.get(model)===key)return;
  applied.set(model,key);model.bodyColor.set(SKIN_COLORS[skin]);
  const old=model.root.getObjectByName('player-accessory');
  if(old){model.root.remove(old);old.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();(o.material as THREE.Material).dispose();}});}
  const group=new THREE.Group();group.name='player-accessory';
  if(accessory===1){
    const halo=new THREE.Mesh(new THREE.TorusGeometry(.36,.035,5,20),new THREE.MeshBasicMaterial({color:0xffdf87}));
    halo.rotation.x=Math.PI/2;halo.position.y=1.35;group.add(halo);
  }
  if(accessory===2)for(const side of [-1,1]){
    const horn=new THREE.Mesh(new THREE.ConeGeometry(.11,.32,5),new THREE.MeshBasicMaterial({color:0xf3e1ff}));
    horn.position.set(side*.32,1.02,0);horn.rotation.z=-side*.35;group.add(horn);
  }
  model.root.add(group);
}
