import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecoveryClient } from '../../js/auth/recovery-client.js';
import { sodium, seal, open, aad } from '../../js/crypto/sodium.js';
const s=await sodium(),b64=bytes=>s.to_base64(bytes,s.base64_variants.URLSAFE_NO_PADDING),from=value=>s.from_base64(value,s.base64_variants.URLSAFE_NO_PADDING);
const records=new Map();globalThis.sessionStorage={getItem:key=>records.get(key)??null,setItem:(key,value)=>records.set(key,value),removeItem:key=>records.delete(key)};
async function fixture(localPath=false){
  records.clear();const pair=s.crypto_box_keypair(),key=s.randombytes_buf(32);
  const versions={credential:'3',vaultKey:'2',vaultRevision:'4',identity:'5'};
  const contents={scheme:'PLK1',userId:'1',vaultKeyVersion:'2',vaultRevision:'4',currentIdentityVersion:'5',identities:[{version:'5',publicKey:b64(pair.publicKey),privateKey:b64(pair.privateKey)}]};
  const bundle={versions,identity:{userId:'1',version:'5',publicKey:b64(pair.publicKey)},vault:await seal(JSON.stringify(contents),key,aad('vault','1','2','4'))};
  const operation={operationId:crypto.randomUUID(),userId:'1',email:'synthetic@example.invalid',kind:'RECOVERY_LOCAL',state:'VERIFIED',baseVersions:versions};
  const calls=[];let staged,failed=false,losePrepare=false,loseCommit=false;
  const readVault=async(key,bundle)=>{const plain=await open(bundle.vault,key,aad('vault','1',bundle.versions.vaultKey,bundle.versions.vaultRevision));try{return JSON.parse(new TextDecoder().decode(plain));}finally{plain.fill(0);}};
  const api={request:async request=>{
    const method=request.url.split('/').at(-1);calls.push(structuredClone(request));
    if(method==='status')return structuredClone(operation);
    if(method==='unlock'){operation.kind='RECOVERY_SERVICE';operation.state='WAITING_SERVICE';return {vaultKey:b64(key),bundle};}
    if(method==='prepare'){
      if(failed)throw Object.assign(new Error('Unavailable'),{code:'SERVICE_UNAVAILABLE',retryable:true});
      staged=structuredClone(request.data);operation.state='READY';
      if(losePrepare){losePrepare=false;throw Object.assign(new Error('Lost prepare'),{code:'NETWORK'});}return operation;
    }
    if(method==='commit'){operation.state='COMPLETED';if(loseCommit){loseCommit=false;throw Object.assign(new Error('Lost commit'),{code:'NETWORK'});}return operation;}
    throw new Error('Unexpected route '+method);
  }};
  const options={readVault,local:async()=>localPath?{bundle,key:key.slice(),contents:structuredClone(contents)}:null,finish:async()=>({status:'authenticated'})};
  return {api,options,operation,key,bundle,contents,calls,get staged(){return staged;},fail:()=>{failed=true;},recover:()=>{failed=false;},lose:()=>{losePrepare=true;loseCommit=true;}};
}
test('service recovery preserves historical private keys and rotates identity, vault and copies before commit',async()=>{
  const f=await fixture();f.lose();const result=await createRecoveryClient(f.api,f.options).resetPassword({newPassword:'Recovery fixture pass!9'});assert.equal(result.status,'authenticated');
  const request=f.staged;assert.equal(request.kind,'RECOVERY_SERVICE');assert.equal(request.identity.version,'6');
  const key=from(request.serviceVaultKey);assert(!s.memcmp(key,f.key));
  const next=await f.options.readVault(key,{vault:request.vault,versions:{vaultKey:'3',vaultRevision:'5'}});
  assert.deepEqual(next.identities[0],f.contents.identities[0]);assert.equal(next.currentIdentityVersion,'6');assert.equal(next.identities.length,2);
  assert.equal(b64(s.crypto_scalarmult_base(from(next.identities[1].privateKey))),request.identity.publicKey);
  assert.equal(f.calls.filter(c=>c.url.endsWith('/commit')).length,2);assert.equal(records.size,0);
});
test('local recovery preserves identity and vault and never requests a service key',async()=>{
  const f=await fixture(true);await createRecoveryClient(f.api,f.options).resetPassword({newPassword:'Local fixture pass!9'});
  assert.equal(f.staged.kind,'RECOVERY_LOCAL');assert.deepEqual(f.staged.vault,f.bundle.vault);assert.deepEqual(f.staged.identity,f.bundle.identity);assert(!('serviceVaultKey' in f.staged));
  assert(!f.calls.some(c=>c.url.endsWith('/unlock')));
});
test('reload resumes exact encrypted candidate; wrong password cannot replace an ambiguous package',async()=>{
  const f=await fixture();f.fail();await assert.rejects(createRecoveryClient(f.api,f.options).resetPassword({newPassword:'Retry fixture pass!9'}));
  const first=f.calls.find(c=>c.url.endsWith('/prepare')).data;
  assert(!JSON.stringify([...records.values()]).includes(first.serviceVaultKey));assert(!JSON.stringify([...records.values()]).includes(first.loginSecret));
  const resumed=createRecoveryClient(f.api,f.options);await assert.rejects(resumed.resetPassword({newPassword:'Wrong fixture pass!7'}),e=>e.code==='VALIDATION');
  f.recover();await resumed.resetPassword({newPassword:'Retry fixture pass!9'});
  const requests=f.calls.filter(c=>c.url.endsWith('/prepare'));assert.deepEqual(requests[0].data,requests[1].data);assert.equal(f.calls.filter(c=>c.url.endsWith('/unlock')).length,1);
});
