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
 await input.click();await panel.getByRole('button', { name: 'Մաքրել', exact: true }).click();
 assert.equal(await page.evaluate(() => picker.get()), null);assert.equal(await input.inputValue(), '');
 await input.click();await page.locator('#outside').click();assert(await panel.isHidden());
 for (const value of ['2020', '2020-09-23', '1899-02-28']) {
  await mount(value);assert.equal(await page.evaluate(() => picker.get()), value, 'Keep unchanged legacy precision');
  await input.click();await page.keyboard.press('Escape');assert.equal(await page.evaluate(() => picker.get()), value);
 }
 await mount('2020-09-23', false);assert.equal(await input.inputValue(), 'սեպտեմբեր 2020');assert.equal(await page.evaluate(() => picker.get()), '2020-09');
 for(const year of ['1900', '2200']) {
  await mount(`${year}-01`);await input.click();
  assert(await panel.getByRole('button', { name: year === '1900' ? 'Նախորդ տարի' : 'Հաջորդ տարի', exact: true }).isDisabled());
 }
 await mount('2024-06');await page.setViewportSize({ width: 390, height: 844 });await input.click();
 assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
 await page.screenshot({ path: '/tmp/polylink-month-year-mobile.png', fullPage: true });
 await page.evaluate(() => document.body.classList.add('theme-dark'));
 await page.screenshot({ path: '/tmp/polylink-month-year-dark.png', fullPage: true });
 await page.evaluate(() => picker.setDisabled(true));assert(await input.isDisabled());assert(await panel.isHidden());
 assert.deepEqual(errors, []);console.log('Month-year picker browser checks passed');
} finally { await browser.close(); }
