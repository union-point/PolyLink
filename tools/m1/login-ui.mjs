// Run against the static server: M1_FRONTEND=http://localhost:8001 node tools/m1/login-ui.mjs
// Exercise real page controllers and crypto with an isolated HTTP service fixture.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const origin=process.env.M1_FRONTEND||'http://localhost:8001';
const browser=await chromium.launch({headless:true,executablePath:process.env.M1_CHROMIUM||undefined});
const context=await browser.newContext();
const errors=[];
await context.route('**/js/data/http/transport.js',route=>route.fulfill({contentType:'application/javascript',body:`
  import { sodium, derive, seal, aad } from '/js/crypto/sodium.js';
  import { DataError } from '/js/data/errors.js';
  const settings={scheme:'PLK1',salt:'AAAAAAAAAAAAAAAAAAAAAA',opsLimit:2,memoryBytes:67108864};
  const versions={credential:'1',vaultKey:'1',vaultRevision:'1'};
  const session={user:{id:'login-test',firstName:'Test',lastName:'User',onboardingComplete:true},familyId:'test-family',versions};
  let fixture;
  async function bundle(){
    if(fixture)return fixture;
    const cached=sessionStorage.getItem('test.loginFixture');
    if(cached)return fixture=JSON.parse(cached);
    const s=await sodium(),derived=await derive('TestPassword1!',settings),key=s.randombytes_buf(32),pair=s.crypto_box_keypair();
    const b64=value=>s.to_base64(value,s.base64_variants.URLSAFE_NO_PADDING);
    const identity={version:'1',publicKey:b64(pair.publicKey)};
    const contents={scheme:'PLK1',userId:session.user.id,vaultKeyVersion:'1',vaultRevision:'1',currentIdentityVersion:'1',identities:[{...identity,privateKey:b64(pair.privateKey)}]};
    fixture={versions,identity,vault:await seal(JSON.stringify(contents),key,aad('vault',session.user.id,'1','1')),passwordCopy:await seal(key,derived.wrapping,aad('password-copy',session.user.id,'1','1'))};
    sessionStorage.setItem('test.loginFixture',JSON.stringify(fixture));return fixture;
  }
  const challenge=id=>({challengeId:id,expiresAt:new Date(Date.now()+600000).toISOString(),resendAfter:new Date().toISOString()});
  const authenticated=()=>({status:'authenticated',accessToken:'test-token',session});
  export async function loadTransport(){return {
    setToken(){},beginSession(){},isLoggedOut(){return false;},restore:async()=>{},
    async request({url,data}){
      if(url==='/auth/parameters')return settings;
      if(url==='/auth/login')return data.email==='direct@example.com'?authenticated():{status:'challenge',challenge:challenge('first-code')};
      if(url==='/auth/login/verify'){
        if(data.code!=='123456')throw new DataError('VALIDATION','Incorrect code');
        return authenticated();
      }
      if(url==='/auth/challenges/resend')return challenge('resent-code');
      if(url==='/auth/me')return session;
      if(url==='/keys/me')return bundle();
      throw new Error('Unexpected fixture request: '+url);
    }
  };}
` }));
await context.route(/\/(profile|profile_info)\.html$/,route=>route.fulfill({contentType:'text/html',body:'<p>Signed in</p>'}));
const page=await context.newPage();
page.on('pageerror',error=>errors.push(error.message));
async function ready(){await page.waitForFunction(()=>document.querySelector('form')&&!document.querySelector('.container').inert);}
async function login(email){
  await page.goto(origin+'/login.html');await ready();
  assert.equal(await page.locator('[data-inline-verification],.code-input').count(),0);
  assert.equal(await page.locator('button').count(),2);
  await page.locator('#email').fill(email);await page.locator('#password').fill('TestPassword1!');
  await page.locator('[type=submit]').click();
}
async function code(value){for(let i=0;i<6;i++)await page.locator('.code-input').nth(i).fill(value[i]);}
try{
  await login('factor@example.com');await page.waitForURL('**/2fa-verify.html');await ready();
  assert.equal(await page.locator('.code-input').count(),6);
  assert.equal(await page.evaluate(async()=>{
    const account=sessionStorage.getItem('polylink.http.loginChallenge');
    const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('polylink-key-device-v1',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    try{
      const record=await new Promise((resolve,reject)=>{const request=db.transaction('devices').objectStore('devices').get(account);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
      return record.key.extractable===false&&record.ciphertext instanceof ArrayBuffer&&!record.derived&&!JSON.stringify(sessionStorage).includes('TestPassword1!');
    }finally{db.close();}
  }),true,'Navigation context stores encrypted derivatives with a non-extractable key');
  await page.reload();await ready();
  await code('000000');await page.locator('[type=submit]').click();
  await page.getByRole('alert').filter({hasText:'Incorrect code'}).waitFor();
  assert(page.url().endsWith('/2fa-verify.html'));
  await page.locator('#resend-btn').click();
  await page.waitForFunction(()=>JSON.parse(sessionStorage.getItem('polylink.http.workflow')).challengeId==='resent-code');
  await page.reload();await ready();
  await code('123456');await page.locator('[type=submit]').click();
  await page.waitForURL('**/profile.html');
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('polylink.http.loginChallenge')),null);
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('polylink.http.workflow')),null);
  await login('direct@example.com');await page.waitForURL('**/profile.html');
  await page.goto(origin+'/2fa-verify.html');await ready();
  assert.equal(await page.locator('[type=submit]').isDisabled(),true);
  await login('factor@example.com');await page.waitForURL('**/2fa-verify.html');await ready();
  assert.equal(await page.evaluate(async()=>{
    const {loadLoginChallenge}=await import('/js/crypto/device-store.js');
    const now=Date.now;Date.now=()=>now()+700000;
    try{return await loadLoginChallenge('first-code');}finally{Date.now=now;}
  }),null,'Expired navigation context cannot restore password derivatives');
  await page.evaluate(()=>{const key='polylink.http.workflow';const workflow=JSON.parse(sessionStorage.getItem(key));workflow.expiresAt=Date.now()-1;sessionStorage.setItem(key,JSON.stringify(workflow));});
  await page.reload();await ready();
  assert.equal(await page.locator('[type=submit]').isDisabled(),true);
  assert.deepEqual(errors,[]);
  console.log('Login UI checks passed: clean login card, challenge redirect, encrypted context, reload, wrong code, resend, verified profile redirect, context cleanup, direct login, missing and expired challenges.');
}finally{await browser.close();}
