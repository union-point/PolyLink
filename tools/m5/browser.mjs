import { isolateDecorativeAssets } from '../m1/browser-assets.mjs';
import { chromium } from '../m1/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
const phase=process.argv[2],origin=process.env.M1_FRONTEND,api=process.env.M1_API,baseEmail=process.env.M1_BROWSER_EMAIL;
const contexts=[],errors=[],payloads=[],uploads=[],sends=[],reads=[];
const email=index=>baseEmail.replace('browser-',`m5-${index}-`),password='M5 Browser fixture pass!8';
async function context(index,mock=false){
  const ctx=await chromium.launchPersistentContext(path.join(process.env.M1_ARTIFACT_DIR,`m5-${index}`),{headless:true,viewport:{width:1280,height:900},executablePath:process.env.M1_CHROMIUM||undefined});contexts.push(ctx);await isolateDecorativeAssets(ctx);ctx.setDefaultTimeout(30000);ctx.setDefaultNavigationTimeout(60000);
  await ctx.route('**/js/config.js',async route=>{const response=await route.fetch();let body=(await response.text()).replace('http://localhost:3004',api);if(mock)body=body.replace(/dataMode:\s*['"](?:http|mock)['"]/,"dataMode: 'mock'");await route.fulfill({response,body,contentType:'application/javascript'});});
  await ctx.route('**/axios@*/dist/axios.min.js',route=>route.fulfill({path:new URL('../m1/node_modules/axios/dist/axios.min.js',import.meta.url).pathname,contentType:'application/javascript'}));
  ctx.on('request',request=>{
    if(!request.url().startsWith(api))return;const data=request.postDataBuffer();
    if(request.url().endsWith('/attachments')&&data){assert(!data.includes(Buffer.from('private-image-name.png')));uploads.push({id:request.headers()['x-attachment-id'],hash:createHash('sha256').update(data).digest('hex'),length:data.length});}
    else if(data){const text=data.toString();payloads.push(text);if(request.url().endsWith('/messages')&&request.method()==='POST')sends.push(JSON.parse(text));if(request.url().endsWith('/read'))reads.push(JSON.parse(text).throughSequence);}
  });
  ctx.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));const p=ctx.pages()[0]||await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(origin+'/login.html');return {ctx,p};
}
async function proof(address){for(let i=0;i<30;i++){const listing=await(await fetch(process.env.M1_MAILPIT_URL+'/api/v1/messages')).json(),item=listing.messages.find(m=>m.To.some(to=>to.Address===address));if(item){const mail=await(await fetch(process.env.M1_MAILPIT_URL+'/api/v1/message/'+item.ID)).json();return mail.Text.match(/\b\d{6}\b/)[0];}await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('Missing capture email');}
const call=(p,feature,method,args=[])=>p.evaluate(async({feature,method,args})=>{const services=await import('/js/services/index.js');return services[feature][method](...args);},{feature,method,args});
const chat=(p,method,...args)=>call(p,'chat',method,args);
async function image(p,room,large=false,type='image/png'){
  return p.evaluate(async({room,large,type})=>{
    const canvas=document.createElement('canvas');canvas.width=2;canvas.height=2;canvas.getContext('2d').fillRect(0,0,2,2);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,type));const initial=new Uint8Array(await blob.arrayBuffer());
    const bytes=large?new Uint8Array(5*1024*1024):initial;if(large)bytes.set(initial);
    const {chat}=await import('/js/services/index.js');return chat.send(room,{file:new File([bytes],'private-image-name.png',{type})});
  },{room,large,type});
}
async function downloadCode(p,id){return p.evaluate(async id=>{const {loadTransport}=await import('/js/data/http/transport.js');const api=await loadTransport();await api.restore();try{await api.request({method:'get',url:'/chat/attachments/'+id,responseType:'arraybuffer'});return 'allowed';}catch(e){return e.code;}},id);}
async function anchor(p,id){return p.evaluate(id=>{const h=document.querySelector('.messages'),rect=h.getBoundingClientRect(),node=id?[...h.querySelectorAll('.message')].find(n=>n.dataset.messageId===id):[...h.querySelectorAll('.message')].find(n=>n.getBoundingClientRect().bottom>rect.top);return {id:node?.dataset.messageId,offset:node?node.getBoundingClientRect().top-rect.top:0,top:h.scrollTop};},id);}
try{
  if(phase==='setup'){
    for(let i=1;i<=3;i++){const {p}=await context(i);const challenge=await call(p,'auth','register',[{email:email(i),password,firstName:'M5',lastName:`User${i}`,role:'graduate'}]);await call(p,'auth','verifyEmail',[{challengeId:challenge.challengeId,code:await proof(email(i))}]);const result=await call(p,'auth','login',[{email:email(i),password}]);assert(!result.user.cryptoLocked);}
    console.log('M5 browser fixtures configured.');
  }else if(phase==='ui'){
    const a=await context(1),b=await context(2),c=await context(3);const au=await call(a.p,'auth','me'),bu=await call(b.p,'auth','me');
    const room=(await chat(a.p,'openDirect',bu.id)).id;
    await a.p.evaluate(async room=>{const {chat}=await import('/js/services/index.js');for(let i=0;i<125;i++)await chat.send(room,{text:`M5 history ${String(i).padStart(3,'0')}`});},room);
    await b.p.goto(origin+'/message.html?room='+room);await b.p.locator('.message').last().waitFor();assert.equal(await b.p.locator('.message').count(),50);
    await b.p.waitForFunction(async room=>{const {chat}=await import('/js/services/index.js');return (await chat.list()).find(r=>r.id===room)?.lastReadSequence==='125';},room);
    const before=await b.p.evaluate(()=>{const h=document.querySelector('.messages');h.scrollTop=0;const n=h.querySelector('.message');return {id:n.dataset.messageId,offset:n.getBoundingClientRect().top-h.getBoundingClientRect().top};});
    await b.p.waitForFunction(()=>document.querySelectorAll('.message').length===100);const after=await anchor(b.p,before.id);assert.equal(after.id,before.id);assert(Math.abs(after.offset-before.offset)<3,'Prepending must preserve the old first visible message');
    await b.p.locator('[data-load-earlier]').click();await b.p.waitForFunction(()=>document.querySelectorAll('.message').length===125);
    const anchored=await anchor(b.p);await chat(a.p,'send',room,{text:'M5 incoming while reading old history'});await b.p.locator('[data-new-messages]').waitFor({state:'visible',timeout:15000});
    const stable=await anchor(b.p);assert.equal(stable.id,anchored.id);assert(Math.abs(stable.offset-anchored.offset)<3);assert(!reads.includes('126'),'An off-screen arrival must not be acknowledged');
    assert.equal((await chat(b.p,'list')).find(r=>r.id===room).unreadCount,'1');await b.p.locator('[data-new-messages]').click();
    await b.p.waitForFunction(async room=>{const {chat}=await import('/js/services/index.js');return (await chat.list()).find(r=>r.id===room)?.lastReadSequence==='126';},room);
    await b.p.getByRole('button',{name:'Search loaded history',exact:true}).click();await b.p.getByRole('searchbox',{name:'Search loaded history only'}).fill('M5 history 000');await b.p.waitForFunction(()=>document.querySelectorAll('.message').length===1);
    await b.p.getByRole('button',{name:'Search loaded history',exact:true}).click();
    const input=b.p.locator('.message-input input');await input.fill('M5 compose survives a polling failure');
    await b.ctx.route(api+'/chat/rooms*',route=>route.abort('failed'));await b.p.evaluate(()=>dispatchEvent(new Event('online')));await b.p.locator('[data-poll-status]').filter({hasText:'Retrying'}).waitFor();assert.equal(await input.inputValue(),'M5 compose survives a polling failure');assert.equal(await b.p.locator('.message').count(),126);
    await b.ctx.unroute(api+'/chat/rooms*');await b.p.evaluate(()=>dispatchEvent(new Event('online')));await b.p.waitForFunction(()=>!document.querySelector('[data-poll-status]').textContent);assert.equal(await input.inputValue(),'M5 compose survives a polling failure');await input.fill('');
    let lostUpload=false,lostSend=false;
    await a.ctx.route(api+`/chat/rooms/${room}/attachments`,async route=>{if(!lostUpload){const result=await route.fetch();assert.equal(result.status(),201);lostUpload=true;await route.abort('failed');}else await route.continue();});
    await assert.rejects(image(a.p,room,true));assert(lostUpload);
    const encrypted=await a.p.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('polylink-outbox-v1');r.onsuccess=()=>resolve(r.result);});const rows=await new Promise(resolve=>{const r=db.transaction('operations').objectStore('operations').getAll();r.onsuccess=()=>resolve(r.result);});db.close();return JSON.stringify(rows);});assert(encrypted.length>5*1024*1024);assert(!encrypted.includes('private-image-name.png'));
    await a.ctx.route(api+`/chat/rooms/${room}/messages`,async route=>{if(route.request().method()==='POST'&&!lostSend){const result=await route.fetch();assert.equal(result.status(),200);lostSend=true;await route.abort('failed');}else await route.continue();});
    await a.p.reload();await assert.rejects(chat(a.p,'messages',room));assert(lostSend);await a.p.reload();const recovered=await chat(a.p,'messages',room);assert.equal(recovered.length,127);const attachment=recovered.at(-1).attachment;assert(attachment.url.startsWith('blob:'));
    assert.equal(uploads[0].length,5242896);assert.equal(uploads[0].id,uploads[1].id);assert.equal(uploads[0].hash,uploads[1].hash);assert.equal(uploads[1].hash,uploads[2].hash);assert.deepEqual(sends.at(-1),sends.at(-2));
    await b.p.locator('.message img').waitFor({timeout:15000});await b.p.waitForFunction(()=>[...document.querySelectorAll('.message img')].every(img=>img.complete&&img.naturalWidth));
    assert.equal(await downloadCode(c.p,attachment.id),'NOT_FOUND');
    assert.equal((await image(a.p,room,true)).sequence,'127'); // Explicitly acknowledge the resolved persisted draft without sending it twice.
    const otherTab=await b.ctx.newPage();await otherTab.goto(origin+'/login.html');await chat(otherTab,'hide',room);await chat(a.p,'send',room,{text:'M5 another tab hid history before incoming reopen'});await otherTab.close();await b.p.bringToFront();
    await b.p.locator('.messages').getByText('M5 another tab hid history before incoming reopen',{exact:false}).first().waitFor({timeout:15000});assert.equal(await b.p.locator('.message').count(),1,'A changed cutoff must discard cached old history even if incoming already reopened the room');
    assert.equal(await downloadCode(b.p,attachment.id),'NOT_FOUND');
    for(const type of ['image/jpeg','image/webp'])await image(a.p,room,false,type);
    await a.p.evaluate(async room=>{const {chat}=await import('/js/services/index.js');const raw=Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),c=>c.charCodeAt(0));await chat.send(room,{file:new File([raw],'image.gif',{type:'image/gif'})});},room);
    const invalid=await a.p.evaluate(async room=>{const {chat}=await import('/js/services/index.js');try{await chat.send(room,{file:new File(['fake image'],'bad.png',{type:'image/png'})});return false;}catch(e){return e.code==='VALIDATION';}},room);assert(invalid);
    const tooLong=await a.p.evaluate(async room=>{const {chat}=await import('/js/services/index.js');await chat.send(room,{text:'x'.repeat(4998)+'😀'});try{await chat.send(room,{text:'x'.repeat(4999)+'😀'});return false;}catch(e){return e.code==='VALIDATION';}},room);assert(tooLong);
    await chat(b.p,'mute',room,true);assert((await chat(b.p,'list')).find(r=>r.id===room).muted);
    await chat(b.p,'block',au.id,true);await assert.rejects(chat(a.p,'send',room,{text:'M5 blocked direct send'}));
    const group=(await chat(a.p,'list')).find(r=>r.isGroup);assert(group);await chat(a.p,'send',group.id,{text:'M5 group ignores direct blocks'});assert((await chat(b.p,'messages',group.id)).some(m=>m.text==='M5 group ignores direct blocks'));
    await b.p.goto(origin+'/message.html?room='+group.id);await b.p.locator('.messages').getByText('M5 group ignores direct blocks',{exact:false}).first().waitFor();assert(await b.p.locator('.message-input input').isEnabled());
    await chat(b.p,'block',au.id,false);await b.p.goto(origin+'/message.html?room='+room);await b.p.locator('.message').last().waitFor();await b.p.locator('.menu-btn').click();await b.p.locator('.chat-dropdown-item').filter({hasText:'Ջնջել նամակագրությունը'}).click();await b.p.locator('[data-confirm-yes]').click();
    await b.p.waitForFunction(async room=>{const {chat}=await import('/js/services/index.js');return !(await chat.list()).some(r=>r.id===room);},room);assert.equal(await downloadCode(b.p,attachment.id),'NOT_FOUND');assert.equal(await downloadCode(a.p,attachment.id),'allowed');
    await chat(a.p,'send',room,{text:'M5 incoming reopens a hidden conversation'});await b.p.locator(`.chat-item[data-room-id="${room}"]`).waitFor({timeout:15000});await b.p.locator(`.chat-item[data-room-id="${room}"]`).click();await b.p.locator('.messages').getByText('M5 incoming reopens a hidden conversation',{exact:false}).first().waitFor();assert.equal(await b.p.locator('.message').count(),1);assert.equal(await downloadCode(b.p,attachment.id),'NOT_FOUND');
    assert(!payloads.some(body=>body.includes('M5 history ')||body.includes('M5 incoming ')||body.includes('private-image-name.png')));assert.equal(errors.length,0,errors.join('\n'));
    console.log('M5 HTTP browser acceptance passed: paginated anchors, visible acknowledgements, polling failure, image types/size, durable upload/send retries, private downloads, mute, blocks, groups and hide/reopen.');
  }else if(phase==='mock'){
    const {p}=await context('mock',true);const ids=await p.evaluate(async()=>{const {transaction}=await import('/js/data/mock/store.js');return transaction(state=>{const users=state.users.filter(u=>u.status==='active');state.sessionUserId=users[0].id;return users.slice(0,2).map(u=>u.id);},{write:true});});
    const room=(await chat(p,'openDirect',ids[1])).id;await chat(p,'send',room,{text:'M5 mock visible message'});await p.goto(origin+'/message.html?room='+room);await p.locator('.messages').getByText('M5 mock visible message',{exact:false}).first().waitFor();
    const page=await chat(p,'page',room,{});assert(page.items.at(-1).sequence);await chat(p,'hide',room);assert.equal((await chat(p,'page',room,{})).items.length,0);
    await p.evaluate(async room=>{const {mockControls}=await import('/js/data/client.js');await(await mockControls()).incoming(room,'M5 mock incoming after hide');},room);
    assert.equal((await chat(p,'page',room,{})).items.length,1);assert((await chat(p,'list')).some(r=>r.id===room));
    console.log('M5 mock browser acceptance passed: shared UI pagination, sequence cutoff and incoming reopen.');
  }else throw new Error('Unknown M5 browser phase');
}catch(error){for(const ctx of contexts)for(const p of ctx.pages())console.error('M5 page:',p.url(),'alerts:',await p.locator('[role=alert]').allTextContents().catch(()=>[]));console.error('Page errors:',errors);throw error;}
finally{for(const ctx of contexts)await ctx.close();}
