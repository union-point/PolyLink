import { chromium } from 'playwright';
import { isolateDecorativeAssets } from './browser-assets.mjs';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const origin=process.env.M1_FRONTEND||'http://localhost:8137';
const browser=await chromium.launch({headless:true,executablePath:process.env.M1_CHROMIUM||undefined});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
await isolateDecorativeAssets(context);
await context.route('**/js/config.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace(/dataMode:\s*['"]http['"]/,"dataMode: 'mock'"),contentType:'application/javascript'});});
const page=await context.newPage(),errors=[];context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));page.on('pageerror',e=>errors.push(e.message));
const service=(p,method,...args)=>p.evaluate(async({method,args})=>{const {forum}=await import('/js/services/index.js');const parts=method.split('.');return parts.length===1?forum[method](...args):forum[parts[0]][parts[1]](...args);},{method,args});
async function ready(p=page){await p.waitForFunction(()=>document.querySelector('main')&&!document.querySelector('main').inert);}
async function screenshot(name){if(process.env.M1_ARTIFACT_DIR){await mkdir(process.env.M1_ARTIFACT_DIR,{recursive:true});await page.screenshot({path:`${process.env.M1_ARTIFACT_DIR}/${name}.png`,fullPage:true});}}
try{
 await page.goto(origin+'/forum.html');await ready();
 assert.equal(await page.locator('#category-filter option').count(),7);
 await page.goto(origin+'/topic.html');await ready();await page.getByText('Թեմայի նույնացուցիչը բացակայում է։').waitFor();assert.equal(await page.locator('a[href="forum.html"]').count(),2);
 await page.goto(origin+'/new-topic.html');await ready();
 await page.locator('#topic-title').fill('Ֆորումի ամբողջական ստուգում');await page.locator('select[name=categoryCode]').selectOption('energy');
 await page.locator('[contenteditable]').fill('Նոր թեմայի բովանդակություն');await page.locator('[contenteditable]').press('ControlOrMeta+A');await page.locator('[data-command=bold]').click();
 await page.locator('.new-topic-form [type=submit]').click();await page.waitForURL('**/topic.html?id=*');await ready();await page.locator('[data-edit-topic]').waitFor();
 const id=new URL(page.url()).searchParams.get('id');let topic=await service(page,'get',id);assert.equal(topic.categoryCode,'energy');assert.match(topic.content,/<(b|strong)>/);
 await page.locator('.reply-form [contenteditable]').fill('Իմ պատասխանը');await page.locator('.reply-form [type=submit]').click();await page.locator('.reply-text').getByText('Իմ պատասխանը',{exact:true}).waitFor();
 await page.locator('.like-btn').click();await page.locator('.like-btn[aria-pressed=true]').waitFor();assert.equal(await page.locator('.like-btn span').innerText(),'1');
 await page.locator('[data-edit-reply]').click();const dialog=page.locator('[data-forum-edit]');await dialog.locator('[contenteditable]').fill('Իմ սևագիրը պահպանվում է');
 let reply=(await service(page,'replies.list',id)).items[0];await service(page,'replies.update',reply.id,{content:'<p>Մյուս ներդիրի խմբագրում</p>',expectedVersion:reply.version});
 await dialog.locator('[data-save]').click();await dialog.locator('[data-conflict]:not([hidden])').waitFor();assert.equal(await dialog.locator('[contenteditable]').innerText(),'Իմ սևագիրը պահպանվում է');
 await dialog.locator('[data-reload-latest]').click();await dialog.locator('[data-latest]').getByText('Մյուս ներդիրի խմբագրում',{exact:true}).waitFor();
 assert.equal(await dialog.locator('[contenteditable]').innerText(),'Իմ սևագիրը պահպանվում է');await screenshot('forum-conflict-light');
 await dialog.locator('[data-keep-draft]').click();await dialog.locator('[data-save]').click();await dialog.waitFor({state:'detached'});await page.locator('.reply-text').getByText('Իմ սևագիրը պահպանվում է',{exact:true}).waitFor();
 await page.locator('[data-edit-topic]').click();await page.locator('[data-forum-edit] input[name=title]').fill('Թարմացված վերնագիր');await page.locator('[data-forum-edit] [data-save]').click();await page.locator('.topic-title').getByText('Թարմացված վերնագիր',{exact:true}).waitFor();
 // Enough data to exercise page metadata and counts independently of the loaded page.
 await page.evaluate(async id=>{const {forum}=await import('/js/services/index.js');for(let i=0;i<23;i++)await forum.replies.create(id,{content:`<p>Էջ ${i}</p>`,requestId:crypto.randomUUID()});},id);
 await page.locator('.replies-section [data-refresh]').click();await page.waitForFunction(()=>document.querySelector('.reply-count')?.textContent==='(24)');assert.equal(await page.locator('.replies-list .reply-item').count(),20);
 await page.locator('.replies-section [data-more]').click();await page.waitForFunction(()=>document.querySelectorAll('.replies-list .reply-item').length===24);assert.equal(await page.locator('.replies-section [data-more]').isVisible(),false);
 await page.locator('.sort-select').selectOption('popular');await page.waitForFunction(()=>document.querySelector('.like-btn span')?.textContent==='1');
 await page.evaluate(async()=>{const {setTheme}=await import('/js/shared/ui.js');setTheme('dark');});await screenshot('forum-topic-dark');
 await page.setViewportSize({width:390,height:844});await screenshot('forum-topic-mobile');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No mobile horizontal overflow');
 await page.locator('[data-edit-topic]').click();await page.locator('[data-forum-edit]').waitFor();await screenshot('forum-edit-mobile');await page.keyboard.press('Escape');
 // Server-style failure injection must retain a draft and retry with the same request key.
 await page.locator('.reply-form [contenteditable]').fill('Սևագիր ցանցի սխալից հետո');await page.evaluate(async()=>{const {mockControls}=await import('/js/data/client.js');await(await mockControls()).failNext('forum.replies.create','NETWORK','Ցանցի սխալ');});
 await page.locator('.reply-form [type=submit]').click();await page.locator('.reply-form [role=alert]').waitFor();assert.equal(await page.locator('.reply-form [contenteditable]').innerText(),'Սևագիր ցանցի սխալից հետո');
 await page.locator('.reply-form [type=submit]').click();await page.locator('.reply-text').getByText('Սևագիր ցանցի սխալից հետո',{exact:true}).waitFor();
 await page.locator('.replies-list [data-delete-reply]').first().click();await page.locator('[data-common-confirm]').getByRole('button',{name:'Ոչ',exact:true}).click();
 await page.locator('[data-delete-topic]').click();await page.locator('[data-common-confirm]').getByText('Ջնջե՞լ թեման։ Կջնջվեն բոլոր օգտատերերի պատասխանները և դրանց հավանումները։').waitFor();await page.locator('[data-common-confirm]').getByRole('button',{name:'Այո',exact:true}).click();await page.waitForURL('**/forum.html');await ready();
 await page.locator('#category-filter').selectOption('energy');await page.waitForFunction(()=>!document.querySelector('[data-page-status]')?.textContent);assert.equal(await page.locator(`[data-topic-id="${id}"]`).count(),0);
 assert.equal(errors.length,0,errors.join('\n'));console.log('Forum mock browser acceptance passed: create, formatting, likes, stale edit review, pagination, drafts, delete, themes and mobile.');
}finally{await browser.close();}
