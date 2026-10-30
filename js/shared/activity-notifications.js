import { auth, notifications } from '../services/index.js';
import { createBrowserPresentation, notificationTarget } from './browser-notifications.js';
import { stateMessage, dateTime } from './ui.js';

let active;
export function startActivityNotifications(user) {
  if (active?.user === user) return active.stop;
  active?.stop();

  const root = document.createElement('aside');
  root.className = 'activity-inbox';
  root.setAttribute('aria-label', 'Ծանուցումներ');
  root.innerHTML = `<button class="activity-toggle" type="button" data-activity-toggle aria-expanded="false" aria-controls="activity-panel" aria-haspopup="dialog" aria-label="Ծանուցումներ" title="Ծանուցումներ">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>
  </button>
  <section id="activity-panel" class="activity-panel" role="dialog" aria-labelledby="activity-heading" hidden>
    <div class="activity-heading"><h2 id="activity-heading">Ծանուցումներ</h2><button type="button" data-activity-close aria-label="Փակել">×</button></div>
    <p class="activity-description">Ձեր հայտարարությունների մեկնաբանությունները</p>
    <div class="activity-scroll"><div data-activity-items></div><div data-activity-status aria-live="polite"></div></div>
    <div class="activity-actions"><button type="button" data-activity-refresh>Թարմացնել</button><button type="button" data-activity-more hidden>Ցուցադրել ավելին</button></div>
  </section>`;
  document.body.append(root);
  const toggle = root.querySelector('[data-activity-toggle]');
  const panel = root.querySelector('.activity-panel');
  const close = root.querySelector('[data-activity-close]');
  const list = root.querySelector('[data-activity-items]');
  const status = root.querySelector('[data-activity-status]');
  const more = root.querySelector('[data-activity-more]');
  const refresh = root.querySelector('[data-activity-refresh]');
  const items = new Map(), presenter = createBrowserPresentation(user);
  let stopped = false, timer, cursor = 'initial', historyCursor = null;
  let historyLoading = false, polling = false, delay = 15000, unsubscribe;

  function render() {
    // Keep keyboard focus on its link when a live event updates the list.
    const focusedId = list.contains(document.activeElement) ? document.activeElement.dataset.activityId : null;
    list.replaceChildren();
    const sorted = [...items.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || (BigInt(a.id) > BigInt(b.id) ? -1 : 1)).slice(0, 200);
    items.clear();
    for (const item of sorted) {
      const target = notificationTarget(item);
      if (!target) continue;
      items.set(item.id, item);
      const link = document.createElement('a');
      link.href = target;
      link.dataset.activityId = item.id;
      const label = document.createElement('span'), date = document.createElement('time');
      label.textContent = `${item.title} · ${item.body}`;
      date.dateTime = item.createdAt;
      date.textContent = dateTime(item.createdAt);
      link.append(label, date);
      list.append(link);
      if (focusedId === item.id) link.focus({ preventScroll: true });
    }
    if (!items.size) stateMessage(list, 'Ծանուցումներ չկան');
    more.hidden = !historyCursor || items.size >= 200;
  }
  function ingest(records) {
    let changed = false;
    for (const item of records) {
      if (item.kind === 'POST_COMMENT' && notificationTarget(item)) {
        items.set(item.id, item);
        changed = true;
      }
    }
    if (changed) render();
  }
  async function history(reset = false) {
    if (stopped || historyLoading) return;
    historyLoading = true;
    const focusedControl = [more, refresh].includes(document.activeElement) ? document.activeElement : null;
    more.disabled = refresh.disabled = true;
    status.setAttribute('aria-busy', 'true');
    stateMessage(status, 'Բեռնվում է...');
    try {
      const result = await notifications.history({ cursor: reset ? '' : historyCursor || '' });
      if (stopped) return;
      if (reset) items.clear();
      for (const item of result.items) if (item.kind === 'POST_COMMENT' && notificationTarget(item)) items.set(item.id, item);
      historyCursor = result.nextCursor;
      render();
      status.replaceChildren();
    } catch (error) {
      if (!stopped) stateMessage(status, error.message, { retry: () => history(reset) });
    } finally {
      historyLoading = false;
      status.removeAttribute('aria-busy');
      more.disabled = refresh.disabled = false;
      if (focusedControl && !panel.hidden && document.activeElement === document.body) (focusedControl.hidden ? refresh : focusedControl).focus({ preventScroll: true });
    }
  }
  async function poll() {
    if (stopped || polling) return;
    polling = true;
    try {
      const result = await notifications.list({ cursor, limit: 100 });
      if (stopped) return;
      cursor = result.nextCursor;
      ingest(result.items);
      await presenter.present(result.items, cursor);
      delay = 15000;
    } catch (error) {
      // Live delivery retries independently of the history panel and its status.
      delay = Math.min(delay * 2, 120000);
    } finally {
      polling = false;
      if (!stopped) timer = setTimeout(poll, delay);
    }
  }
  function setOpen(open, restoreFocus = false) {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) {
      close.focus({ preventScroll: true });
      history(true);
    } else if (restoreFocus) toggle.focus({ preventScroll: true });
  }
  toggle.onclick = () => setOpen(panel.hidden);
  close.onclick = () => setOpen(false, true);
  more.onclick = () => history();
  refresh.onclick = () => history(true);
  const outside = event => { if (!panel.hidden && !root.contains(event.target)) setOpen(false); };
  const escape = event => {
    if (event.key === 'Escape' && !panel.hidden && root.contains(event.target)) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false, true);
    }
  };
  const focusOut = event => {
    if (event.relatedTarget) {
      if (!root.contains(event.relatedTarget)) setOpen(false);
      return;
    }
    queueMicrotask(() => {
      if (!stopped && !historyLoading && !root.contains(document.activeElement)) setOpen(false);
    });
  };
  document.addEventListener('pointerdown', outside);
  root.addEventListener('keydown', escape);
  root.addEventListener('focusout', focusOut);
  const changed = () => history(true);
  window.addEventListener('polylink-notifications-changed', changed);
  function stop() {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    presenter.stop();
    items.clear();
    root.remove();
    unsubscribe?.();
    document.removeEventListener('pointerdown', outside);
    window.removeEventListener('polylink-notifications-changed', changed);
    window.removeEventListener('pagehide', pagehide);
    window.removeEventListener('pageshow', pageshow);
    if (active?.stop === stop) active = null;
  }
  const pageshow = event => {
    if (event.persisted) auth.me().then(current => { if (current?.id === user) startActivityNotifications(user); }).catch(() => {});
  };
  const pagehide = event => { stop(); if (event.persisted) window.addEventListener('pageshow', pageshow, { once: true }); };
  window.addEventListener('pagehide', pagehide, { once: true });
  auth.subscribeSession((current, error) => { if (!error && current?.id !== user) stop(); }).then(off => { if (stopped) off(); else unsubscribe = off; }).catch(() => {});
  active = { user, stop };
  // Establish the live watermark before history so events between reads deduplicate by ID.
  poll().then(() => { if (!stopped) history(true); });
  return stop;
}
