import assert from 'node:assert/strict';
import {origin,api,password,email,contexts,errors,payloads,sends,context,proof,call,chat,image,downloadCode} from './browser-support.mjs';
try{
  // Recipients publish fully backed-up identities once, then go offline.
  const a=await context(1),offline=[];let unconfiguredId;
  for(let i=1;i<=4;i++){
    const entry=i===1?a:await context(i);const challenge=await call(entry.p,'auth','register',[{email:email(i),password,firstName:'M6',lastName:`User${i}`,role:'graduate'}]);
    await call(entry.p,'auth','verifyEmail',[{challengeId:challenge.challengeId,code:await proof(email(i))}]);
    if(i<4){await call(entry.p,'auth','login',[{email:email(i),password}]);const user=await call(entry.p,'auth','me');offline.push(user.id);}
    else{const people=await call(a.p,'search','people',[{q:'M6 User4'}]);unconfiguredId=people[0].id;}
    if(i>1)await entry.ctx.close();
  }
  const [au,bu,cu]=offline;
  await a.p.goto(origin+'/message.html');await a.p.getByRole('button',{name:'Create group',exact:true}).click();
  const dialog=a.p.getByRole('dialog',{name:'Group management'});await dialog.getByRole('textbox',{name:'Group name'}).fill('M6 offline study');await dialog.getByRole('searchbox',{name:'Find people'}).fill('M6 User2');
  await dialog.getByRole('button',{name:'Select',exact:true}).click();assert.equal(await dialog.getByRole('textbox',{name:'Group name'}).inputValue(),'M6 offline study');
  await dialog.getByRole('button',{name:'Create group',exact:true}).click();await dialog.waitFor({state:'hidden'});
  await a.p.waitForFunction(()=>new URLSearchParams(location.search).has('room'));const room=new URL(a.p.url()).searchParams.get('room');
  await chat(a.p,'send',room,{text:'M6 secret before addition'});await a.p.locator('.message-input input').fill('M6 draft survives membership changes');
  await a.p.locator('.menu-btn').click();await a.p.getByRole('button',{name:'Group members',exact:false}).click();
  await dialog.getByRole('searchbox',{name:'Find people'}).fill('M6 User4');await dialog.getByRole('button',{name:'Add member',exact:true}).click();await dialog.getByRole('status').filter({hasText:'must finish encrypted account setup'}).waitFor();assert.equal((await chat(a.p,'participants',room)).participants.length,2);
  await dialog.getByRole('searchbox',{name:'Find people'}).fill('M6 User3');await dialog.getByRole('button',{name:'Add member',exact:true}).click();await a.p.waitForFunction(async room=>{const {chat}=await import('/js/services/index.js');return (await chat.participants(room)).participants.length===3;},room);
  await dialog.getByRole('textbox',{name:'Group name'}).fill('M6 renamed group');await dialog.getByRole('button',{name:'Save name',exact:true}).click();
  await a.p.waitForFunction(async room=>{const {chat}=await import('/js/services/index.js');return (await chat.participants(room)).name==='M6 renamed group';},room);
  await a.p.waitForFunction(()=>[...document.querySelectorAll('.group-dialog button')].some(button=>button.textContent==='Close'&&!button.disabled));
  if(process.env.M6_SCREENSHOT)await a.p.screenshot({path:process.env.M6_SCREENSHOT});
  await dialog.getByRole('button',{name:'Close',exact:true}).click();assert.equal(await a.p.locator('.message-input input').inputValue(),'M6 draft survives membership changes');
  const b=await context(2),c=await context(3);assert.equal((await chat(b.p,'messages',room)).length,1);assert.equal((await chat(c.p,'messages',room)).length,0);
  await chat(c.p,'send',room,{text:'M6 secret after addition'});assert.equal((await chat(b.p,'messages',room)).length,2);
  const oldImage=await image(b.p,room);const oldRequest=sends.at(-1);assert.equal((await call(c.p,'settings','export')).messages.length,1);
  let lost=false;await a.ctx.route(api+`/chat/rooms/${room}/participants/${bu}`,async route=>{if(route.request().method()==='DELETE'&&!lost){const response=await route.fetch();assert.equal(response.status(),200);lost=true;await route.abort('failed');}else await route.continue();});
  await assert.rejects(chat(a.p,'removeParticipant',room,bu));assert(lost);await a.ctx.close();
  await assert.rejects(chat(b.p,'messages',room));await c.p.goto(origin+'/message.html?room='+room);
  await c.p.waitForFunction(async room=>{const {chat}=await import('/js/services/index.js');return (await chat.participants(room)).keySnapshot.keyState==='ready';},room);
  const back=await context(1);const receipt=await chat(back.p,'removeParticipant',room,bu);assert.equal(receipt.membershipVersion,'3');
  await chat(back.p,'addParticipant',room,bu);assert.equal((await chat(b.p,'messages',room)).length,0);assert.equal(await downloadCode(b.p,oldImage.attachmentId),'NOT_FOUND');
  const replay=await b.p.evaluate(async({room,request})=>{const {loadTransport}=await import('/js/data/http/transport.js');const api=await loadTransport();await api.restore();try{await api.request({method:'post',url:`/chat/rooms/${room}/messages`,data:request});return 'allowed';}catch(e){return e.code;}},{room,request:oldRequest});assert.equal(replay,'NOT_FOUND');
  assert.equal((await call(b.p,'settings','export')).messages.length,0);
  await chat(b.p,'block',au,true);await chat(b.p,'send',room,{text:'M6 group ignores direct block'});const ownImage=await image(b.p,room);const exported=await call(b.p,'settings','export');assert.equal(exported.messages.length,2);assert(exported.messages.at(-1).attachment.data);assert(!JSON.stringify(exported).includes('privateKey'));assert(!JSON.stringify(exported).includes('sealedPacket'));
  await chat(back.p,'transferOwner',room,cu);await chat(back.p,'leaveGroup',room);assert.equal((await chat(c.p,'participants',room)).ownerId,cu);
  await call(c.p,'settings','deleteAccount',[{password}]);assert.equal((await chat(b.p,'participants',room)).ownerId,bu);assert.equal((await chat(b.p,'messages',room)).length,2);
  await chat(b.p,'send',room,{text:'M6 surviving single member'});
  // A lost create response never creates a second room, even after a reload.
  const d=await context(4);await call(d.p,'auth','login',[{email:email(4),password}]);
  let lostCreate=false;await b.ctx.route(api+'/chat/groups',async route=>{if(!lostCreate){const response=await route.fetch();assert.equal(response.status(),200);lostCreate=true;await route.abort('failed');}else await route.continue();});
  const draft={name:'M6 durable create',userIds:[unconfiguredId]};await assert.rejects(chat(b.p,'createGroup',draft));await b.p.reload();const created=await chat(b.p,'createGroup',draft);assert(created.roomId);assert.equal((await chat(b.p,'list')).filter(r=>r.name==='M6 durable create').length,1);
  await call(d.p,'settings','deactivate',[{password}]);assert.equal(await call(d.p,'auth','me'),null);
  assert(!payloads.some(body=>body.includes('M6 secret ')||body.includes(password)||body.includes('private-image-name.png')));assert.equal(errors.length,0,errors.join('\n'));
  console.log('M6 browser acceptance passed: offline create/add, owner controls, missing keys, draft retention, removal/rejoin, rotation resumption, durable lost replies, own image export, deletion succession and deactivation.');
}catch(error){for(const ctx of contexts)for(const p of ctx.pages())console.error('M6 page:',p.url(),'alerts:',await p.locator('[role=alert]').allTextContents().catch(()=>[]));console.error('Page errors:',errors);throw error;}
finally{for(const ctx of contexts)await ctx.close();}
