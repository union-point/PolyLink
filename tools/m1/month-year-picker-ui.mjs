import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const origin = process.env.M1_FRONTEND;
const browser = await chromium.launch({ headless: true, executablePath: process.env.M1_CHROMIUM || undefined });
const errors = [];
try {
 const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
 page.on('pageerror', error => errors.push(error.message));
 await page.route(origin + '/picker-fixture', route => route.fulfill({ contentType: 'text/html', body: '<html lang="hy"><meta charset="utf-8"><link rel="stylesheet" href="/css/style.css"><link rel="stylesheet" href="/css/profile.css"><div class="profile-modal" style="margin:40px auto;padding:24px"><label for="fixture-input">Ժամանակահատված</label><div id="fixture"></div><button id="outside">Ավարտել</button></div></html>' }));
 await page.goto(origin + '/picker-fixture');
 const mount = async (value = '', preservePrecision = true) => page.evaluate(async ({ value, preservePrecision }) => {
  const { createMonthYearPicker } = await import('/js/profile/month-year-picker.js');
  window.picker = createMonthYearPicker({ name: 'period', label: 'Ժամանակահատված', value, preservePrecision });
  document.querySelector('label').htmlFor = picker.el.id;
  document.querySelector('#fixture').replaceChildren(picker.root);
  window.edits = 0; picker.root.addEventListener('change', () => window.edits++);
 }, { value, preservePrecision });
 const input = page.locator('[name=period]'), panel = page.locator('.profile-month-panel');
 await page.clock.setFixedTime(new Date('2026-11-06T12:00:00Z'));
 await mount('2020-09');
 assert.equal(await input.inputValue(), 'սեպտեմբեր 2020');
 assert.equal(await page.locator('input[type=date],input[type=month]').count(), 0);
 assert(await input.evaluate(el => el.readOnly));
 await input.press('Enter');assert(await panel.isVisible());
 assert.equal(await panel.locator('.profile-month-choice').count(), 12);
 assert.equal(await panel.locator('[aria-pressed=true]').textContent(), 'սեպտ.');
 await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
 assert.equal(await page.evaluate(() => picker.get()), '2020-10');assert(await panel.isHidden());
 assert(await input.evaluate(el => document.activeElement === el));
 await input.click();await page.keyboard.press('PageUp');assert(await panel.isVisible());
 assert.equal(await panel.locator('.profile-month-year').textContent(), '2019');
 await page.keyboard.press('Escape');assert(await panel.isHidden());
 assert.equal(await page.evaluate(() => window.edits), 1, 'Navigation does not change the saved date');
 await input.click();await panel.locator('.profile-month-year').click();
 await panel.getByRole('button', { name: '2024', exact: true }).click();
 await panel.getByRole('button', { name: 'հունիս 2024', exact: true }).click();
 assert.equal(await page.evaluate(() => picker.get()), '2024-06');
 await input.click();await panel.locator('.profile-month-year').click();
 await panel.getByRole('button', { name: 'Նախորդ տարիները', exact: true }).click();
 await panel.getByRole('button', { name: '2010', exact: true }).click();
 await panel.getByRole('button', { name: 'մարտ 2010', exact: true }).click();
 assert.equal(await page.evaluate(() => picker.get()), '2010-03');
 assert.equal(await panel.getByRole('button',{name:/Մաքրել|Այս ամիս/}).count(),0);
 await input.click();await page.mouse.click(10,10);assert(await panel.isHidden());
 for (const value of ['2020', '2020-09-23', '1899-02-28']) {
  await mount(value);assert.equal(await page.evaluate(() => picker.get()), value, 'Keep unchanged legacy precision');
  await input.click();await page.keyboard.press('Escape');assert.equal(await page.evaluate(() => picker.get()), value);
 }
 await mount('2020-09-23', false);assert.equal(await input.inputValue(), 'սեպտեմբեր 2020');assert.equal(await page.evaluate(() => picker.get()), '2020-09');
 for(const [date,year,month] of [['2031-01-15',2031,0],['2031-12-15',2031,11],['2032-01-01',2032,0]]) {
  await page.clock.setFixedTime(new Date(`${date}T12:00:00Z`));
  await mount(`${year}-01`);await input.click();
  assert.equal(await panel.locator('.profile-month-year').textContent(),String(year));
  assert(await panel.getByRole('button',{name:'Հաջորդ տարի',exact:true}).isDisabled());
  assert.deepEqual(await panel.locator('.profile-month-choice').evaluateAll(buttons=>buttons.map(button=>button.disabled)),Array.from({length:12},(_,index)=>index>month));
  await page.keyboard.press('PageDown');assert.equal(await panel.locator('.profile-month-year').textContent(),String(year));
  if(month<11){await panel.locator('.profile-month-choice').nth(11).dispatchEvent('click');assert.equal(await page.evaluate(()=>picker.get()),`${year}-01`);assert(await panel.isVisible());}
  await panel.getByRole('button',{name:'Նախորդ տարի',exact:true}).click();assert.equal(await panel.locator('.profile-month-choice:disabled').count(),0);
  await panel.getByRole('button',{name:'Հաջորդ տարի',exact:true}).click();
  await panel.locator('.profile-month-year').click();
  assert(await panel.locator('.profile-month-choice').evaluateAll(buttons=>buttons.every(button=>Number(button.textContent)<=new Date().getFullYear())));
  assert(await panel.getByRole('button',{name:'Հաջորդ տարիները',exact:true}).isDisabled());
  await panel.getByRole('button',{name:String(year),exact:true}).click();
  await page.keyboard.press('End');assert.equal(await page.evaluate(()=>Number(document.activeElement.dataset.index)),month);
  await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>picker.get()),`${year}-${String(month+1).padStart(2,'0')}`);assert(await panel.isHidden());
 }
 for(const year of ['1900', '2200']) {
  await mount(`${year}-01`);await input.click();
  assert(await panel.getByRole('button', { name: year === '1900' ? 'Նախորդ տարի' : 'Հաջորդ տարի', exact: true }).isDisabled());
 }
 await mount('2024-06');
 const dimensions=()=>page.locator('.profile-modal').evaluate(el=>({height:el.getBoundingClientRect().height,scroll:el.scrollHeight}));
 const before=await dimensions();await input.click();assert.deepEqual(await dimensions(),before);
 assert.equal(await panel.getAttribute('data-placement'),'below');
 await page.keyboard.press('Escape');
 await page.locator('.profile-modal').evaluate(el=>Object.assign(el.style,{position:'fixed',bottom:'8px',margin:'0',height:'180px',maxHeight:'none',overflow:'hidden',transform:'translateZ(0)'}));
 await input.click();assert.equal(await panel.getAttribute('data-placement'),'above');
 assert(await panel.evaluate(el=>{const bounds=el.getBoundingClientRect();return bounds.top<el.closest('.profile-modal').getBoundingClientRect().top&&el.contains(document.elementFromPoint(bounds.left+20,bounds.top+20));}),'Popover escapes the transformed overflow-hidden modal');
 await page.keyboard.press('Escape');
 await page.locator('.profile-modal').evaluate(el=>{el.style.cssText='margin:40px auto;padding:24px';});
 await mount('2024-06');await page.setViewportSize({ width: 390, height: 844 });await input.click();
 assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
 await page.screenshot({ path: '/tmp/polylink-month-year-mobile.png', fullPage: true });
 await page.evaluate(() => document.body.classList.add('theme-dark'));
 await page.screenshot({ path: '/tmp/polylink-month-year-dark.png', fullPage: true });
 await page.evaluate(() => picker.setDisabled(true));assert(await input.isDisabled());assert(await panel.isHidden());
 assert.deepEqual(errors, []);console.log('Month-year picker browser checks passed');
} finally { await browser.close(); }
