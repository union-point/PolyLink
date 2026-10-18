import test from 'node:test';
import assert from 'node:assert/strict';
import { createEncryptedChat } from '../../js/chat/encrypted-client.js';
import { sodium, seal, aad } from '../../js/crypto/sodium.js';
const s=await sodium(),room='10000000-0000-4000-8000-000000000001';
const b64=bytes=>s.to_base64(bytes,s.base64_variants.URLSAFE_NO_PADDING);
function fixture(bindingRoom=room){
  const pair=s.crypto_box_keypair(),key=s.randombytes_buf(32),vaultKey=s.randombytes_buf(32);
  const session={user:{id:'1'},versions:{vaultKey:'1'}},vault={identities:[{version:'1',publicKey:b64(pair.publicKey),privateKey:b64(pair.privateKey)}]};
  const tuple=['PLK1','room-key',bindingRoom,'1','1','1','1',b64(key)];
  const bundle={snapshot:{roomId:room,versions:{membership:'1',roomKey:'1'},keyState:'ready',recipients:[{userId:'1',identityVersion:'1',publicKey:b64(pair.publicKey)},{userId:'2',identityVersion:'1',publicKey:b64(pair.publicKey)}]},envelopes:[{keyVersion:'1',membershipVersion:'1',envelope:{userId:'1',identityVersion:'1',sealedPacket:b64(s.crypto_box_seal(JSON.stringify(tuple),pair.publicKey))}}]};
  const records=new Map(),store={async get(id){return structuredClone(records.get(id));},async put(value){records.set(value.id,structuredClone(value));},async remove(id){records.delete(id);}};
  const identity={withKeys:work=>work({session,vault,vaultKey})};
  return {bundle,store,identity,records,key};
}
test('bound envelopes and durable storage must succeed before any send HTTP request',async()=>{
  for(const mode of ['foreign-envelope','storage-failure']){
    const f=fixture(mode==='foreign-envelope'?'20000000-0000-4000-8000-000000000001':room);let posts=0;
    if(mode==='storage-failure')f.store.put=async()=>{throw new Error('Storage blocked');};
    const client=createEncryptedChat({request:async request=>{if(request.method==='post'){posts++;throw new Error('Unexpected post');}return f.bundle;}},f.identity,f.store);
    await assert.rejects(client.send(room,{text:'Do not send this'}));assert.equal(posts,0);
  }
});
test('ambiguous send retains encrypted original bytes and retries before reading fresh keys',async()=>{
  const f=fixture();let lost=true,posts=[],keyReads=0;
  const client=createEncryptedChat({request:async request=>{
    if(request.method==='get'){keyReads++;if(keyReads>1)throw new Error('Replay must not refresh/re-encrypt keys');return f.bundle;}
    posts.push(structuredClone(request.data));if(lost){lost=false;throw Object.assign(new Error('Lost reply'),{code:'NETWORK'});}
    return {id:'saved',sequence:'1'};
  }},f.identity,f.store);
  await assert.rejects(client.send(room,{text:'Persistent secret canary'}));assert.equal(f.records.size,1);
  assert(!JSON.stringify([...f.records.values()]).includes('Persistent secret canary'));
  assert.equal((await client.send(room,{text:'Persistent secret canary'})).sequence,'1');
  assert.deepEqual(posts[0],posts[1]);assert.equal(f.records.size,0);
});
test('decrypted render models authenticate sender and operation bindings',async()=>{
  const f=fixture(),operationId='20000000-0000-4000-8000-000000000001';
  const packet=await seal(JSON.stringify({text:'Authenticated text',attachment:null}),f.key,aad('message',room,'1',operationId,'1','1'));
  const message={id:'saved',roomId:room,sequence:'1',operationId,keyVersion:'1',membershipVersion:'1',sender:{id:'2',name:'Substituted sender'},packet};
  const client=createEncryptedChat({request:async request=>request.url.endsWith('/keys')?f.bundle:{items:[message],nextAfter:'1',hasMore:false}},f.identity,f.store);
  await assert.rejects(client.messages(room),error=>error.code==='DATA_INTEGRITY');
  message.sender.id='1';assert.equal((await client.messages(room))[0].text,'Authenticated text');
});
test('blocked outbox storage permits authenticated password-based reads and prevents a new send',async()=>{
  const f=fixture(),operationId='20000000-0000-4000-8000-000000000002';let posts=0;
  f.store.get=async()=>{throw new Error('IndexedDB blocked');};
  const packet=await seal(JSON.stringify({text:'Password access remains available',attachment:null}),f.key,aad('message',room,'1',operationId,'1','1'));
  const message={id:'saved',roomId:room,sequence:'1',operationId,keyVersion:'1',membershipVersion:'1',sender:{id:'1',name:'Sender'},packet};
  const client=createEncryptedChat({request:async request=>{
    if(request.method==='post'){posts++;throw new Error('Unexpected send');}
    return request.url.endsWith('/keys')?f.bundle:{items:[message],nextAfter:'1',hasMore:false};
  }},f.identity,f.store);
  assert.equal((await client.messages(room))[0].text,'Password access remains available');
  await assert.rejects(client.send(room,{text:'Requires durable outbox'}),error=>error.code==='STORAGE_UNAVAILABLE');assert.equal(posts,0);
});
