import {chromium, firefox, webkit} from 'playwright';
import assert from 'node:assert/strict';
const engine = {chromium, firefox, webkit}[process.env.M1_BROWSER || 'chromium'];
const browser=await engine.launch({headless:true});
try {
 for(const width of [1280,390]) {
 const page=await browser.newPage({viewport:{width,height:850}});
 await page.route('**/js/profile-info.js',r=>r.fulfill({body:'',contentType:'application/javascript'}));
 await page.goto((process.env.M1_FRONTEND || 'http://localhost:8137')+'/profile_info.html');
 await page.evaluate(async()=>{
 document.querySelector('#profile-fields').disabled=false;
 for(const select of document.querySelectorAll('select'))select.replaceChildren(new Option('Ընտրեք…',''),new Option('Համակարգչային ճարտարագիտություն','1'),new Option('Երկար անվանումով համալսարանի ֆակուլտետ և մասնագիտություն','2'));
 window.dropdownEvents = {input: 0, change: 0};
 for (const type of ['input', 'change']) document.querySelector('form').addEventListener(type, () => window.dropdownEvents[type]++);
 const {initializeProfileSelects}=await import('/js/profile-info-select.js');initializeProfileSelects(document.querySelector('form'));
 });
 for(const id of ['instituteId','specializationId','departmentId','professionId']) {
 await page.evaluate(()=>{document.querySelector('[data-lecturer]').hidden=false;});
 const trigger=page.locator('#'+id+'-trigger'), select=page.locator('#'+id);
 await trigger.click(); assert.equal(await trigger.getAttribute('aria-expanded'),'true');
 const a=await trigger.boundingBox(),b=await page.locator('#'+id+'-list').boundingBox();assert(b.y>=a.y+a.height);assert(Math.abs(b.width-a.width)<1);
 await trigger.press('Home');await trigger.press('ArrowDown');await trigger.press('Enter');
 assert.equal(await select.inputValue(),'1');assert.equal(await trigger.getAttribute('aria-expanded'),'false');
 await trigger.click();await trigger.press('ArrowDown');await trigger.press('Escape');assert.equal(await select.inputValue(),'1');
 await trigger.click();await trigger.press('Tab');assert.equal(await trigger.getAttribute('aria-expanded'),'false');
 await trigger.click();await page.locator('h1').click();assert.equal(await trigger.getAttribute('aria-expanded'),'false');
 }
 assert.deepEqual(await page.evaluate(() => window.dropdownEvents), {input: 4, change: 4});
 await page.locator('#instituteId-trigger').click();
 await page.locator('#instituteId-option-2').click();
 assert.equal(await page.locator('#instituteId').inputValue(),'2');
 await page.evaluate(()=>{document.querySelector('#instituteId').setAttribute('aria-invalid','true');document.querySelector('#instituteId').classList.add('error');});
 await page.waitForTimeout(30);
 assert.equal(await page.locator('#instituteId-trigger').getAttribute('aria-invalid'),'true');
 await page.evaluate(()=>{document.querySelector('#departmentId').disabled=true;document.querySelector('#professionId').disabled=true;});
 await page.waitForTimeout(30);
 assert(await page.locator('#departmentId-trigger').isDisabled());
 await page.evaluate(()=>{document.querySelector('#instituteId').focus();});assert.equal(await page.locator('#instituteId-trigger').getAttribute('aria-expanded'),'true');
 await page.evaluate(()=>{document.querySelector('#profile-fields').disabled=true;});await page.waitForTimeout(30);assert.equal(await page.locator('#instituteId-trigger').getAttribute('aria-expanded'),'false');assert(await page.locator('#instituteId-trigger').isDisabled());
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.evaluate(()=>{document.querySelector('#profile-fields').disabled=false;document.documentElement.classList.add('theme-dark');});
 await page.locator('#instituteId-trigger').click();
 if(process.env.M1_ENROLLMENT_SCREENSHOT) await page.screenshot({path:`${process.env.M1_ENROLLMENT_SCREENSHOT}-${width}.png`});await page.close();
 console.log('Passed dropdown geometry, keyboard, dismissal, validation focus, disabled state and width at',width);
 }
} finally {await browser.close();}
