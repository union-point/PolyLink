import { settings } from './services/index.js';
import { bootstrap, start, pending, notify, setTheme, dateTime } from './shared/ui.js';
import { auth } from './services/index.js';
import { passwordsMatch, inlineCode } from './shared/auth-ui.js';

start(async () => {
  const user = await bootstrap(); if (!user) return;
  window.addEventListener('pagehide',()=>document.querySelectorAll('input[type=password]').forEach(input=>{input.value='';}));
  let preferences;
  try{preferences=await settings.get();}catch(error){if(error.code!=='UNSUPPORTED')throw error;preferences=null;}
  const controls = [...document.querySelectorAll('[data-setting]')];
  function applyControl(element, value) {
    if (element.type === 'checkbox') element.checked = value;
    else element.value = element.dataset.setting === 'isProfilePublic' ? value ? 'open' : 'closed' : value;
  }
  controls.forEach(element => {
    const key = element.dataset.setting;
    if(!preferences){element.disabled=true;if(key==='twoFactorEnabled')element.checked=Boolean(user.emailFactorEnabled);element.title='This setting is not available yet.';return;}
    applyControl(element, preferences[key]);
    element.onchange = async () => {
      const previous = preferences[key], value = element.type === 'checkbox' ? element.checked : key === 'isProfilePublic' ? element.value === 'open' : element.value;
      element.disabled = true;
      const saved = await pending(null, element.closest('.settings-item'), async () => { const updated = await settings.update({ [key]: value }); preferences = { ...preferences, [key]: updated[key] }; });
      element.disabled = false; applyControl(element, saved ? preferences[key] : previous);
      if (saved) notify('Կարգավորումը պահպանվել է');
    };
  });
  const themeButtons = [...document.querySelectorAll('.theme-btn')];
  function updateThemes() {
    const classes = document.documentElement.classList;
    const theme = classes.contains('theme-auto') ? 'auto' : classes.contains('theme-dark') ? 'dark' : 'light';
    themeButtons.forEach(button => { button.classList.toggle('active', button.dataset.theme === theme); button.setAttribute('aria-pressed', String(button.dataset.theme === theme)); });
  }
  themeButtons.forEach(button => { button.onclick = () => { setTheme(button.dataset.theme); updateThemes(); }; }); updateThemes();
  document.getElementById('current-email').textContent = user.email;
  const passwordDescription = document.querySelector('#password-setting .settings-item-description');
  passwordDescription.textContent = user.passwordChangedAt ? `Վերջին փոփոխությունը՝ ${dateTime(user.passwordChangedAt)}` : 'Գաղտնաբառի փոփոխություն դեռ չի կատարվել';
  function editor(kind) {
    const row = document.getElementById(`${kind}-setting`), form = document.getElementById(`${kind}-edit-form`);
    const inputs = [...form.querySelectorAll('input')];
    const close = () => { if (form.querySelector('[aria-busy="true"]')) return; form.style.display = 'none'; row.style.display = 'flex'; inputs.forEach(input => { input.value = ''; input.classList.remove('error'); input.removeAttribute('aria-invalid'); }); form.querySelector('[data-status]')?.remove(); };
    document.getElementById(`edit-${kind}-btn`).onclick = () => { row.style.display = 'none'; form.style.display = 'block'; inputs[0].focus(); };
    document.getElementById(`cancel-${kind}-btn`).onclick = close;
    return { form, close };
  }
  const emailEdit = editor('email'), passwordEdit = editor('password');
  document.getElementById('new-email').name = 'email'; document.getElementById('email-old-password').name = 'password';
  document.getElementById('new-password').name = 'password'; document.getElementById('confirm-password').name = 'confirmPassword';
  document.getElementById('save-email-btn').onclick = async event => {
    const saved = await pending(event.currentTarget, emailEdit.form, async () => {
      const updated = await settings.changeEmail({ email: document.getElementById('new-email').value, password: document.getElementById('email-old-password').value });
      document.getElementById('current-email').textContent = updated.email;
    });
    if (saved) { emailEdit.close(); notify('Էլ․ փոստը թարմացվել է'); }
  };
  document.getElementById('save-password-btn').onclick = async event => {
    const saved = await pending(event.currentTarget, passwordEdit.form, async () => {
      const newPassword = document.getElementById('new-password').value;
      passwordsMatch(newPassword, document.getElementById('confirm-password').value);
      let result=await settings.changePassword({ oldPassword: document.getElementById('old-password').value, newPassword });
      passwordEdit.form.querySelectorAll('input').forEach(input=>{input.value='';});
      if(result?.status==='challenge')result=await inlineCode(auth,result,'LOGIN',passwordEdit.form);
      if(result?.storageUnavailable)notify('The password changed. Secure browser storage is unavailable; navigation will require your password.');
      passwordDescription.textContent = 'Գաղտնաբառը թարմացվել է';
    });
    if (saved) { passwordEdit.close(); notify('Գաղտնաբառը թարմացվել է'); }
  };
  document.getElementById('download-data-btn').onclick = event => pending(event.currentTarget, event.currentTarget.closest('.settings-item'), async () => {
    const data = await settings.export();
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'polylink-data.json'; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    notify('Տվյալների պատճենը պատրաստ է');
  });
  const backdrop = document.getElementById('custom-confirm-backdrop'), confirmation = document.getElementById('confirm-delete-btn'), cancellation = document.getElementById('confirm-cancel-btn');
  let lifecycle;
  let submitting = false;
  let previousFocus;
  function closeConfirmation() { if (submitting) return; backdrop.classList.add('hidden'); previousFocus?.focus(); }
  function openConfirmation(kind, button) {
    lifecycle = kind; previousFocus = button;
    document.getElementById('confirm-title').textContent = kind === 'deleteAccount' ? 'Ջնջել հաշիվը' : 'Ապաակտիվացնել հաշիվը';
    document.getElementById('confirm-text').textContent = kind === 'deleteAccount' ? 'Հաստատեք հաշվի և ձեր տվյալների մշտական ջնջումը։' : 'Հաշիվը ժամանակավորապես ապաակտիվացվելու է։ Կարող եք վերականգնել այն հաջորդ մուտքի ժամանակ։';
    document.getElementById('confirm-password-delete').value = ''; document.getElementById('confirm-error').textContent = ''; backdrop.querySelector('[data-status]')?.remove();
    confirmation.textContent = kind === 'deleteAccount' ? 'ՋՆՋԵԼ' : 'Ապաակտիվացնել';
    backdrop.classList.remove('hidden'); backdrop.style.zIndex = '2000'; backdrop.setAttribute('role', 'dialog'); backdrop.setAttribute('aria-modal', 'true'); backdrop.setAttribute('aria-label', 'Հաստատել հաշվի գործողությունը');
    document.getElementById('confirm-password-delete').focus();
  }
  document.querySelector('.btn-danger-outline').onclick = event => openConfirmation('deactivate', event.currentTarget);
  document.querySelector('.btn-danger').onclick = event => openConfirmation('deleteAccount', event.currentTarget);
  cancellation.onclick = closeConfirmation;
  backdrop.onkeydown = event => {
    if (event.key === 'Escape') closeConfirmation();
    if (event.key === 'Enter' && event.target.matches('input')) { event.preventDefault(); confirmation.click(); }
    if (event.key === 'Tab') { const focusable = [...backdrop.querySelectorAll('button,input')].filter(element => !element.disabled); if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1).focus(); } else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0].focus(); } }
  };
  confirmation.onclick = async () => {
    if (submitting) return;
    submitting = true; cancellation.disabled = true;
    const saved = await pending(confirmation, backdrop.querySelector('.custom-confirm'), () => settings[lifecycle]({ password: document.getElementById('confirm-password-delete').value }));
    submitting = false; cancellation.disabled = false;
    if (saved) { closeConfirmation(); location.href = 'login.html'; }
  };
});
