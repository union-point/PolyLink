import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { adminManagementCases } from './admin-management-cases.mjs';
const origin=process.env.M1_FRONTEND,api=process.env.M1_API;
assert(process.env.DB_NAME?.startsWith('polylink_m1_'),'Admin browser checks require disposable infrastructure');
const email=`admin-browser-${randomUUID()}@example.org`,password='Admin browser fixture!4';
function command(args){
  const result=spawnSync('./backend/mvnw',['-q','-f','backend/pom.xml','exec:java','-Dexec.mainClass=am.polylink.admin.AdminCommand',`-Dexec.args=${args}`],{encoding:'utf8',env:{...process.env,ADMIN_REGISTRATION_URL:origin+'/admin-register.html'}});
  assert.equal(result.status,0,'Local admin command succeeds');return result.stdout;
}
const link=command(`invite ${email}`).split('\n').find(line=>line.startsWith(origin+'/admin-register.html#invite='));
assert(link,'Local command returns an invitation link');
async function code(){
  for(let tries=0;tries<30;tries++){
    const messages=await(await fetch(process.env.M1_MAILPIT_URL+'/api/v1/messages')).json();
    const found=messages.messages.find(item=>item.To.some(to=>to.Address===email));
    if(found){const mail=await(await fetch(process.env.M1_MAILPIT_URL+'/api/v1/message/'+found.ID)).json();return mail.Text.match(/\b\d{6}\b/)[0];}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('Admin verification email was not captured');
}
const browser=await chromium.launch({headless:true,executablePath:process.env.M1_CHROMIUM||undefined});
try {
  const context=await browser.newContext({viewport:{width:1100,height:900}});context.setDefaultTimeout(15000);
  await context.addInitScript(()=>{const original=window.setInterval;window.setInterval=(callback,delay,...args)=>{if(delay===15000)window.__adminPoll=callback;return original(callback,delay,...args);};});
  await context.route('**/js/config.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('http://localhost:3004',api),contentType:'application/javascript'});});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(link);await page.locator('#credentials').waitFor({state:'visible'});
  assert.equal(new URL(page.url()).hash,'','Invitation removed from browser URL');
  assert.equal(await page.locator('#email').inputValue(),email);
  await page.locator('#firstName').fill('Admin');await page.locator('#lastName').fill('Browser');
  await page.locator('#password').fill(password);await page.locator('#confirmation').fill(password);
  if(process.env.M1_ADMIN_SCREENSHOT)await page.screenshot({path:process.env.M1_ADMIN_SCREENSHOT,fullPage:true});
  await page.locator('#credentials button[type=submit]').click();await page.locator('#verification').waitFor({state:'visible'});
  assert.equal(await page.locator('#password').inputValue(),'');
  await page.reload();await page.locator('#verification').waitFor({state:'visible'});
  await page.locator('#code').fill(await code());await page.locator('#verification button[type=submit]').click();await page.locator('#success').waitFor({state:'visible'});
  await page.goto(origin+'/admin-login.html');await page.locator('#email').fill(email);await page.locator('#password').fill(password);
  await page.locator('#credentials button[type=submit]').click();await page.locator('#verification').waitFor({state:'visible'});
  const forbidden=await page.evaluate(async(api)=>(await fetch(api+'/admin/auth/session',{credentials:'include'})).status,api);
  assert.equal(forbidden,401,'Password alone cannot create an admin session');
  await page.locator('#code').fill(await code());await page.locator('#verification button[type=submit]').click();await page.locator('#logout').waitFor({state:'visible'});
  assert((await page.locator('#account').textContent()).includes(email));
  const session=await page.evaluate(async(api)=>(await(await fetch(api+'/admin/auth/session',{credentials:'include'})).json()),api);
  assert.equal(session.role,'admin');
  await page.reload();await page.locator('#logout').waitFor({state:'visible'});
  try{await adminManagementCases(page,{origin,artifactDir:process.env.M1_ARTIFACT_DIR||'/tmp'});}catch(error){await page.screenshot({path:'/tmp/admin6-live-failure.png',fullPage:true});console.error(await page.locator('.admin-dialog').evaluateAll(dialogs=>dialogs.map(d=>({open:d.open,title:d.querySelector('h2')?.textContent,fields:[...d.querySelectorAll('input')].map(f=>[f.name,f.value]),status:d.querySelector('[data-status]')?.textContent}))));throw error;}
  command(`disable ${session.id}`);
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.getByRole('link',{name:'Ադմինիստրատորի մուտք',exact:true}).waitFor();
  assert.equal(await page.locator('.admin-dialog').count(),0,'Disabled sessions clear registry drafts');
  await page.goto(origin+'/admin-login.html');
  await page.reload();await page.locator('#credentials').waitFor({state:'visible'});assert(await page.locator('#success').isHidden());
  assert.deepEqual(errors,[],'Admin pages have no uncaught browser errors');
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile page fits the viewport');
  console.log('Admin invitation, registration, required 2FA, reload and disable browser checks passed.');
} finally {await browser.close();}
