// Run against the repository's static server: node tools/m1/search-browser.mjs [base URL].
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => { errors.push(error.message); console.error('Page error:', error.message); });
  await page.route('**/js/config.js', route => route.fulfill({ contentType: 'text/javascript', body: `export const config={dataMode:'mock'};` }));
  await page.route('**/js/services/index.js', route => route.fulfill({ contentType: 'text/javascript', body: `
    const user={id:'1',onboardingComplete:true};
    export const auth={me:async()=>user,subscribeSession:async()=>()=>{}};
    export const chat={openDirect:async()=>{throw new Error('chat test failure');}};
    window.searchTest={calls:[],failFilters:true,failMore:false,delay:0};
    const person=id=>({id:String(id),name:'Name '+id,firstName:'Name',lastName:String(id),jobTitle:'Position',canOpenProfile:id!==2,matchedEducation:[{id:'1',institution:'University',degree:'Degree',specialization:'<img src=x onerror=alert(1)>',institute:'Institute',endDate:'2024-06-01'},{id:'2',institution:'Other',specialization:'Second',endDate:'2020-06-01'}]});
    export const search={filters:async()=>{if(window.searchTest.failFilters){window.searchTest.failFilters=false;throw new Error('filter failure');}return {specializations:[{id:1,label:'Dynamic X'}],institutes:[{id:1,label:'Dynamic I'}],years:[2026]};},page:async f=>{
      window.searchTest.calls.push({...f});
      const delay=window.searchTest.delay; await new Promise(resolve=>setTimeout(resolve,delay));
      if(f.cursor&&window.searchTest.failMore){window.searchTest.failMore=false;throw new Error('page failure');}
      if(f.q==='empty')return {items:[],hasMore:false,nextCursor:null};
      if(f.q)return {items:[{...person(90),name:f.q}],hasMore:false,nextCursor:null};
      return f.cursor?{items:[person(3)],hasMore:false,nextCursor:null}:{items:[person(1),person(2)],hasMore:true,nextCursor:'next'};
    }};
  ` }));
  await page.goto((process.argv[2] || 'http://127.0.0.1:8012') + '/search.html');
  await page.waitForSelector('.card[data-user-id="2"]');
  assert.equal(await page.locator('.card').count(),2);
  assert(await page.locator('[data-user-id="2"] .btn-view').isDisabled());
  assert(await page.locator('[data-user-id="1"] .btn-connect').isDisabled());
  await page.locator('[data-user-id="2"] .btn-view').dispatchEvent('click');
  assert(page.url().endsWith('/search.html'));
  assert.equal(await page.locator('.search-education img').count(),0);
  await page.locator('[data-user-id="2"] summary').click();
  assert(await page.locator('[data-user-id="2"] details').evaluate(element=>element.open));
  await page.locator('#filter-status button').click();
  await page.waitForFunction(()=>document.querySelector('#faculty option[value="1"]'));
  assert.equal(await page.locator('#year option').last().textContent(),'2026');
  await page.evaluate(()=>{window.searchTest.failMore=true;window.searchTest.delay=50;});
  await page.locator('#search-more').dblclick({force:true});
  await page.waitForSelector('#search-status button');
  assert.equal(await page.locator('.card').count(),2);
  assert.equal(await page.evaluate(()=>window.searchTest.calls.filter(f=>f.cursor).length),1);
  await page.locator('#search-status button').click();
  await page.waitForSelector('[data-user-id="3"]');
  assert.equal(await page.locator('.card').count(),3);
  assert(await page.locator('#search-more').isHidden());
  // A response for an old query must never replace the newer result.
  await page.evaluate(()=>{window.searchTest.delay=500;});
  await page.locator('.search-bar input').fill('old');
  await page.waitForFunction(()=>window.searchTest.calls.some(f=>f.q==='old'));
  await page.evaluate(()=>{window.searchTest.delay=0;});
  await page.locator('.search-bar input').fill('new');
  await page.waitForFunction(()=>document.querySelector('.card h3')?.textContent==='new');
  await page.waitForTimeout(550);
  assert.equal(await page.locator('.card h3').textContent(),'new');
  await page.locator('.search-bar input').fill('empty');
  await page.locator('.search-bar input').press('Enter');
  await page.waitForFunction(()=>document.querySelector('.graduates')?.textContent.includes('չեն գտնվել'));
  await page.locator('.search-bar input').fill(''); await page.locator('#faculty').selectOption('1');
  await page.waitForFunction(()=>window.searchTest.calls.at(-1).specializationId==='1');
  assert.equal((await page.evaluate(()=>window.searchTest.calls.at(-1))).cursor,undefined);
  await page.waitForSelector('[data-user-id="2"]');
  await page.screenshot({path:'/tmp/polylink-search-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'/tmp/polylink-search-mobile.png',fullPage:true});
  assert(await page.locator('.search-bar input').evaluate(element => element.getBoundingClientRect().top >= document.querySelector('.header').getBoundingClientRect().bottom));
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors,[]);
  console.log('Search browser acceptance passed: privacy, escaping, education disclosure, filter retry, pagination retry/double clicks, stale queries, empty results, filter reset.');
} finally { await browser.close(); }
