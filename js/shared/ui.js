import { authMessage, isAuthPage, validateAuthForm } from './auth-messages.js';
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
  const region = errorRegion(container); region.setAttribute('role', 'alert'); region.textContent = isAuthPage() ? authMessage(error.message, error.code) : error.message;
  for (const [field, message] of Object.entries(error.fieldErrors || {})) {
    const element = [...container.querySelectorAll('input,select,textarea,[contenteditable]')].find(element => element.name === field || element.id === field || element.dataset.name === field);
    if (element) { element.classList.add('error'); element.setAttribute('aria-invalid', 'true'); element.title = isAuthPage() ? authMessage(message, 'VALIDATION') : message; }
  }
}
export async function pending(button, container, action) {
  if (button?.disabled) return false;
  if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
  errorRegion(container).textContent = '';
  container.querySelectorAll('[aria-invalid]').forEach(input => { input.classList.remove('error'); input.removeAttribute('aria-invalid'); input.removeAttribute('title'); });
  try {
    const invalid = isAuthPage() && (button?.type === 'submit' || button?.id === 'save-profile') && validateAuthForm(container);
    if (invalid) throw invalid;
    await action(); return true;
  }
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
export function relativeTime(value) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (!minutes) return 'Հենց հիմա';
  if (minutes < 60) return `${minutes} րոպե առաջ`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} ժամ առաջ`;
  return `${Math.floor(minutes / 1440)} օր առաջ`;
}
export function confirmAction(message) {
  let backdrop = document.getElementById('custom-confirm-backdrop');
  if (!backdrop?.querySelector('#confirm-yes')) {
    backdrop = document.querySelector('[data-common-confirm]');
    if (!backdrop) {
      backdrop = document.createElement('div'); backdrop.dataset.commonConfirm = '';
      backdrop.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);align-items:center;justify-content:center;backdrop-filter:blur(5px)';
      backdrop.innerHTML = '<div class="custom-confirm"><p data-confirm-message></p><div class="buttons"><button data-confirm-yes>Այո</button><button data-confirm-no>Ոչ</button></div></div>';
      document.body.appendChild(backdrop);
    }
  }
  return new Promise(resolve => {
    const previous = document.activeElement;
    const yes = backdrop.querySelector('#confirm-yes,[data-confirm-yes]'), no = backdrop.querySelector('#confirm-no,[data-confirm-no]');
    backdrop.querySelector('#custom-confirm-message,[data-confirm-message]').textContent = message;
    backdrop.style.zIndex = '2000';
    backdrop.style.display = 'flex';
    backdrop.classList.remove('hidden'); backdrop.setAttribute('role', 'dialog'); backdrop.setAttribute('aria-modal', 'true');
    backdrop.setAttribute('aria-label', 'Հաստատել գործողությունը');
    const finish = answer => { backdrop.classList.add('hidden'); backdrop.style.display = 'none'; yes.onclick = no.onclick = null; backdrop.onkeydown = null; previous?.focus(); resolve(answer); };
    yes.onclick = () => finish(true); no.onclick = () => finish(false);
    backdrop.onkeydown = event => {
      if (event.key === 'Escape') { event.stopPropagation(); finish(false); }
      if (event.key === 'Tab') { event.preventDefault(); (document.activeElement === yes ? no : yes).focus(); }
    };
    no.focus();
  });
}

export async function bootstrap({ protectedPage = true, requireOnboarding = true } = {}) {
  initializeTheme();
  document.querySelectorAll('.dropdown-container').forEach(container => {
    const button = container.querySelector('.dropdown-btn'), menu = container.querySelector('.dropdown-menu');
    if (!button || !menu) return;
    button.setAttribute('aria-label', 'Բացել ընտրացանկը'); button.setAttribute('aria-expanded', 'false');
    const close = () => { container.classList.remove('menu-open'); button.setAttribute('aria-expanded', 'false'); };
    button.onclick = () => { const expanded = container.classList.toggle('menu-open'); button.setAttribute('aria-expanded', String(expanded)); };
    container.onkeydown = event => { if (event.key === 'Escape') { close(); button.focus(); } };
    document.addEventListener('click', event => { if (!container.contains(event.target)) close(); });
  });
  let leaving = false;
  document.addEventListener('input', event => { event.target.classList?.remove('error'); event.target.removeAttribute?.('aria-invalid'); });
  document.querySelectorAll('nav a[href="login.html"]').forEach(link => link.addEventListener('click', async event => {
    event.preventDefault();
    leaving = true;document.body.dataset.sessionCheck='';
    const { config } = await import('../config.js');
    if(config.dataMode==='http') {
      document.querySelector('main')?.replaceChildren();
      try { await auth.logout(); }
      catch(error) { try { sessionStorage.setItem('polylink.logoutNotice', error.message); } catch {} }
      finally { location.href='login.html'; }
      return;
    }
    const done = await pending(null, document.querySelector('main') || document.body, async () => { await auth.logout(); location.href = 'login.html'; });
    if (!done) leaving = false;
  }));
  if (!protectedPage) return null;
  let user = await auth.me();
  if (user?.cryptoLocked) {
    const { unlockIdentity } = await import('./auth-ui.js');
    user = await unlockIdentity(auth, user);
  }
  if (!user && protectedPage) {
    try { const enrollment=await auth.enrollment();if(enrollment.status==='enrollment'){location.replace('profile_info.html');return null;} }
    catch(error){if(error.code!=='UNAUTHORIZED'&&error.code!=='UNSUPPORTED')throw error;}
    location.replace('login.html');return null;
  }
  if (user && protectedPage && requireOnboarding && !user.onboardingComplete) { location.replace('profile_info.html'); return null; }
  if(user.storageUnavailable){const notice=document.createElement('p');notice.dataset.storageNotice='';notice.setAttribute('role','status');notice.textContent='Այս դիտարկիչը չի կարող անվտանգ պահել մուտքի տվյալները։ Այլ էջ անցնելիս կամ էջը թարմացնելիս գաղտնաբառը կրկին կպահանջվի։';(document.querySelector('main')||document.body).prepend(notice);}
  const validateSession = (nextUser, error, event) => {
    if (leaving) return;
    if (error) { showError(document.querySelector('main') || document.body, error); return; }
    if (!nextUser) { leaving = true; document.body.dataset.sessionCheck='';document.querySelector('main')?.replaceChildren(); location.replace('login.html'); }
    else if (nextUser.id !== user.id || nextUser.sessionVersion!==user.sessionVersion || nextUser.cryptoLocked || event?.operation === 'reset') { leaving = true; location.reload(); }
  };
  const unsubscribe = await auth.subscribeSession(validateSession);
  window.addEventListener('pagehide', event => { if (!event.persisted) unsubscribe(); });
  const { config } = await import('../config.js');
  if(config.dataMode==='http') {
    const style=document.createElement('style');style.textContent='body[data-session-check] > :not([data-identity-unlock]):not([data-session-status]):not(script):not(style) {visibility:hidden}';document.head.appendChild(style);
    let checking=false;
    const check=async()=>{
      if(leaving||checking||document.visibilityState==='hidden')return;
      checking=true;
      try {
        let next=await auth.me();
        if(next?.cryptoLocked){document.body.dataset.sessionCheck='';const {unlockIdentity}=await import('./auth-ui.js');next=await unlockIdentity(auth,next);if(next)user=next;}
        validateSession(next);if(next&&!leaving){delete document.body.dataset.sessionCheck;document.querySelector('[data-session-status]')?.remove();}
      }catch(error){
        if(document.body.hasAttribute('data-session-check')){const status=document.querySelector('[data-session-status]')||document.createElement('p');status.dataset.sessionStatus='';status.setAttribute('role','status');status.textContent=error.message;document.body.appendChild(status);}
        else validateSession(null,error);
      }finally{checking=false;}
    };
    const interval=setInterval(check,15000);
    window.addEventListener('pagehide',event=>{document.body.dataset.sessionCheck='';if(!event.persisted)clearInterval(interval);});
    window.addEventListener('pageshow',event=>{if(event.persisted){leaving=false;check();}});
    window.addEventListener('focus',check);document.addEventListener('visibilitychange',check);
  }else window.addEventListener('pageshow', event => { if (event.persisted) { leaving = false; auth.me().then(next => validateSession(next)).catch(error => validateSession(null, error)); } });
  const {startActivityNotifications}=await import('./activity-notifications.js');startActivityNotifications(user.id);
  return user;
}

export function start(controller) {
  const run = async () => {
    // Controls must not act on empty shells while the initial service reads are pending.
    const roots = [...document.body.children].filter(element => !['SCRIPT', 'STYLE', 'LINK'].includes(element.tagName));
    const previous = roots.map(element => element.inert);
    roots.forEach(element => { element.inert = true; });
    const loading = document.createElement('p'); loading.setAttribute('role', 'status'); loading.textContent = 'Բեռնվում է...';
    loading.style.cssText = 'position:fixed;bottom:12px;left:12px;padding:8px 16px;background:var(--card-background,#fff);z-index:10000';
    document.body.appendChild(loading);
    try { await controller(); }
    catch (error) {
      const container = document.querySelector('main') || document.querySelector('form') || document.body;
      showError(container, error);
      const retry = document.createElement('button'); retry.className = 'primary-btn'; retry.textContent = 'Կրկին փորձել'; retry.onclick = () => location.reload(); container.appendChild(retry);
    }
    finally { loading.remove(); roots.forEach((element, index) => { element.inert = previous[index]; }); }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
  else run();
}
