import assert from 'node:assert/strict';
import {origin,api,password,email,contexts,errors,payloads,sends,context,proof,call,chat,image,downloadCode} from './browser-support.mjs';
try{
  const {p}=await context('mock',true);const ids=await p.evaluate(async()=>{const {transaction}=await import('/js/data/mock/store.js');return transaction(state=>{const users=state.users.filter(u=>u.status==='active');state.sessionUserId=users[0].id;return users.slice(0,3).map(u=>u.id);},{write:true});});
  const who=id=>p.evaluate(async id=>{const {transaction}=await import('/js/data/mock/store.js');await transaction(state=>{state.sessionUserId=id;},{write:true});},id);
  const room=(await chat(p,'createGroup',{name:'M6 mock group',userIds:[ids[1]]})).roomId;await chat(p,'send',room,{text:'M6 mock earlier'});await who(ids[1]);await assert.rejects(chat(p,'renameGroup',room,'Forbidden'));await chat(p,'send',room,{text:'M6 mock own old interval'});await who(ids[0]);
  await chat(p,'addParticipant',room,ids[2]);await who(ids[2]);assert.equal((await chat(p,'messages',room)).length,0);await who(ids[0]);await chat(p,'removeParticipant',room,ids[1]);await chat(p,'addParticipant',room,ids[1]);await who(ids[1]);assert.equal((await chat(p,'messages',room)).length,0);assert.equal((await call(p,'settings','export')).messages.filter(m=>m.roomId===room).length,0);
  await chat(p,'block',ids[0],true);await chat(p,'send',room,{text:'M6 mock group ignores block'});await who(ids[0]);await chat(p,'transferOwner',room,ids[1]);await chat(p,'leaveGroup',room);await who(ids[1]);await chat(p,'removeParticipant',room,ids[2]);await chat(p,'send',room,{text:'M6 mock one member'});
  await p.goto(origin+'/message.html?room='+room);await p.locator('.messages').getByText('M6 mock one member',{exact:false}).first().waitFor();assert(await p.locator('.message-input input').isEnabled());assert.equal(errors.length,0,errors.join('\n'));
  await chat(p,'block',ids[0],false);const direct=(await chat(p,'openDirect',ids[0])).id;await chat(p,'send',direct,{text:'M6 mock deleted body'});
  await p.evaluate(async id=>{const {transaction}=await import('/js/data/mock/store.js');const address=await transaction(state=>state.users.find(u=>u.id===id).email);const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${address}:Mock M6 password!8`));const digest=[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');await transaction(state=>{state.credentials[id]=digest;},{write:true});},ids[1]);
  await call(p,'settings','deleteAccount',[{password:'Mock M6 password!8'}]);await p.waitForURL(origin+'/login.html',{waitUntil:'load'});await who(ids[0]);
  assert((await chat(p,'list')).find(r=>r.id===direct).closed);assert((await chat(p,'messages',direct)).some(m=>m.deleted));
  console.log('M6 mock browser acceptance passed: roles, membership cutoffs, rejoin export, ownership, blocks and one-member groups.');
}finally{for(const ctx of contexts)await ctx.close();}
