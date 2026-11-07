import assert from 'node:assert/strict';
const record=async(page,area,kind,q)=>page.evaluate(async({area,kind,q})=>{const {createManagementClient}=await import('/js/admin/management-client.js');return (await createManagementClient().list(area,kind,{q})).items[0];},{area,kind,q});
export async function adminManagementCases(page,{origin,artifactDir='/tmp'}={}){
 const suffix=Date.now().toString(36),name='Reference '+suffix;
 const dialog=page.locator('.admin-dialog');
 const ready=async()=>{await page.locator('#admin-kind').waitFor();await page.locator('[data-list-status]').filter({hasText:'Բեռնվում է...'}).waitFor({state:'hidden'});};
 const search=async q=>{await page.locator('#admin-search').fill(q);await page.locator('#admin-search').press('Enter');};
 const save=async()=>{await dialog.locator('[type=submit]').click();await dialog.waitFor({state:'detached'});};
 const confirm=async yes=>{await page.locator('[data-common-confirm]').getByRole('button',{name:yes?'Այո':'Ոչ',exact:true}).click();};
 await page.goto(origin+'/admin-academic.html');await ready();assert.equal(await page.locator('.admin-nav a').count(),3);
 await page.locator('#admin-kind').selectOption('universities');await page.locator('tbody tr').first().waitFor();
 await page.screenshot({path:artifactDir+'/admin-academic-desktop.png',fullPage:true});
 assert(await page.locator('tbody tr').filter({has:page.locator('[data-edit][disabled]')}).count()>0,'Protected university explained');
 await page.locator('#admin-kind').selectOption('degrees');await page.locator('[data-add]').click();await dialog.locator('[name=name]').fill(name);await save();
 await search(name);let row=page.locator('tbody tr').filter({hasText:name});await row.waitFor();const created=await record(page,'references','degrees',name);
 await row.locator('[data-edit]').click();await dialog.locator('[name=name]').fill(name+' draft');
 await page.evaluate(async({id,version,name})=>{const {createManagementClient}=await import('/js/admin/management-client.js');await createManagementClient().update('references','degrees',id,{name:name+' external',version});},{...created,name});
 await dialog.locator('[type=submit]').click();await dialog.locator('[data-reload]').waitFor({state:'visible'});assert.equal(await dialog.locator('[name=name]').inputValue(),name+' draft');
 await dialog.locator('[data-reload]').click();await confirm(true);await page.waitForFunction(value=>document.querySelector('.admin-dialog [name=name]')?.value===value,name+' external');
 await dialog.locator('[name=name]').fill(name+' final');await save();await search(name+' final');row=page.locator('tbody tr').filter({hasText:name+' final'});await row.waitFor();
 await page.locator('[data-add]').click();await dialog.locator('[name=name]').fill(name+' final');await dialog.locator('[type=submit]').click();await dialog.locator('[data-status]').getByText('Այս անվանումն արդեն առկա է։',{exact:true}).waitFor();assert.equal(await dialog.locator('[name=name]').inputValue(),name+' final');
 await dialog.locator('[data-close]').click();await confirm(false);assert(await dialog.isVisible());await dialog.locator('[data-close]').click();await confirm(true);await dialog.waitFor({state:'detached'});
 await row.locator('[data-delete]').click();await confirm(false);assert(await row.isVisible());await row.locator('[data-delete]').click();await confirm(true);await row.waitFor({state:'detached'});
 await page.locator('[data-clear]').click();assert.equal(await page.locator('#admin-search').inputValue(),'');assert(await page.locator('#admin-search').evaluate(el=>el===document.activeElement));
 if(!await page.locator('.admin-mock-notice').count()){
   await page.route(/\/admin\/references\/degrees\?/,route=>route.fulfill({status:503,contentType:'application/json',body:'{"code":"SERVICE_ERROR"}'}));
   await page.locator('[data-refresh]').click();await page.locator('[data-list-status] button').waitFor();
   await page.unroute(/\/admin\/references\/degrees\?/);await page.locator('[data-list-status] button').click();
 }
 await page.locator('.admin-nav a[href="admin-content.html"]').click();await ready();await page.locator('#admin-kind').selectOption('post-types');
 await page.locator('[data-add]').click();await dialog.locator('[name=name]').fill('<b>Type '+suffix+'</b>');await dialog.locator('[name=code]').fill('t'+suffix);await page.screenshot({path:artifactDir+'/admin-content-form-desktop.png',fullPage:true});await save();await search('t'+suffix);row=page.locator('tbody tr').filter({hasText:'<b>Type '+suffix+'</b>'});await row.waitFor();assert.equal(await row.locator('strong b').count(),0);
 await row.locator('[data-edit]').click();assert(await dialog.locator('[name=code]').evaluate(el=>el.readOnly));await dialog.locator('[data-close]').click();await dialog.waitFor({state:'detached'});
 await row.locator('[data-delete]').click();await confirm(true);await row.waitFor({state:'detached'});
 await page.locator('.admin-nav a[href="admin-registry.html"]').click();await ready();
 await page.locator('[data-add]').click();await dialog.locator('[name=departmentId] option').nth(1).waitFor({state:'attached'});
 await dialog.locator('[name=firstName]').fill('Admin');await dialog.locator('[name=lastName]').fill(suffix);await dialog.locator('[name=email]').fill('registry-'+suffix+'@example.org');await dialog.locator('[name=departmentId]').selectOption({index:1});await save();
 await search('registry-'+suffix);row=page.locator('tbody tr').filter({hasText:'registry-'+suffix});await row.waitFor();await row.locator('[data-view]').click();assert(await dialog.locator('[name=email]').evaluate(el=>el.readOnly));await dialog.locator('[data-close]').click();await row.locator('[data-delete]').click();await confirm(true);await row.waitFor({state:'detached'});
 await page.locator('#admin-kind').selectOption('alumni');await page.locator('[data-clear]').click();await page.locator('[data-add]').click();await dialog.locator('[name=specializationId] option').nth(1).waitFor({state:'attached'});
 for(const [key,value] of Object.entries({firstName:'Graduate',lastName:suffix,diplomaNumber:'D-'+suffix,studyStartDate:'2021-09-01',studyEndDate:'2025-06-01'}))await dialog.locator(`[name=${key}]`).fill(value);
 await dialog.locator('[name=specializationId]').selectOption({index:1});await save();await search('D-'+suffix);row=page.locator('tbody tr').filter({hasText:'D-'+suffix});await row.waitFor();
 await page.screenshot({path:artifactDir+'/admin-registry-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile fits document width');await row.locator('[data-edit]').click();await dialog.locator('[name=firstName]').focus();await page.keyboard.press('Tab');assert(await dialog.locator('[name=lastName]').evaluate(el=>el===document.activeElement));await page.screenshot({path:artifactDir+'/admin-registry-mobile.png',fullPage:true});assert(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth),'Mobile dialog fits');assert(await dialog.locator('footer').evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight),'Modal actions remain visible while fields scroll');
 await dialog.locator('[data-close]').click();await row.locator('[data-delete]').click();await confirm(true);await row.waitFor({state:'detached'});
 await page.locator('[data-add]').click();await dialog.locator('[name=firstName]').fill('Sensitive draft');
 // A restored page must keep drafts hidden until the isolated admin session passes.
 await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
 assert(await page.locator('body').evaluate(el=>el.hasAttribute('data-admin-check')));
 await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
 await page.waitForFunction(()=>!document.body.hasAttribute('data-admin-check'));
 assert.equal(await dialog.locator('[name=firstName]').inputValue(),'Sensitive draft');
 await dialog.locator('[name=firstName]').focus();await page.evaluate(()=>document.querySelector('.admin-dialog [name=firstName]').setSelectionRange(2,5));
 await page.evaluate(()=>window.__adminPoll?.());await page.waitForTimeout(100);
 assert(await dialog.locator('[name=firstName]').evaluate(el=>el===document.activeElement&&el.selectionStart===2&&el.selectionEnd===5),'Background poll preserves typing focus and selection');
 if(!await page.locator('.admin-mock-notice').count()){
   await page.route('**/admin/auth/session',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'SERVICE_ERROR'})}));
   await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
   const retry=page.locator('[data-admin-session-error] button');await retry.waitFor({state:'visible'});assert(await dialog.isHidden(),'Offline check hides sensitive draft');
   await retry.focus();assert(await retry.evaluate(el=>el===document.activeElement),'Retry remains keyboard reachable outside suspended native modal');
   await page.unroute('**/admin/auth/session');await retry.click();await dialog.waitFor({state:'visible'});
   assert.equal(await dialog.locator('[name=firstName]').inputValue(),'Sensitive draft');
 }


 console.log('Admin academic/content/registry CRUD, locks, stale drafts, confirmation, keyboard and mobile journeys passed.');
}
