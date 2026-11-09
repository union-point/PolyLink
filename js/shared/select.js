// Preserve native form values and validation behind a consistently styled listbox.
export function initializeSelects(container) {
  const controls = [];
  for (const select of container.querySelectorAll('select')) {
    const root = document.createElement('div');
    root.className = 'app-select';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'app-select-trigger';
    const valueText = document.createElement('span');
    valueText.className = 'app-select-value';
    trigger.append(valueText);
    trigger.id = `${select.id}-trigger`;
    trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-controls', `${select.id}-list`);
    trigger.setAttribute('aria-expanded', 'false');
    const label = container.querySelector(`label[for="${select.id}"]`);
    label.id ||= `${select.id}-label`;
    trigger.setAttribute('aria-labelledby', `${label.id} ${trigger.id}`);
    select.setAttribute('aria-labelledby', label.id);
    select.before(root);
    const list = document.createElement('div');
    list.id = `${select.id}-list`;
    list.className = 'app-select-list';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-labelledby', label.id);
    list.hidden = true;
    root.append(trigger, select, list);
    select.classList.add('app-select-native');
    select.setAttribute('aria-hidden', 'true');
    select.tabIndex = -1;
    let open = false, active = select.selectedIndex, search = '', searchedAt = 0;
    let options;
    function rebuild() {
      list.replaceChildren();
      options = [...select.options].map((option, index) => {
      const item = document.createElement('div');
      item.id = `${select.id}-option-${index}`;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-disabled', String(option.disabled));
      item.textContent = option.textContent;
      list.append(item);
      item.addEventListener('pointerdown', event => event.preventDefault());
      item.addEventListener('click', () => { if (!option.disabled) { active = index; choose(); } });
      return item;
      });
    }
    rebuild();
    function highlight(index) {
      active = index;
      options.forEach((item, i) => item.classList.toggle('is-active', i === active));
      trigger.setAttribute('aria-activedescendant', options[active]?.id || '');
      options[active]?.scrollIntoView({ block: 'nearest' });
    }
    function choose() {
      if (active < 0 || select.options[active].disabled) return;
      select.selectedIndex = active;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      close({ focus: true });
    }
    function close({ focus = false } = {}) {
      if (!open) return;
      open = false;
      root.classList.remove('is-open');
      list.hidden = true;
      trigger.removeAttribute('aria-activedescendant');
      trigger.setAttribute('aria-expanded', 'false');
      sync();
      if (focus) trigger.focus();
    }
    function sync() {
      valueText.textContent = select.selectedOptions[0]?.textContent || 'Ընտրեք…';
      if (trigger.disabled !== select.disabled) trigger.disabled = select.disabled;
      options.forEach((item, index) => item.setAttribute('aria-selected', String(index === select.selectedIndex)));
      trigger.classList.toggle('error', select.classList.contains('error'));
      for (const attribute of ['aria-invalid', 'title']) {
        if (select.hasAttribute(attribute)) {
          if (trigger.getAttribute(attribute) !== select.getAttribute(attribute)) trigger.setAttribute(attribute, select.getAttribute(attribute));
        }
        else trigger.removeAttribute(attribute);
      }
      trigger.setAttribute('aria-required', String(select.required));
      if (select.matches(':disabled') || select.closest('[hidden]')) close();
    }
    function show() {
      if (select.matches(':disabled')) return;
      controls.forEach(control => control.close());
      open = true;
      root.classList.add('is-open');
      list.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      // The list stays below the field; scroll the document rather than flip it.
      list.scrollIntoView({ block: 'nearest' });
      trigger.focus({ preventScroll: true });
      highlight(Math.max(0, select.selectedIndex));
    }
    trigger.addEventListener('click', () => open ? close() : show());
    trigger.addEventListener('keydown', event => {
      const key = event.key;
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) {
        event.preventDefault();
        if (!open) show();
        const enabled = [...select.options].map((option, index) => option.disabled ? -1 : index).filter(index => index >= 0);
        const position = enabled.indexOf(active);
        const next = key === 'Home' ? enabled[0] : key === 'End' ? enabled.at(-1)
          : enabled[Math.max(0, Math.min(enabled.length - 1, position + (key === 'ArrowDown' ? 1 : -1)))];
        if (next !== undefined) highlight(next);
      } else if (key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); close();
      } else if (key === 'Enter' || key === ' ') {
        event.preventDefault(); if (open) choose(); else show();
      } else if (key === 'Tab') close();
      else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && !event.isComposing) {
        event.preventDefault();
        if (!open) show();
        search = Date.now() - searchedAt > 700 ? key : search + key;
        searchedAt = Date.now();
        const matches = index => !select.options[index].disabled && select.options[index].textContent.toLocaleLowerCase('hy').startsWith(search.toLocaleLowerCase('hy'));
        const indices = options.map((_, index) => (active + 1 + index) % options.length);
        const found = indices.find(matches);
        if (found !== undefined) highlight(found);
      }
    });
    select.addEventListener('focus', () => { show(); });
    select.addEventListener('change', sync);
    root.addEventListener('focusout', event => { if (!root.contains(event.relatedTarget)) close(); });
    document.addEventListener('pointerdown', event => { if (!root.contains(event.target)) close(); });
    controls.push({ close, sync, refresh() { close(); rebuild(); sync(); } });
    sync();
  }
  // Reflect validation errors, role switches and the enclosing busy fieldset.
  new MutationObserver(() => controls.forEach(control => control.sync())).observe(container, {
    subtree: true, attributes: true,
    attributeFilter: ['disabled', 'required', 'hidden', 'aria-invalid', 'title'],
  });
  return () => controls.forEach(control => control.refresh());
}
