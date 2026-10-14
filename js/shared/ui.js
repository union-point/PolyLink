import { auth } from '../services/index.js';

export function applyTheme(theme) {
  const root = document.documentElement;
  root.classList.remove('theme-light', 'theme-dark', 'theme-auto');
  root.classList.add(`theme-${theme}`);
  if (theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches) root.classList.add('theme-dark');
}
export function initializeTheme() {
  const preference = () => localStorage.getItem('theme') || 'light';
  applyTheme(preference());
  const media = matchMedia('(prefers-color-scheme: dark)');
  const update = () => { if (preference() === 'auto') applyTheme('auto'); };
  media.addEventListener('change', update);
  window.addEventListener('storage', event => { if (event.key === 'theme') applyTheme(preference()); });
  return () => media.removeEventListener('change', update);
}
export function setTheme(theme) { localStorage.setItem('theme', theme); applyTheme(theme); }

export function errorRegion(container) {
  let region = container.querySelector('[data-status]');
  if (!region) {
    region = document.createElement('p'); region.dataset.status = ''; region.setAttribute('role', 'status');
    region.style.cssText = 'color:var(--font-color-primary,#223);font-size:14px;margin:12px 0;';
    container.appendChild(region);
  }
  return region;
}
export function showError(container, error) {
  const region = errorRegion(container); region.setAttribute('role', 'alert'); region.textContent = error.message;
  for (const [field, message] of Object.entries(error.fieldErrors || {})) {
    const element = [...container.querySelectorAll('input,select,textarea,[contenteditable]')].find(element => element.name === field || element.id === field || element.dataset.name === field);
    if (element) { element.classList.add('error'); element.setAttribute('aria-invalid', 'true'); element.title = message; }
  }
}
export async function pending(button, container, action) {
  if (button?.disabled) return false;
  if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
  errorRegion(container).textContent = '';
  try { await action(); return true; }
  catch (error) { showError(container, error); return false; }
  finally { if (button) { button.disabled = false; button.removeAttribute('aria-busy'); } }
}
export function notify(message) {
  document.querySelector('[data-toast]')?.remove();
  const toast = document.createElement('div'); toast.dataset.toast = ''; toast.setAttribute('role', 'status'); toast.textContent = message;
  toast.style.cssText = 'position:fixed;bottom:24px;right:24px;padding:16px 24px;background:#2c3e50;color:white;border-radius:8px;z-index:10000;max-width:90vw';
  document.body.appendChild(toast); setTimeout(() => toast.remove(), 3500);
}
export function stateMessage(container, message, { retry } = {}) {
  container.replaceChildren();
  const text = document.createElement('p'); text.setAttribute('role', 'status'); text.style.cssText = 'text-align:center;padding:2rem'; text.textContent = message; container.appendChild(text);
  if (retry) { const button = document.createElement('button'); button.className = 'primary-btn'; button.textContent = 'Կրկին փորձել'; button.onclick = retry; container.appendChild(button); }
}
export function dateTime(value) {
  const date = new Date(value);
  const months = ['Հունվար', 'Փետրվար', 'Մարտ', 'Ապրիլ', 'Մայիս', 'Հունիս', 'Հուլիս', 'Օգոստոս', 'Սեպտեմբեր', 'Հոկտեմբեր', 'Նոյեմբեր', 'Դեկտեմբեր'];
  return Number.isNaN(date.getTime()) ? '' : `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}, ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
export function monthLabel(value) {
  if (!value) return 'Ներկա';
  const [year, month] = value.split('-').map(Number);
  if (!year || !month) return '';
  const months = ['հունվ.', 'փետր.', 'մարտ.', 'ապր.', 'մայ.', 'հունիս', 'հուլ.', 'օգ.', 'սեպտ.', 'հոկտ.', 'նոյ.', 'դեկ.'];
  return `${months[month - 1]} ${year} թ.`;
}
export function dateRange(start, end) { return `${monthLabel(start)} – ${monthLabel(end)}`; }

export async function bootstrap({ protectedPage = true, requireOnboarding = true } = {}) {
  initializeTheme();
  document.addEventListener('input', event => { event.target.classList?.remove('error'); event.target.removeAttribute?.('aria-invalid'); });
  document.querySelectorAll('nav a[href="login.html"]').forEach(link => link.addEventListener('click', async event => {
    event.preventDefault();
    await pending(null, document.querySelector('main') || document.body, async () => { await auth.logout(); location.href = 'login.html'; });
  }));
  if (!protectedPage) return null;
  const user = await auth.me();
  if (!user && protectedPage) { location.replace('login.html'); return null; }
  if (user && protectedPage && requireOnboarding && !user.onboardingComplete) { location.replace('profile_info.html'); return null; }
  return user;
}

export function start(controller) {
  const run = () => controller().catch(error => showError(document.querySelector('main') || document.querySelector('form') || document.body, error));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
  else run();
}
