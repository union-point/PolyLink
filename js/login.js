import { authMessage } from './shared/auth-messages.js';
import { auth } from './services/index.js';
import { clearWorkflow } from './services/workflow.js';
import { start, bootstrap, pending } from './shared/ui.js';
import { initializePasswordControls, finishLogin } from './shared/auth-ui.js';

start(async () => {
  await bootstrap({ protectedPage: false });
  initializePasswordControls();
  try {
    const notice = sessionStorage.getItem('polylink.logoutNotice');
    if (notice) {
      const message = document.createElement('p'); message.setAttribute('role', 'status');
      message.textContent = authMessage(notice); document.querySelector('form').appendChild(message);
      sessionStorage.removeItem('polylink.logoutNotice');
    }
  } catch { /* Login remains available when browser storage is restricted. */ }
  const form = document.getElementById('login-form');
  form.onsubmit = event => {
    event.preventDefault();
    pending(form.querySelector('[type="submit"]'), form, async () => {
      clearWorkflow();
      const result = await auth.login({ email: document.getElementById('email').value, password: document.getElementById('password').value, persistChallenge: true });
      document.getElementById('password').value = '';
      finishLogin(result);
    });
  };
});
