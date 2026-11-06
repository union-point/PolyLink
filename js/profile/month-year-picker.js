const firstYear = 1900;
const lastYear = 2200;
const months = ['հունվար', 'փետրվար', 'մարտ', 'ապրիլ', 'մայիս', 'հունիս', 'հուլիս', 'օգոստոս', 'սեպտեմբեր', 'հոկտեմբեր', 'նոյեմբեր', 'դեկտեմբեր'];
const chevron = direction => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="${direction === 'previous' ? 'm14 6-6 6 6 6' : 'm10 6 6 6-6 6'}"/></svg>`;
let sequence = 0;

/** Calendar periods stay as strings: no local timezone or day conversion. */
export function createMonthYearPicker({ name, value = '', label, preservePrecision = true }) {
  let selected = value || '';
  if (!preservePrecision && selected.length > 7) selected = selected.slice(0, 7);
  let year = Math.min(lastYear, Math.max(firstYear, Number(selected.slice(0, 4)) || new Date().getFullYear()));
  let yearView = false;
  let pageStart;
  const root = document.createElement('div'); root.className = 'profile-month-picker';
  const input = document.createElement('input');
  input.type = 'text'; input.name = name; input.id = `profile-period-${++sequence}`;
  input.readOnly = true; input.className = 'profile-form-control profile-month-value';
  input.placeholder = 'Ընտրեք ամիսը և տարին';
  input.setAttribute('role', 'combobox'); input.setAttribute('aria-readonly', 'true');
  input.setAttribute('aria-expanded', 'false'); input.setAttribute('aria-haspopup', 'dialog');
  const icon = document.createElement('span'); icon.className = 'profile-month-icon'; icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M16 3v4M8 3v4M3 11h18M8 15h2m4 0h2"/></svg>';
  const panel = document.createElement('div'); panel.className = 'profile-month-panel'; panel.hidden = true;
  panel.id = `${input.id}-panel`; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', `${label}՝ ամիս և տարի`);
  input.setAttribute('aria-controls', panel.id);
  const header = document.createElement('div'); header.className = 'profile-month-header';
  const button = (text, className, action) => {
    const el = document.createElement('button'); el.type = 'button'; el.className = className; el.textContent = text; el.onclick = action; return el;
  };
  const previous = button('', 'profile-month-nav', () => navigate(-1));
  const next = button('', 'profile-month-nav', () => navigate(1));
  previous.innerHTML = chevron('previous'); next.innerHTML = chevron('next');
  const heading = button('', 'profile-month-year', () => { yearView = !yearView; pageStart = Math.max(firstYear, Math.floor(year / 12) * 12); render(); focusChoice(); });
  const grid = document.createElement('div'); grid.className = 'profile-month-grid';
  grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', 'Ամիս');
  const footer = document.createElement('div'); footer.className = 'profile-month-footer';
  const today = button('Այս ամիս', '', () => choose(new Date().getFullYear(), new Date().getMonth()));
  const clear = button('Մաքրել', '', () => { selected = ''; update(); close(true); });
  footer.append(today, clear); header.append(previous, heading, next); panel.append(header, grid, footer); root.append(input, icon, panel);

  function update() {
    const [selectedYear, selectedMonth] = selected.split('-');
    input.value = selectedMonth ? `${months[Number(selectedMonth) - 1]} ${selectedYear}` : selectedYear || '';
    clear.disabled = !selected;
    input.removeAttribute('aria-invalid'); input.classList.remove('error'); input.removeAttribute('title');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function choose(selectedYear, month) {
    selected = `${selectedYear}-${String(month + 1).padStart(2, '0')}`;
    year = selectedYear; update(); close(true);
  }
  function close(focus = false) {
    panel.hidden = true; input.setAttribute('aria-expanded', 'false');
    if (focus) input.focus();
  }
  function focusChoice() {
    (grid.querySelector('[aria-pressed="true"]') || grid.children[0])?.focus();
  }
  function render() {
    heading.textContent = yearView ? `${pageStart}–${Math.min(lastYear, pageStart + 11)}` : String(year);
    heading.setAttribute('aria-label', yearView ? 'Ընտրել ամիսը' : `${year}՝ ընտրել տարին`);
    previous.setAttribute('aria-label', yearView ? 'Նախորդ տարիները' : 'Նախորդ տարի');
    next.setAttribute('aria-label', yearView ? 'Հաջորդ տարիները' : 'Հաջորդ տարի');
    previous.disabled = yearView ? pageStart <= firstYear : year <= firstYear;
    next.disabled = yearView ? pageStart + 11 >= lastYear : year >= lastYear;
    grid.setAttribute('aria-label', yearView ? 'Տարի' : 'Ամիս');
    const choices = yearView ? Array.from({ length: Math.min(12, lastYear - pageStart + 1) }, (_, i) => pageStart + i) : months;
    grid.replaceChildren(...choices.map((text, index) => {
      const choice = button(String(text), 'profile-month-choice', () => {
        if (yearView) { year = text; yearView = false; render(); focusChoice(); }
        else choose(year, index);
      });
      choice.dataset.index = index;
      choice.setAttribute('aria-pressed', String(yearView ? Number(selected.slice(0, 4)) === text : selected.slice(0, 7) === `${year}-${String(index + 1).padStart(2, '0')}`));
      if (!yearView) choice.setAttribute('aria-label', `${text} ${year}`);
      return choice;
    }));
  }
  function navigate(direction) {
    if (yearView) pageStart = Math.max(firstYear, Math.min(lastYear - 11, pageStart + direction * 12));
    else year = Math.max(firstYear, Math.min(lastYear, year + direction));
    render();
  }
  function open() {
    if (input.disabled) return;
    year = Math.min(lastYear, Math.max(firstYear, Number(selected.slice(0, 4)) || new Date().getFullYear()));
    yearView = false; render(); panel.hidden = false; input.setAttribute('aria-expanded', 'true'); focusChoice();
  }
  input.onclick = () => panel.hidden ? open() : close();
  input.onkeydown = event => {
    if (['Enter', ' ', 'ArrowDown'].includes(event.key)) { event.preventDefault(); open(); }
  };
  root.addEventListener('keydown', event => {
    if (panel.hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return; }
    if (event.key === 'PageUp' || event.key === 'PageDown') { event.preventDefault(); navigate(event.key === 'PageUp' ? -1 : 1); focusChoice(); return; }
    const index = Number(event.target.dataset.index);
    if (!Number.isInteger(index)) return;
    const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 };
    let target = index + offsets[event.key];
    if (event.key === 'Home') target = 0;
    if (event.key === 'End') target = grid.children.length - 1;
    if (!Number.isFinite(target)) return;
    event.preventDefault(); grid.children[Math.max(0, Math.min(grid.children.length - 1, target))].focus();
  });
  root.addEventListener('focusout', event => {
    if (event.relatedTarget) { if (!root.contains(event.relatedTarget)) close(); }
    else setTimeout(() => { if (!root.contains(document.activeElement)) close(); }, 0);
  });
  update();
  return { root, el: input, get: () => selected || null, setDisabled(disabled) { input.disabled = disabled; if (disabled) close(); } };
}
