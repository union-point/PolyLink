import { auth } from './services/index.js';
import { clearWorkflow } from './services/workflow.js';
import { start, bootstrap, pending } from './shared/ui.js';
import { initializePasswordControls, finishLogin, inlineCode } from './shared/auth-ui.js';

start(async () => {
  await bootstrap({ protectedPage: false });
  initializePasswordControls();
  const notice=sessionStorage.getItem('polylink.logoutNotice');if(notice){const message=document.createElement('p');message.setAttribute('role','status');message.textContent=notice;document.querySelector('form').appendChild(message);sessionStorage.removeItem('polylink.logoutNotice');}
  const form = document.getElementById('login-form');
  form.querySelector('.error-message').remove();
  form.onsubmit = event => {
    event.preventDefault();
    pending(form.querySelector('[type="submit"]'), form, async () => {
      clearWorkflow();
      let result = await auth.login({ email: document.getElementById('email').value, password: document.getElementById('password').value });
      document.getElementById('password').value = '';
      if (result.status === 'challenge' && result.expiresAt && typeof result.expiresAt === 'string') result = await inlineCode(auth, result, 'LOGIN', form);
      document.getElementById('password').value = '';
      finishLogin(result);
    });
  };
});
