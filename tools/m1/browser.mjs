import { isolateDecorativeAssets } from './browser-assets.mjs';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
const phase=process.argv[2],origin=process.env.M1_FRONTEND,api=process.env.M1_API,email=process.env.M1_BROWSER_EMAIL;
const password='M1 Browser fixture pass!4';
const profile=path.join(process.env.M1_ARTIFACT_DIR,phase==='factor'?'second-browser':'browser-profile');
const browser=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.M1_CHROMIUM||undefined});
await isolateDecorativeAssets(browser);
const outbound=[];const failures=[];
browser.on('request',request=>{if(request.url().startsWith(api))outbound.push(request.postData()||'');});
await browser.route('**/js/config.js',async route=>{
  const response=await route.fetch();let text=await response.text();
  const mode=/dataMode:\s*['"](?:mock|http)['"]/;
  assert(mode.test(text),'Browser acceptance requires a recognized data mode');
  text=text.replace(mode,"dataMode: 'http'").replace('http://localhost:3004',api);
  await route.fulfill({response,body:text,contentType:'application/javascript'});
});
// Use a local pinned transport in acceptance, so the test does not depend on a CDN.
await browser.route('**/axios@*/dist/axios.min.js',async route=>{
  await route.fulfill({path:new URL('./node_modules/axios/dist/axios.min.js',import.meta.url).pathname,contentType:'application/javascript'});
});
const page=browser.pages()[0]||await browser.newPage();
page.on('pageerror',error=>failures.push(error.message));
const readUser=()=>page.evaluate(async()=>{const {auth}=await import('/js/services/index.js');return auth.me();});
async function code(){
  for(let i=0;i<50;i++){
    const listing=await (await fetch(process.env.M1_MAILPIT_URL+'/api/v1/messages')).json();
    const item=listing.messages.find(item=>item.To.some(to=>to.Address===email));
    if(item){const mail=await(await fetch(process.env.M1_MAILPIT_URL+'/api/v1/message/'+item.ID)).json();const match=mail.Text.match(/\b[0-9]{6}\b/);if(match)return match[0];}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('Local verification email did not arrive');
}
async function verifyCode(){
  if(phase==='factor'){
    await page.waitForURL('**/2fa-verify.html');
    const value=await code();
    for(let i=0;i<value.length;i++)await page.locator('.code-input').nth(i).fill(value[i]);
    await page.locator('#verify-form [type=submit]').click();
    return;
  }
  await page.locator('#enrollment-code:not([hidden])').waitFor();
  await page.locator('#enrollment-code input').fill(await code());
  await page.locator('#enrollment-code button').first().click();
}
async function assertReady(){
  await page.waitForURL('**/profile.html',{timeout:60000});
  const user=await readUser();assert(user&&!user.cryptoLocked,'Account must be locally unlocked before profile navigation');
  const device=await page.evaluate(async()=>{
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('polylink-key-device-v1');r.onsuccess=()=>resolve(r.result);r.onerror=reject;});
    const records=await new Promise((resolve,reject)=>{const r=db.transaction('devices').objectStore('devices').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=reject;});db.close();
    return records.map(record=>({extractable:record.key.extractable,algorithm:record.key.algorithm.name,length:record.key.algorithm.length,keys:Object.keys(record)}));
  });
  assert.equal(device.length,1);assert.equal(device[0].extractable,false);assert.equal(device[0].algorithm,'AES-GCM');assert.equal(device[0].length,256);
  assert(!device[0].keys.includes('vaultKey'));
  assert.equal(await page.evaluate(()=>localStorage.getItem('polylink.http.accessToken')),null);
}
try{
  if(phase==='setup'){
    await page.goto(origin+'/register.html');await page.locator('select[name=role]').waitFor();
    for(const [id,value]of Object.entries({firstname:'Browser',lastname:'Fixture',email,password,confirm:password}))await page.locator('#'+id).fill(value);
    await page.locator('#register-form [type=submit]').click();
    await page.waitForURL('**/profile_info.html');await page.locator('#profile-fields:not([disabled])').waitFor();
    // Reload resumes the restricted enrollment without storing a password or a derived login proof.
    await page.reload();await page.locator('#profile-fields:not([disabled])').waitFor();
    await page.locator('#instituteId').selectOption({index:1});
    await page.locator('#diplomaNumber').fill(email);await page.locator('#specializationId').selectOption({index:1});await page.locator('#startYear').fill('2021');await page.locator('#endYear').fill('2025');
    await page.locator('#submit-profile').click();await page.locator('#enrollment-code:not([hidden])').waitFor();
    await verifyCode();await page.locator('#enrollment-login:not([hidden])').waitFor();
    await page.locator('#password').fill(password);await page.locator('#enrollment-login [type=submit]').click();await assertReady();
    await page.reload();await assertReady();
    const tab=await browser.newPage();await tab.goto(origin+'/profile.html');await tab.waitForURL('**/profile.html');
    const next=await tab.evaluate(async()=>{const {auth}=await import('/js/services/index.js');return auth.me();});assert(next&&!next.cryptoLocked);await tab.close();
  }else if(phase==='resume'){
    await page.goto(origin+'/profile.html');await assertReady();
    assert(!outbound.some(body=>body.includes('serviceVaultKey')),'Restart/session continuity must not invoke Transit setup');
    await page.goto(origin+'/login.html');await page.locator('#login-form [type=submit]').waitFor();await readUser();
    await browser.setOffline(true);
    const outcome=await page.evaluate(async()=>{try{const {auth}=await import('/js/services/index.js');await auth.logout();return 'unexpected';}catch(error){return error.code;}});
    assert.equal(outcome,'NETWORK');assert.equal(await page.evaluate(()=>localStorage.getItem('polylink.http.loggedOut')),'true');
    await browser.setOffline(false);await page.reload();await page.waitForURL('**/login.html');
    await page.reload();assert(page.url().endsWith('/login.html'),'Remaining cookie must not sign the browser back in after local logout');
  }else if(phase==='factor'){
    await page.goto(origin+'/login.html');await page.locator('#login-form [type=submit]').waitFor();
    await page.locator('#email').fill(email);await page.locator('#password').fill(password);await page.locator('#login-form [type=submit]').click();
    await page.waitForURL('**/2fa-verify.html');
    await page.waitForFunction(()=>typeof document.querySelector('#verify-form')?.onsubmit==='function');
    assert.equal(await page.evaluate(async api=>(await fetch(api+'/auth/me',{credentials:'include'})).status,api),401,'No authenticated session before second factor');
    assert(await page.evaluate(async()=>{
      const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('polylink-key-device-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      try{
        const records=await new Promise((resolve,reject)=>{const r=db.transaction('devices').objectStore('devices').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
        return records.length===1&&records.every(record=>record.account.startsWith('login-challenge:')&&record.key.extractable===false&&record.ciphertext instanceof ArrayBuffer&&!record.familyId);
      }finally{db.close();}
    }),'Only encrypted challenge context may be stored before second factor');
    await page.reload();await page.waitForFunction(()=>typeof document.querySelector('#verify-form')?.onsubmit==='function');
    await verifyCode();await assertReady();
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('polylink.http.loginChallenge')),null,'Verified challenge context must be cleared');
  }else throw new Error('Unknown browser phase');
  assert(!outbound.some(body=>body.includes(password)),'Original password must never reach HTTP');
  assert(!outbound.some(body=>body.includes('"password"')),'Raw password DTO must never reach HTTP');
  assert(!page.url().includes('2fa-verify.html'),'Successful verification must leave the challenge page');
  assert.equal(failures.length,0,'Browser module execution must not raise uncaught errors');
  console.log('Browser '+phase+' acceptance passed.');
}finally{await browser.close();}
