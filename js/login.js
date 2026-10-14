import { auth } from './services/index.js';
import { clearWorkflow } from './services/workflow.js';
import { start, bootstrap, pending } from './shared/ui.js';
import { initializePasswordControls, finishLogin } from './shared/auth-ui.js';

start(async () => {
  await bootstrap({ protectedPage: false });
  initializePasswordControls();
  const form = document.getElementById('login-form');
  form.querySelector('.error-message').remove();
  form.onsubmit = event => {
    event.preventDefault();
    pending(form.querySelector('[type="submit"]'), form, async () => {
      clearWorkflow();
      const result = await auth.login({ email: document.getElementById('email').value, password: document.getElementById('password').value });
      finishLogin(result);
    });
  };
});
