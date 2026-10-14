import { auth } from './services/index.js';
import { clearWorkflow } from './services/workflow.js';
import { start, bootstrap, pending } from './shared/ui.js';
import { initializePasswordControls, passwordsMatch, finishLogin } from './shared/auth-ui.js';

start(async () => {
  await bootstrap({ protectedPage: false });
  initializePasswordControls();
  const form = document.getElementById('register-form');
  document.getElementById('confirm').name = 'confirmPassword';
  document.getElementById('firstname').name = 'firstName';
  document.getElementById('lastname').name = 'lastName';
  form.querySelector('.error-message').remove();
  form.onsubmit = event => {
    event.preventDefault();
    pending(form.querySelector('[type="submit"]'), form, async () => {
      const data = { firstName: document.getElementById('firstname').value, lastName: document.getElementById('lastname').value, email: document.getElementById('email').value, password: document.getElementById('password').value };
      passwordsMatch(data.password, document.getElementById('confirm').value);
      await auth.register(data);
      const result = await auth.login({ email: data.email, password: data.password });
      clearWorkflow();
      finishLogin(result);
    });
  };
});
