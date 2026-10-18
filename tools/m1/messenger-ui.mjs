// Run against the static server: M1_FRONTEND=http://localhost:8001 node tools/m1/messenger-ui.mjs
// Uses isolated mock data in the browser; production configuration is never changed.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const origin=process.env.M1_FRONTEND||'http://localhost:8001';
const browser=await chromium.launch({headless:true,executablePath:process.env.M1_CHROMIUM||undefined});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
await context.route('**/js/config.js',async route=>{
  const response=await route.fetch();
  await route.fulfill({response,body:(await response.text()).replace(/dataMode:\s*['"]http['"]/,"dataMode: 'mock'"),contentType:'application/javascript'});
});
const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
const artifacts=process.env.M1_ARTIFACT_DIR;
async function screenshot(name){if(artifacts){await page.waitForFunction(()=>!document.querySelector('.group-dialog[open][aria-busy=true]')&&![...document.querySelectorAll('.messages > [role=status]')].some(node=>node.textContent==='Բեռնվում է...'));await page.evaluate(()=>document.getAnimations().forEach(animation=>animation.finish()));await mkdir(artifacts,{recursive:true});await page.screenshot({path:`${artifacts}/${name}.png`,fullPage:true});}}
async function ready(){await page.waitForFunction(()=>document.querySelector('.chat-item')&&!document.querySelector('main').inert);}
async function service(work,...args){return page.evaluate(async({work,args})=>{const {chat}=await import('/js/services/index.js');return chat[work](...args);},{work,args});}
try{
  await page.goto(origin+'/message.html');await ready();
  await page.locator('[data-room-id="room-2"]').click();
  const input=page.getByRole('textbox',{name:'Հաղորդագրություն',exact:true});await input.fill('Նոր դիզայնի ստուգում');await page.locator('.send-icon').click();await page.locator('.messages').getByText('Նոր դիզայնի ստուգում',{exact:true}).waitFor();
  await page.locator('.chat-actions .action-icon').first().click();
  const search=page.locator('#chat-search');await search.fill('չգտնվող տեքստ');await page.getByText('Բեռնված հաղորդագրություններում ոչինչ չի գտնվել').waitFor();
  const box=await search.boundingBox(),searchButtonBox=await page.locator('.chat-actions .action-icon').first().boundingBox();assert(box.x<searchButtonBox.x,'Search expands left of its button');
  await screenshot('inline-search');await search.press('Escape');assert.equal(await search.isDisabled(),true);await page.locator('.messages').getByText('Նոր դիզայնի ստուգում',{exact:true}).waitFor();
  await input.fill('Սևագիր');await input.evaluate(node=>node.setSelectionRange(0,0));await page.locator('.emoji-btn').click();await screenshot('emoji-picker');await page.getByRole('button',{name:'Ժպիտ',exact:true}).click();assert.equal(await input.inputValue(),'😀Սևագիր');await page.keyboard.press('Escape');
  await page.locator('input[type=file]').setInputFiles({name:'նկար.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5N0AAAAASUVORK5CYII=','base64')});
  await page.locator('.attachment-preview img').waitFor();await screenshot('attachment-preview');await page.getByRole('button',{name:'Հեռացնել կցված պատկերը'}).click();assert.equal(await page.locator('.attachment-preview img').count(),0);
  await page.locator('[data-room-id="room-3"]').click();await page.locator('[data-room-id="room-2"]').click();assert.equal(await input.inputValue(),'😀Սևագիր');
  await page.locator('.menu-btn').click();assert.equal(await page.getByRole('menuitem').count(),4);await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Ստեղծել խումբ',exact:true}).click();
  const dialog=page.locator('.group-dialog');await dialog.waitFor();assert.equal(await dialog.locator('.people-list').first().getByRole('button').count(),5);
  assert((await dialog.getByText('Ձեր կոնտակտները').boundingBox()).y<(await dialog.getByRole('searchbox').boundingBox()).y);
  await dialog.getByLabel('Խմբի անունը',{exact:true}).fill('Դիզայնի քննարկում');await dialog.getByRole('button',{name:'Ավելացնել՝ Գևորգ Մանուկյան'}).click();
  assert.equal(await dialog.locator('.person-chip').count(),1);await dialog.getByRole('searchbox').fill('Լիլիթ');await dialog.locator('.people-list').nth(1).getByRole('button',{name:'Ավելացնել՝ Լիլիթ Սարգսյան'}).click();
  await screenshot('create-group-light');await dialog.locator('[data-create]').click();await dialog.waitFor({state:'hidden'});await page.locator('.contact-name').filter({hasText:'Դիզայնի քննարկում'}).waitFor();
  assert.equal(await page.locator('.menu-btn').isVisible(),false,'Owner has no leave menu');
  await page.locator('.contact-info').click();await dialog.waitFor();assert.equal(await dialog.getByText('Խմբի սեփականատեր',{exact:true}).count(),1);assert.equal(await dialog.locator('.people-list').first().locator('.person-name').count(),3);await screenshot('group-members-light');
  await dialog.getByLabel('Խմբի անունը',{exact:true}).fill('Թարմացված քննարկում');await dialog.getByRole('button',{name:'Պահպանել անունը'}).click();await page.locator('.contact-name').filter({hasText:'Թարմացված քննարկում'}).waitFor();
  await dialog.getByRole('button',{name:'Ավելացնել՝ Մարիամ Գրիգորյան'}).click();await dialog.locator('.people-list').first().getByText('Մարիամ Գրիգորյան',{exact:true}).waitFor();
  await dialog.locator('.person-row').filter({hasText:'Մարիամ Գրիգորյան'}).getByRole('button',{name:'Հեռացնել',exact:true}).click();await dialog.getByRole('button',{name:'Ավելացնել՝ Մարիամ Գրիգորյան'}).waitFor();
  await dialog.getByRole('button',{name:'Փակել',exact:true}).last().click();await input.fill('Խմբային հաղորդագրություն');await page.locator('.send-icon').click();await page.locator('.message-author').waitFor();
  await page.evaluate(async()=>{const {setTheme}=await import('/js/shared/ui.js');setTheme('dark');});await screenshot('messenger-dark');
  const contrast=await page.locator('.message-author').first().evaluate(node=>{const rgb=value=>value.match(/[\d.]+/g).slice(0,3).map(Number);const lum=values=>values.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);const a=lum(rgb(getComputedStyle(node).color)),b=lum(rgb(getComputedStyle(node.closest('.messages')).backgroundColor));return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);});assert(contrast>=4.5,`Sender contrast ${contrast}`);
  const roomId=new URL(page.url()).searchParams.get('room');await service('transferOwner',roomId,'6');await page.waitForFunction(()=>!document.querySelector('.menu-btn').hidden);await page.locator('.menu-btn').click();assert.equal(await page.getByRole('menuitem').count(),1);assert.equal(await page.getByRole('menuitem').innerText(),'Լքել խումբը');await screenshot('group-menu-dark');await page.keyboard.press('Escape');
  await page.locator('.contact-info').click();await dialog.waitFor();assert.equal(await dialog.getByRole('button',{name:'Սեփականատեր դարձնել'}).count(),0);await screenshot('group-members-dark');await page.keyboard.press('Escape');
  await page.setViewportSize({width:390,height:844});await screenshot('messenger-mobile-dark');assert(await page.locator('.chat-area').isVisible());await page.locator('.mobile-back').click();assert(await page.locator('.sidebar').isVisible());await page.locator('[data-room-id="room-2"]').click();assert(await page.locator('.chat-area').isVisible());
  await page.evaluate(async()=>{const {setTheme}=await import('/js/shared/ui.js');setTheme('light');});await screenshot('messenger-mobile-light');
  await page.locator('.mobile-back').click();await page.getByRole('button',{name:'Ստեղծել խումբ',exact:true}).click();await screenshot('create-group-mobile');await page.keyboard.press('Escape');
  await page.setViewportSize({width:1440,height:1000});await page.locator('[data-room-id="room-2"]').click();await screenshot('messenger-light');
  for(const width of [320,768,900,1100,1440]){
    await page.setViewportSize({width,height:900});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`No horizontal overflow at ${width}px`);
    const header=await page.locator('.header').boundingBox(),main=await page.locator('main').boundingBox();assert(header.y+header.height<=main.y,`Header clears messenger at ${width}px`);
  }
  await page.locator(`[data-room-id="${roomId}"]`).click();await page.locator('.menu-btn').click();await page.getByRole('menuitem',{name:'Լքել խումբը'}).click();await page.locator('[data-confirm-yes]').click();await page.waitForFunction(id=>![...document.querySelectorAll('.chat-item')].some(node=>node.dataset.roomId===id),roomId);
  assert.deepEqual(errors,[]);
  console.log('Messenger UI checks passed: contacts, group creation, owner/member menus, message sending, drafts, inline search, emoji insertion, image removal, themes, contrast and mobile navigation.');
}finally{await browser.close();}
