import { registerForVerification } from './enrollment-fixture.mjs';
import { chromium } from 'playwright';
import { isolateDecorativeAssets } from './browser-assets.mjs';
import assert from 'node:assert/strict';
const origin=process.env.M1_FRONTEND,api=process.env.M1_API,password='Forum browser fixture!4';
const browser=await chromium.launch({headless:true,executablePath:process.env.M1_CHROMIUM||undefined});
const errors=[];
async function member(index,role){
 const context=await browser.newContext({viewport:{width:1280,height:900}});await isolateDecorativeAssets(context);
 await context.addInitScript(()=>{window.__forumNotifications=[];window.Notification=class{static permission='granted';static async requestPermission(){return 'granted';}constructor(title,options){Object.assign(this,{title,...options});window.__forumNotifications.push(this);}close(){}};});
 await context.route('**/js/config.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('http://localhost:3004',api),contentType:'application/javascript'});});
 await context.route('**/axios@*/dist/axios.min.js',route=>route.fulfill({path:new URL('./node_modules/axios/dist/axios.min.js',import.meta.url).pathname,contentType:'application/javascript'}));
 context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
 const page=await context.newPage();await page.goto(origin+'/login.html');await page.locator('#login-form').waitFor();
 const email=process.env.M1_BROWSER_EMAIL.replace('browser-',`forum-${index}-`);
 const challenge=await registerForVerification(page,{email,password,firstName:'Forum',lastName:role,role});
 let code;
 for(let tries=0;tries<50&&!code;tries++){
  const messages=await(await fetch(process.env.M1_MAILPIT_URL+'/api/v1/messages')).json();const found=messages.messages.find(item=>item.To.some(to=>to.Address===email));
  if(found){const mail=await(await fetch(process.env.M1_MAILPIT_URL+'/api/v1/message/'+found.ID)).json();code=mail.Text.match(/\b\d{6}\b/)?.[0];}
  if(!code)await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert(code,'Verification email delivered');
 await page.evaluate(async({email,password,code,challengeId})=>{const {auth}=await import('/js/services/index.js');await auth.verifyEmail({challengeId,code});await auth.login({email,password});},{email,password,code,challengeId:challenge.challengeId});
 return {page,context,email};
}
async function ready(page){await page.waitForFunction(()=>document.querySelector('main')&&!document.querySelector('main').inert);}
const service=(page,method,...args)=>page.evaluate(async({method,args})=>{const {forum}=await import('/js/services/index.js');const parts=method.split('.');return parts.length===1?forum[method](...args):forum[parts[0]][parts[1]](...args);},{method,args});
try{
 const a=await member(1,'graduate'),b=await member(2,'lecturer');
 await a.page.goto(origin+'/new-topic.html');await ready(a.page);await a.page.locator('#topic-title').fill('Իրական ֆորումի ստուգում');await a.page.locator('[name=categoryCode]').selectOption('electronics');await a.page.locator('[contenteditable]').fill('Իրական բովանդակություն');await a.page.locator('[type=submit]').click();await a.page.waitForURL('**/topic.html?id=*');await ready(a.page);
 const id=new URL(a.page.url()).searchParams.get('id');assert.match(id,/^\d+$/);
 await a.page.evaluate(async()=>{const {auth}=await import('/js/services/index.js');const {enableBrowserNotifications}=await import('/js/shared/browser-notifications.js');await enableBrowserNotifications((await auth.me()).id,true);});
 await a.page.reload();await ready(a.page);await a.page.waitForFunction(()=>Object.keys(localStorage).some(key=>key.startsWith('polylink.notifications.')&&key.endsWith('.cursor')));
 await b.page.goto(origin+'/topic.html?id='+id);await ready(b.page);assert.equal(await b.page.locator('[data-edit-topic]').count(),0);
 await b.page.locator('.reply-form [contenteditable]').fill('Դասախոսի իրական պատասխանը');await b.page.locator('.reply-form [type=submit]').click();await b.page.locator('.reply-text').getByText('Դասախոսի իրական պատասխանը',{exact:true}).waitFor();
 assert.equal(await a.page.locator('.replies-list .reply-item').count(),0,'Replies wait for manual refresh');
 await a.page.waitForFunction(()=>window.__forumNotifications.some(item=>item.tag.startsWith('polylink-forum-')),{},{timeout:25000});
 await a.page.locator('.replies-section [data-refresh]').click();await a.page.locator('.reply-text').getByText('Դասախոսի իրական պատասխանը',{exact:true}).waitFor();assert.equal(await a.page.locator('[data-edit-reply]').count(),0);
 await a.page.locator('.like-btn').click();await a.page.locator('.like-btn[aria-pressed=true]').waitFor();
 // Commit on the server, lose the response, then retry through the actual form.
 let lost=false;
 await a.context.route(api+`/forum/topics/${id}/replies`,async route=>{if(route.request().method()==='POST'&&!lost){lost=true;const response=await route.fetch();assert.equal(response.status(),201);await route.abort('failed');}else await route.continue();});
 await a.page.locator('.reply-form [contenteditable]').fill('Անվտանգ կրկնվող հարցում');await a.page.locator('.reply-form [type=submit]').click();await a.page.locator('.reply-form [role=alert]').waitFor();assert.equal(await a.page.locator('.reply-form [contenteditable]').innerText(),'Անվտանգ կրկնվող հարցում');
 await a.page.locator('.reply-form [type=submit]').click();await a.page.locator('.reply-text').getByText('Անվտանգ կրկնվող հարցում',{exact:true}).waitFor();assert.equal((await service(a.page,'get',id)).replyCount,2);
 await a.page.locator('[data-edit-topic]').click();const dialog=a.page.locator('[data-forum-edit]');await dialog.locator('[name=title]').fill('Պահպանված սևագիր');
 const current=await service(a.page,'get',id);await service(a.page,'update',id,{title:'Մյուս ներդիր',expectedVersion:current.version});await dialog.locator('[data-save]').click();await dialog.locator('[data-conflict]:not([hidden])').waitFor();assert.equal(await dialog.locator('[name=title]').inputValue(),'Պահպանված սևագիր');
 await dialog.locator('[data-reload-latest]').click();await dialog.locator('[data-latest]').getByText('Մյուս ներդիր',{exact:true}).waitFor();await dialog.locator('[data-keep-draft]').click();await dialog.locator('[data-save]').click();await dialog.waitFor({state:'detached'});await a.page.locator('.topic-title').getByText('Պահպանված սևագիր',{exact:true}).waitFor();
 const invalid=await a.page.evaluate(async id=>{const {forum}=await import('/js/services/index.js');try{await forum.update(id,{title:'',expectedVersion:(await forum.get(id)).version});}catch(error){return {code:error.code,fields:error.fieldErrors};}},id);assert.equal(invalid.code,'VALIDATION');assert(invalid.fields.title,'Field errors reach the browser');
 await a.page.evaluate(async()=>{const {notifications}=await import('/js/services/index.js');const result=await notifications.list({cursor:'0',limit:100});const forum=result.items.find(item=>item.kind==='FORUM_REPLY');window.__forumNotifications.find(item=>item.tag===`polylink-forum-${forum.topicId}`).onclick();});
 await a.page.waitForURL('**/topic.html?id=*&reply=*');await ready(a.page);
 await a.page.setViewportSize({width:390,height:844});await a.page.evaluate(async()=>{const {setTheme}=await import('/js/shared/ui.js');setTheme('dark');});assert(await a.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await a.page.locator('[data-delete-topic]').click();await a.page.locator('[data-common-confirm]').getByRole('button',{name:'Այո',exact:true}).click();await a.page.waitForURL('**/forum.html');await ready(a.page);
 await b.page.reload();await ready(b.page);await b.page.getByText('Թեման կամ պատասխանը չի գտնվել։',{exact:true}).waitFor();
 assert.equal(errors.length,0,errors.join('\n'));console.log('Forum live browser acceptance passed: both roles, manual refresh, browser notifications, retry deduplication, edit conflicts, validation, mobile and deletion.');
}finally{await browser.close();}
