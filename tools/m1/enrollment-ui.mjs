import { chromium } from 'playwright';
import { isolateDecorativeAssets } from './browser-assets.mjs';
import assert from 'node:assert/strict';
const origin=process.env.M1_FRONTEND,api=process.env.M1_API,password='Enrollment fixture!4';
const browser=await chromium.launch({headless:true,executablePath:process.env.M1_CHROMIUM||undefined});
const errors=[];
async function code(email){
  for(let i=0;i<50;i++){
    const list=await(await fetch(process.env.M1_MAILPIT_URL+'/api/v1/messages')).json();const found=list.messages.find(m=>m.To.some(to=>to.Address===email));
    if(found){const mail=await(await fetch(process.env.M1_MAILPIT_URL+'/api/v1/message/'+found.ID)).json();return mail.Text.match(/\b\d{6}\b/)[0];}
    await new Promise(resolve=>setTimeout(resolve,100));
  }throw new Error('Enrollment code was not delivered');
}
try{
  for(const [index,role] of [[1,'graduate'],[2,'lecturer']]){
    const context=await browser.newContext({viewport:{width:390,height:844}});await isolateDecorativeAssets(context);
    await context.route('**/js/config.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('http://localhost:3004',api),contentType:'application/javascript'});});
    await context.route('**/axios@*/dist/axios.min.js',route=>route.fulfill({path:new URL('./node_modules/axios/dist/axios.min.js',import.meta.url).pathname,contentType:'application/javascript'}));
    context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
    const page=await context.newPage(),email=process.env.M1_BROWSER_EMAIL.replace('browser-',`enrollment-ui-${index}-`);
    await page.goto(origin+'/register.html');await page.waitForFunction(()=>typeof document.querySelector('form').onsubmit==='function');
    for(const [id,value]of Object.entries({firstname:'Enrollment',lastname:role,email,password,confirm:password}))await page.locator('#'+id).fill(value);
    await page.locator('#register-form [type=submit]').click();await page.waitForURL('**/profile_info.html');await page.locator('#profile-fields:not([disabled])').waitFor();
    assert.equal(await page.evaluate(async()=>{const {auth}=await import('/js/services/index.js');return auth.me();}),null);
    await page.locator(`[name=role][value=${role}]`).check();assert.equal(await page.locator('#firstName,#lastName').count(),0);
    assert.equal(await page.getByLabel('Ֆակուլտետ/ինստիտւտ', {exact:true}).getAttribute('required'), '');
    await page.locator('#save-profile').click();await page.locator('#instituteId[aria-invalid=true]').waitFor();
    await page.locator('#instituteId').selectOption({index:1});
    if(role==='graduate') {await page.locator('#diplomaNumber').fill(email+'-wrong');await page.locator('#specializationId').selectOption({index:1});await page.locator('#startYear').fill('2021');await page.locator('#endYear').fill('2025');}
    else {await page.locator('#departmentId').selectOption({index:1});await page.locator('#professionId').selectOption({index:1});}
    if(role==='graduate') {
      await page.locator('#submit-profile').click();await page.getByText('Գրանցամատյանում համապատասխան տվյալներ չեն գտնվել։ Ստուգեք տվյալները կամ դիմեք համալսարանին։',{exact:true}).waitFor();
      assert.equal(await page.locator('#diplomaNumber').inputValue(),email+'-wrong');await page.locator('#diplomaNumber').fill(email);
    }
    await Promise.all([page.waitForResponse(response=>response.url()===api+'/auth/enrollment/profile'&&response.status()===200),page.locator('#save-profile').click()]);await page.getByText('Տվյալները պահպանված են։',{exact:true}).waitFor();
    // A second tab saves a newer revision. The first tab must retain fields and show a conflict.
    const stale=await context.newPage();await stale.goto(origin+'/profile_info.html');await stale.locator('#profile-fields:not([disabled])').waitFor();await stale.locator('#biography').fill('Saved in another tab');await Promise.all([stale.waitForResponse(response=>response.url()===api+'/auth/enrollment/profile'&&response.status()===200),stale.locator('#save-profile').click()]);await stale.getByText('Տվյալները պահպանված են։',{exact:true}).waitFor();
    await page.locator('#submit-profile').click();await page.getByText('Տվյալները փոխվել են մեկ այլ ներդիրում։ Թարմացրեք էջը և կրկին փորձեք։',{exact:true}).waitFor();assert.equal(await page.locator('#firstName,#lastName').count(),0);
    await stale.close();await page.reload();await page.locator('#profile-fields:not([disabled])').waitFor();assert.equal(await page.locator('#biography').inputValue(),'Saved in another tab');assert.notEqual(await page.locator('#instituteId').inputValue(),'');
    if(process.env.M1_ENROLLMENT_SCREENSHOT)await page.screenshot({path:`${process.env.M1_ENROLLMENT_SCREENSHOT}-${role}.png`,fullPage:true});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Enrollment form fits a mobile viewport');
    await page.locator('#submit-profile').click();await page.locator('#enrollment-code:not([hidden])').waitFor();await page.reload();await page.locator('#enrollment-code:not([hidden])').waitFor();
    let lost=false;await context.route(api+'/auth/email/verify',async route=>{if(!lost){lost=true;const response=await route.fetch();assert.equal(response.status(),200);await route.abort('failed');}else await route.continue();});
    await page.locator('#verification-code').fill(await code(email));await page.locator('#enrollment-code [type=submit]').click();await page.locator('#enrollment-code [role=alert]').waitFor();
    await page.locator('#enrollment-code [type=submit]').click();await page.locator('#enrollment-login:not([hidden])').waitFor();assert(lost);
    await page.locator('#password').fill(password);await page.locator('#enrollment-login [type=submit]').click();await page.waitForURL('**/profile.html',{timeout:60000});
    const user=await page.evaluate(async()=>{const {auth}=await import('/js/services/index.js');return auth.me();});assert.equal(user.role,role);assert(user.onboardingComplete&&!user.cryptoLocked);
    await context.close();
  }
  assert.equal(errors.length,0,errors.join('\n'));console.log('Enrollment browser acceptance passed: both roles, editable mismatches, reload, stale tabs, lost verification responses, mobile layout and key setup.');
}finally{await browser.close();}
