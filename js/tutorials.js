import { bootstrap, start, notify } from './shared/ui.js';

start(async () => {
  await bootstrap({ protectedPage: false, showNotifications: true });
  const buttons = [...document.querySelectorAll('.filter-btn')];
  const categories = [...document.querySelectorAll('.tutorial-category')];
  buttons.forEach(button => {
    button.setAttribute('aria-pressed', String(button.classList.contains('active')));
    button.onclick = () => {
      buttons.forEach(item => { const active = item === button; item.classList.toggle('active', active); item.setAttribute('aria-pressed', String(active)); });
      categories.forEach(item => item.classList.toggle('hidden', button.dataset.category !== 'all' && item.dataset.category !== button.dataset.category));
    };
  });
  document.querySelectorAll('.tutorial-card').forEach(card => {
    card.tabIndex = 0; card.setAttribute('role', 'button'); card.setAttribute('aria-label', card.querySelector('h3').textContent);
    const unavailable = () => notify('Այս ուղեցույցի տեսանյութը դեռ հասանելի չէ։');
    card.onclick = unavailable;
    card.onkeydown = event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); unavailable(); } };
  });
});
