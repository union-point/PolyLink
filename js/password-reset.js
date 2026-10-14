import { auth } from './services/index.js';
import { requireChallenge, clearWorkflow } from './services/workflow.js';
import { start, bootstrap, pending, showError } from './shared/ui.js';
import { initializePasswordControls, passwordsMatch } from './shared/auth-ui.js';
import { DataError } from './data/errors.js';

start(async () => {
  await bootstrap({ protectedPage: false });
  initializePasswordControls('new-password');
  const form = document.getElementById('reset-form');
  let context;
  try { context = requireChallenge('recovery'); if (!context.recoveryToken) throw new DataError('VALIDATION', 'Նախ հաստատեք վերականգնման կոդը։'); }
  catch (error) { showError(form, error); form.querySelector('[type="submit"]').disabled = true; return; }
  document.getElementById('confirm-password').name = 'confirmPassword';
  form.onsubmit = event => {
    event.preventDefault();
    pending(form.querySelector('[type="submit"]'), form, async () => {
      const password = document.getElementById('new-password').value;
      passwordsMatch(password, document.getElementById('confirm-password').value);
      await auth.resetPassword({ recoveryToken: context.recoveryToken, email: context.email, code: context.code, newPassword: password });
      clearWorkflow(); location.href = 'login.html';
    });
  };
});
