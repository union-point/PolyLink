import test from 'node:test';
import assert from 'node:assert/strict';
import { sodium,seal,aad } from '../../js/crypto/sodium.js';
import { encryptImage,decryptImage,imageLimit,validateImageBytes } from '../../js/crypto/images.js';
import { createEncryptedChat } from '../../js/chat/encrypted-client.js';
import { mergeMessages,messageShown } from '../../js/chat/history.js';
import { upgradeChatState,appendMessage,hideRoom,markRead,visibleMessages,messagePage,canSend,preference } from '../../js/data/mock/chat-state.js';
const s=await sodium(),b64=bytes=>s.to_base64(bytes,s.base64_variants.URLSAFE_NO_PADDING),room='10000000-0000-4000-8000-000000000001';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
function file(bytes=png,type='image/png'){const blob=new Blob([bytes],{type});Object.defineProperty(blob,'name',{value:'private-image-name.png'});return blob;}
function fixture(){
  const pair=s.crypto_box_keypair(),key=s.randombytes_buf(32),vaultKey=s.randombytes_buf(32);
  const context={session:{user:{id:'1'},versions:{vaultKey:'1'}},vaultKey,vault:{identities:[{version:'1',publicKey:b64(pair.publicKey),privateKey:b64(pair.privateKey)}]}};
  const snapshot={roomId:room,versions:{membership:'1',roomKey:'1'},keyState:'ready',recipients:[{userId:'1',identityVersion:'1',publicKey:b64(pair.publicKey)},{userId:'2',identityVersion:'1',publicKey:b64(pair.publicKey)}]};
  const bundle={snapshot,envelopes:[{keyVersion:'1',membershipVersion:'1',envelope:{userId:'1',identityVersion:'1',sealedPacket:b64(s.crypto_box_seal(JSON.stringify(['PLK1','room-key',room,'1','1','1','1',b64(key)]),pair.publicKey))}}]};
  const records=new Map(),store={get:async id=>structuredClone(records.get(id)),put:async record=>records.set(record.id,structuredClone(record)),remove:async id=>records.delete(id)};
  return {key,bundle,records,store,identity:{withKeys:work=>work(context)}};
}
test('images bind ciphertext to owner, room and ID and validate actual type and bounds',async()=>{
  const prepared=await encryptImage(file(),room,'1'),cipher=s.from_base64(prepared.upload.ciphertext,s.base64_variants.URLSAFE_NO_PADDING);
  assert.deepEqual(new Uint8Array(await(await decryptImage(cipher,prepared.attachment,room,'1')).arrayBuffer()),new Uint8Array(png));
  await assert.rejects(decryptImage(cipher,prepared.attachment,room,'2'),e=>e.code==='DATA_INTEGRITY');
  cipher[0]^=1;await assert.rejects(decryptImage(cipher,prepared.attachment,room,'1'),e=>e.code==='DATA_INTEGRITY');
  await assert.rejects(encryptImage(file(new TextEncoder().encode('pretend-image')),room,'1'));
  await assert.rejects(validateImageBytes(png,'image/jpeg'));
  await assert.rejects(encryptImage(file(new Uint8Array(imageLimit+1)),room,'1'));
});
test('maximum-sized image upload and send retries retain exact encrypted bytes across reloads',async()=>{
  const f=fixture(),bytes=new Uint8Array(imageLimit);bytes.set(png);let lostUpload=true,lostSend=true,upload,request;const uploads=[],sends=[];
  const api={request:async r=>{
    if(r.url.endsWith('/keys'))return f.bundle;
    if(r.url.endsWith('/attachments')){uploads.push(new Uint8Array(r.data));upload=new Uint8Array(r.data);if(lostUpload){lostUpload=false;throw Object.assign(new Error('Lost upload'),{code:'NETWORK'});}return {attachmentId:r.headers['X-Attachment-Id']};}
    if(r.method==='post'){sends.push(structuredClone(r.data));request=r.data;if(lostSend){lostSend=false;throw Object.assign(new Error('Lost send'),{code:'NETWORK'});}return {id:'saved',sequence:'1'};}
    if(r.url.startsWith('/chat/attachments/'))return upload.buffer;
    return {items:[{id:'saved',roomId:room,sequence:'1',operationId:request.operationId,keyVersion:'1',membershipVersion:'1',sender:{id:'1'},attachmentId:request.attachmentId,packet:request.packet}],nextAfter:'1',hasMore:false};
  }};
  await assert.rejects(createEncryptedChat(api,f.identity,f.store).send(room,{file:file(bytes)}));
  assert(!JSON.stringify([...f.records.values()]).includes('private-image-name.png'));assert(JSON.stringify([...f.records.values()]).length>imageLimit);
  await assert.rejects(createEncryptedChat(api,f.identity,f.store).messages(room));
  const client=createEncryptedChat(api,f.identity,f.store);const messages=await client.messages(room);
  assert.equal(messages.length,1);assert.equal(messages[0].text,'');assert(messages[0].attachment.url.startsWith('blob:'));
  assert.deepEqual(uploads[0],uploads[1]);assert.deepEqual(uploads[1],uploads[2]);assert.deepEqual(sends[0],sends[1]);client.release();
});
test('receiver rejects authenticated invalid plaintext and unexpected image bindings',async()=>{
  const f=fixture();
  for(const payload of [{text:'x'.repeat(5001),attachment:null},{text:' ',attachment:null},{text:'',attachment:null}]){
    const operationId=crypto.randomUUID(),packet=await seal(JSON.stringify(payload),f.key,aad('message',room,'1',operationId,'1','1'));
    const api={request:async r=>r.url.endsWith('/keys')?f.bundle:{items:[{id:'bad',roomId:room,sequence:'1',operationId,keyVersion:'1',membershipVersion:'1',sender:{id:'1'},packet}],nextAfter:'1',hasMore:false}};
    await assert.rejects(createEncryptedChat(api,f.identity,f.store).messages(room),e=>e.code==='DATA_INTEGRITY');
  }
});
test('history merges and mock personal state use BIGINT sequences rather than timestamps',()=>{
  assert.deepEqual(mergeMessages([{id:'b',sequence:'9007199254740993'}],[{id:'a',sequence:'9007199254740992'},{id:'b',sequence:'9007199254740993'}]).map(m=>m.id),['a','b']);
  const group={id:'g',isGroup:true,participants:['a','b'],preferences:{}},direct={id:'d',isGroup:false,participants:['a','b'],preferences:{}};
  const state={users:[{id:'a',status:'active'},{id:'b',status:'active'}],rooms:[group,direct],messages:[],blocks:[{userId:'a',targetId:'b'}]};upgradeChatState(state);
  assert(canSend(state,group));assert(!canSend(state,direct));
  const same='2026-10-18T10:00:00Z';appendMessage(state,group,{id:'1',roomId:'g',senderId:'b',createdAt:same});markRead(state,group,'a','1');hideRoom(group,'a');appendMessage(state,group,{id:'2',roomId:'g',senderId:'b',createdAt:same});
  assert(!preference(group,'a').hidden);assert.equal(preference(group,'a').historyCutoff,'1');assert.deepEqual(visibleMessages(state,group,'a').map(m=>m.id),['2']);
  assert.throws(()=>markRead(state,group,'a','3'));markRead(state,group,'a','2');markRead(state,group,'a','0');assert.equal(preference(group,'a').lastReadSequence,'2');
  assert.equal(messagePage(visibleMessages(state,group,'a'),{after:'1'}).nextAfter,'2');assert.equal(messagePage(visibleMessages(state,group,'a'),{before:'2'}).items.length,0);
});

test('viewport acknowledgement excludes unseen arrivals and handles a message taller than the viewport',()=>{
  const viewport={top:100,bottom:600,height:500};
  assert(messageShown({top:200,bottom:350,height:150},viewport));
  assert(!messageShown({top:610,bottom:760,height:150},viewport));
  assert(messageShown({top:-500,bottom:590,height:1090},viewport));
  assert(!messageShown({top:-100,bottom:700,height:800},viewport));
});
