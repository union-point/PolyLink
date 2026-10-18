import { sodium, derive, seal, open, aad } from '../crypto/sodium.js';
import { saveDevice, openDevice, clearDevice } from '../crypto/device-store.js';
import { outboxStore } from '../crypto/outbox-store.js';
import { validatePassword } from './password-policy.js';
import { DataError } from '../data/errors.js';

export function createIdentityClient(api){
  let pending=null,session=null,vaultKey=null,vault=null,revision=0,restoring=null,changing=false,storageUnavailable=false,transitionUser=null;
  const transition=work=>globalThis.navigator?.locks?navigator.locks.request('polylink-identity-transition',work):work();
  const changed=()=>new DataError('SESSION_CHANGED','Your session changed. Please retry.');
  const listeners=new Set();
  const channel=typeof BroadcastChannel==='undefined'?null:new BroadcastChannel('polylink-identity-v1');
  const post=(url,data)=>api.request({method:'post',url,data});
  const emit=operation=>{for(const listener of listeners)listener({operation});};
  function forget(){revision++;vaultKey?.fill(0);vaultKey=null;vault=null;}
  function forgetPending(){pending?.derived.login.fill(0);pending?.derived.wrapping.fill(0);pending=null;changing=false;transitionUser=null;}
  async function clear(expected=session){
    forget();forgetPending();api.setToken(null);session=null;
    await clearDevice(expected?.user.id,expected).catch(()=>{});
    await outboxStore.clear(expected?.user.id).catch(()=>{});
  }
  const onEvent=async event=>{
    if(event?.operation==='auth.logout'){
      const clearing=clear();emit('auth.logout');await clearing;
    }else if(['auth.login','auth.version'].includes(event?.operation)){
      forget();api.setToken(null);emit(event.operation);
    }else if(event?.operation==='auth.revoked'&&!changing&&session?.user.id===event.account&&session?.familyId===event.familyId){
      const clearing=clear();emit('auth.revoked');await clearing;
    }
  };
  channel?.addEventListener('message',event=>onEvent(event.data).catch(()=>{}));
  globalThis.addEventListener?.('storage',event=>{if(event.key==='polylink.http.loggedOut'&&event.newValue==='true')onEvent({operation:'auth.logout'}).catch(()=>{});});
  const user=()=>session?{...session.user,name:[session.user.firstName,session.user.lastName].join(' '),cryptoLocked:!vaultKey,storageUnavailable,sessionVersion:JSON.stringify([session.familyId,session.versions])}:null;
  async function readVault(key,bundle,current=session){
    const plain=await open(bundle.vault,key,aad('vault',current.user.id,bundle.versions.vaultKey,bundle.versions.vaultRevision));
    try{
      const value=JSON.parse(new TextDecoder().decode(plain));
      if(value.scheme!=='PLK1'||value.userId!==current.user.id||value.vaultKeyVersion!==bundle.versions.vaultKey||value.vaultRevision!==bundle.versions.vaultRevision||value.currentIdentityVersion!==bundle.identity.version||!Array.isArray(value.identities))throw new Error();
      const currentIdentity=value.identities.find(identity=>identity.version===bundle.identity.version);
      const s=await sodium();
      if(!currentIdentity||currentIdentity.publicKey!==bundle.identity.publicKey||s.to_base64(s.crypto_scalarmult_base(s.from_base64(currentIdentity.privateKey,s.base64_variants.URLSAFE_NO_PADDING)),s.base64_variants.URLSAFE_NO_PADDING)!==currentIdentity.publicKey)throw new Error();
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
      const opening=revision;const contents=await readVault(key,bundle);if(opening!==revision){key.fill(0);throw changed();}forget();vaultKey=key;vault=contents;
      storageUnavailable=false;
      const acceptedRevision=revision;const acceptedSession=session;
      try{await saveDevice(acceptedSession,key);}catch{storageUnavailable=true;}
      if(acceptedRevision!==revision){await clearDevice(acceptedSession.user.id,acceptedSession).catch(()=>{});throw changed();}
      api.beginSession();channel?.postMessage({operation:'auth.login',account:session.user.id,versions:session.versions});emit('auth.login');
      return {status:'authenticated',user:user(),storageUnavailable};
    }finally{derived.login.fill(0);derived.wrapping.fill(0);pending=null;changing=false;transitionUser=null;}
  }
  const client={
    async login({email,password}){
      if(pending){pending.derived.login.fill(0);pending.derived.wrapping.fill(0);pending=null;}
      const attemptRevision=revision;const settings=await post('/auth/parameters',{email});const derived=await derive(password,settings),s=await sodium();
      try{
        return await transition(async()=>{
        if(attemptRevision!==revision)throw changed();
        const result=await post('/auth/login',{email,scheme:'PLK1',loginSecret:s.to_base64(derived.login,s.base64_variants.URLSAFE_NO_PADDING)});
        if(result.status==='challenge'){pending={derived,settings,challenge:result.challenge};return {status:'challenge',...result.challenge};}
        return await complete(result,derived,settings);
        });
      }catch(error){if(!pending){derived.login.fill(0);derived.wrapping.fill(0);}throw error;}
    },
    async verifySecondFactor({challengeId,code}){
      if(!pending||pending.challenge.challengeId!==challengeId)throw new DataError('UNAUTHORIZED','Start signing in again.');
      return transition(async()=>{const attempt=pending;const result=await post('/auth/login/verify',{challengeId,code});return complete(result,attempt.derived,attempt.settings);});
    },
    async register({email,password,firstName,lastName,role='graduate'}){
      validatePassword(password);
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
      if(api.isLoggedOut()){if(session)await clear();return null;}
      if(changing)return pending?.passwordChange?transitionUser:user();
      if(restoring)return restoring;
      restoring=(async()=>{
        let opening=revision;
        try{
          await api.restore();const next=await api.request({method:'get',url:'/auth/me'});
          if(opening!==revision||api.isLoggedOut())throw changed();
          if(session&&(session.user.id!==next.user.id||session.familyId!==next.familyId||JSON.stringify(session.versions)!==JSON.stringify(next.versions))){forget();opening=revision;}
          session=next;
          if(!vaultKey&&!next.keySetupRequired){
            let key;
            try{key=await openDevice(next);storageUnavailable=false;}catch{key=null;storageUnavailable=true;}
            if(key){
              try{
                const bundle=await api.request({method:'get',url:'/keys/me'});
                if(JSON.stringify(next.versions)!==JSON.stringify(bundle.versions))throw changed();
                const contents=await readVault(key,bundle,next);
                if(opening!==revision||api.isLoggedOut())throw changed();
                vault=contents;vaultKey=key;key=null;
              }finally{key?.fill(0);}
            }
          }
          if(opening!==revision||api.isLoggedOut())throw changed();
          return user();
        }catch(error){
          if(error?.response?.status===401||error.code==='UNAUTHORIZED'){
            const previous=session;await clear(previous);
            channel?.postMessage({operation:'auth.revoked',account:previous?.user.id,familyId:previous?.familyId});return null;
          }
          throw error;
        }
      })().finally(()=>{restoring=null;});
      return restoring;
    },
    async changePassword({oldPassword,newPassword}){
      validatePassword(newPassword);
      return transition(async()=>{
        await client.me();
        if(!session||!vaultKey)throw new DataError('KEY_LOCKED','Sign in with your password first.');
        changing=true;let derived,old;
        const email=session.user.email,base=session,operationRevision=revision;transitionUser=user();
        try{
          const s=await sodium(),b64=bytes=>s.to_base64(bytes,s.base64_variants.URLSAFE_NO_PADDING);
          const bundle=await api.request({method:'get',url:'/keys/me'});
          if(oldPassword){
            const oldSettings=await post('/auth/parameters',{email});old=await derive(oldPassword,oldSettings);
            let check;
            try{check=await open(bundle.passwordCopy,old.wrapping,aad('password-copy',base.user.id,base.versions.vaultKey,base.versions.credential));if(!s.memcmp(check,vaultKey))throw new Error();}
            catch{throw new DataError('VALIDATION','The current password is incorrect.');}finally{check?.fill(0);}
          }
          const settings={scheme:'PLK1',salt:b64(s.randombytes_buf(16)),opsLimit:2,memoryBytes:67108864};derived=await derive(newPassword,settings);
          const nextCredential=(BigInt(base.versions.credential)+1n).toString();
          const passwordCopy=await seal(vaultKey,derived.wrapping,aad('password-copy',base.user.id,base.versions.vaultKey,nextCredential));
          const check=await open(passwordCopy,derived.wrapping,aad('password-copy',base.user.id,base.versions.vaultKey,nextCredential));
          try{if(!s.memcmp(check,vaultKey))throw new Error('Password copy verification failed.');}finally{check.fill(0);}
          const operationId=crypto.randomUUID(),request={kind:'PASSWORD_CHANGE',operationId,expected:base.versions,derivation:settings,loginSecret:b64(derived.login),vault:bundle.vault,passwordCopy,identity:bundle.identity};
          if(operationRevision!==revision||api.isLoggedOut())throw changed();
          await post('/auth/password-change/prepare',request);
          try{await post('/auth/password-change/commit',{operationId});}
          catch(error){
            if(error.code!=='NETWORK'&&!error.retryable)throw error;
            // A repeated commit using the original access token is status-only after activation.
            await post('/auth/password-change/commit',{operationId});
          }
          if(operationRevision!==revision||api.isLoggedOut())throw changed();
          api.setToken(null);forget();session=null;
          const result=await post('/auth/login',{email,scheme:'PLK1',loginSecret:b64(derived.login)});
          if(result.status==='challenge'){
            pending={derived,settings,challenge:result.challenge,passwordChange:true};derived=null;
            return {status:'challenge',...result.challenge};
          }
          return await complete(result,derived,settings);
        }finally{changing=!!pending?.passwordChange;if(!changing)transitionUser=null;derived?.login.fill(0);derived?.wrapping.fill(0);old?.login.fill(0);old?.wrapping.fill(0);}
      });
    },
    async logout(){
      api.markLoggedOut?.();
      if(!api.markLoggedOut){try{localStorage.setItem('polylink.http.loggedOut','true');}catch{}}
      const previous=session;forget();forgetPending();session=null;
      channel?.postMessage({operation:'auth.logout'});emit('auth.logout');
      return transition(async()=>{
        await clearDevice(previous?.user.id).catch(()=>{});await outboxStore.clear(previous?.user.id).catch(()=>{});
        try{await post('/auth/logout',{});}
        catch{throw new DataError('NETWORK','You are signed out on this browser. Server session revocation could not be confirmed. Try signing out again when connected.',{},true);}
        finally{api.setToken(null);}
      });
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
  globalThis.addEventListener?.('pagehide', event=>{forget();forgetPending();api.setToken(null);if(!event.persisted)channel?.close();});
  return client;
}
