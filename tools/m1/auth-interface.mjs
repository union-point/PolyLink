// Static-server UI acceptance with the real mock provider, isolated browser storage and no live accounts.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const origin = process.env.M1_FRONTEND || 'http://127.0.0.1:8017';
const browser = await chromium.launch({ headless: true, executablePath: process.env.M1_CHROMIUM || undefined });
const errors = [];
async function ready(page) {
  await page.waitForFunction(() => !document.querySelector('.container').inert);
}
async function fits(page) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow');
}
try {
  for (const role of ['graduate', 'lecturer']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const database = `auth-ui-${role}-${Date.now()}`;
    await context.route('**/js/config.js', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: (await response.text()).replace("dataMode: 'http'", "dataMode: 'mock'").replace('polylink-demo-v1', database) });
    });
    const page = await context.newPage(); page.setDefaultNavigationTimeout(20000); page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/register.html'); await ready(page);
    assert.equal(await page.locator('[name=role]').count(), 0);
    await page.locator('[type=submit]').click();
    assert.match(await page.locator('[data-status]').innerText(), /[Ա-ֆ]/u);
    for (const [id, value] of Object.entries({ firstname: 'Demo', lastname: role === 'graduate' ? 'Graduate' : 'Lecturer', email: `new.${role}@polytechnic.am`, password: 'Demo enrollment!4', confirm: 'Demo enrollment!4' })) await page.locator('#' + id).fill(value);
    await page.locator('[type=submit]').click(); await page.waitForURL('**/profile_info.html'); await ready(page);
    assert.equal(await page.locator('#firstName,#lastName').count(),0);
    await page.locator(`[name=role][value=${role}]`).check();
    assert.equal(await page.locator('[data-lecturer]').isVisible(), role === 'lecturer');
    const picture = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 64; c.getContext('2d').fillRect(0, 0, 64, 64); return c.toDataURL('image/png').split(',')[1]; });
    await page.locator('#avatar-file').setInputFiles({ name: 'portrait.png', mimeType: 'image/png', buffer: Buffer.from(picture, 'base64') });
    await page.getByText('Լուսանկարը պահպանված է։', { exact: true }).waitFor({timeout:10000}).catch(async error => { console.log(await page.locator('main').innerText()); console.log(errors); throw error; });
    assert((await page.locator('#avatar-preview').getAttribute('src')).startsWith('blob:'));
    if (role === 'graduate') {
      await page.locator('#diplomaNumber').fill('DEMO-2025'); await page.locator('#specializationId').selectOption('1');
      await page.locator('#startYear').fill('2021'); await page.locator('#endYear').fill('2020');
      await page.locator('#submit-profile').click(); await page.getByText('Ուսման ավարտը չի կարող լինել սկզբից առաջ։', { exact: true }).waitFor();
      await page.locator('#endYear').fill('2025');
    } else { await page.locator('#departmentId').selectOption('1'); await page.locator('#professionId').selectOption('1'); }
    await fits(page);
    await page.locator('#save-profile').click(); await page.getByText('Տվյալները պահպանված են։', { exact: true }).waitFor();
    assert((await page.locator('#avatar-preview').getAttribute('src')).startsWith('blob:'));
    assert.equal(await page.locator('#diplomaNumber').getAttribute('placeholder'), 'օրինակ՝ AB123456');
    for (const [width,height] of [[1366,768],[1280,720],[1024,600],[390,844],[375,667],[320,700],[360,640]]) {
      await page.setViewportSize({width,height});
      const layout = await page.evaluate(() => ({width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,viewport:innerHeight}));
      assert(layout.width<=width, 'No horizontal overflow');
      assert(layout.height<=height, `Onboarding fits ${width}×${height}: ${JSON.stringify(layout)}`);
    }
    await page.setViewportSize({width:390,height:844});
    assert.match(await page.evaluate(()=>getComputedStyle(document.body).backgroundImage), /background\.jpg/);
    const savedProfile = await page.evaluate(async()=>{const {auth}=await import('/js/services/index.js');return (await auth.enrollment()).profile;});
    assert.equal(savedProfile.firstName,'Demo'); assert.equal(savedProfile.lastName,role==='graduate'?'Graduate':'Lecturer');
    if (process.env.M1_AUTH_SCREENSHOTS) {
      await page.screenshot({ path: `${process.env.M1_AUTH_SCREENSHOTS}-${role}-mobile.png`, fullPage: true });
      await page.setViewportSize({ width: 1280, height: 1000 }); await page.screenshot({ path: `${process.env.M1_AUTH_SCREENSHOTS}-${role}-desktop.png`, fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
    }
    await page.locator('#submit-profile').click(); await page.locator('#enrollment-code:not([hidden])').waitFor();
    assert(await page.locator('#profile-info-form').isHidden()); await fits(page);
    await page.setViewportSize({width:360,height:640});
    if(process.env.M1_AUTH_SCREENSHOTS) await page.screenshot({path:`${process.env.M1_AUTH_SCREENSHOTS}-code-small.png`,fullPage:true});
    assert(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight),'Verification fits 360×640');
    await page.setViewportSize({width:390,height:844});
    assert(await page.locator('#resend-code').isDisabled());
    await page.evaluate(() => { const now = Date.now; Date.now = () => now() + 61000; });
    await page.waitForFunction(() => !document.getElementById('resend-code').disabled);
    await page.locator('#resend-code').click();
    await page.getByText('Նոր կոդն ուղարկված է Ձեր էլ․ փոստին։', {exact:true}).waitFor();
    if (process.env.M1_AUTH_SCREENSHOTS) await page.screenshot({path:`${process.env.M1_AUTH_SCREENSHOTS}-verification.png`,fullPage:true});
    await page.locator('#edit-profile').click(); assert(await page.locator('#profile-info-form').isVisible());
    await page.locator('#submit-profile').click(); await page.locator('#enrollment-code:not([hidden])').waitFor();
    await page.locator('#verification-code').fill('000000'); await page.locator('#enrollment-code [type=submit]').click();
    await page.locator('#enrollment-code [role=alert]').waitFor();
    await page.locator('#verification-code').fill('123456'); await page.locator('#enrollment-code [type=submit]').click();
    await page.locator('#enrollment-login:not([hidden])').waitFor(); await fits(page);
    await page.goto(origin + '/forgot.html'); await ready(page);
    await page.locator('#email').fill(`new.${role}@polytechnic.am`); await page.locator('[type=submit]').click();
    await page.waitForURL('**/verify-code.html'); await ready(page);
    for(let i=0;i<6;i++) await page.locator('.code-input').nth(i).fill('123456'[i]);
    await page.locator('[type=submit]').click(); await page.waitForURL('**/reset-password.html'); await ready(page);
    await page.locator('#new-password').fill('Updated password!5'); await page.locator('#confirm-password').fill('mismatch');
    await page.locator('[type=submit]').click(); await page.getByText('Գաղտնաբառերը չեն համընկնում։',{exact:true}).waitFor();
    await page.locator('#confirm-password').fill('Updated password!5'); await page.locator('[type=submit]').click(); await page.waitForURL('**/login.html'); await ready(page);
    assert.equal(await page.evaluate(async email => { const {auth}=await import('/js/services/index.js'); return Boolean((await auth.login({email,password:'Updated password!5'})).user); }, `new.${role}@polytechnic.am`),true);
    await context.close();
  }
  const context = await browser.newContext({ viewport: { width: 320, height: 700 } });
  const page = await context.newPage();
  await context.route('**/js/config.js', async route => { const response = await route.fetch(); await route.fulfill({ response, body: (await response.text()).replace("dataMode: 'http'", "dataMode: 'mock'") }); });
  for (const file of ['login', 'register', 'forgot', 'reset-password', 'verify-code', '2fa-verify']) {
    await page.goto(`${origin}/${file}.html`); await ready(page); await fits(page);
    assert.equal(await page.locator('html').getAttribute('lang'), 'hy');
    if (file === 'login') {
      await page.locator('#email').fill('invalid'); await page.locator('#password').fill('password'); await page.locator('[type=submit]').click();
      assert.match(await page.locator('[role=alert]').innerText(), /[Ա-ֆ]/u);
    }
  }
  const localized = await page.evaluate(async () => {
    const { showError } = await import('/js/shared/ui.js');
    const form = document.querySelector('form');
    showError(form, { code: 'NETWORK', message: 'The request could not be completed.', fieldErrors: {} });
    return form.querySelector('[role=alert]').textContent;
  });
  assert(!localized.includes('request')); assert.match(localized, /[Ա-ֆ]/u);
  assert.deepEqual(errors, []); await context.close();
  console.log('Auth UI passed: both onboarding roles, preserved registration names, seven single-viewport layouts, avatar persistence, Armenian validation, code retry, resend cooldown, return to editing, full password recovery and six auth pages at 320px.');
} finally { await browser.close(); }
