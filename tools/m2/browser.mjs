import { isolateDecorativeAssets } from '../m1/browser-assets.mjs';
import { chromium } from '../m1/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
const origin=process.env.M1_FRONTEND,api=process.env.M1_API;
const browser=await chromium.launch({headless:true,executablePath:process.env.M1_CHROMIUM||undefined});
const contexts=[],outbound=[],errors=[];
const password='M2 Browser fixture pass!4',canary='M2 secret text — Բարեւ 👋';
async function context(){
  const ctx=await browser.newContext();contexts.push(ctx);await isolateDecorativeAssets(ctx);
  await ctx.route('**/js/config.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('http://localhost:3004',api),contentType:'application/javascript'});});
  await ctx.route('**/axios@*/dist/axios.min.js',route=>route.fulfill({path:new URL('../m1/node_modules/axios/dist/axios.min.js',import.meta.url).pathname,contentType:'application/javascript'}));
  ctx.on('request',request=>{if(request.url().startsWith(api+'/chat/'))outbound.push(request.postData()||'');});
  ctx.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
  return ctx;
}
async function page(ctx){const p=await ctx.newPage();await p.goto(origin+'/login.html');await p.locator('#login-form').waitFor();return p;}
async function code(email){
  for(let i=0;i<50;i++){
    const list=await(await fetch(process.env.M1_MAILPIT_URL+'/api/v1/messages')).json();const found=list.messages.find(m=>m.To.some(to=>to.Address===email));
    if(found){const message=await(await fetch(process.env.M1_MAILPIT_URL+'/api/v1/message/'+found.ID)).json();return message.Text.match(/\b\d{6}\b/)[0];}
    await new Promise(resolve=>setTimeout(resolve,100));
  }throw new Error('Verification mail missing');
}
async function enroll(ctx,index){
  const p=await page(ctx),email=process.env.M1_BROWSER_EMAIL.replace('browser-','m2-'+index+'-');
  const challenge=await p.evaluate(async({email,password})=>{const {auth}=await import('/js/services/index.js');return auth.register({email,password,firstName:'M2',lastName:'Fixture',role:'graduate'});},{email,password});
  const proof=await code(email);
  await p.evaluate(async({challengeId,proof,email,password})=>{const {auth}=await import('/js/services/index.js');await auth.verifyEmail({challengeId,code:proof});await auth.login({email,password});},{challengeId:challenge.challengeId,proof,email,password});
  const user=await p.evaluate(async()=>{const {auth}=await import('/js/services/index.js');return auth.me();});assert(user&&!user.cryptoLocked);return {p,user,email};
}
const chat=(p,method,args=[])=>p.evaluate(async({method,args})=>{const {chat}=await import('/js/services/index.js');return chat[method](...args);},{method,args});
try{
  const ca=await context(),cb=await context(),cc=await context();
  const a=await enroll(ca,1),b=await enroll(cb,2),c=await enroll(cc,3);
  const rooms=await Promise.all([chat(a.p,'openDirect',[b.user.id]),chat(b.p,'openDirect',[a.user.id])]);const room=rooms[0].id;assert.equal(room,rooms[1].id);
  await b.p.close(); // Configured recipient is offline during room key activation and first send.
  await chat(a.p,'send',[room,{text:canary}]);
  b.p=await page(cb);assert.equal((await chat(b.p,'messages',[room]))[0].text,canary);
  await assert.rejects(chat(c.p,'messages',[room]),/unavailable/);
  const denied=await c.p.evaluate(async room=>{const {loadTransport}=await import('/js/data/http/transport.js');const {createIdentityClient}=await import('/js/auth/identity-client.js');const api=await loadTransport(),id=createIdentityClient(api);await id.me();try{await api.request({method:'get',url:`/chat/rooms/${room}/keys`});return 'unexpected';}catch(e){return e.code;}finally{id.close();}},room);assert.equal(denied,'NOT_FOUND');
  let lost=false;
  await ca.route(api+`/chat/rooms/${room}/messages`,async route=>{
    if(route.request().method()==='POST'&&!lost){lost=true;const response=await route.fetch();assert.equal(response.status(),200);await route.abort('failed');}else await route.continue();
  });
  await assert.rejects(chat(a.p,'send',[room,{text:'Lost-response canary'}]));assert(lost);
  const stored=await a.p.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('polylink-outbox-v1');r.onsuccess=()=>resolve(r.result);});const data=await new Promise(resolve=>{const r=db.transaction('operations').objectStore('operations').getAll();r.onsuccess=()=>resolve(r.result);});db.close();return JSON.stringify(data);});
  assert(!stored.includes('Lost-response canary'));assert(!stored.includes('privateKey'));
  await a.p.reload();await a.p.locator('#login-form').waitFor();
  let history=await chat(a.p,'messages',[room]);assert.equal(history.length,2);
  // Acknowledging a completed persisted operation must not accidentally send it again.
  await chat(a.p,'send',[room,{text:'Lost-response canary'}]);assert.equal((await chat(a.p,'messages',[room])).length,2);
  await Promise.all([chat(a.p,'send',[room,{text:'Concurrent A'}]),chat(b.p,'send',[room,{text:'Concurrent B'}])]);
  history=await chat(b.p,'messages',[room]);assert.deepEqual(history.map(m=>m.sequence),['1','2','3','4']);
  // Exercise actual decrypted render models and visible-page polling.
  await b.p.goto(origin+'/search.html');await b.p.locator(`[data-user-id="${a.user.id}"] .btn-connect`).click();await b.p.waitForURL('**/message.html?room='+room);await b.p.getByText(canary,{exact:false}).first().waitFor();
  await chat(a.p,'send',[room,{text:'Polling delivery canary'}]);await b.p.getByText('Polling delivery canary',{exact:false}).first().waitFor({timeout:15000});
  assert(!outbound.some(body=>body.includes(canary)||body.includes('Lost-response canary')||body.includes('Polling delivery canary')),'Chat HTTP requests contain only encrypted material');
  assert.equal(errors.length,0,errors.join('\n'));
  console.log('M2 browser acceptance passed: offline recipient, denial, encrypted persistent retries, concurrency and polling.');
}finally{await browser.close();}
