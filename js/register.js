import { auth } from './services/index.js';
import { clearWorkflow } from './services/workflow.js';
import { start, bootstrap, pending } from './shared/ui.js';
import { initializePasswordControls, passwordsMatch, finishLogin, inlineCode } from './shared/auth-ui.js';

start(async () => {
  await bootstrap({ protectedPage: false });
  initializePasswordControls();
  const form = document.getElementById('register-form');
  document.getElementById('confirm').name = 'confirmPassword';
  document.getElementById('firstname').name = 'firstName';
  document.getElementById('lastname').name = 'lastName';
  form.onsubmit = event => {
    event.preventDefault();
    pending(form.querySelector('[type="submit"]'), form, async () => {
      const data = { firstName: document.getElementById('firstname').value, lastName: document.getElementById('lastname').value, email: document.getElementById('email').value, password: document.getElementById('password').value };
      passwordsMatch(data.password, document.getElementById('confirm').value);
      const challenge = await auth.register(data);
      if(challenge.status==='enrollment') {
        document.getElementById('password').value='';document.getElementById('confirm').value='';clearWorkflow();finishLogin(challenge);return;
      }
      if (challenge?.challengeId && typeof challenge.expiresAt === 'string') await inlineCode(auth, challenge, 'EMAIL_VERIFY', form);
      let result = await auth.login({ email: data.email, password: data.password });
      if (result.status === 'challenge' && typeof result.expiresAt === 'string') result = await inlineCode(auth, result, 'LOGIN', form);
      document.getElementById('password').value = ''; document.getElementById('confirm').value = '';
      clearWorkflow();
      finishLogin(result);
    });
  };
});
