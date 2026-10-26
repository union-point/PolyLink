import { openDirectWithUnblock } from './chat/direct-contact.js';
import { search, chat } from './services/index.js';
import { bootstrap, start, stateMessage, pending, confirmAction } from './shared/ui.js';
import { escapeHtml as e } from './shared/content.js';

export function educationHtml(records) {
  const record = entry => `<div class="search-education"><p>${e([entry.institution, entry.degree].filter(Boolean).join(' · '))}</p><p>${e([entry.specialization, entry.institute].filter(Boolean).join(' · '))}</p><p>${e([entry.startDate, entry.endDate].filter(Boolean).join(' — '))}</p></div>`;
  if (!records.length) return '<p>Կրթությունը նշված չէ</p>';
  return record(records[0]) + (records.length > 1 ? `<details><summary>Եվս ${records.length - 1}</summary>${records.slice(1).map(record).join('')}</details>` : '');
}

start(async () => {
  const currentUser = await bootstrap(); if (!currentUser) return;
  const list = document.querySelector('.graduates'), query = document.querySelector('.search-bar input');
  const specialization = document.getElementById('faculty'), year = document.getElementById('year'), institute = document.getElementById('institute');
  const status = document.getElementById('search-status'), filterStatus = document.getElementById('filter-status'), more = document.getElementById('search-more');
  let generation = 0, debounce, cursor = null, loading = false, activeFilters;
  const people = new Map();
  const filters = () => ({ q: query.value, specializationId: specialization.value || undefined, year: year.value || undefined, instituteId: institute.value || undefined, limit: 50 });
  const card = user => `<div class="card" data-user-id="${e(user.id)}"><div class="letter">${e(user.name.slice(0, 1))}</div><h3>${e(user.name)}</h3>${educationHtml(user.matchedEducation)}<p>${e(user.jobTitle || 'Պաշտոնը նշված չէ')}</p><div class="card-buttons"><button class="btn-view" ${!user.canOpenProfile && user.id !== currentUser.id ? 'disabled title="Պրոֆիլը փակ է"' : ''}>Դիտել էջը</button><button class="btn-connect" ${user.id === currentUser.id ? 'disabled' : ''}>Կապ հաստատել</button></div></div>`;
  async function load(append = false) {
    if (loading || append && !cursor) return;
    const current = generation;
    loading = true; more.disabled = true; list.setAttribute('aria-busy', 'true'); status.replaceChildren();
    if (!append) stateMessage(list, 'Բեռնվում է...');
    try {
      const page = await search.page({ ...activeFilters, ...(append ? { cursor } : {}) });
      if (current !== generation) return;
      if (!append) list.replaceChildren();
      for (const user of page.items) if (!people.has(user.id)) { people.set(user.id, user); list.insertAdjacentHTML('beforeend', card(user)); }
      cursor = page.nextCursor; more.hidden = !page.hasMore;
      if (!people.size) stateMessage(list, 'Օգտատերեր չեն գտնվել');
      else if (!page.hasMore) status.textContent = 'Ցուցակի ավարտը';
    } catch (error) {
      if (current === generation) {
        more.hidden = true;
        stateMessage(append ? status : list, error.message, { retry: () => load(append) });
      }
    } finally {
      if (current === generation) { loading = false; more.disabled = false; list.setAttribute('aria-busy', 'false'); }
    }
  }
  function reset(delay = 0) {
    clearTimeout(debounce); ++generation; loading = false; cursor = null; people.clear();
    activeFilters = filters(); more.hidden = true; status.replaceChildren(); list.replaceChildren();
    debounce = setTimeout(() => load(), delay);
  }
  async function loadFilters() {
    [specialization, year, institute].forEach(element => { element.disabled = true; });
    stateMessage(filterStatus, 'Բեռնվում են զտիչները...');
    try {
      const values = await search.filters();
      for (const [element, options] of [[specialization, values.specializations], [institute, values.institutes], [year, values.years.map(value => ({ id: value, label: value }))]]) {
        element.replaceChildren(new Option('Բոլորը', ''));
        for (const option of options) element.add(new Option(option.label, option.id));
        element.disabled = false;
      }
      filterStatus.replaceChildren();
    } catch (error) { stateMessage(filterStatus, error.message, { retry: loadFilters }); }
  }
  query.setAttribute('aria-label', 'Որոնել օգտատերերին'); query.maxLength = 100;
  query.oninput = () => reset(200);
  query.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); reset(); } };
  document.querySelector('.search-bar button').onclick = () => reset();
  [specialization, year, institute].forEach(element => { element.onchange = () => reset(); });
  more.onclick = () => load(true);
  list.onclick = event => {
    const button = event.target.closest('.btn-view,.btn-connect'); if (!button || button.disabled) return;
    const id = button.closest('.card').dataset.userId, user = people.get(id);
    if (!user) return;
    if (button.classList.contains('btn-view')) {
      if (!user.canOpenProfile && id !== currentUser.id) return;
      location.href = `user.html?id=${encodeURIComponent(id)}`;
    } else if (id !== currentUser.id) pending(button, button.closest('.card'), async () => { const room = await openDirectWithUnblock(chat, id, confirmAction); if (room) location.href = `message.html?room=${encodeURIComponent(room.id)}`; });
  };
  activeFilters = filters();
  await Promise.all([loadFilters(), load()]);
});
