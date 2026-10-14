import { DataError } from '../data/errors.js';
import { rememberChallenge } from '../services/workflow.js';

export function initializePasswordControls(passwordId = 'password') {
  document.querySelectorAll('.toggle-password').forEach(button => {
    button.onclick = () => {
      const input = button.parentElement.querySelector('input');
      input.type = input.type === 'password' ? 'text' : 'password';
      button.textContent = input.type === 'password' ? '👁️' : '🙈';
    };
  });
  const input = document.getElementById(passwordId);
  const bar = document.getElementById('strength-bar');
  if (!input || !bar) return;
  const rules = { length: /.{8,}/, uppercase: /[A-Z]/, number: /\d/, special: /[^\w\s]/ };
  input.addEventListener('input', () => {
    let count = 0;
    for (const [name, pattern] of Object.entries(rules)) { const matches = pattern.test(input.value); document.getElementById(`req-${name}`)?.classList.toggle('met', matches); if (matches) count++; }
    const level = count < 3 ? 'weak' : count === 3 ? 'medium' : 'strong';
    bar.className = `password-strength-bar ${level}`;
    const label = document.getElementById('strength-text'); label.className = `strength-text ${level}`; label.textContent = { weak: 'Թույլ', medium: 'Միջին', strong: 'Ուժեղ' }[level];
  });
}
export function passwordsMatch(first, second) {
  if (!first || first !== second) throw new DataError('VALIDATION', 'Գաղտնաբառերը չեն համընկնում։', { confirmPassword: 'Գաղտնաբառերը չեն համընկնում' });
}
export function goToProfile(user) { location.href = user.onboardingComplete ? 'profile.html' : 'profile_info.html'; }
export function finishLogin(result) {
  if (result.status === 'challenge') { rememberChallenge('second-factor', result); location.href = '2fa-verify.html'; }
  else if (result.user) goToProfile(result.user);
  else throw new DataError('CONTRACT', 'Login response is missing the user.');
}
