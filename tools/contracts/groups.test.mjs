import test from 'node:test';
import assert from 'node:assert/strict';
import {createEncryptedChat} from '../../js/chat/encrypted-client.js';
import {sodium,open,aad} from '../../js/crypto/sodium.js';
const s=await sodium(),b64=v=>s.to_base64(v,s.base64_variants.URLSAFE_NO_PADDING),from=v=>s.from_base64(v,s.base64_variants.URLSAFE_NO_PADDING);
function fixture(){
  const records=new Map(),pairs=[s.crypto_box_keypair(),s.crypto_box_keypair(),s.crypto_box_keypair()];
  const context={session:{user:{id:'1'},versions:{vaultKey:'1'}},vaultKey:s.randombytes_buf(32),vault:{identities:[]}};
  const store={get:async id=>structuredClone(records.get(id)),put:async record=>records.set(record.id,structuredClone(record)),remove:async id=>records.delete(id)};
  const recipients=pairs.map((p,i)=>({userId:String(i+1),identityVersion:'1',publicKey:b64(p.publicKey)}));
  return {records,context,store,identity:{withKeys:work=>work(context)},pairs,recipients};
}
test('group creation persists encrypted operation and replays identical room/key bytes after reload',async()=>{
  const f=fixture();let lost=true,prepared=0;const posts=[];
  const api={request:async r=>{
    if(r.url==='/chat/groups/prepare'){prepared++;return {roomId:r.data.roomId,versions:{membership:'1',roomKey:'0'},keyState:'missing',recipients:f.recipients.slice(0,2)};}
    if(r.url==='/chat/groups'){posts.push(structuredClone(r.data));if(lost){lost=false;throw Object.assign(new Error('Lost reply'),{code:'NETWORK'});}return {roomId:r.data.roomId};}
    return {snapshot:{keyState:'ready'}};
  }};
  const draft={name:'Secret group draft',userIds:['2']};await assert.rejects(createEncryptedChat(api,f.identity,f.store).createGroup(draft));
  assert.equal(f.records.size,1);assert(!JSON.stringify([...f.records.values()]).includes(draft.name));
  const receipt=await createEncryptedChat(api,f.identity,f.store).createGroup(draft);assert.equal(receipt.roomId,posts[0].roomId);assert.equal(prepared,1);assert.deepEqual(posts[0],posts[1]);assert.equal(f.records.size,0);
});
test('membership addition uses independent random key and complete offline recipient envelopes',async()=>{
  const f=fixture(),room=crypto.randomUUID(),packages=[];let membership=1,keyVersion=1;
  const api={request:async r=>{
    if(r.url.endsWith('/participants/prepare'))return {roomId:room,versions:{membership:String(++membership),roomKey:String(keyVersion)},keyState:'stale',recipients:f.recipients};
    if(r.method==='get'&&r.url.endsWith('/participants'))return {metadataVersion:'1',keySnapshot:{versions:{membership:String(membership)}}};
    if(r.method==='post'&&r.url.endsWith('/participants')){packages.push(r.data.activation);keyVersion++;return {roomId:room};}
    return {snapshot:{keyState:'ready'}};
  }};
  const client=createEncryptedChat(api,f.identity,f.store);await client.addParticipant(room,'3');await client.addParticipant(room,'3');
  const keys=[];
  for(const packet of packages){
    assert.equal(packet.envelopes.length,3);const opened=packet.envelopes.map((e,i)=>JSON.parse(s.to_string(s.crypto_box_seal_open(from(e.sealedPacket),f.pairs[i].publicKey,f.pairs[i].privateKey))));
    assert(opened.every(t=>t[2]===room&&t[5]===packet.expected.versions.membership&&t[6]===packet.newKeyVersion));assert.equal(new Set(opened.map(t=>t[7])).size,1);keys.push(opened[0][7]);
  }
  assert.notEqual(keys[0],keys[1]);
  const nonce=s.randombytes_buf(24),cipher=s.crypto_aead_xchacha20poly1305_ietf_encrypt('future',null,null,nonce,from(keys[1]));
  assert.throws(()=>s.crypto_aead_xchacha20poly1305_ietf_decrypt(null,cipher,null,nonce,from(keys[0])));
});
test('blocked durable storage prevents group commit and stale snapshots are rebuilt only after definitive rejection',async()=>{
  const f=fixture();let posts=0,prepares=0;const room=crypto.randomUUID();
  const api={request:async r=>{
    if(r.url.endsWith('/participants/prepare')){prepares++;return {roomId:room,versions:{membership:'2',roomKey:String(prepares)},keyState:'stale',recipients:f.recipients};}
    if(r.method==='get'&&r.url.endsWith('/participants'))return {metadataVersion:'1',keySnapshot:{versions:{membership:'1'}}};
    if(r.method==='post'){posts++;if(posts===1)throw Object.assign(new Error('Stale'),{code:'REVISION_CONFLICT'});return {roomId:room};}
    return {snapshot:{keyState:'ready'}};
  }};
  f.store.put=async()=>{throw new Error('Storage blocked');};await assert.rejects(createEncryptedChat(api,f.identity,f.store).addParticipant(room,'3'));assert.equal(posts,0);
  f.store.put=async record=>f.records.set(record.id,structuredClone(record));await createEncryptedChat(api,f.identity,f.store).addParticipant(room,'3');assert.equal(posts,2);assert.equal(prepares,3);
});
test('composer drafts survive reload only inside vault-encrypted storage and clear after use',async()=>{
  const f=fixture(),room=crypto.randomUUID(),api={request:async()=>{throw new Error('Drafts need no HTTP request');}};
  await createEncryptedChat(api,f.identity,f.store).saveDraft(room,'M6 private composer canary');assert.equal(f.records.size,1);assert(!JSON.stringify([...f.records.values()]).includes('M6 private composer canary'));
  const restored=createEncryptedChat(api,f.identity,f.store);assert.equal(await restored.loadDraft(room),'M6 private composer canary');await restored.saveDraft(room,'');assert.equal(await restored.loadDraft(room),'');assert.equal(f.records.size,0);
});
test('an inaccessible saved send cannot wedge history after rejoining a new interval',async()=>{
  const f=fixture(),room=crypto.randomUUID();let sent=0,reads=0;
  const record={id:`1:${room}`,account:'1',operationId:crypto.randomUUID()};
  const {seal}=await import('../../js/crypto/sodium.js');
  record.packet=await seal(JSON.stringify({request:{operationId:record.operationId}}),f.context.vaultKey,aad('outbox','1',room,record.operationId,'1'));f.records.set(record.id,record);
  const api={request:async request=>{
    if(request.method==='post'){sent++;throw Object.assign(new Error('Previous interval'),{code:'NOT_FOUND'});}
    if(request.url.endsWith('/keys'))return {snapshot:{keyState:'ready'},envelopes:[]};
    reads++;return {items:[],hasMore:false,nextAfter:'0'};
  }};
  assert.equal((await createEncryptedChat(api,f.identity,f.store).page(room)).items.length,0);assert.equal(f.records.size,0);assert.equal(sent,1);assert.equal(reads,1);
});
