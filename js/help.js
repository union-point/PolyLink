import { bootstrap, start, showError } from './shared/ui.js';
import { DataError } from './data/errors.js';

start(async () => {
  await bootstrap({ protectedPage: false, showNotifications: true });
  document.querySelectorAll('.faq-item').forEach((item, index) => {
    const question = item.querySelector('.faq-question'), answer = item.querySelector('.faq-answer');
    answer.id = `faq-answer-${index}`;
    question.tabIndex = 0; question.setAttribute('role', 'button');
    question.setAttribute('aria-controls', answer.id); question.setAttribute('aria-expanded', 'false');
    const toggle = () => { const expanded = item.classList.toggle('active'); question.setAttribute('aria-expanded', String(expanded)); };
    question.onclick = toggle;
    question.onkeydown = event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); toggle(); } };
  });
  const form = document.querySelector('.contact-form');
  if (form) form.onsubmit = event => {
    event.preventDefault();
    showError(form, new DataError('UNSUPPORTED', 'Աջակցության ուղարկումը դեռ հասանելի չէ։ Ձեր հաղորդագրությունը չի ուղարկվել։'));
  };
});
