import { sodium, seal, open, aad } from '../crypto/sodium.js';
import { outboxStore } from '../crypto/outbox-store.js';
import { routes } from '../data/http/routes.js';
import { DataError } from '../data/errors.js';

const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const versionList=snapshot=>snapshot.recipients.map(({userId,identityVersion})=>({userId,identityVersion}));
export function createEncryptedChat(api,identity,store=outboxStore){
  const call=(name,...args)=>api.request(routes[`chat.${name}`](...args));
  const roomLocks=new Map(),rotating=new Map();
  let rotationTimer,priorityRoom;
  const rotate=(room,context)=>{
    if(!rotating.has(room))rotating.set(room,ready(room,context).finally(()=>rotating.delete(room)));
    return rotating.get(room);
  };
  const rotateLater=rooms=>{
    clearTimeout(rotationTimer);
    rotationTimer=setTimeout(async()=>{
      for(const room of [...rooms].sort((a,b)=>(b===priorityRoom)-(a===priorityRoom))){
        try{await identity.withKeys(context=>rotate(room,context));}
        catch{/* Polling/refocus retries against a fresh session and recipient snapshot. */}
      }
    },100);
  };
  async function locked(room,work){
    if(globalThis.navigator?.locks)return navigator.locks.request(`polylink-outbox:${room}`,work);
    const previous=roomLocks.get(room)||Promise.resolve();const next=previous.catch(()=>{}).then(work);roomLocks.set(room,next);
    try{return await next;}finally{if(roomLocks.get(room)===next)roomLocks.delete(room);}
  }
  async function roomKey(room,bundle,version,context){
    const s=await sodium(),historical=bundle.envelopes.find(e=>e.keyVersion===version);
    if(!historical)throw new DataError('KEY_MISSING','The encrypted message key is unavailable.');
    const envelope=historical.envelope,own=context.vault.identities.find(i=>i.version===envelope.identityVersion);
    if(!own||envelope.userId!==context.session.user.id)throw new DataError('DATA_INTEGRITY','Invalid room key owner.');
    const from=value=>s.from_base64(value,s.base64_variants.URLSAFE_NO_PADDING);
    const privateKey=from(own.privateKey);let plain;
    try{
      plain=s.crypto_box_seal_open(from(envelope.sealedPacket),from(own.publicKey),privateKey);
      const tuple=JSON.parse(decoder.decode(plain));
      const expected=['PLK1','room-key',room,context.session.user.id,own.version,historical.membershipVersion,version];
      if(tuple.length!==8||expected.some((v,i)=>v!==tuple[i]))throw new Error('Room key binding mismatch.');
      const key=from(tuple[7]);if(key.length!==32)throw new Error('Invalid room key.');return key;
    }finally{privateKey.fill(0);plain?.fill(0);}
  }
  async function ready(room,context){
    for(let attempt=0;attempt<3;attempt++){
      const bundle=await call('keys',room),snapshot=bundle.snapshot;
      if(snapshot.keyState==='ready')return bundle;
      if(snapshot.keyState==='recipient_unconfigured')throw new DataError('ROOM_KEY_PENDING','A participant has not completed encrypted account setup.');
      const s=await sodium(),key=s.randombytes_buf(32),b64=bytes=>s.to_base64(bytes,s.base64_variants.URLSAFE_NO_PADDING);
      const version=(BigInt(snapshot.versions.roomKey)+1n).toString();
      try{
        const envelopes=snapshot.recipients.map(recipient=>({userId:recipient.userId,identityVersion:recipient.identityVersion,sealedPacket:b64(s.crypto_box_seal(encoder.encode(JSON.stringify(['PLK1','room-key',room,recipient.userId,recipient.identityVersion,snapshot.versions.membership,version,b64(key)])),s.from_base64(recipient.publicKey,s.base64_variants.URLSAFE_NO_PADDING)))}));
        await call('activate',room,{expected:snapshot,newKeyVersion:version,envelopes});
      }catch(error){if(error.code!=='REVISION_CONFLICT')throw error;}
      finally{key.fill(0);}
    }
    throw new DataError('REVISION_CONFLICT','Conversation keys changed. Please retry.');
  }
  async function decrypt(message,bundle,context){
    if(message.deleted)return {...message,sender:message.sender||{id:'',name:''},text:'Message deleted',attachment:null};
    let key,plain;
    try{
      key=await roomKey(message.roomId,bundle,message.keyVersion,context);
      plain=await open(message.packet,key,aad('message',message.roomId,message.sender.id,message.operationId,message.keyVersion,message.membershipVersion));
      if(plain.length>32768)throw new Error();
      const content=JSON.parse(decoder.decode(plain));
      if(typeof content.text!=='string'||content.text!==content.text.trim()||!content.text.length||content.text.length>5000||content.attachment!==null)throw new Error();
      return {...message,text:content.text,attachment:null};
    }catch{throw new DataError('DATA_INTEGRITY','An encrypted message could not be authenticated.');}
    finally{key?.fill(0);plain?.fill(0);}
  }
  const outboxId=(context,room)=>`${context.session.user.id}:${room}`;
  const binding=(context,room,id)=>aad('outbox',context.session.user.id,room,id,context.session.versions.vaultKey);
  async function pending(context,room){
    let record;try{record=await store.get(outboxId(context,room));}catch{throw new DataError('STORAGE_UNAVAILABLE','Encrypted outbox storage is unavailable. Enable secure browser storage before sending.');}if(!record)return null;
    const plain=await open(record.packet,context.vaultKey,binding(context,room,record.operationId));
    try{return JSON.parse(decoder.decode(plain));}finally{plain.fill(0);}
  }
  async function flush(context,room,operation){
    if(operation.result)return operation.result;
    try{
      const saved=await call('send',room,operation.request);
      operation.result=saved;
      const operationId=operation.request.operationId;
      const packet=await seal(JSON.stringify(operation),context.vaultKey,binding(context,room,operationId));
      await store.put({id:outboxId(context,room),account:context.session.user.id,operationId,packet});return saved;
    }catch(error){
      // A network error, 5xx or expired session is ambiguous. Keep the exact bytes.
      if(['KEY_STALE_NOT_SAVED','ROOM_KEY_PENDING','FORBIDDEN','VALIDATION'].includes(error.code))await store.remove(outboxId(context,room));
      throw error;
    }
  }
  return {
    async resumeRotation(){return identity.withKeys(async()=>{
      let cursor=null;const rooms=[];
      do{const page=await call('list',{...(cursor?{cursor}:{}),limit:100});rooms.push(...page.items);cursor=page.nextCursor;}while(cursor);
      rotateLater(rooms.filter(room=>room.canSend&&room.keySnapshot?.keyState!=='ready').map(room=>room.id));
    });},
    async list(){return identity.withKeys(async context=>{
      let cursor=null;const rooms=[];
      do{const page=await call('list',{...(cursor?{cursor}:{}),limit:100});rooms.push(...page.items);cursor=page.nextCursor;}while(cursor);
      for(const room of rooms){
        room.unreadCount=BigInt(room.unreadCount)===0n?0:room.unreadCount;
        if(room.lastMessage){const bundle=await call('keys',room.id);room.lastMessage=await decrypt(room.lastMessage,bundle,context);}
      }
      rotateLater(rooms.filter(room=>room.canSend&&room.keySnapshot?.keyState!=='ready').map(room=>room.id));
      return rooms;
    });},
    openDirect:target=>identity.withKeys(()=>call('openDirect',typeof target==='object'?target.id:target)),
    async messages(room){priorityRoom=room;return locked(room,()=>identity.withKeys(async context=>{
      let operation;try{operation=await pending(context,room);}catch(error){if(error.code!=='STORAGE_UNAVAILABLE')throw error;}if(operation)await flush(context,room,operation);
      const bundle=await call('keys',room);
      // Start the open room immediately; historical envelopes remain readable during rotation.
      if(bundle.snapshot.keyState!=='ready')rotate(room,context).catch(()=>{});
      let after='0';const items=[];
      do{
        const page=await call('messages',room,{after,limit:100});
        for(const message of page.items)items.push(await decrypt(message,bundle,context));
        if(!page.hasMore)break;
        if(BigInt(page.nextAfter)<=BigInt(after))throw new DataError('CONTRACT','History cursor did not advance.');after=page.nextAfter;
      }while(true);
      return items;
    }));},
    async send(room,{text='',file}={}){return locked(room,()=>identity.withKeys(async context=>{
      if(file)throw new DataError('UNSUPPORTED','Encrypted images are planned for M5.');
      text=text.trim();if(!text||text.length>5000)throw new DataError('VALIDATION','Enter 1–5,000 characters.');
      const old=await pending(context,room);
      if(old){const saved=await flush(context,room,old);await store.remove(outboxId(context,room));if(old.text!==text)throw new DataError('OUTBOX_RESOLVED','Your previous message was delivered. Send this draft again.');return saved;}
      const bundle=await ready(room,context),snapshot=bundle.snapshot,operationId=crypto.randomUUID();let key;
      try{
        key=await roomKey(room,bundle,snapshot.versions.roomKey,context);
        const packet=await seal(JSON.stringify({text,attachment:null}),key,aad('message',room,context.session.user.id,operationId,snapshot.versions.roomKey,snapshot.versions.membership));
        const operation={text,request:{operationId,expected:snapshot.versions,recipientVersions:versionList(snapshot),packet,attachmentId:null}};
        const encrypted=await seal(JSON.stringify(operation),context.vaultKey,binding(context,room,operationId));
        await store.put({id:outboxId(context,room),account:context.session.user.id,operationId,packet:encrypted});
        const saved=await flush(context,room,operation);await store.remove(outboxId(context,room));return saved;
      }finally{key?.fill(0);}
    }));},
    // Personal-state routes stay unavailable until M5. Basic M2 reads never acknowledge unseen messages.
    async read(){},
    async mute(){throw new DataError('UNSUPPORTED','Personal conversation settings are planned for M5.');},
    async hide(){throw new DataError('UNSUPPORTED','Personal conversation settings are planned for M5.');},
    async block(){throw new DataError('UNSUPPORTED','Personal conversation settings are planned for M5.');},
    subscribe(listener){
      let timer,stopped=false;
      const tick=()=>{if(stopped)return;if(document.visibilityState!=='hidden')listener({operation:'chat.incoming'});timer=setTimeout(tick,2500);};
      const visible=()=>{if(document.visibilityState!=='hidden')listener({operation:'chat.incoming'});};
      timer=setTimeout(tick,2500);document.addEventListener('visibilitychange',visible);globalThis.addEventListener('online',visible);
      return()=>{stopped=true;clearTimeout(timer);clearTimeout(rotationTimer);document.removeEventListener('visibilitychange',visible);globalThis.removeEventListener('online',visible);};
    }
  };
}
