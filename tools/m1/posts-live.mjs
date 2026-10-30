import { registerForVerification } from './enrollment-fixture.mjs';
import { chromium } from 'playwright';
import { isolateDecorativeAssets } from './browser-assets.mjs';
import assert from 'node:assert/strict';
const origin=process.env.M1_FRONTEND,api=process.env.M1_API,password='Posts browser fixture!4';
const browser=await chromium.launch({headless:true,executablePath:process.env.M1_CHROMIUM||undefined});
const errors=[];
async function member(index,role){
 const context=await browser.newContext({viewport:{width:1280,height:900}});await isolateDecorativeAssets(context);
 await context.addInitScript(()=>{window.Notification=class{static permission='denied';};Object.defineProperty(navigator,'locks',{value:undefined,configurable:true});});
 await context.route('**/js/config.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('http://localhost:3004',api),contentType:'application/javascript'});});
 await context.route('**/axios@*/dist/axios.min.js',route=>route.fulfill({path:new URL('./node_modules/axios/dist/axios.min.js',import.meta.url).pathname,contentType:'application/javascript'}));
 context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
 const page=await context.newPage();await page.goto(origin+'/login.html');await page.locator('#login-form').waitFor();
 const email=process.env.M1_BROWSER_EMAIL.replace('browser-',`posts-${index}-`);
 const challenge=await registerForVerification(page,{email,password,firstName:'Posts',lastName:role,role});
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
async function ready(page){await page.waitForFunction(()=>document.querySelector('main')&&!document.querySelector('body > [inert]'));}
const service=(page,method,...args)=>page.evaluate(async({method,args})=>{const {posts}=await import('/js/services/index.js');const p=method.split('.');return p.length===1?posts[method](...args):posts[p[0]][p[1]](...args);},{method,args});
try{
 const a=await member(1,'graduate'),b=await member(2,'lecturer');await a.page.goto(origin+'/events.html');await ready(a.page);
 await a.page.locator('.create-post-btn').click();const form=a.page.locator('.posts-modal');await form.locator('select[name=sphereCode] option').nth(1).waitFor({state:'attached'});
 await form.locator('[name=title]').fill('Իրական հայտարարություն');await form.locator('[name=category]').selectOption('job');await form.locator('[name=sphereCode]').selectOption({index:1});await form.locator('[contenteditable]').fill('Իրական բովանդակություն');await form.locator('[type=submit]').click();await form.waitFor({state:'detached'});await a.page.locator('.post-card').first().waitFor();
 const first=(await service(a.page,'list')).items[0],id=first.id;assert.match(id,/^\d+$/);
 assert.equal(await a.page.locator('.post-permalink').count(),0);await a.page.goto(origin+'/post.html?id='+id);await ready(a.page);
 await a.page.evaluate(async()=>{const {settings}=await import('/js/services/index.js');await settings.update({emailEnabled:false});});
 await b.page.goto(origin+'/post.html?id='+id);await ready(b.page);assert.equal(await b.page.locator('[data-post-edit]').count(),0);await b.page.locator('.comments-toggle').click();await b.page.locator('.comment-input').fill('Դասախոսի իրական մեկնաբանություն');await b.page.locator('.comment-btn').click();await b.page.locator('.comment-text').getByText('Դասախոսի իրական մեկնաբանություն',{exact:true}).waitFor();
 await a.page.locator('[data-activity-toggle]').click();await a.page.locator(`[data-activity-items] a[href="post.html?id=${id}"]`).waitFor({timeout:25000});assert.equal(await a.page.locator('[data-activity-items] a').count(),1);
 const disabledMail=await(await fetch(process.env.M1_MAILPIT_URL+'/api/v1/messages')).json();assert(!disabledMail.messages.some(m=>m.Subject.includes('նոր մեկնաբանություն')&&m.To.some(t=>t.Address===a.email)),'Disabled email does not deliver comment mail');
 await a.page.reload();await ready(a.page);await a.page.locator('[data-activity-toggle]').click();await a.page.locator(`[data-activity-items] a[href="post.html?id=${id}"]`).waitFor();await a.page.locator('[data-activity-toggle]').click();
 await a.page.locator('.comments-toggle').click();await a.page.locator('.comment-text').waitFor();assert.equal(await a.page.locator('[data-comment-delete]').count(),0,'Post author cannot delete other comments');
 await a.page.locator('[data-post-edit]').click();await form.locator('[name=title]').fill('Սևագիրը պահպանվում է');let failed=false;await a.context.route(api+'/posts/'+id,async route=>{if(route.request().method()==='PUT'&&!failed){failed=true;await route.abort('failed');}else await route.continue();});await form.locator('[type=submit]').click();await form.locator('[role=alert]').last().waitFor();assert.equal(await form.locator('[name=title]').inputValue(),'Սևագիրը պահպանվում է');
 const other={title:'Another session',content:first.content,category:first.category,sphereCode:first.sphereCode};await service(a.page,'update',id,other);await form.locator('[type=submit]').click();await form.waitFor({state:'detached'});assert.equal((await service(a.page,'get',id)).title,'Սևագիրը պահպանվում է');assert.equal((await service(a.page,'get',id)).createdAt,first.createdAt);
 await a.page.evaluate(async()=>{const {settings}=await import('/js/services/index.js');await settings.update({emailEnabled:true});});await service(b.page,'comments.create',id,{text:'Email delivery'});
 let delivered=false;for(let i=0;i<60&&!delivered;i++){const messages=await(await fetch(process.env.M1_MAILPIT_URL+'/api/v1/messages')).json();delivered=messages.messages.some(m=>m.Subject.includes('նոր մեկնաբանություն')&&m.To.some(t=>t.Address===a.email));if(!delivered)await new Promise(r=>setTimeout(r,500));}assert(delivered,'Comment email reaches mail capture when enabled');
 await a.page.locator('[data-post-delete]').click();await a.page.locator('[data-common-confirm]').getByRole('button',{name:'Այո',exact:true}).click();await a.page.getByText('Հայտարարությունը հասանելի չէ։',{exact:true}).waitFor();await b.page.reload();await ready(b.page);await b.page.getByText('Հայտարարությունը հասանելի չէ։',{exact:true}).waitFor();
 await a.page.goto(origin+'/events.html');await ready(a.page);await a.page.setViewportSize({width:390,height:844});assert(await a.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual(errors,[]);console.log('Live posts publication, comments, last-save-wins, retained activity, settings, SMTP, deep links and deletion passed.');
}finally{await browser.close();}
