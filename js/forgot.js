import { auth } from './services/index.js';
import { rememberChallenge } from './services/workflow.js';
import { start, bootstrap, pending } from './shared/ui.js';

start(async () => {
  await bootstrap({ protectedPage: false });
  const form = document.getElementById('forgot-form');
  form.onsubmit = event => {
    event.preventDefault();
    pending(form.querySelector('[type="submit"]'), form, async () => {
      const email = document.getElementById('email').value.trim();
      rememberChallenge('recovery', await auth.forgotPassword(email), email);
      location.href = 'verify-code.html';
    });
  };
});
