// Run with a static server: M1_FRONTEND=http://localhost:8138 node tools/m1/notifications-ui.mjs
import { chromium } from 'playwright';
import { isolateDecorativeAssets } from './browser-assets.mjs';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const origin = process.env.M1_FRONTEND || 'http://localhost:8138';
const browser = await chromium.launch({ headless: true, executablePath: process.env.M1_CHROMIUM || undefined });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await isolateDecorativeAssets(context);
await context.route('**/js/config.js', async route => {
  const response = await route.fetch();
  await route.fulfill({ response, body: (await response.text()).replace(/dataMode:\s*['"]http['"]/, "dataMode: 'mock'"), contentType: 'application/javascript' });
});
await context.addInitScript(() => {
  window.__notifications = [];
  window.Notification = class {
    static permission = 'granted';
    static async requestPermission() { return 'granted'; }
    constructor(title, options) { Object.assign(this, { title, ...options }); window.__notifications.push(this); }
    close() { this.closed = true; }
  };
});
const page = await context.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
const toggle = page.locator('[data-activity-toggle]'), panel = page.locator('.activity-panel');
async function ready() {
  await toggle.waitFor();
  await page.waitForFunction(() => !document.querySelector('body > [inert]') && document.querySelector('[data-account-id]'));
}
async function open() {
  await toggle.click();
  await panel.waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-activity-status][aria-busy]'));
  await page.evaluate(() => document.getAnimations().filter(animation => animation.effect?.target?.closest('.activity-inbox')).forEach(animation => animation.finish()));
}
async function geometry(label) {
  const bounds = await page.locator('.activity-inbox').evaluate(root => {
    const box = node => { const r = node.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    return { button: box(root.querySelector('[data-activity-toggle]')), panel: box(root.querySelector('.activity-panel')), width: innerWidth, height: innerHeight };
  });
  for (const [name, r] of Object.entries({ button: bounds.button, panel: bounds.panel })) {
    assert(r.left >= 0 && r.top >= 0 && r.right <= bounds.width + 1 && r.bottom <= bounds.height + 1, `${label}: ${name} stays in viewport: ${JSON.stringify(r)}`);
  }
  assert.equal(bounds.button.width, bounds.button.height, `${label}: circular button`);
  assert(bounds.panel.bottom < bounds.button.top, `${label}: panel clears button`);
  assert.equal(await page.locator('.header .activity-inbox').count(), 0, `${label}: outside navigation`);
  assert.equal(await toggle.count(), 1, `${label}: one shared button`);
}
async function screenshot(name) {
  if (!process.env.M1_ARTIFACT_DIR) return;
  await mkdir(process.env.M1_ARTIFACT_DIR, { recursive: true });
  await page.screenshot({ path: `${process.env.M1_ARTIFACT_DIR}/${name}.png` });
}
try {
  await page.goto(origin + '/events.html'); await ready();
  await open();
  await page.locator('[data-activity-items]').getByText('Ծանուցումներ չկան', { exact: true }).waitFor();
  assert(await page.locator('[data-activity-close]').evaluate(node => node === document.activeElement));
  await page.keyboard.press('Escape'); assert(await panel.isHidden());
  assert(await toggle.evaluate(node => node === document.activeElement));
  await open(); await page.locator('main').click({ position: { x: 5, y: 5 } }); assert(await panel.isHidden());
  await open(); await page.locator('[data-activity-refresh]').focus(); await page.keyboard.press('Tab'); assert(await panel.isHidden(), 'Tab out dismisses the nonmodal history');

  // Retained history paginates and deduplicates independently of browser permission.
  await page.evaluate(async () => {
    const { transaction } = await import('/js/data/mock/store.js');
    await transaction(state => {
      const post = state.posts.find(post => post.userId === '1');
      for (let i = 0; i < 45; i++) {
        const id = `comment-${++state.sequence}`, createdAt = new Date(Date.UTC(2026, 9, 29, 12, i)).toISOString();
        state.comments.push({ id, postId: post.id, userId: '2', text: `Notification ${i}`, createdAt, updatedAt: null });
        state.activity.push({ id: String(++state.activitySequence), kind: 'POST_COMMENT', userId: '1', actorId: '2', postId: post.id, commentId: id, createdAt });
      }
    }, { write: true });
    window.Notification.permission = 'denied';
  });
  await open(); assert.equal(await page.locator('[data-activity-items] a').count(), 20);
  await page.locator('[data-activity-more]').click(); await page.waitForFunction(() => document.querySelectorAll('[data-activity-items] a').length === 40, null, { timeout: 5000 });
  await page.locator('[data-activity-more]').click(); await page.waitForFunction(() => document.querySelectorAll('[data-activity-items] a').length === 45);
  assert(await page.locator('[data-activity-more]').isHidden());
  assert(await page.locator('.activity-scroll').evaluate(node => node.scrollHeight > node.clientHeight), 'Long history scrolls inside panel');
  await screenshot('notifications-desktop');
  await page.locator('[data-activity-refresh]').click(); await page.waitForFunction(() => document.querySelectorAll('[data-activity-items] a').length === 20);
  const target = await page.locator('[data-activity-items] a').first().getAttribute('href');
  await page.locator('[data-activity-items] a').first().click(); await page.waitForURL('**/' + target); await ready();
  await open(); assert.equal(await page.locator('[data-activity-items] a').count(), 20, 'History survives navigation');
  await page.locator('[data-activity-close]').click();
  await page.evaluate(async () => { const { mockControls } = await import('/js/data/client.js'); await (await mockControls()).failNext('notifications.history', 'NETWORK', 'History test error'); });
  await open(); await page.locator('[data-activity-status]').getByText('History test error', { exact: true }).waitFor();
  await page.locator('[data-activity-status] button').click(); await page.waitForFunction(() => !document.querySelector('[data-activity-status]').textContent);

  const pages = ['events.html', target, 'forum.html', 'topic.html?id=topic-1', 'new-topic.html', 'profile.html', 'user.html?id=2', 'search.html', 'settings.html', 'help.html', 'tutorials.html', 'privacy.html', 'terms.html', 'message.html?room=room-2'];
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    console.log(`Check notification layout at ${viewport.width}x${viewport.height}`);
    for (const path of pages) {
      await page.goto(origin + '/' + path, { waitUntil: 'domcontentloaded' }); await ready(); await open();
      await geometry(`${path} ${viewport.width}x${viewport.height}`);
      if (path.startsWith('message')) {
        await page.locator('[data-activity-close]').click();
        await page.locator('.send-icon').waitFor();
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        const button = await toggle.boundingBox(), send = await page.locator('.send-icon').boundingBox();
        assert(send.y + send.height <= button.y || send.x + send.width <= button.x, 'Floating button clears message send control');
        await open();
      }
      if (path === 'events.html' && viewport.width === 390) await screenshot('notifications-mobile');
      if (path.startsWith('message') && viewport.width === 1280) {
        await page.evaluate(async () => { const { setTheme } = await import('/js/shared/ui.js'); setTheme('dark'); });
        await screenshot('notifications-messenger-dark');
      }
    }
  }

  // Browser presentation still consumes the same live poller with the panel closed.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(origin + '/events.html'); await ready();
  await page.evaluate(async () => { const { enableBrowserNotifications } = await import('/js/shared/browser-notifications.js'); await enableBrowserNotifications('1', true); });
  await page.reload(); await ready();
  await page.waitForFunction(() => localStorage.getItem('polylink.notifications.1.cursor') !== null);
  await page.clock.install();
  await page.evaluate(async () => {
    const { transaction } = await import('/js/data/mock/store.js'); const { posts } = await import('/js/services/index.js');
    const postId = await transaction(state => { state.sessionUserId = '2'; return state.posts.find(post => post.userId === '1').id; }, { write: true });
    await posts.comments.create(postId, { text: 'Live browser notification' });
    await transaction(state => { state.sessionUserId = '1'; }, { write: true });
  });
  await page.clock.runFor(16000);
  await page.waitForFunction(() => window.__notifications.length === 1);
  assert(await panel.isHidden(), 'Browser delivery does not open panel');
  await page.clock.runFor(16000); assert.equal(await page.evaluate(() => window.__notifications.length), 1, 'Live stream does not duplicate browser delivery');
  await page.evaluate(() => { window.__notifications[0].onclick(); }); await page.waitForURL('**/post.html?id=*'); await ready();
  await page.clock.resume();

  // Repeated starts and page-cache restoration leave one widget and a live history.
  await page.evaluate(async () => {
    const { startActivityNotifications } = await import('/js/shared/activity-notifications.js'); startActivityNotifications('1'); startActivityNotifications('1');
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await ready(); assert.equal(await toggle.count(), 1); await open(); await geometry('page cache restore');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await panel.evaluate(node => getComputedStyle(node).animationName), 'none');
  assert.deepEqual(errors, []);
  console.log('Notification UI passed: 14 pages at four viewport sizes, history pagination/retry/deep links, focus/Escape/outside dismissal, messenger clearance, themes, browser delivery/deduplication and page-cache restoration.');
} catch (error) {
  console.error(await page.evaluate(() => ({ url: location.href, count: document.querySelectorAll('[data-activity-items] a').length, hidden: document.querySelector('.activity-panel')?.hidden, status: document.querySelector('[data-activity-status]')?.textContent, focused: document.activeElement?.tagName })));
  await screenshot('notifications-failure'); throw error;
} finally { await browser.close(); }
