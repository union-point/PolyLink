import { encryptImage, decryptImage, imageMetadata } from '../crypto/images.js';
import { sodium, seal, open, aad } from '../crypto/sodium.js';
import { outboxStore } from '../crypto/outbox-store.js';
import { routes } from '../data/http/routes.js';
import { DataError } from '../data/errors.js';

const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const versionList=snapshot=>snapshot.recipients.map(({userId,identityVersion})=>({userId,identityVersion}));
export function createEncryptedChat(api,identity,store=outboxStore){
  const call=(name,...args)=>api.request(routes[`chat.${name}`](...args));
  const roomLocks=new Map(),rotating=new Map(),images=new Map();let imageScope,imageGeneration=0;
  const release=room=>{imageGeneration++;for(const [id,entry]of images)if(!room||entry.room===room){URL.revokeObjectURL(entry.url);images.delete(id);}};
  identity.subscribe?.(event=>{if(['auth.logout','auth.revoked','auth.login','auth.version'].includes(event.operation))release();});
  globalThis.addEventListener?.('pagehide',()=>release());
  function scope(context){const value=JSON.stringify([context.session.user.id,context.session.familyId,context.session.versions]);if(value!==imageScope){release();imageScope=value;}}

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
  async function epoch(snapshot){
    const s=await sodium(),key=s.randombytes_buf(32),b64=bytes=>s.to_base64(bytes,s.base64_variants.URLSAFE_NO_PADDING);
    const version=(BigInt(snapshot.versions.roomKey)+1n).toString();
    try{return {expected:snapshot,newKeyVersion:version,envelopes:snapshot.recipients.map(recipient=>({userId:recipient.userId,identityVersion:recipient.identityVersion,sealedPacket:b64(s.crypto_box_seal(encoder.encode(JSON.stringify(['PLK1','room-key',snapshot.roomId,recipient.userId,recipient.identityVersion,snapshot.versions.membership,version,b64(key)])),s.from_base64(recipient.publicKey,s.base64_variants.URLSAFE_NO_PADDING)))}))};}
    finally{key.fill(0);}
  }
  async function ready(room,context){
    for(let attempt=0;attempt<3;attempt++){
      const bundle=await call('keys',room),snapshot=bundle.snapshot;
      if(snapshot.keyState==='ready')return bundle;
      if(snapshot.keyState==='recipient_unconfigured')throw new DataError('ROOM_KEY_PENDING','A participant has not completed encrypted account setup.');
      try{await call('activate',room,await epoch(snapshot));}
      catch(error){if(error.code!=='REVISION_CONFLICT')throw error;}
    }
    throw new DataError('REVISION_CONFLICT','Conversation keys changed. Please retry.');
  }
  async function decrypt(message,bundle,context,loadImage=true,signal){
    scope(context);const openingImageGeneration=imageGeneration;
    if(message.deleted)return {...message,sender:message.sender||{id:'',name:''},text:'Message deleted',attachment:null};
    let key,plain;
    try{
      key=await roomKey(message.roomId,bundle,message.keyVersion,context);
      plain=await open(message.packet,key,aad('message',message.roomId,message.sender.id,message.operationId,message.keyVersion,message.membershipVersion));
      if(plain.length>32768)throw new Error();
      const content=JSON.parse(decoder.decode(plain));
      if(Object.keys(content).sort().join(',')!=='attachment,text'||typeof content.text!=='string'||content.text!==content.text.trim()||content.text.length>5000||(!content.text&&!content.attachment))throw new Error();
      let attachment=null;
      if(content.attachment){
        const meta=imageMetadata(content.attachment);if(meta.id!==message.attachmentId)throw new Error();
        attachment={id:meta.id,name:meta.name,type:meta.type,size:meta.size};
        if(loadImage){
          const cached=images.get(meta.id),fingerprint=JSON.stringify(meta);
          if(cached&&(cached.fingerprint!==fingerprint||cached.room!==message.roomId||cached.owner!==message.sender.id))throw new Error();
          if(cached)attachment.url=cached.url;
          else{
            const bytes=new Uint8Array(await api.request({...routes['chat.download'](meta.id),signal}));
            const blob=await decryptImage(bytes,meta,message.roomId,message.sender.id);
            if(signal?.aborted)throw new DOMException('Selection changed','AbortError');
            if(openingImageGeneration!==imageGeneration)throw new DataError('SESSION_CHANGED','Your session changed.');
            const url=URL.createObjectURL(blob);images.set(meta.id,{url,room:message.roomId,owner:message.sender.id,fingerprint});attachment.url=url;
          }
        }
      }else if(message.attachmentId)throw new Error();
      return {...message,text:content.text,attachment};
    }catch(error){if(error.retryable||['UNAUTHORIZED','SESSION_CHANGED','NOT_FOUND'].includes(error.code))throw error;throw new DataError('DATA_INTEGRITY','An encrypted message could not be authenticated.');}
    finally{key?.fill(0);plain?.fill(0);}
  }
  const outboxId=(context,room)=>`${context.session.user.id}:${room}`;
  const binding=(context,room,id)=>aad('outbox',context.session.user.id,room,id,context.session.versions.vaultKey);
  async function pending(context,room){
    let record;try{record=await store.get(outboxId(context,room));}catch{throw new DataError('STORAGE_UNAVAILABLE','Encrypted outbox storage is unavailable. Enable secure browser storage before sending.');}if(!record)return null;
    const plain=await open(record.packet,context.vaultKey,binding(context,room,record.operationId),12*1024*1024);
    try{return JSON.parse(decoder.decode(plain));}finally{plain.fill(0);}
  }
  async function persist(context,room,operation){
    const operationId=operation.request.operationId,packet=await seal(JSON.stringify(operation),context.vaultKey,binding(context,room,operationId));
    await store.put({id:outboxId(context,room),account:context.session.user.id,operationId,packet});
  }
  async function flush(context,room,operation){
    if(operation.result)return operation.result;
    const s=await sodium();
    try{
      if(operation.upload)await call('upload',room,operation.upload.id,s.from_base64(operation.upload.ciphertext,s.base64_variants.URLSAFE_NO_PADDING));
      const saved=await call('send',room,operation.request);
      operation.result=saved;delete operation.upload;delete operation.attachment;
      await persist(context,room,operation);return saved;
    }catch(error){
      // An upload/send timeout or 5xx remains ambiguous. Preserve the exact original bytes.
      if(['KEY_STALE_NOT_SAVED','ROOM_KEY_PENDING','FORBIDDEN','VALIDATION','ATTACHMENT_UNAVAILABLE_NOT_SAVED','NOT_FOUND'].includes(error.code)){
        if(operation.upload&&!['ATTACHMENT_UNAVAILABLE_NOT_SAVED','NOT_FOUND'].includes(error.code)){operation.rejected=true;await persist(context,room,operation);}
        else await store.remove(outboxId(context,room));
      }
      throw error;
    }
  }
  async function page(room,params={}){priorityRoom=room;return locked(room,()=>identity.withKeys(async context=>{
    let operation;try{operation=await pending(context,room);}catch(error){if(error.code!=='STORAGE_UNAVAILABLE')throw error;}
    if(operation&&!operation.rejected)try{await flush(context,room,operation);}catch(error){if(error.code!=='NOT_FOUND')throw error;}
    const bundle=await call('keys',room);
    if(bundle.snapshot.keyState!=='ready')rotate(room,context).catch(()=>{});
    const {signal,...query}=params;
    if(signal?.aborted)throw new DOMException('Selection changed','AbortError');
    const response=await api.request({...routes['chat.messages'](room,{...query,limit:query.limit??50}),signal});
    const items=[];for(const message of response.items){if(signal?.aborted)throw new DOMException('Selection changed','AbortError');items.push(await decrypt(message,bundle,context,true,signal));}
    return {...response,items};
  }));}
  async function groupMutation(action,room,details={}){
    const slot=action==='create'?'group-create':`group:${room}`,signature=JSON.stringify([action,room,details]);
    return locked(slot,()=>identity.withKeys(async context=>{
      async function deliver(operation){
        if(!operation.result){operation.result=await call(operation.route,...operation.args);await persist(context,slot,operation);}
        const result=operation.result;await store.remove(outboxId(context,slot));release(room);rotateLater([result.roomId]);return result;
      }
      const prior=await pending(context,slot);
      if(prior){
        try{const result=await deliver(prior);if(prior.signature!==signature)throw new DataError('OUTBOX_RESOLVED','Your previous group action completed. Review the group and try this action again.');return result;}
        catch(error){if(['REVISION_CONFLICT','RECIPIENT_UNCONFIGURED','VALIDATION','FORBIDDEN','NOT_FOUND','OWNER_TRANSFER_REQUIRED'].includes(error.code))await store.remove(outboxId(context,slot));if(error.code!=='REVISION_CONFLICT')throw error;}
      }
      for(let attempt=0;attempt<3;attempt++){
        const operationId=crypto.randomUUID();let args,route;
        if(action==='create'){
          const roomId=crypto.randomUUID(),snapshot=await call('prepareGroup',{roomId,userIds:details.userIds});
          route='createGroup';args=[{operationId,roomId,name:details.name.trim(),activation:await epoch(snapshot)}];
        }else{
          const current=await call('participants',room);
          const data={operationId,expectedMembership:current.keySnapshot.versions.membership,expectedMetadata:current.metadataVersion,...details};
          if(action==='add'){
            const snapshot=await call('prepareAddition',room,{roomId:room,userIds:[details.userId]});data.activation=await epoch(snapshot);
          }
          route={add:'addParticipant',remove:'removeParticipant',leave:'leaveGroup',rename:'renameGroup',owner:'transferOwner'}[action];
          args=action==='remove'?[room,details.userId,{...data,userId:undefined}]:[room,data];
        }
        const operation={signature,route,args,request:{operationId}};await persist(context,slot,operation);
        try{return await deliver(operation);}
        catch(error){
          if(['REVISION_CONFLICT','RECIPIENT_UNCONFIGURED','VALIDATION','FORBIDDEN','NOT_FOUND','OWNER_TRANSFER_REQUIRED'].includes(error.code))await store.remove(outboxId(context,slot));
          if(error.code!=='REVISION_CONFLICT'||attempt===2)throw error;
        }
      }
    }));
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
        if(room.lastMessage){const bundle=await call('keys',room.id);room.lastMessage=await decrypt(room.lastMessage,bundle,context,false);}
      }
      rotateLater(rooms.filter(room=>room.canSend&&room.keySnapshot?.keyState!=='ready').map(room=>room.id));
      return rooms;
    });},
    saveDraft:(room,text)=>locked(`draft:${room}`,()=>identity.withKeys(async context=>{if(text){await persist(context,`draft:${room}`,{text,request:{operationId:crypto.randomUUID()}});}else await store.remove(outboxId(context,`draft:${room}`));})),
    loadDraft:room=>identity.withKeys(async context=>{try{return (await pending(context,`draft:${room}`))?.text||'';}catch(error){if(error.code==='STORAGE_UNAVAILABLE')return '';throw error;}}),
    createGroup:({name,userIds})=>groupMutation('create',null,{name,userIds}),
    participants:room=>identity.withKeys(()=>call('participants',room)),
    addParticipant:(room,userId)=>groupMutation('add',room,{userId:String(userId)}),
    removeParticipant:(room,userId)=>groupMutation('remove',room,{userId:String(userId)}),
    leaveGroup:room=>groupMutation('leave',room),
    renameGroup:(room,name)=>groupMutation('rename',room,{name:name.trim()}),
    transferOwner:(room,userId)=>groupMutation('owner',room,{userId:String(userId)}),
    async exportOwn(){return identity.withKeys(async context=>{
      const messages=[];let cursor=null;
      do{
        const response=await call('exportOwn',{...(cursor?{cursor}:{}),limit:50});
        for(const item of response.items){const bundle=await call('keys',item.roomId),message=await decrypt(item,bundle,context);if(message.attachment?.url){const blob=await(await fetch(message.attachment.url)).blob();const bytes=new Uint8Array(await blob.arrayBuffer());const s=await sodium();message.attachment={id:message.attachment.id,name:message.attachment.name,type:message.attachment.type,size:message.attachment.size,data:s.to_base64(bytes,s.base64_variants.ORIGINAL)};}messages.push({id:message.id,roomId:message.roomId,sequence:message.sequence,createdAt:message.createdAt,text:message.text,attachment:message.attachment,deleted:message.deleted});}
        cursor=response.nextCursor;
      }while(cursor);
      return {exportedAt:new Date().toISOString(),user:context.session.user,messages};
    });},
    openDirect:target=>identity.withKeys(()=>call('openDirect',typeof target==='object'?target.id:target)),
    page,
    release:room=>release(room),
    async messages(room){
      let after='0';const items=[];
      do{const response=await page(room,{after,limit:100});items.push(...response.items);if(!response.hasMore)break;
        if(BigInt(response.nextAfter)<=BigInt(after))throw new DataError('CONTRACT','History cursor did not advance.');after=response.nextAfter;
      }while(true);return items;
    },
    async send(room,{text='',file}={}){return locked(room,()=>identity.withKeys(async context=>{
      text=text.trim();if(text.length>5000)throw new DataError('VALIDATION','Enter at most 5,000 characters.');
      const old=await pending(context,room);
      let prepared=file?await encryptImage(file,room,context.session.user.id):null;
      if(old&&!old.rejected){
        const saved=await flush(context,room,old);await store.remove(outboxId(context,room));
        if(old.text!==text||old.fileSignature!==(prepared?.fileSignature))throw new DataError('OUTBOX_RESOLVED','Your previous message was delivered. Send this draft again.');return saved;
      }
      // Only an explicit unsaved rejection permits a fresh message operation. Reuse immutable staged bytes.
      if(old?.rejected&&old.upload&&prepared&&prepared.fileSignature===old.fileSignature)prepared={upload:old.upload,attachment:old.attachment,fileSignature:old.fileSignature};
      if(!text&&!prepared)throw new DataError('VALIDATION','Enter a message or choose an image.');
      for(let attempt=0;attempt<3;attempt++){
        const bundle=await ready(room,context),snapshot=bundle.snapshot,operationId=crypto.randomUUID();let key;
        try{
          key=await roomKey(room,bundle,snapshot.versions.roomKey,context);
          const packet=await seal(JSON.stringify({text,attachment:prepared?.attachment??null}),key,aad('message',room,context.session.user.id,operationId,snapshot.versions.roomKey,snapshot.versions.membership));
          const operation={text,...(prepared??{}),request:{operationId,expected:snapshot.versions,recipientVersions:versionList(snapshot),packet,attachmentId:prepared?.attachment.id??null}};
          await persist(context,room,operation);
          try{const saved=await flush(context,room,operation);await store.remove(outboxId(context,room));return saved;}
          catch(error){if(!['KEY_STALE_NOT_SAVED','ROOM_KEY_PENDING'].includes(error.code)||attempt===2)throw error;}
        }finally{key?.fill(0);}
      }
    }));},
    read:(room,throughSequence)=>identity.withKeys(()=>call('read',room,String(throughSequence))),
    mute:(room,value)=>identity.withKeys(()=>call('mute',room,value)),
    hide:room=>identity.withKeys(async()=>{const result=await call('hide',room);release(room);return result;}),
    block:(target,value)=>identity.withKeys(()=>call('block',String(target),value)),
    subscribe(listener){
      const visible=()=>{if(document.visibilityState!=='hidden')listener({operation:'chat.incoming'});};
      document.addEventListener('visibilitychange',visible);globalThis.addEventListener('online',visible);globalThis.addEventListener('focus',visible);
      return()=>{clearTimeout(rotationTimer);release();document.removeEventListener('visibilitychange',visible);globalThis.removeEventListener('online',visible);globalThis.removeEventListener('focus',visible);};
    }
  };
}
