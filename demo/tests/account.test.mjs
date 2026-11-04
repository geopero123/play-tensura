import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const temp=await mkdtemp(path.join(tmpdir(),'tempest-account-'));
const sdk=`
export function createClient(){return {
auth:{
getSession:async()=>({data:{session:globalThis.session},error:null}),
signInWithPassword:async({email})=>{globalThis.session={user:{id:email}};return {data:{session:globalThis.session}}},
signUp:async()=>({data:{session:null}}),
signOut:async()=>{globalThis.session=null;return {error:null}}
},
from(){let filters={},operation='read',value;const chain={
select(){return chain},eq(k,v){filters[k]=v;return chain},
update(v){operation='update';value=v;return chain},
insert(v){operation='insert';value=v;return chain},
async maybeSingle(){return {data:globalThis.records.get(filters.user_id)||null}},
then(resolve){const id=filters.user_id??value.user_id,old=globalThis.records.get(id);
if(operation==='update'&&old?.updated_at!==filters.updated_at)return Promise.resolve({data:[]}).then(resolve);
const row={...value};globalThis.records.set(id,structuredClone(row));return Promise.resolve({data:[row]}).then(resolve)}
};return chain;}
};}
`;
try{
await build({entryPoints:['src/accounts/Account.ts'],outfile:path.join(temp,'account.mjs'),bundle:true,platform:'node',format:'esm',plugins:[{name:'test-sdk',setup(b){b.onResolve({filter:/^@supabase\/supabase-js$/},()=>({path:'sdk',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:sdk}));}}]});
globalThis.records=new Map();globalThis.session=null;
const items=new Map();globalThis.localStorage={getItem:k=>items.get(k)||null,setItem:(k,v)=>items.set(k,v)};
const {Account}=await import(path.join(temp,'account.mjs'));
let state={version:1,level:1};
const account=new Account(()=>state,v=>{state=structuredClone(v)});
await account.init();state.level=7;await account.save();
assert.equal(JSON.parse(items.get('tempest-save-v1-guest')).level,7);
await account.login('a','password');assert.equal(state.level,1,'new account starts fresh');
state.level=12;await account.save();assert.equal(records.get('a').data.level,12);
records.get('a').updated_at='changed-by-second-device';state.level=15;await account.save();
assert(account.status.includes('Another device'));assert.equal(records.get('a').data.level,12);
assert.equal(JSON.parse(items.get('tempest-save-v1-a')).level,15,'conflict retains device backup');
await account.load();assert.equal(state.level,12);assert.equal(JSON.parse(items.get('tempest-save-v1-a-recovery')).level,15);
await account.logout();assert.equal(state.level,7,'signout restores separate guest save');
await account.login('b','password');assert.equal(state.level,1,'second account does not inherit first account');
await account.logout();await account.login('c','password',true);assert(account.status.includes('confirm'));assert.equal(account.userId,'');
console.log('PASS device saves, cloud roundtrip, account isolation, conflict protection, recovery backup, email confirmation');
}finally{await rm(temp,{recursive:true,force:true});}
