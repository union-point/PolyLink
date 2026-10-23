import { isolateDecorativeAssets } from '../m1/browser-assets.mjs';
import { chromium } from '../m1/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';
const phase=process.argv[2],origin=process.env.M1_FRONTEND,api=process.env.M1_API;
const email=process.env.M1_BROWSER_EMAIL.replace('browser-','m2-1-'),oldPassword='M2 Browser fixture pass!4',newPassword='M3 new password canary!9';
const profile=path.join(process.env.M1_ARTIFACT_DIR,'m3-profile');
const browser=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.M1_CHROMIUM||undefined});
const payloads=[],errors=[];let workers=0;
async function configure(context){
  await isolateDecorativeAssets(context);
  await context.route('**/js/config.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('http://localhost:3004',api),contentType:'application/javascript'});});
  await context.route('**/axios@*/dist/axios.min.js',route=>route.fulfill({path:new URL('../m1/node_modules/axios/dist/axios.min.js',import.meta.url).pathname,contentType:'application/javascript'}));
  context.on('request',request=>{if(request.url().startsWith(api))payloads.push(request.postData()||'');if(request.url().includes('/derive-worker.js'))workers++;});
  context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
}
await configure(browser);
const p=browser.pages()[0]||await browser.newPage();p.on('pageerror',e=>errors.push(e.message));
const user=page=>page.evaluate(async()=>{const {auth}=await import('/js/services/index.js');return auth.me();});
const messages=page=>page.evaluate(async()=>{const {chat}=await import('/js/services/index.js');const rooms=await chat.list();return chat.messages(rooms[0].id);});
async function proof(){
  const listing=await(await fetch(process.env.M1_MAILPIT_URL+'/api/v1/messages')).json();const item=listing.messages.find(m=>m.To.some(to=>to.Address===email));assert(item,'Verification email must arrive');
  return (await(await fetch(process.env.M1_MAILPIT_URL+'/api/v1/message/'+item.ID)).json()).Text.match(/\b\d{6}\b/)[0];
}
async function login(page,password){
  await page.goto(origin+'/login.html');await page.locator('#login-form [type=submit]').waitFor();
  const result=await page.evaluate(async({email,password})=>{const {auth}=await import('/js/services/index.js');return auth.login({email,password});},{email,password});
  if(result.status==='challenge')await page.evaluate(async({challengeId,code})=>{const {auth}=await import('/js/services/index.js');return auth.verifySecondFactor({challengeId,code});},{challengeId:result.challengeId,code:await proof()});
  return user(page);
}
async function ready(page,url='profile.html'){
  await page.goto(origin+'/'+url);await page.waitForFunction(()=>!document.querySelector('[data-identity-unlock]')&&!document.body.hasAttribute('data-session-check'));
  const current=await user(page);assert(current&&!current.cryptoLocked,'Expected a server-validated device unlock');assert.equal(await page.locator('[data-identity-unlock]').count(),0);return current;
}
try{
  if(phase==='continuity'){
    assert(!(await login(p,oldPassword)).cryptoLocked);
    const initialWorkers=workers;
    for(const url of ['profile.html','message.html','search.html','settings.html','profile.html'])await ready(p,url);
    await p.reload();assert(!(await user(p)).cryptoLocked);
    const tab=await browser.newPage();await ready(tab);
    await Promise.all([user(p),user(tab),user(p),user(tab)]);assert(!(await user(p)).cryptoLocked);assert(!(await user(tab)).cryptoLocked);
    // Back/forward restoration must conceal content until server revalidation completes.
    await p.evaluate(()=>dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
    assert(await p.evaluate(()=>document.body.hasAttribute('data-session-check')));
    await p.evaluate(()=>dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
    await p.waitForFunction(()=>!document.body.hasAttribute('data-session-check'));assert(!(await user(p)).cryptoLocked);
    assert.equal(workers,initialWorkers,'Navigation/reload/tab restore must not rerun Argon2id');
    assert((await messages(p)).some(m=>m.text==='M2 secret text — Բարեւ 👋'));
    // A network failure must not cause a device-key open or a password-unlock prompt.
    const waiting=await browser.newPage();await waiting.addInitScript(()=>{window.deviceOpens=0;const original=IDBFactory.prototype.open;IDBFactory.prototype.open=function(...args){window.deviceOpens++;return original.apply(this,args);};});
    await waiting.route(api+'/**',route=>route.abort('failed'));await waiting.goto(origin+'/profile.html');await waiting.getByRole('alert').waitFor();
    assert.equal(await waiting.evaluate(()=>window.deviceOpens),0);assert.equal(await waiting.locator('[data-identity-unlock]').count(),0);
    await waiting.unroute(api+'/**');await ready(waiting);await waiting.close();
    // An isolated browser opens the same history using the password with Transit sealed.
    const clean=await browser.browser().newContext();await configure(clean);const cleanPage=await clean.newPage();assert(!(await login(cleanPage,oldPassword)).cryptoLocked);assert((await messages(cleanPage)).some(m=>m.text==='M2 secret text — Բարեւ 👋'));await clean.close();
    // Blocked IndexedDB still permits password-based reading on the current page.
    const blocked=await browser.browser().newContext();await configure(blocked);
    await blocked.addInitScript(()=>{IDBFactory.prototype.open=function(){throw new DOMException('Storage blocked','SecurityError');};});
    const bp=await blocked.newPage(),memoryUser=await login(bp,oldPassword);assert(memoryUser.storageUnavailable&&!memoryUser.cryptoLocked);
    assert((await messages(bp)).length>=5);
    await bp.goto(origin+'/profile.html');await bp.locator('[data-identity-unlock] input').fill(oldPassword);await bp.locator('[data-identity-unlock] button[type=submit]').click();await bp.locator('[data-storage-notice]').waitFor();assert(!(await user(bp)).cryptoLocked);await blocked.close();
    await tab.close();console.log('M3 continuity passed: navigation, tabs, restored-page gate, network failure, clean-browser history and blocked storage.');
  }else if(phase==='restart'){
    await ready(p);assert(!(await user(p)).cryptoLocked);assert((await messages(p)).length>=5);assert.equal(workers,0,'Browser restart must use only the validated device copy');console.log('M3 persistent browser restart passed.');
  }else if(phase==='password'){
    await ready(p,'settings.html');await p.locator('#edit-password-btn').waitFor();
    await p.locator('[data-setting="language"]').selectOption('ru');
    await p.waitForFunction(async()=>{const {settings}=await import('/js/services/index.js');return (await settings.get()).language==='ru';});
    await p.reload();await p.waitForFunction(()=>document.querySelector('[data-setting="language"]')?.value==='ru'&&!document.querySelector('main')?.inert);assert.equal(await p.locator('[data-setting="language"]').inputValue(),'ru');
    await p.locator('[data-setting="isProfilePublic"]').selectOption('closed');
    await p.waitForFunction(async()=>{const {settings}=await import('/js/services/index.js');return !(await settings.get()).isProfilePublic;});
    await p.locator('[data-setting="isProfilePublic"]').selectOption('open');
    await p.waitForFunction(async()=>{const {settings}=await import('/js/services/index.js');return (await settings.get()).isProfilePublic;});
    const exportDownload=p.waitForEvent('download');await p.locator('#download-data-btn').click();
    const exportForm=p.locator('#download-data-btn').locator('..').locator('form');await exportForm.locator('input[type=password]').fill(oldPassword);await exportForm.locator('button[type=submit]').click();
    const archive=await exportDownload;assert.equal(archive.suggestedFilename(),'polylink-data.zip');
    const stream=await archive.createReadStream();let archiveBytes=0;for await(const bytes of stream)archiveBytes+=bytes.length;assert(archiveBytes>100);

    const other=await browser.browser().newContext();await configure(other);const op=await other.newPage();await login(op,oldPassword);await op.goto(origin+'/profile.html');
    const tab=await browser.newPage();await ready(tab);
    let lost=false,commits=0;
    await browser.route(api+'/auth/password-change/commit',async route=>{commits++;if(!lost){const response=await route.fetch();assert.equal(response.status(),200);lost=true;await route.abort('failed');}else await route.continue();});
    await p.locator('#edit-password-btn').click();await p.locator('#old-password').fill(oldPassword);await p.locator('#new-password').fill(newPassword);await p.locator('#confirm-password').fill(newPassword);await p.locator('#save-password-btn').click();
    await p.locator('[data-inline-verification]').waitFor({timeout:30000});assert(lost);assert.equal(commits,2);
    await p.locator('[data-inline-verification] input').fill(await proof());await p.locator('[data-inline-verification] button').first().click();
    await p.waitForFunction(async()=>{const {auth}=await import('/js/services/index.js');const u=await auth.me();return u&&!u.cryptoLocked&&!document.querySelector('[data-inline-verification]');});
    await tab.reload();await tab.waitForFunction(async()=>{const {auth}=await import('/js/services/index.js');const u=await auth.me();return u&&!u.cryptoLocked;});
    assert((await messages(p)).some(m=>m.text==='M2 secret text — Բարեւ 👋'));assert(!(await user(tab)).cryptoLocked);
    assert.equal(await user(op),null,'Other browser sessions must be revoked');await other.close();
    const oldResult=await p.evaluate(async({email,password})=>{const {auth}=await import('/js/services/index.js');try{await auth.login({email,password});return 'unexpected';}catch(e){return e.code;}},{email,password:oldPassword});assert.equal(oldResult,'UNAUTHORIZED');
    // Local logout clears both tabs even if remote delivery cannot be confirmed.
    await browser.route(api+'/auth/logout',route=>route.abort('failed'));
    if(!await p.locator('nav a[href="login.html"]').isVisible())await p.locator('.dropdown-btn').click();
    await Promise.all([p.waitForURL('**/login.html'),p.locator('nav a[href="login.html"]').click()]);
    await tab.waitForURL('**/login.html');assert.equal(await user(p),null);
    await p.reload();assert.equal(await user(p),null);assert.equal(await p.evaluate(()=>localStorage.getItem('polylink.http.accessToken')),null);
    console.log('M3 password lifecycle passed: optional inline factor, lost commit, preserved history, cross-tab device recreation, revocation and offline logout.');
  }else throw new Error('Unknown M3 browser phase');
  assert(!payloads.some(body=>body.includes(oldPassword)||body.includes(newPassword)),'Raw passwords must remain in browser memory');
  assert(!payloads.some(body=>body.includes('serviceVaultKey')),'Existing-account continuity/password change must not call Transit setup');
  assert.equal(errors.length,0,errors.join('\n'));
}finally{await browser.close();}
