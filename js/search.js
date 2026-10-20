import { openDirectWithUnblock } from './chat/direct-contact.js';
import { search, chat } from './services/index.js';
import { bootstrap, start, stateMessage, pending, confirmAction } from './shared/ui.js';
import { escapeHtml as e } from './shared/content.js';

start(async () => {
  const currentUser = await bootstrap(); if (!currentUser) return;
  const list = document.querySelector('.graduates'), query = document.querySelector('.search-bar input');
  const specialization = document.getElementById('faculty'), year = document.getElementById('year'), institute = document.getElementById('institute');
  let generation = 0;
  let debounce;
  const selected = element => element.selectedIndex === 0 ? '' : element.value.trim();
  async function load() {
    const current = ++generation; stateMessage(list, 'Բեռնվում է...');
    try {
      const people = await search.people({ q: query.value, specialization: selected(specialization), year: selected(year), institute: selected(institute) });
      if (current !== generation) return;
      if (!people.length) { stateMessage(list, 'Օգտատերեր չեն գտնվել'); return; }
      list.innerHTML = people.map(user => `<div class="card" data-user-id="${e(user.id)}"><div class="letter">${e(user.name.slice(0, 1))}</div><h3>${e(user.name)}</h3>
        <p><strong>Մասնագիտություն՝</strong> ${e(user.specialization)} ${user.graduationYear ? `(${e(user.graduationYear)})` : ''}</p><p><strong>Ինստիտուտ՝</strong> ${e(user.institute || user.department || '')}</p><p>${e(user.jobTitle)}</p>
        <div class="card-buttons"><button class="btn-view">Դիտել էջը</button><button class="btn-connect" ${user.id === currentUser.id ? 'disabled' : ''}>Կապ հաստատել</button></div></div>`).join('');
    } catch (error) { if (current === generation) stateMessage(list, error.message, { retry: load }); }
  }
  query.setAttribute('aria-label', 'Որոնել օգտատերերին');
  query.oninput = () => { clearTimeout(debounce); debounce = setTimeout(load, 200); };
  query.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); clearTimeout(debounce); load(); } };
  document.querySelector('.search-bar button').onclick = () => { clearTimeout(debounce); load(); };
  [specialization, year, institute].forEach(element => { element.onchange = load; });
  list.onclick = event => {
    const button = event.target.closest('.btn-view,.btn-connect'); if (!button) return;
    const id = button.closest('.card').dataset.userId;
    if (button.classList.contains('btn-view')) location.href = `user.html?id=${encodeURIComponent(id)}`;
    else pending(button, button.closest('.card'), async () => { const room = await openDirectWithUnblock(chat, id, confirmAction); if (room) location.href = `message.html?room=${encodeURIComponent(room.id)}`; });
  };
  await load();
});
