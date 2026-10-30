import { chromium } from 'playwright';
import { isolateDecorativeAssets } from './browser-assets.mjs';
import assert from 'node:assert/strict';
const origin=process.env.M1_FRONTEND||'http://localhost:8138';
const browser=await chromium.launch({headless:true,executablePath:process.env.M1_CHROMIUM||undefined});
const context=await browser.newContext({viewport:{width:1280,height:900},hasTouch:true});await isolateDecorativeAssets(context);
await context.addInitScript(()=>{Object.defineProperty(navigator,'locks',{value:undefined,configurable:true});window.Notification=class{static permission='denied';};});
await context.route('**/js/config.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace(/dataMode:\s*['"]http['"]/,"dataMode: 'mock'"),contentType:'application/javascript'});});
const page=await context.newPage(),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
const service=(method,...args)=>page.evaluate(async({method,args})=>{const {posts}=await import('/js/services/index.js');const p=method.split('.');return p.length===1?posts[method](...args):posts[p[0]][p[1]](...args);},{method,args});
async function ready(){await page.waitForFunction(()=>document.querySelector('main')&&!document.querySelector('body > [inert]'));}
async function count(selector,n){await page.waitForFunction(({selector,n})=>document.querySelectorAll(selector).length===n,{selector,n});}
try{
 await page.goto(origin+'/events.html');await ready();await count('.post-card',3);assert(await page.locator('.post-more').isHidden(),'No extra pagination space at the end of the feed');
 assert.equal(await page.locator('.filters label').count(),0);
 assert.equal(await page.locator('.container').evaluate(el=>Math.round(el.getBoundingClientRect().width)),1128);
 assert(await page.evaluate(()=>document.querySelector('.upper-container').getBoundingClientRect().top-document.querySelector('.header').getBoundingClientRect().bottom<=24));
 assert.equal(await page.locator('.post-permalink,.post-meta').count(),0);
 assert(await page.locator('.user-name a').evaluateAll(links=>links.every(link=>getComputedStyle(link).color==='rgb(23, 23, 23)')));
 assert(await page.locator('.post-card').evaluateAll(cards=>cards.every(card=>card.querySelectorAll('[data-post-edit],[data-post-delete]').length===(card.record.canEdit?2:0))));

 await page.evaluate(async()=>{const {postPlainText,validatePostInput}=await import('/js/posts/content.js');if(postPlainText('<p>A   B</p><p>C<br>D</p>')!=='A   B\nC\nD')throw new Error('Visible-text parity');validatePostInput({title:'x'.repeat(255),content:'<p>'+'a'.repeat(19998)+'</p><p>B</p>',category:'job',sphereCode:'other'});let failed=false;try{validatePostInput({title:'x',content:'<p>'+'a'.repeat(19999)+'</p><p>B</p>',category:'job',sphereCode:'other'});}catch{failed=true;}if(!failed)throw new Error('Visible-text limit not enforced');});
 await page.evaluate(async()=>{const {transaction}=await import('/js/data/mock/store.js');const {posts}=await import('/js/services/index.js');await transaction(state=>{for(const [id,createdAt] of [['999999','2030-01-01T00:00:00Z'],['999998','2030-01-01T00:00:00.100Z']])state.posts.push({...state.posts[0],id,createdAt,category:'training',sphereCode:'other'});},{write:true});try{const result=await posts.list({category:'training',sphereCode:'other'});if(result.items[0].id!=='999998')throw new Error('Mixed timestamp precision reordered mock feed');}finally{await transaction(state=>{state.posts=state.posts.filter(p=>!['999999','999998'].includes(p.id));},{write:true});}});
 await page.evaluate(async()=>{const {transaction}=await import('/js/data/mock/store.js');const {upgradePostsState}=await import('/js/data/mock/posts-state.js');await transaction(state=>{const original=structuredClone(state.posts[0]);state.posts.push({...original,id:'999997',sphere:'marketing',sphereCode:null,sphereId:null});state.postsDataVersion=0;upgradePostsState(state);if(state.posts.find(p=>p.id==='999997').sphereCode!=='marketing')throw new Error('Saved legacy marketing direction was lost');state.posts=state.posts.filter(p=>p.id!=='999997');},{write:true});});
 await page.evaluate(async()=>{const {upgradePostsState}=await import('/js/data/mock/posts-state.js');const state={posts:[{sphereId:'2'}],comments:[],settings:{},postsDataVersion:1,postCursors:{old:{}}};upgradePostsState(state);if(state.posts[0].sphereCode!=='engineering'||'sphereId'in state.posts[0]||Object.keys(state.postCursors).length)throw new Error('Saved numeric direction upgrade failed');});
 await page.locator('.category-selector').selectOption('training');await page.locator('.filters .tag-selector:not(.category-selector)').selectOption('data-science');await count('.post-card',1);
 await page.locator('.create-post-btn').click();const form=page.locator('.posts-modal');await form.locator('select[name=sphereCode] option[value="other"]').waitFor({state:'attached'});
 await form.locator('[data-author-name]:not([aria-busy])').waitFor();
 assert((await form.locator('[data-author-name]').textContent()).trim());
 assert.equal(await form.locator('h2,.forum-editor-hint,[data-title-count],[data-body-count]').count(),0);
 const composerBounds=()=>form.evaluate(dialog=>{
   const bounds=selector=>{const r=dialog.querySelector(selector).getBoundingClientRect();return [r.x,r.y,r.width,r.height];};
   return {dialog:[dialog.getBoundingClientRect().width,dialog.getBoundingClientRect().height],writing:bounds('.posts-composer-writing'),footer:bounds('footer')};
 });
 const beforePopover=await composerBounds();
 assert(await form.evaluate(dialog=>{const writing=dialog.querySelector('.posts-composer-writing').getBoundingClientRect(),footer=dialog.querySelector('footer').getBoundingClientRect();return footer.top-writing.bottom<=20&&dialog.getBoundingClientRect().height<600;}),'Modal fits its content without a footer gap');

 await form.locator('[contenteditable]').fill('Selected link');await form.locator('[contenteditable]').press('ControlOrMeta+A');
 await form.locator('[data-link]').click();
 assert.deepEqual(await composerBounds(),beforePopover,'Link popover preserves the composer geometry');
 await form.locator('.forum-link input').fill('https://example.org/article');await form.locator('.forum-link input').press('Enter');
 assert.equal(await form.locator('[contenteditable] a').textContent(),'Selected link');
 assert.equal(await form.locator('[contenteditable] a').getAttribute('href'),'https://example.org/article');
 assert(await form.isVisible(),'Enter applies the link without saving');
 await form.locator('[data-link]').click();await form.locator('.forum-link input').fill('javascript:alert(1)');await form.locator('[data-apply-link]').click();
 assert.equal(await form.locator('.forum-link input').evaluate(input=>input.validity.customError),true);
 await form.locator('.forum-link input').press('Escape');assert(await form.isVisible());assert(await form.locator('.forum-link').isHidden());
 await form.locator('[data-link]').click();await form.locator('[data-dismiss-link]').click();assert(await form.locator('.forum-link').isHidden());
 await form.locator('[data-link]').click();await form.locator('[name=title]').click();assert(await form.locator('.forum-link').isHidden());
 assert.deepEqual(await form.locator('.posts-composer-selectors select,footer button').evaluateAll(elements=>elements.map(el=>getComputedStyle(el).borderRadius)),['20px','20px','20px','20px']);
 await page.screenshot({path:(process.env.M1_ARTIFACT_DIR||'/tmp')+'/posts-form-desktop.png'});
 assert.equal(await form.locator('[name=sphereCode]').inputValue(),'','Direction never comes from feed filter');assert.equal(await form.locator('[name=category]').inputValue(),'');
 await form.locator('[name=title]').fill('Հայտարարության ստուգում');await form.locator('[name=category]').selectOption('job');await form.locator('[name=sphereCode]').selectOption('other');await form.locator('[contenteditable]').fill('Առաջին պարբերություն');await form.locator('[contenteditable]').press('ControlOrMeta+A');await form.locator('[data-command=bold]').click();assert.equal(await form.locator('[data-command=bold]').getAttribute('aria-pressed'),'true');
 page.once('dialog',d=>d.dismiss());await page.keyboard.press('Escape');assert(await form.isVisible());
 await page.evaluate(async()=>{const {mockControls}=await import('/js/data/client.js');await(await mockControls()).failNext('posts.create','NETWORK','Ցանցի սխալ');});
 await form.locator('[type=submit]').click();await form.locator('[role=alert]').last().waitFor();assert.equal(await form.locator('[name=title]').inputValue(),'Հայտարարության ստուգում');assert.equal(await form.locator('[name=sphereCode]').inputValue(),'other');assert.match(await form.locator('[contenteditable]').innerHTML(),/<(b|strong)>/);
 await form.locator('[type=submit]').click();await form.waitFor({state:'detached'});assert.equal(await page.locator('.post-card').count(),1,'Nonmatching create does not enter filtered feed');
 await page.locator('.category-selector').selectOption('');await page.locator('.filters .tag-selector:not(.category-selector)').selectOption('');await count('.post-card',4);
 const created=(await service('list',{category:'job',sphereCode:'other'})).items[0],id=created.id,card=page.locator(`[data-post-id="${id}"]`);
 assert.equal(await card.locator('.post-permalink,.post-meta').count(),0);assert.equal(await card.locator('.post-type-badge').textContent(),created.categoryName);await page.goto(origin+'/post.html?id='+id);await ready();assert.equal(await page.locator('.comment').count(),0);await page.locator('.comments-toggle').click();await page.locator('.comment-input').fill('Մեկնաբանություն <b>բառացի</b>');await page.locator('.comment-btn').click();await page.locator('.comment-text').getByText('Մեկնաբանություն <b>բառացի</b>',{exact:true}).waitFor();assert.equal(await page.locator('.comment-text b').count(),0);assert(await page.locator('.comments-more').isHidden(),'No load-more control when there is no next page');
 await page.locator('.comment-input').fill('AB');await page.locator('.comment-input').evaluate(el=>{el.focus();el.setSelectionRange(1,1);});
 await page.locator('.emoji-toggle').hover();assert(await page.locator('.emoji-popover').isHidden(),'Hover alone does not open the picker');
 await page.locator('.emoji-toggle').click();await page.locator('[data-emoji="😀"]').click();assert.equal(await page.locator('.comment-input').inputValue(),'A😀B');
 await page.locator('.emoji-toggle').click();
 const emoji=page.locator('[data-emoji="🎉"]');await emoji.hover();await page.mouse.down();
 assert(await page.locator('.emoji-popover').isVisible(),'Pressing a different emoji does not dismiss the picker before click');
 await page.mouse.up();assert.equal(await page.locator('.comment-input').inputValue(),'A😀🎉B');
 assert(await page.locator('.comment-input').evaluate(input=>document.activeElement===input),'Emoji selection returns focus to the comment');
 await page.locator('.emoji-toggle').focus();await page.keyboard.press('Enter');await page.keyboard.press('Tab');await page.keyboard.press('Enter');
 assert.equal(await page.locator('.comment-input').inputValue(),'A😀🎉😊B','Keyboard selection inserts a different emoji');
 await page.locator('.emoji-toggle').tap();await page.locator('[data-emoji="👍"]').tap();assert.equal(await page.locator('.comment-input').inputValue(),'A😀🎉😊👍B','Touch selection inserts the chosen emoji');
 await page.locator('.emoji-toggle').click();await page.keyboard.press('Escape');assert(await page.locator('.emoji-popover').isHidden());
 await page.locator('.emoji-toggle').click();await page.locator('.announcement-content').click();assert(await page.locator('.emoji-popover').isHidden());
 await page.locator('.comment-input').fill('');
 await page.screenshot({path:(process.env.M1_ARTIFACT_DIR||'/tmp')+'/posts-comments-desktop.png'});
 await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>document.documentElement.classList.add('theme-dark'));
 await page.screenshot({path:(process.env.M1_ARTIFACT_DIR||'/tmp')+'/posts-comments-dark.png'});await page.evaluate(()=>document.documentElement.classList.remove('theme-dark'));
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:(process.env.M1_ARTIFACT_DIR||'/tmp')+'/posts-comments-mobile-single.png',fullPage:true});await page.setViewportSize({width:1280,height:900});

 await page.locator('[data-post-edit]').click();await form.locator('[name=title]').fill('Նոր վերնագիր');await form.locator('[name=category]').selectOption('training');await form.locator('[name=sphereCode]').selectOption('programming');await form.locator('[type=submit]').click();await form.waitFor({state:'detached'});await page.locator('.announcement-content h2').getByText('Նոր վերնագիր',{exact:true}).waitFor();assert.equal((await service('get',id)).createdAt,created.createdAt);
 await page.evaluate(async id=>{const {transaction}=await import('/js/data/mock/store.js');await transaction(state=>{const p=state.posts.find(p=>p.id===id);p.title=null;p.category=null;p.sphereCode=null;p.content='<script>window.__unsafe=true</script><p>Legacy</p>';for(let i=0;i<44;i++)state.comments.push({id:`comment-${++state.sequence}`,postId:id,userId:'2',text:`Legacy ${i}`,createdAt:'2026-01-01T00:00:00Z',updatedAt:null});},{write:true});},id);
 await page.reload();await ready();assert.equal(await page.locator('.announcement-content h2').count(),0);assert.equal(await page.evaluate(()=>window.__unsafe),undefined);await page.locator('.comment-sort').selectOption('oldest');await page.locator('.comments-toggle').click();await count('.comment',20);await page.locator('.comments-more').click();await count('.comment',40);await page.locator('.comment-input').fill('Նորագույն');await page.locator('.comment-btn').click();await page.locator('[data-comment-status]').getByText('Նոր մեկնաբանությունն ավելացվել է։ Շարունակեք բեռնել՝ այն տեսնելու համար։').waitFor();assert.equal(await page.locator('.comment').count(),40);await page.locator('.comments-more').click();await count('.comment',46);
 const orders=await page.evaluate(async id=>{
   const {posts}=await import('/js/services/index.js');
   async function all(sort){let cursor='',ids=[];do{const page=await posts.comments.list(id,{sort,cursor});ids.push(...page.items.map(c=>c.id));cursor=page.nextCursor;}while(cursor);return ids;}
   const first=await posts.comments.list(id,{sort:'newest'});let rejected=false;try{await posts.comments.list(id,{sort:'oldest',cursor:first.nextCursor});}catch(error){rejected=error.code==='VALIDATION';}
   return {oldest:await all('oldest'),newest:await all('newest'),rejected};
 },id);
 assert.deepEqual(orders.newest,orders.oldest.toReversed());assert(orders.rejected,'Sort changes reject a cursor from the other order');
 await page.locator('.comment-sort').selectOption('newest');await count('.comment',20);assert.equal(await page.locator('.comment-text').first().textContent(),'Նորագույն');
 await page.locator('.comments-more').click();await count('.comment',40);
 await page.locator('.comment-sort').selectOption('oldest');await count('.comment',20);assert.equal(await page.locator('.comment-text').first().textContent(),'Legacy 0');
 for(const width of [600,430,390,320]){
   await page.setViewportSize({width,height:844});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Post page has no horizontal overflow');
   assert(await page.locator('.post-actions').evaluate(row=>{const r=row.getBoundingClientRect();return [...row.querySelectorAll('button,select')].every(el=>{const b=el.getBoundingClientRect();return b.left>=r.left&&b.right<=r.right&&Math.abs((b.top+b.height/2)-(r.top+r.height/2+6))<=8;});}),'All post actions stay on one horizontal row');
   await page.locator('.emoji-toggle').click();assert(await page.locator('.emoji-popover').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;}));await page.keyboard.press('Escape');
   assert(await page.locator('.comment').first().evaluate(row=>{const r=row.getBoundingClientRect(),avatar=row.querySelector('img').getBoundingClientRect();return avatar.left-r.left>=13&&avatar.top-r.top>=13;}));
 }
 await page.screenshot({path:(process.env.M1_ARTIFACT_DIR||'/tmp')+'/posts-comments-mobile.png'});
 await page.setViewportSize({width:1280,height:900});

 await page.locator('[data-post-edit]').click();assert.equal(await form.locator('[name=category]').inputValue(),'');assert.equal(await form.locator('[name=sphereCode]').inputValue(),'');await form.locator('[type=submit]').click();await form.locator('[aria-invalid]').first().waitFor();await form.locator('[data-cancel]').click();
 await page.goto(origin+'/events.html');await ready();await page.evaluate(async()=>{const {posts}=await import('/js/services/index.js');for(let i=0;i<45;i++)await posts.create({title:`Batch ${i}`,content:'<p>Բովանդակություն</p>',category:'job',sphereCode:'engineering'});});await page.reload();await ready();await count('.post-card',20);await page.locator('.post-more').click();await count('.post-card',40);await page.locator('.post-more').click();await count('.post-card',49);
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow');await page.locator('.create-post-btn').click();await form.locator('[name=sphereCode] option[value="other"]').waitFor({state:'attached'});await form.locator('[data-author-name]:not([aria-busy])').waitFor();
 for(const width of [390,320]){
   await page.setViewportSize({width,height:844});
   assert(await form.evaluate(dialog=>dialog.scrollWidth<=dialog.clientWidth),'Composer has no horizontal overflow');
   const selectors=await form.locator('select').evaluateAll(elements=>elements.map(el=>el.getBoundingClientRect().top));assert.equal(selectors[0],selectors[1]);
   await form.locator('[data-link]').click();assert(await form.locator('.forum-link').evaluate(panel=>{const p=panel.getBoundingClientRect(),d=panel.closest('dialog').getBoundingClientRect();return p.left>=d.left&&p.right<=d.right;}));await form.locator('.forum-link input').press('Escape');
 }
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:(process.env.M1_ARTIFACT_DIR||'/tmp')+'/posts-form-mobile.png'});await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>document.documentElement.classList.add('theme-dark'));await page.screenshot({path:(process.env.M1_ARTIFACT_DIR||'/tmp')+'/posts-form-dark.png'});await page.evaluate(()=>document.documentElement.classList.remove('theme-dark'));page.once('dialog',d=>d.accept());await form.locator('[name=title]').fill('Dirty');await form.locator('[data-close]').click();await form.waitFor({state:'detached'});
 // Offline events are retained without browser permission or Web Locks, scoped to the author.
 await page.evaluate(async id=>{const {transaction}=await import('/js/data/mock/store.js');const {posts}=await import('/js/services/index.js');await transaction(state=>{state.sessionUserId='2';},{write:true});await posts.comments.create(id,{text:'Offline other comment'});await transaction(state=>{state.sessionUserId='1';},{write:true});await posts.comments.create(id,{text:'Self is suppressed'});},id);
 await page.reload();await ready();await page.locator('[data-activity-toggle]').click();await page.locator(`[data-activity-items] a[href="post.html?id=${id}"]`).waitFor();assert.equal(await page.locator('[data-activity-items] a').count(),1);
 await page.locator('[data-activity-refresh]').click();await page.waitForTimeout(100);assert.equal(await page.locator('[data-activity-items] a').count(),1,'History reload deduplicates events');
 await page.evaluate(async()=>{const {transaction}=await import('/js/data/mock/store.js');await transaction(state=>{state.sessionUserId='2';},{write:true});});await page.reload();await ready();await page.locator('[data-activity-toggle]').click();await page.locator('[data-activity-items]').getByText('Ծանուցումներ չկան',{exact:true}).waitFor();assert.equal(await page.locator('[data-activity-items] a').count(),0);
 await page.evaluate(async()=>{const {transaction}=await import('/js/data/mock/store.js');await transaction(state=>{state.sessionUserId='1';},{write:true});});await page.reload();await ready();
 await page.goto(origin+'/profile.html');await ready();await page.locator('.announcements-section .post-card').first().waitFor();
 await page.goto(origin+'/post.html?id='+id);await ready();await page.locator('[data-post-delete]').click();await page.locator('[data-common-confirm]').getByRole('button',{name:'Այո',exact:true}).click();await page.getByText('Հայտարարությունը հասանելի չէ։',{exact:true}).waitFor();await page.reload();await ready();await page.getByText('Հայտարարությունը հասանելի չէ։',{exact:true}).waitFor();
 assert.deepEqual(errors,[]);console.log('Posts mock provider, feed, forms, comments, profiles, deep links and mobile acceptance passed.');
}catch(error){console.error(error);throw error;}finally{await context.unrouteAll({behavior:'ignoreErrors'});await browser.close();}
