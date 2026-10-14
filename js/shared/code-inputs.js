import { auth } from '../services/index.js';
import { requireChallenge, rememberChallenge } from '../services/workflow.js';
import { pending, showError } from './ui.js';
import { DataError } from '../data/errors.js';

export function initializeCodeInputs(purpose, onVerified) {
  const form = document.getElementById('verify-form');
  let context;
  try { context = requireChallenge(purpose); }
  catch (error) { showError(form, error); form.querySelector('[type="submit"]').disabled = true; return; }
  const inputs = [...form.querySelectorAll('.code-input')];
  inputs.forEach((input, index) => {
    input.setAttribute('aria-label', `Կոդի նիշ ${index + 1}`);
    input.oninput = () => { input.value = input.value.replace(/\D/g, '').slice(0, 1); if (input.value) inputs[index + 1]?.focus(); };
    input.onkeydown = event => { if (event.key === 'Backspace' && !input.value) inputs[index - 1]?.focus(); };
    input.onpaste = event => {
      event.preventDefault();
      const text = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, inputs.length - index);
      [...text].forEach((digit, position) => { inputs[index + position].value = digit; });
      inputs[Math.min(inputs.length - 1, index + text.length)]?.focus();
    };
  });
  inputs[0].focus();
  const resend = document.getElementById('resend-btn'), timer = document.getElementById('timer');
  let resending = false;
  resend.setAttribute('role', 'button'); resend.tabIndex = 0;
  function updateTimer() {
    const left = Math.max(0, Math.ceil(((context.resendAt || 0) - Date.now()) / 1000));
    timer.textContent = left ? `(${left}վ)` : '';
    resend.style.opacity = left || resending ? '0.5' : '1';
    resend.setAttribute('aria-disabled', String(Boolean(left || resending)));
  }
  updateTimer(); let interval = setInterval(updateTimer, 1000);
  window.addEventListener('pagehide', () => clearInterval(interval));
  window.addEventListener('pageshow', event => { if (event.persisted) { updateTimer(); interval = setInterval(updateTimer, 1000); } });
  resend.onclick = async () => {
    if (resending || context.resendAt > Date.now()) return;
    resending = true; updateTimer();
    await pending(null, form, async () => {
      const result = await auth.resendChallenge(context.challengeId);
      context = rememberChallenge(purpose, result, context.email);
    });
    resending = false; updateTimer();
  };
  resend.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); resend.click(); } };
  form.onsubmit = event => {
    event.preventDefault();
    pending(form.querySelector('[type="submit"]'), form, async () => {
      const code = inputs.map(input => input.value).join('');
      if (!/^\d{6}$/.test(code)) throw new DataError('VALIDATION', 'Մուտքագրեք վեց նիշանոց կոդը։');
      await onVerified(context, code);
    });
  };
}
