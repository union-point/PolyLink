import { registerForVerification } from './enrollment-fixture.mjs';
import { chromium } from 'playwright';
import { isolateDecorativeAssets } from './browser-assets.mjs';
import assert from 'node:assert/strict';
const origin=process.env.M1_FRONTEND,api=process.env.M1_API,password='Profile browser fixture!4';
const mock=process.argv.includes('--mock');
const browser=await chromium.launch({headless:true,executablePath:process.env.M1_CHROMIUM||undefined}),errors=[];
async function member(index,role){
 const context=await browser.newContext({viewport:{width:1280,height:900}});context.setDefaultTimeout(15000);await isolateDecorativeAssets(context);
 await context.addInitScript(()=>{window.Notification=class{static permission='denied';};Object.defineProperty(navigator,'locks',{value:undefined,configurable:true});});
 await context.route('**/js/config.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('http://localhost:3004',api),contentType:'application/javascript'});});
 await context.route('**/axios@*/dist/axios.min.js',route=>route.fulfill({path:new URL('./node_modules/axios/dist/axios.min.js',import.meta.url).pathname,contentType:'application/javascript'}));
 context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
 const page=await context.newPage();await page.goto(origin+'/login.html');await page.locator('#login-form').waitFor();
 const email=process.env.M1_BROWSER_EMAIL.replace('browser-',`profile-${index}-`);
 const challenge=await registerForVerification(page,{email,password,firstName:'Profile',lastName:role,role});
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

async function mockMember(){
 const context=await browser.newContext({viewport:{width:1280,height:900}});context.setDefaultTimeout(15000);await isolateDecorativeAssets(context);
 await context.route('**/js/config.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace(/dataMode:\s*['"]http['"]/ ,"dataMode: 'mock'"),contentType:'application/javascript'});});
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));return {page,context};
}
const service=(page,operation,...args)=>page.evaluate(async({operation,args})=>{const {profiles}=await import('/js/services/index.js');const [group,method]=operation.split('.');return method?profiles[group][method](...args):profiles[group](...args);},{operation,args});
let firstMember;
const modalFor=page=>page.locator('.modal-overlay');
async function save(page){await modalFor(page).locator('.modal-footer .primary-btn').click();await modalFor(page).waitFor({state:'detached'});}
try{
 for(const [index,role] of [[1,'graduate'],[2,'lecturer']]){
  const {page,context}=mock?await mockMember():await member(index,role);
  await page.goto(origin+'/profile.html');await page.locator('.intro-card .secondary-btn').waitFor();
  await page.waitForFunction(()=>typeof document.querySelector('.intro-card .secondary-btn')?.onclick==='function');
  console.log(`Profile ${mock?'mock':'HTTP'} ${role}: page ready`);
  if(mock&&role==='lecturer'){await page.evaluate(async()=>{const {transaction}=await import('/js/data/mock/store.js');await transaction(s=>{s.users.find(u=>u.id===s.sessionUserId).role='lecturer';},{write:true});});}
  const name=await page.locator('.name-title-section h1').textContent();
  await page.locator('.intro-card .secondary-btn').click();assert.equal(await page.locator('.name-title-section h1').getAttribute('contenteditable'),null);
  await page.locator('.job-title').fill('Profile engineer');await page.locator('.desc p').fill('Profile biography <b>plain</b>');
  await page.locator('.intro-card .primary-btn').click();await page.waitForFunction(()=>!document.querySelector('.job-title[contenteditable=true]'));
  assert.equal(await page.locator('.name-title-section h1').textContent(),name);assert.equal(await page.locator('.desc p b').count(),0);
  console.log(`Profile ${role}: editor verified`);
  await page.locator('.intro-card .primary-btn').click();const chooser=modalFor(page);
  assert.equal(await chooser.locator('.profile-section-choice').count(),3);assert(await chooser.locator('.modal-footer .primary-btn').isHidden());
  await page.keyboard.press('ControlOrMeta+s');assert(await chooser.isVisible(),'Section chooser has no save action');
  await page.keyboard.press('Shift+Tab');await page.keyboard.press('Shift+Tab');
  assert(await chooser.locator('.modal-footer .secondary-btn').evaluate(el=>document.activeElement===el),'Focus stays inside the dialog');
  await page.keyboard.press('Escape');await chooser.waitFor({state:'detached'});

  const before=await page.locator('.education-section .item-entry').count();
  if(mock)await page.evaluate(async()=>{const {mockControls}=await import('/js/data/client.js');await(await mockControls()).failNext('profiles.education.options','NETWORK','Options retry');});
  else {let failed=false;await context.route(api+'/users/me/education/options',async route=>{if(!failed){failed=true;await route.abort('failed');}else await route.continue();});}
  await page.locator('.education-section .fa-plus').focus();await page.locator('.education-section .fa-plus').press('Enter');let form=modalFor(page);
  assert(await form.locator('.modal-footer .primary-btn').isDisabled(),'Save stays disabled until reference data loads');
  await form.getByText('Կրկին փորձել',{exact:true}).click();
  await form.locator('[name=universityId] option').nth(1).waitFor({state:'attached'});assert.equal(await form.locator('select[name$=Id]').count(),4);
  assert(await form.locator('.modal-footer .primary-btn').isEnabled());
  assert.equal(await form.locator('.profile-search-toggle,[data-profile-search],.profile-date-precision').count(),0);
  for(const select of await form.locator('select[name$=Id]').all()){
   assert.equal(await select.inputValue(),await select.locator('option').first().getAttribute('value'),'First reference is selected by default');
  }
  await form.locator('.profile-modal-close').click();await form.waitFor({state:'detached'});
  assert(await page.locator('.education-section .fa-plus').evaluate(el=>document.activeElement===el),'Close restores the trigger focus');
  assert.notEqual(await page.evaluate(()=>document.body.style.overflow),'hidden','Closing restores page scrolling');
  await page.locator('.education-section .fa-plus').press('Enter');form=modalFor(page);await form.locator('[name=universityId] option').nth(1).waitFor({state:'attached'});

  await form.locator('[name=universityId]').selectOption({index:1});await form.locator('[name=startDate]').fill('2020-09-15');await form.locator('[name=isOngoing]').check();
  assert(await form.locator('[name=endDate]').isDisabled());
  await save(page);assert.equal(await page.locator('.education-section .item-entry').count(),before+1);assert.match(await page.locator('.education-section .item-entry').last().textContent(),/2020.*Շարունակվում է/s);
  const addedEducation=page.locator('.education-section .item-entry').last();
  await addedEducation.locator('.edit-icon').dispatchEvent('click');form=modalFor(page);
  assert.equal(await form.locator('[name=startDate]').inputValue(),'2020-09-01');
  assert.equal(await form.locator('.profile-date-precision').count(),0);
  await form.locator('[name=isOngoing]').uncheck();await form.locator('[name=endDate]').fill('2019-06-01');
  await form.locator('.modal-footer .primary-btn').click();await form.locator('[role=alert]').waitFor();
  await form.locator('[name=endDate]').fill('2024-06-01');
  const actions=await form.locator('.modal-footer button').evaluateAll(buttons=>buttons.map(button=>({x:button.getBoundingClientRect().x,y:button.getBoundingClientRect().y})));
  assert.equal(actions.length,3);assert(actions[0].x<actions[1].x&&actions[1].x<actions[2].x);assert(actions.every(action=>action.y===actions[0].y),'Edit actions share one row');
  await page.screenshot({path:`/tmp/polylink-education-${role}.png`,fullPage:true});
  await save(page);
  console.log(`Profile ${role}: education verified`);
  await page.locator('.licenses-section .fa-plus').dispatchEvent('click');form=modalFor(page);
  await form.locator('[name=name]').fill('Profile certificate');await form.locator('[name=organization]').fill('Profile issuer');await form.locator('[name=credentialUrl]').fill('https://example.invalid/proof');await form.locator('[name=issueDate]').fill('2024-06-17');
  if(mock)await page.evaluate(async()=>{const {mockControls}=await import('/js/data/client.js');await(await mockControls()).failNext('profiles.certificates.create','NETWORK','Retry certificate');});
  else {let failed=false;await context.route(api+'/users/me/licenses',async route=>{if(route.request().method()==='POST'&&!failed){failed=true;await route.abort('failed');}else await route.continue();});}
  await form.locator('.modal-footer .primary-btn').click();await form.locator('[role=alert]').waitFor();assert.equal(await form.locator('[name=name]').inputValue(),'Profile certificate');await save(page);
  const certificates=await service(page,'get',await page.evaluate(async()=>{const {auth}=await import('/js/services/index.js');return (await auth.me()).id;}));assert.equal(certificates.licenses.find(row=>row.name==='Profile certificate').issueDate,'2024-06');
  await page.reload();await page.getByText('Profile certificate',{exact:true}).waitFor();assert.equal(await page.locator('.job-title').textContent(),'Profile engineer');
  await context.route('https://example.invalid/**',route=>route.fulfill({body:'Fixture credential',contentType:'text/plain'}));
  const popup=page.waitForEvent('popup');await page.locator('.licenses-section .show-cred-btn').last().click();const credential=await popup;await credential.waitForLoadState();assert.equal(credential.url(),'https://example.invalid/proof');await credential.close();
  const cert=page.locator('.licenses-section .item-entry').filter({hasText:'Profile certificate'});await cert.locator('.edit-icon').dispatchEvent('click');form=modalFor(page);
  await form.locator('[name=name]').fill('Discard this');await form.locator('.modal-footer .secondary-btn').click();await page.locator('#custom-confirm-backdrop:not(.hidden),[data-common-confirm]:not(.hidden)').waitFor();
  await page.locator('#confirm-yes:visible,[data-confirm-yes]:visible').click();await form.waitFor({state:'detached'});assert.equal(await page.getByText('Discard this',{exact:true}).count(),0);
  await cert.locator('.edit-icon').dispatchEvent('click');await modalFor(page).locator('.delete-entry-btn').click();await page.locator('#custom-confirm-backdrop:not(.hidden),[data-common-confirm]:not(.hidden)').waitFor();await page.locator('#confirm-yes:visible,[data-confirm-yes]:visible').click();await modalFor(page).waitFor({state:'detached'});
  const file={name:'profile.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAUAAAACgCAIAAADywSLLAAAB60lEQVR4nO3TQQ0AIBDAsAP/nsEDH7KkVbDP1swZoGn/DgDeGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEHYBOjMCPwoyEA8AAAAASUVORK5CYII=','base64')};
  for(const selector of ['.banner-edit-icon','.profile-photo-area > .profile-photo']){
   const chooser=page.waitForEvent('filechooser');await page.locator(selector).dispatchEvent('click');await(await chooser).setFiles(file);await page.getByText('Լուսանկարը թարմացվել է',{exact:true}).waitFor();
  }
  await page.locator('.announcements-section .fa-plus').dispatchEvent('click');const postForm=page.locator('.posts-modal');
  await postForm.locator('[name=sphereCode] option[value=other]').waitFor({state:'attached'});await postForm.locator('[name=title]').fill('Profile announcement');await postForm.locator('[name=category]').selectOption('job');await postForm.locator('[name=sphereCode]').selectOption('other');await postForm.locator('[contenteditable]').fill('Profile announcement body');await postForm.locator('[type=submit]').click();await postForm.waitFor({state:'detached'});
  const card=page.locator('.post-card').filter({hasText:'Profile announcement'});await card.waitFor();await card.locator('.comments-toggle').click();await card.locator('.comment-input').fill('Profile comment');await card.locator('.comment-btn').click();await card.getByText('Profile comment',{exact:true}).waitFor();
  await card.locator('[data-post-edit]').click();await postForm.locator('[name=title]').fill('Edited profile announcement');await postForm.locator('[type=submit]').click();await postForm.waitFor({state:'detached'});await page.getByText('Edited profile announcement',{exact:true}).waitFor();
  await page.screenshot({path:`/tmp/polylink-profile-${mock?'mock':'http'}-${role}.png`,fullPage:true});
  const own=await page.evaluate(async()=>{const {auth}=await import('/js/services/index.js');return (await auth.me()).id;});
  await page.goto(origin+'/user.html?id='+own);await page.locator('.education-list .item-entry').first().waitFor();assert.match(await page.locator('.education-list').textContent(),/2020/);
  await page.getByText('Edited profile announcement',{exact:true}).waitFor();
  assert(await page.locator('.intro-card .primary-btn').isDisabled(),'Own member-view contact is disabled');
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:`/tmp/polylink-profile-mobile-${mock?'mock':'http'}-${role}.png`,fullPage:true});
  const overflow=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,elements:[...document.querySelectorAll('body *')].filter(el=>el.getBoundingClientRect().right>innerWidth+1).map(el=>({tag:el.tagName,classes:el.className,right:el.getBoundingClientRect().right})).slice(0,12)}));
  assert(overflow.scroll<=overflow.width,'Profile fits a mobile viewport: '+JSON.stringify(overflow));
  if(index===1)firstMember=own;
  if(index===2){
    await page.goto(origin+'/user.html?id='+(mock?'2':firstMember));await page.waitForFunction(()=>typeof document.querySelector('.intro-card .primary-btn')?.onclick==='function');
    await page.locator('.intro-card .primary-btn').click();await page.waitForURL('**/message.html?room=*');
  }
  await context.close();
 }
 if(mock){
  const {page,context}=await mockMember();await page.goto(origin+'/profile.html');
  await page.waitForFunction(()=>typeof document.querySelector('.intro-card .primary-btn')?.onclick==='function');
  await page.evaluate(async()=>{const {transaction}=await import('/js/data/mock/store.js');await transaction(state=>{
   state.education=state.education.filter(row=>row.userId!==state.sessionUserId);state.certificates=state.certificates.filter(row=>row.userId!==state.sessionUserId);state.users.find(row=>row.id===state.sessionUserId).cover='';
  },{write:true});});
  await page.reload();await page.waitForFunction(()=>typeof document.querySelector('.intro-card .primary-btn')?.onclick==='function');
  assert(await page.locator('.education-section').isHidden());assert(await page.locator('.licenses-section').isHidden());
  assert.match(await page.locator('.banner-photo').evaluate(el=>getComputedStyle(el).backgroundImage),/gradient/);
  await page.setViewportSize({width:390,height:844});
  for(const [choice,section] of [['Կրթություն','.education-section'],['Հավաստագիր','.licenses-section']]){
   await page.locator('.intro-card .primary-btn').click();await modalFor(page).getByText(choice,{exact:true}).click();
   const form=modalFor(page);await form.locator('.primary-btn').waitFor();
   if(choice==='Կրթություն')await page.waitForFunction(()=>!document.querySelector('.profile-modal-footer .primary-btn').disabled);
   else{await form.locator('[name=name]').fill('Only certificate');await form.locator('[name=organization]').fill('Issuer');}
   await save(page);assert(await page.locator(section).isVisible());assert.equal(await page.locator(section+' .item-logo svg').count(),1);
   await page.locator(section+' .edit-icon').last().dispatchEvent('click');await modalFor(page).locator('.delete-entry-btn').waitFor();
   const rows=await modalFor(page).locator('.modal-footer button').evaluateAll(buttons=>buttons.map(el=>el.getBoundingClientRect().y));assert(rows.every(y=>y===rows[0]),'Footer stays on one row on mobile');
   await modalFor(page).locator('.delete-entry-btn').click();await page.locator('#confirm-yes:visible,[data-confirm-yes]:visible').click();await modalFor(page).waitFor({state:'detached'});assert(await page.locator(section).isHidden());
  }
  await page.screenshot({path:'/tmp/polylink-profile-empty-mobile.png',fullPage:true});
  await context.close();
 }
 assert.deepEqual(errors,[]);console.log(`Profile ${mock?'mock':'HTTP'} browser acceptance passed`);
}finally{await browser.close();}
