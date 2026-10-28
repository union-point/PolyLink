import { auth } from './services/index.js';
import { start, initializeTheme, pending, showError } from './shared/ui.js';
import { finishLogin, inlineCode, initializePasswordControls } from './shared/auth-ui.js';
import { initializeAvatarUpload } from './shared/avatar-upload.js';
import { DataError } from './data/errors.js';

start(async () => {
  initializeTheme();
  initializePasswordControls();
  const element = name => document.getElementById(name);
  const form = element('profile-info-form'), fields = element('profile-fields');
  const codeForm = element('enrollment-code'), loginForm = element('enrollment-login');
  const status = element('enrollment-status');
  let state, challenge, resendAt = 0, dirty = false, busy = false;
  function setChallenge(value) {
    challenge = value;
    resendAt = typeof value?.resendAfter === 'string' ? Date.parse(value.resendAfter) : Date.now() + (value?.resendAfter || 0) * 1000;
  }
  const selectedRole = () => form.querySelector('[name=role]:checked').value;
  const avatar = initializeAvatarUpload();

  function step(name) {
    form.hidden = name !== 'profile';
    codeForm.hidden = name !== 'code';
    loginForm.hidden = name !== 'login';
    document.querySelectorAll('[data-step]').forEach(item => {
      if (item.dataset.step === name) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    });
    const text = {
      profile: ['Լրացրեք Ձեր պրոֆիլը', ''],
      code: ['Հաստատեք Ձեր էլ․ փոստը', 'Մնացել է մեկ քայլ՝ հաշիվը հաստատելու համար։'],
      login: ['Ձեր պրոֆիլը պատրաստ է', ''],
    }[name];
    element('step-title').textContent = text[0];
    element('step-description').textContent = text[1];
    element('step-description').hidden = !text[1];
  }
  function roleFields() {
    const graduate = selectedRole() === 'graduate';
    for (const [selector, enabled] of [['[data-graduate]', graduate], ['[data-lecturer]', !graduate]]) {
      const group = document.querySelector(selector);
      group.hidden = !enabled;
      group.querySelectorAll('input,select').forEach(input => { input.disabled = !enabled; input.required = enabled; });
    }
  }
  function render(next) {
    state = next;
    element('enrollment-email').textContent = state.email;
    status.textContent = '';
    if (next.status === 'admitted') { step('login'); element('password').focus(); return; }
    for (const [key, value] of Object.entries(next.profile)) {
      if (key === 'role') {
        form.querySelectorAll('[name=role]').forEach(input => { input.checked = input.value === value; });
      } else if (element(key)) element(key).value = value ?? '';
    }
    avatar.render(next.avatar);
    roleFields(); fields.disabled = busy; dirty = false;
    setChallenge(next.challenge);
    step(challenge ? 'code' : 'profile');
  }
  try {
    const next = await auth.enrollment();
    if (next.status === 'enrollment') {
      const options = await auth.enrollmentOptions();
      for (const [field, list] of [['instituteId', options.institutes], ['specializationId', options.specializations], ['departmentId', options.departments], ['professionId', options.professions]])
        element(field).replaceChildren(new Option('Ընտրեք…', ''), ...list.map(item => new Option(item.name, String(item.id))));
    }
    render(next);
  } catch (error) { showError(form, error); return; }

  form.addEventListener('input', event => {
    if (event.target.type === 'file') return;
    dirty = true; status.textContent = '';
  });
  form.querySelectorAll('[name=role]').forEach(input => input.addEventListener('change', roleFields));
  function profile() {
    const graduate = selectedRole() === 'graduate';
    const numeric = name => element(name).value ? Number(element(name).value) : null;
    if (graduate && numeric('endYear') < numeric('startYear'))
      throw new DataError('VALIDATION', 'Ուսման ավարտը չի կարող լինել սկզբից առաջ։', { endYear: 'Ստուգեք ուսման տարիները։' });
    return {
      revision: state.revision, role: selectedRole(), firstName: state.profile.firstName, lastName: state.profile.lastName, instituteId: numeric('instituteId'),
      diplomaNumber: graduate ? element('diplomaNumber').value.trim() : null,
      specializationId: graduate ? numeric('specializationId') : null, startYear: graduate ? numeric('startYear') : null, endYear: graduate ? numeric('endYear') : null,
      departmentId: graduate ? null : numeric('departmentId'), professionId: graduate ? null : numeric('professionId'), biography: element('biography').value.trim(),
    };
  }
  // Keep fields stable while a save is in flight so that edits cannot be overwritten.
  async function profileAction(button, action) {
    if (busy || avatar.busy) return;
    busy = true;
    await pending(button, form, async () => {
      const data = profile();
      fields.disabled = true;
      try { await action(data); }
      finally { fields.disabled = false; roleFields(); }
    });
    busy = false;
  }
  async function save(data) {
    render(await auth.saveEnrollment(data));
    status.textContent = 'Տվյալները պահպանված են։';
  }
  element('save-profile').onclick = () => profileAction(element('save-profile'), save);
  form.onsubmit = event => {
    event.preventDefault();
    profileAction(element('submit-profile'), async data => {
      if (challenge && !dirty) { status.textContent = ''; step('code'); updateResend(); element('verification-code').focus(); return; }
      if (dirty || !state.profile.diplomaNumber && selectedRole() === 'graduate' || !state.profile.professionId && selectedRole() === 'lecturer') await save(data);
      setChallenge(await auth.submitEnrollment({ revision: state.revision }));
      status.textContent = '';
      element('verification-code').value = '';
      step('code'); updateResend(); element('verification-code').focus();
    });
  };
  element('edit-profile').onclick = () => {
    step('profile');
    // Returning to the profile preserves the active challenge until data actually changes.
    form.querySelector('[name=role]:checked').focus();
  };
  codeForm.onsubmit = event => {
    event.preventDefault();
    pending(codeForm.querySelector('[type=submit]'), codeForm, async () => {
      const result = await auth.verifyEmail({ challengeId: challenge.challengeId, code: element('verification-code').value });
      element('verification-code').value = ''; render(result);
    });
  };
  function updateResend() {
    const seconds = Math.max(0, Math.ceil((resendAt - Date.now()) / 1000)) || 0;
    element('resend-code').disabled = busy || seconds > 0;
    element('resend-countdown').textContent = seconds ? `Կրկին ուղարկել՝ ${seconds} վրկ․ հետո` : '';
  }
  element('resend-code').onclick = async () => {
    if (busy || !challenge) return;
    busy = true;
    await pending(element('resend-code'), codeForm, async () => {
      setChallenge(await auth.resendChallenge({ challengeId: challenge.challengeId }));
      element('verification-code').value = '';
      status.textContent = 'Նոր կոդն ուղարկված է Ձեր էլ․ փոստին։';
      element('verification-code').focus();
    });
    busy = false; updateResend();
  };
  updateResend();
  let timer = setInterval(updateResend, 1000);
  window.addEventListener('pagehide', () => clearInterval(timer));
  window.addEventListener('pageshow', event => { if (event.persisted) { updateResend(); timer = setInterval(updateResend, 1000); } });
  loginForm.onsubmit = event => {
    event.preventDefault();
    pending(loginForm.querySelector('[type=submit]'), loginForm, async () => {
      let result;
      try { result = await auth.login({ email: state.email, password: element('password').value }); }
      finally { element('password').value = ''; }
      if (result.status === 'challenge') result = await inlineCode(auth, result, 'LOGIN', loginForm);
      finishLogin(result);
    });
  };
  element('enrollment-logout').onclick = () => {
    if (busy || avatar.busy) return;
    // Logout must remain available even when required profile fields are incomplete.
    pending(element('enrollment-logout'), document.querySelector('footer'), async () => {
      await auth.logoutEnrollment(); location.href = 'login.html';
    });
  };
});
