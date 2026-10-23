import { waitForAsync } from '../m1/browser-wait.mjs';
import { isolateDecorativeAssets } from '../m1/browser-assets.mjs';
import { chromium } from '../m1/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
const phase=process.argv[2],origin=process.env.M1_FRONTEND,api=process.env.M1_API;
const email=process.env.M1_BROWSER_EMAIL.replace('browser-',phase==='local'?'m2-3-':phase==='peer'?'m2-1-':'m2-2-');
const oldPassword='M2 Browser fixture pass!4',newPassword=`M4 ${phase} recovery pass!8`;
const browser=await chromium.launch({headless:true,executablePath:process.env.M1_CHROMIUM||undefined});
const ctx=await browser.newContext(),payloads=[],errors=[],rejections=[];
await isolateDecorativeAssets(ctx);
await ctx.route('**/js/config.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('http://localhost:3004',api),contentType:'application/javascript'});});
await ctx.route('**/axios@*/dist/axios.min.js',route=>route.fulfill({path:new URL('../m1/node_modules/axios/dist/axios.min.js',import.meta.url).pathname,contentType:'application/javascript'}));
ctx.on('response',async response=>{if(response.url().startsWith(api)&&response.status()>=400){const body=await response.json().catch(()=>({}));rejections.push({path:new URL(response.url()).pathname,status:response.status(),code:body.code});}});
ctx.on('request',request=>{if(request.url().startsWith(api))payloads.push(request.postData()||'');});
const p=await ctx.newPage();p.setDefaultTimeout(20000);p.setDefaultNavigationTimeout(30000);p.on('pageerror',e=>errors.push(e.message));
async function code(){
  for(let i=0;i<30;i++){
    const listing=await(await fetch(process.env.M1_MAILPIT_URL+'/api/v1/messages')).json();
    const item=listing.messages.find(m=>m.To.some(to=>to.Address===email));
    if(item){const mail=await(await fetch(process.env.M1_MAILPIT_URL+'/api/v1/message/'+item.ID)).json();return mail.Text.match(/\b\d{6}\b/)[0];}
    await new Promise(resolve=>setTimeout(resolve,100));
  }throw new Error('Recovery mail missing');
}
const chat=(name,...args)=>p.evaluate(async({name,args})=>{const {chat}=await import('/js/services/index.js');return chat[name](...args);},{name,args});
async function bundle(){return p.evaluate(async()=>{const {loadTransport}=await import('/js/data/http/transport.js');const api=await loadTransport();await api.restore();return api.request({method:'get',url:'/keys/me'});});}
async function verify(){
  await p.goto(origin+'/forgot.html');await p.locator('#email').fill(email);await p.locator('#forgot-form [type=submit]').click();await p.waitForURL('**/verify-code.html');
  const proof=await code();for(let i=0;i<6;i++)await p.locator('.code-input').nth(i).fill(proof[i]);
  await p.locator('#verify-form [type=submit]').click();await p.waitForURL('**/reset-password.html');await p.locator('#reset-form').waitFor();
}
async function reset(){await p.waitForFunction(()=>!document.querySelector('#submit-btn').disabled);await p.locator('#new-password').fill(newPassword);await p.locator('#confirm-password').fill(newPassword);assert.deepEqual(await p.locator('#reset-form input[type=password]').evaluateAll(inputs=>inputs.map(i=>i.value.length)),[newPassword.length,newPassword.length]);await p.locator('#reset-form [type=submit]').click();}
try{
  await p.goto(origin+'/login.html');await p.locator('#login-form').waitFor();let before;
  if(phase==='local'){
    await p.evaluate(async({email,password})=>{const {auth}=await import('/js/services/index.js');await auth.login({email,password});},{email,password:oldPassword});
    before=await bundle();const rooms=await chat('list'),group=rooms.find(r=>r.isGroup);assert(group,'Fixed test group missing');
    await chat('send',group.id,{text:'M4 retained group history'});
  }
  await verify();await p.reload();await p.locator('#reset-form').waitFor(); // Recovery cookie/status survives page loss.
  let commits=0,lost=false,unlockCalls=0;
  await ctx.route(api+'/auth/recovery/unlock',async route=>{unlockCalls++;await route.continue();});
  await ctx.route(api+'/auth/recovery/commit',async route=>{commits++;if(!lost){const response=await route.fetch();assert.equal(response.status(),200);lost=true;await route.abort('failed');}else await route.continue();});
  if(phase!=='local'){
    let prepared=false,interrupted=false;
    await ctx.route(api+'/auth/recovery/prepare',async route=>{const response=await route.fetch();assert.equal(response.status(),200);prepared=true;await route.abort('failed');});
    if(phase==='service'){
      await ctx.route(api+'/auth/recovery/status',async route=>{if(prepared&&!interrupted){interrupted=true;await route.abort('failed');}else await route.continue();});
      await reset();await p.locator('[role=alert]').filter({hasText:/./}).waitFor();assert(prepared&&interrupted);assert.equal(commits,0);
      await ctx.unroute(api+'/auth/recovery/status');await p.reload();await p.waitForFunction(()=>!document.querySelector('#submit-btn').disabled);
    }
    await reset();await Promise.race([p.waitForURL('**/profile.html',{timeout:60000}),p.locator('[role=alert]').filter({hasText:/./}).waitFor({timeout:60000}).then(async()=>{throw new Error((await p.locator('[role=alert]').allTextContents()).join(' '));})]);assert(prepared);
  }else{await reset();await Promise.race([p.waitForURL('**/profile.html',{timeout:60000}),p.locator('[role=alert]').filter({hasText:/./}).waitFor({timeout:60000}).then(async()=>{throw new Error((await p.locator('[role=alert]').allTextContents()).join(' '));})]);}
  assert.equal(commits,2);assert(lost);assert.equal(unlockCalls,phase==='local'?0:1);
  const after=await bundle();
  if(before){assert.deepEqual(after.vault,before.vault);assert.deepEqual(after.identity,before.identity);assert.equal(after.versions.vaultKey,before.versions.vaultKey);}
  else{assert.equal(after.versions.identity,'2');assert.equal(after.versions.vaultKey,'2');}
  const rooms=await chat('list'),group=rooms.find(r=>r.isGroup);assert((await chat('messages',group.id)).some(m=>m.text==='M4 retained group history'));
  if(phase!=='local'){
    const direct=rooms.find(r=>!r.isGroup);assert((await chat('messages',direct.id)).some(m=>m.text==='M2 secret text — Բարեւ 👋'));
    // Both peers remain offline. Merely opening/listing history must rotate future epochs.
    await waitForAsync(p,async()=>{const {chat}=await import('/js/services/index.js');const rooms=await chat.list();return rooms.every(r=>!r.canSend||r.keySnapshot.keyState==='ready');},{},{timeout:15000});
    await chat('send',direct.id,{text:'M4 post-recovery future text'});await chat('send',group.id,{text:'M4 post-recovery group text'});
    const forbidden=await p.evaluate(async()=>{const {auth}=await import('/js/services/index.js');const op=await auth.recoveryStatus();const {loadTransport}=await import('/js/data/http/transport.js');try{await(await loadTransport()).request({method:'post',url:'/auth/recovery/unlock',data:{operationId:op.operationId}});return false;}catch(e){return e.code==='REVISION_CONFLICT';}});assert(forbidden);
  }
  assert(!payloads.some(v=>v.includes(oldPassword)||v.includes(newPassword)));assert.equal(errors.length,0,errors.join('\n'));
  console.log(`M4 ${phase} browser recovery passed: reload, lost replies, automatic login, retained history and room activation.`);
}catch(error){console.error('Recovery page:',p.url(),'alerts:',await p.locator('[role=alert]').allTextContents(),'page errors:',errors,'API rejections:',rejections);throw error;}finally{await browser.close();}
