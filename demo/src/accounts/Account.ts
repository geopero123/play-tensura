import { createClient } from '@supabase/supabase-js';
import { SERVER_URL, SERVER_KEY } from '../multiplayer/ServerConfig';

export class Account {
  private db = createClient(SERVER_URL, SERVER_KEY, {auth:{storageKey:'tempest-game-account'}});
  userId = '';
  status = 'Guest · progress saved on this device';
  ready = false;
  private revision: string | null = null;
  private baseline: unknown;
  private busy = false;
  private conflict = false;
  onChange = () => {};
  constructor(private capture:()=>object, private restore:(value:unknown)=>void) { this.baseline=JSON.parse(JSON.stringify(capture())); }
  async init() {
    const {data,error} = await this.db.auth.getSession();
    if (error) this.status = error.message;
    this.userId = data.session?.user.id ?? '';
    await this.load();
  }
  private get key() { return 'tempest-save-v1-' + (this.userId || 'guest'); }
  private local() {
    try { const value=localStorage.getItem(this.key); if(value) this.restore(JSON.parse(value)); } catch {this.status='Could not read device save';}
  }
  async load() {
    this.ready=false; this.conflict=false; this.revision=null;
    this.restore(this.baseline);
    this.local();
    if(this.userId) {
      const {data,error} = await this.db.from('game_saves').select('data,updated_at').eq('user_id',this.userId).maybeSingle();
      if(error) {this.status='Cloud load failed. Reconnect before saving online.';this.onChange();return;}
      if(data) {
        try {const local=localStorage.getItem(this.key);if(local&&local!==JSON.stringify(data.data))localStorage.setItem(this.key+'-recovery',local);}catch{}
        this.restore(data.data);this.revision=data.updated_at;
      }
      this.status=data?'Cloud progress loaded':'Account ready · save this adventure to the cloud';
    }
    this.ready=true;this.onChange();
  }
  async login(email:string,password:string,signup=false) {
    if(this.busy)return;
    this.busy=true;
    try {
      const result=signup?await this.db.auth.signUp({email,password}):await this.db.auth.signInWithPassword({email,password});
      if(result.error) {this.status=result.error.message;return;}
      if(!result.data.session){this.status='Check your email to confirm your account, then sign in.';return;}
      this.userId=result.data.session.user.id;
      await this.load();
    } finally {this.busy=false;this.onChange();}
  }
  async logout() {
    if(this.busy)return;
    await this.save();
    const {error}=await this.db.auth.signOut();
    if(error){this.status=error.message;this.onChange();return;}
    this.userId='';this.revision=null;this.conflict=false;this.restore(this.baseline);this.local();
    this.status='Signed out · guest device progress restored';
    this.ready=true;this.onChange();
  }
  async save() {
    if(!this.ready||this.busy||this.conflict)return;
    const data=this.capture();
    try{localStorage.setItem(this.key,JSON.stringify(data));}catch{this.status='Device storage unavailable';}
    if(!this.userId)return;
    this.busy=true;
    try {
      const stamp=new Date().toISOString();
      const result=this.revision
        ?await this.db.from('game_saves').update({data,updated_at:stamp}).eq('user_id',this.userId).eq('updated_at',this.revision).select('updated_at')
        :await this.db.from('game_saves').insert({user_id:this.userId,data,updated_at:stamp}).select('updated_at');
      if(result.error){this.status='Cloud save failed · device backup kept';return;}
      if(!result.data?.length){this.conflict=true;this.status='Another device changed this save. Return to title and reload cloud progress.';return;}
      this.revision=result.data[0].updated_at;this.status='Saved on this device and in the cloud';
    } finally {this.busy=false;this.onChange();}
  }
  panel(allowLoad:boolean) {
    const root=document.createElement('section');
    root.className='account-panel';
    const heading=document.createElement('h3');heading.textContent='Account & progress';root.appendChild(heading);
    const status=document.createElement('p');status.textContent=this.status;root.appendChild(status);
    const button=(text:string,fn:()=>void,disabled=false)=>{const b=document.createElement('button');b.className='room-button';b.textContent=text;b.disabled=disabled||this.busy;b.onclick=fn;root.appendChild(b);};
    let recovery: string | null=null;try{recovery=localStorage.getItem(this.key+'-recovery');}catch{}
    if(recovery) button('RESTORE DEVICE BACKUP',()=>{try{this.restore(JSON.parse(recovery!));this.status='Device backup restored. Save now to use it in the cloud.';this.onChange();}catch{}},!allowLoad||!this.ready);
    if(this.userId){button('SAVE NOW',()=>void this.save());button('RELOAD CLOUD SAVE',()=>void this.load(),!allowLoad);button('SIGN OUT',()=>void this.logout(),!allowLoad);}
    else {
      const email=document.createElement('input');email.type='email';email.placeholder='Email';email.autocomplete='email';email.ariaLabel='Account email';
      const password=document.createElement('input');password.type='password';password.placeholder='Password (at least 8 characters)';password.autocomplete='current-password';password.minLength=8;password.ariaLabel='Account password';
      root.append(email,password);
      const login=(signup:boolean)=>{if(email.checkValidity()&&email.value&&password.value.length>=8)void this.login(email.value.trim(),password.value,signup);else {this.status='Enter a valid email and a password of at least 8 characters.';this.onChange();}};
      button('SIGN IN',()=>login(false),!allowLoad);button('CREATE ACCOUNT',()=>login(true),!allowLoad);
      if(!allowLoad){const p=document.createElement('p');p.textContent='Return to the title screen to sign in or change accounts.';root.appendChild(p);}
    }
    return root;
  }
}
