import { sodium, derive, seal, open, aad } from '../crypto/sodium.js';
import { validatePassword } from './password-policy.js';
import { DataError } from '../data/errors.js';

// Only encrypted candidate bytes and public KDF metadata survive a reload.
const draftKey='polylink.recovery-draft.v1';
export function createRecoveryClient(api,{local,readVault,finish}){
  const post=(name,data)=>api.request({method:'post',url:`/auth/recovery/${name}`,data});
  const status=()=>api.request({method:'get',url:'/auth/recovery/status'});
  const load=()=>{try{return JSON.parse(sessionStorage.getItem(draftKey));}catch{return null;}};
  const remove=()=>{try{sessionStorage.removeItem(draftKey);}catch{}};
  const ambiguous=error=>error.code==='NETWORK'||error.retryable;
  return {
    forgotPassword:email=>post('request',{email}),
    verifyRecovery:async({challengeId,code})=>{const result=await post('verify',{challengeId,code});remove();return result;},
    recoveryStatus:status,
    async resetPassword({newPassword}){
      validatePassword(newPassword);
      let operation=await status(),draft=load(),derived,key,pair;
      const s=await sodium(),b64=bytes=>s.to_base64(bytes,s.base64_variants.URLSAFE_NO_PADDING);
      try{
        if(operation.state==='COMPLETED')return await finish(operation.email,newPassword);
        if(['CANCELLED','EXPIRED'].includes(operation.state))throw new DataError('RECOVERY_EXPIRED','Request a new recovery code.');
        if(operation.state==='READY'){
          // A ready package already has both usable copies. The new password is checked at login.
          await post('commit',{operationId:operation.operationId}).catch(async error=>{if(!ambiguous(error))throw error;await post('commit',{operationId:operation.operationId});});
          remove();return await finish(operation.email,newPassword);
        }
        let request;
        if(draft?.operationId===operation.operationId){
          derived=await derive(newPassword,draft.derivation);let plain;
          try{plain=await open(draft.packet,derived.wrapping,aad('recovery-draft',operation.userId,operation.operationId));request=JSON.parse(new TextDecoder().decode(plain));}
          catch{throw new DataError('VALIDATION','Enter the same new password used to prepare this recovery.');}finally{plain?.fill(0);}
        }else{
          if(['PREPARING','WAITING_SERVICE'].includes(operation.state)&&operation.packagePrepared)throw new DataError('RECOVERY_RESTART','This browser no longer has the encrypted recovery candidate. Request a new recovery code.');
          let bundle,contents,kind='RECOVERY_SERVICE';
          const current=operation.kind==='RECOVERY_LOCAL'?await local(operation).catch(()=>null):null;
          if(current){({bundle,key,contents}=current);kind='RECOVERY_LOCAL';}
          else{
            const unlocked=await post('unlock',{operationId:operation.operationId});bundle=unlocked.bundle;
            const oldKey=s.from_base64(unlocked.vaultKey,s.base64_variants.URLSAFE_NO_PADDING);
            try{contents=await readVault(oldKey,bundle,{user:{id:operation.userId}});}finally{oldKey.fill(0);}
            key=s.randombytes_buf(32);pair=s.crypto_box_keypair();
            const next=version=>(BigInt(version)+1n).toString();
            contents={...contents,vaultKeyVersion:next(contents.vaultKeyVersion),vaultRevision:next(contents.vaultRevision),currentIdentityVersion:next(contents.currentIdentityVersion),identities:[...contents.identities,{version:next(contents.currentIdentityVersion),publicKey:b64(pair.publicKey),privateKey:b64(pair.privateKey)}]};
          }
          const settings={scheme:'PLK1',salt:b64(s.randombytes_buf(16)),opsLimit:2,memoryBytes:67108864};derived=await derive(newPassword,settings);
          const credential=(BigInt(operation.baseVersions.credential)+1n).toString();
          const passwordCopy=await seal(key,derived.wrapping,aad('password-copy',operation.userId,contents.vaultKeyVersion,credential));
          const check=await open(passwordCopy,derived.wrapping,aad('password-copy',operation.userId,contents.vaultKeyVersion,credential));
          try{if(!s.memcmp(check,key))throw new Error('Recovery copy verification failed.');}finally{check.fill(0);}
          const identity=contents.identities.find(i=>i.version===contents.currentIdentityVersion);
          request={kind,operationId:operation.operationId,expected:operation.baseVersions,derivation:settings,loginSecret:b64(derived.login),passwordCopy,vault:kind==='RECOVERY_LOCAL'?bundle.vault:await seal(JSON.stringify(contents),key,aad('vault',operation.userId,contents.vaultKeyVersion,contents.vaultRevision)),identity:{userId:operation.userId,version:identity.version,publicKey:identity.publicKey},...(kind==='RECOVERY_SERVICE'?{serviceVaultKey:b64(key)}:{})};
          // Authenticate the new vault before allowing any password activation.
          await readVault(key,{vault:request.vault,versions:{vaultKey:contents.vaultKeyVersion,vaultRevision:contents.vaultRevision},identity:request.identity},{user:{id:operation.userId}});
          const packet=await seal(JSON.stringify(request),derived.wrapping,aad('recovery-draft',operation.userId,operation.operationId));
          try{sessionStorage.setItem(draftKey,JSON.stringify({operationId:operation.operationId,derivation:settings,packet}));}
          catch{throw new DataError('STORAGE_UNAVAILABLE','Enable browser storage to safely resume recovery before continuing.');}
        }
        try{await post('prepare',request);}catch(error){if(!ambiguous(error))throw error;const current=await status();if(current.state!=='READY')throw error;}
        try{await post('commit',{operationId:operation.operationId});}
        catch(error){if(!ambiguous(error))throw error;await post('commit',{operationId:operation.operationId});}
        remove();return await finish(operation.email,newPassword);
      }finally{derived?.login.fill(0);derived?.wrapping.fill(0);key?.fill(0);pair?.privateKey.fill(0);}
    }
  };
}
