import { sodium, derive, seal, open, aad } from '../crypto/sodium.js';
import { saveDevice, openDevice, clearDevice } from '../crypto/device-store.js';
import { outboxStore } from '../crypto/outbox-store.js';
import { DataError } from '../data/errors.js';

export function createIdentityClient(api){
  let pending=null,session=null,vaultKey=null,vault=null;
  const listeners=new Set();
  const channel=typeof BroadcastChannel==='undefined'?null:new BroadcastChannel('polylink-identity-v1');
  const post=(url,data)=>api.request({method:'post',url,data});
  const emit=operation=>{for(const listener of listeners)listener({operation});};
  function forget(){vaultKey?.fill(0);vaultKey=null;vault=null;}
  async function clear(){await outboxStore.clear(session?.user.id).catch(()=>{});forget();api.setToken(null);await clearDevice(session?.user.id).catch(()=>{});session=null;}
  channel?.addEventListener('message',async event=>{
    if(event.data?.operation==='auth.logout'){await clear();emit('auth.logout');}
    if(event.data?.operation==='auth.login'){forget();api.setToken(null);emit('auth.login');}
  });
  const user=()=>session?{...session.user,name:[session.user.firstName,session.user.lastName].join(' '),cryptoLocked:!vaultKey}:null;
  async function readVault(key,bundle){
    const plain=await open(bundle.vault,key,aad('vault',session.user.id,bundle.versions.vaultKey,bundle.versions.vaultRevision));
    try{
      const value=JSON.parse(new TextDecoder().decode(plain));
      if(value.scheme!=='PLK1'||value.userId!==session.user.id||value.vaultKeyVersion!==bundle.versions.vaultKey||value.vaultRevision!==bundle.versions.vaultRevision||value.currentIdentityVersion!==bundle.identity.version||!Array.isArray(value.identities))throw new Error();
      const current=value.identities.find(identity=>identity.version===bundle.identity.version);
      const s=await sodium();
      if(!current||current.publicKey!==bundle.identity.publicKey||s.to_base64(s.crypto_scalarmult_base(s.from_base64(current.privateKey,s.base64_variants.URLSAFE_NO_PADDING)),s.base64_variants.URLSAFE_NO_PADDING)!==current.publicKey)throw new Error();
      return value;
    }catch{throw new DataError('DATA_INTEGRITY','Your encrypted account data could not be opened.');}
    finally{plain.fill(0);}
  }
  async function setup(derived,settings){
    const s=await sodium(),key=s.randombytes_buf(32),pair=s.crypto_box_keypair();
    const b64=bytes=>s.to_base64(bytes,s.base64_variants.URLSAFE_NO_PADDING);
    const contents={scheme:'PLK1',userId:session.user.id,vaultKeyVersion:'1',vaultRevision:'1',currentIdentityVersion:'1',identities:[{version:'1',publicKey:b64(pair.publicKey),privateKey:b64(pair.privateKey)}]};
    try{
      const packet=await seal(JSON.stringify(contents),key,aad('vault',session.user.id,'1','1'));
      const passwordCopy=await seal(key,derived.wrapping,aad('password-copy',session.user.id,'1',session.versions.credential));
      const roundtrip=await open(passwordCopy,derived.wrapping,aad('password-copy',session.user.id,'1',session.versions.credential));
      if(!s.memcmp(roundtrip,key))throw new Error('Vault copy verification failed.');roundtrip.fill(0);
      const operationId=crypto.randomUUID();
      const request={kind:'SETUP',operationId,expected:session.versions,derivation:settings,loginSecret:b64(derived.login),vault:packet,passwordCopy,identity:{userId:session.user.id,version:'1',publicKey:b64(pair.publicKey)},serviceVaultKey:b64(key)};
      try{await post('/keys/setup/prepare',request);await post('/keys/setup/commit',{operationId});}
      catch(error){
        // Lost commit response or competing setup may already have published the backed-up winner.
        if(!['REVISION_CONFLICT','NETWORK'].includes(error.code)&&error?.response?.status!==409)throw error;
        await api.request({method:'get',url:'/keys/me'});
      }
    }finally{key.fill(0);pair.privateKey.fill(0);}
  }
  async function complete(result,derived,settings){
    const previousAccount=session?.user.id;
    if(previousAccount&&previousAccount!==result.session.user.id){forget();await clearDevice(previousAccount).catch(()=>{});}
    api.setToken(result.accessToken);session=result.session;
    try{
      if(session.keySetupRequired)await setup(derived,settings);
      session=await api.request({method:'get',url:'/auth/me'});
      const bundle=await api.request({method:'get',url:'/keys/me'});
      const key=await open(bundle.passwordCopy,derived.wrapping,aad('password-copy',session.user.id,bundle.versions.vaultKey,session.versions.credential));
      const contents=await readVault(key,bundle);forget();vaultKey=key;vault=contents;
      let storageUnavailable=false;
      try{await saveDevice(session,key);}catch{storageUnavailable=true;}
      api.beginSession();channel?.postMessage({operation:'auth.login'});emit('auth.login');
      return {status:'authenticated',user:user(),storageUnavailable};
    }finally{derived.login.fill(0);derived.wrapping.fill(0);pending=null;}
  }
  const client={
    async login({email,password}){
      if(pending){pending.derived.login.fill(0);pending.derived.wrapping.fill(0);pending=null;}
      const settings=await post('/auth/parameters',{email});const derived=await derive(password,settings),s=await sodium();
      try{
        const result=await post('/auth/login',{email,scheme:'PLK1',loginSecret:s.to_base64(derived.login,s.base64_variants.URLSAFE_NO_PADDING)});
        if(result.status==='challenge'){pending={derived,settings,challenge:result.challenge};return {status:'challenge',...result.challenge};}
        return await complete(result,derived,settings);
      }catch(error){if(!pending){derived.login.fill(0);derived.wrapping.fill(0);}throw error;}
    },
    async verifySecondFactor({challengeId,code}){
      if(!pending||pending.challenge.challengeId!==challengeId)throw new DataError('UNAUTHORIZED','Start signing in again.');
      const result=await post('/auth/login/verify',{challengeId,code});return complete(result,pending.derived,pending.settings);
    },
    async register({email,password,firstName,lastName,role='graduate'}){
      if(password.length<8||password.length>128||!/[A-Z]/.test(password)||!/[0-9]/.test(password)||! /[^\w\s]/.test(password))throw new DataError('VALIDATION','Use 8–128 characters, including an uppercase letter, number and symbol.');
      const s=await sodium(),settings={scheme:'PLK1',salt:s.to_base64(s.randombytes_buf(16),s.base64_variants.URLSAFE_NO_PADDING),opsLimit:2,memoryBytes:67108864};
      const derived=await derive(password,settings);
      try{return await post('/auth/register',{email,firstName,lastName,role,derivation:settings,loginSecret:s.to_base64(derived.login,s.base64_variants.URLSAFE_NO_PADDING)});}
      finally{derived.login.fill(0);derived.wrapping.fill(0);}
    },
    async verifyEmail({challengeId,code}){return post('/auth/email/verify',{challengeId,code});},
    async resendChallenge({challengeId}){
      const result=await post('/auth/challenges/resend',{challengeId});if(pending)pending.challenge=result;return result;
    },
    async me(){
      if(api.isLoggedOut())return null;
      try{
        await api.restore();const previous=session;session=await api.request({method:'get',url:'/auth/me'});
        if(previous&&(previous.user.id!==session.user.id||previous.familyId!==session.familyId||previous.versions.credential!==session.versions.credential||previous.versions.vaultKey!==session.versions.vaultKey))forget();
        if(!vaultKey&&!session.keySetupRequired){
          let key;
          try{key=await openDevice(session);}catch{key=null;}
          if(key){const bundle=await api.request({method:'get',url:'/keys/me'});vault=await readVault(key,bundle);vaultKey=key;}
        }
        return user();
      }catch(error){if(error?.response?.status===401||error.code==='UNAUTHORIZED'){await clear();return null;}throw error;}
    },
    async logout(){
      localStorage.setItem('polylink.http.loggedOut','true');const account=session?.user.id;forget();pending?.derived.login.fill(0);pending?.derived.wrapping.fill(0);pending=null;
      await clearDevice(account).catch(()=>{});await outboxStore.clear(account).catch(()=>{});channel?.postMessage({operation:'auth.logout'});emit('auth.logout');
      try{await post('/auth/logout',{});}catch(error){throw new DataError('NETWORK','You are signed out on this browser. Server session revocation could not be confirmed. Try signing out again when connected.',{},true);}
      finally{api.setToken(null);session=null;}
    },
    subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
    isUnlocked(){return !!vaultKey;},
    async withKeys(work){
      await client.me();
      if(!session||!vaultKey||!vault)throw new DataError('KEY_LOCKED','Sign in with your password to open encrypted messages.');
      return work({session,vault,vaultKey});
    },
    close(){forget();channel?.close();}
  };
  globalThis.addEventListener?.('pagehide', event=>{forget();pending?.derived.login.fill(0);pending?.derived.wrapping.fill(0);pending=null;api.setToken(null);if(!event.persisted)channel?.close();});
  return client;
}
