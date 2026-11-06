import { showError, confirmAction } from '../shared/ui.js';

let modalSequence = 0;

/** Shared profile dialog shell. Only the form body scrolls; actions stay reachable. */
class Modal {
  constructor() {
    this.modal = null;
    this.saving = false;
    this.closing = false;
    window.addEventListener('beforeunload', event => {
      if (this.modal && this.dirty) { event.preventDefault(); event.returnValue = ''; }
    });
  }

  create(title, content, onSave, options = {}) {
    if (this.saving) return;
    this.close(true);
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay profile-modal-overlay';
    const dialog = document.createElement('div');
    dialog.className = 'modal-container profile-modal';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', title);
    const headingId = `profile-modal-title-${++modalSequence}`;
    const header = document.createElement('header');
    header.className = 'profile-modal-header';
    if (options.icon) {
      const badge = document.createElement('span');
      badge.className = 'profile-modal-badge';
      badge.setAttribute('aria-hidden', 'true');
      badge.innerHTML = options.icon === 'education'
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m3 8 9-4 9 4-9 4-9-4Z"/><path d="M6 10v6c3 3 9 3 12 0v-6M21 8v7"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="3" width="16" height="14" rx="2"/><path d="M8 7h8M8 11h5M8 17v4l4-2 4 2v-4"/></svg>';
      header.append(badge);
    }
    const heading = document.createElement('div');
    heading.className = 'profile-modal-heading';
    const titleEl = document.createElement('h2');
    titleEl.id = headingId; titleEl.textContent = title; heading.append(titleEl);
    dialog.setAttribute('aria-labelledby', headingId);
    if (options.description) {
      const description = document.createElement('p');
      description.id = `${headingId}-description`; description.textContent = options.description;
      heading.append(description); dialog.setAttribute('aria-describedby', description.id);
    }
    const close = document.createElement('button');
    close.type = 'button'; close.className = 'profile-modal-close';
    close.setAttribute('aria-label', 'Փակել'); close.title = 'Փակել';
    close.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
    close.onclick = () => this.close(); header.append(heading, close);
    const body = document.createElement('div');
    body.className = 'modal-content profile-modal-body'; body.append(content);
    const footer = document.createElement('footer'); footer.className = 'modal-footer profile-modal-footer';
    if (options.customFooterLeft) footer.append(options.customFooterLeft);
    const cancel = this.createButton('Չեղարկել', 'secondary-btn', () => this.close());
    const save = this.createButton('Պահպանել', 'primary-btn', async () => {
      if (this.saving || !this.ready || !onSave) return;
      for (const control of body.querySelectorAll('input,select,textarea')) {
        if (!control.reportValidity()) return;
      }
      const data = this.getFormData(body);
      this.saving = true; save.setAttribute('aria-busy', 'true'); save.textContent = 'Պահպանվում է…';
      const controls = [...dialog.querySelectorAll('button,input,select,textarea,[contenteditable="true"]')];
      const previous = controls.map(control => ({ control, disabled: control.disabled, editable: control.getAttribute('contenteditable') }));
      controls.forEach(control => { control.disabled = true; if (control.isContentEditable) control.contentEditable = 'false'; });
      try {
        const result = await onSave(data);
        if (result !== false) { this.saving = false; this.close(true); }
      } catch (error) {
        showError(body, error);
        const invalid = body.querySelector('[aria-invalid="true"]');
        (invalid || body.querySelector('[role="alert"]'))?.scrollIntoView({ block: 'nearest' });
      } finally {
        this.saving = false;
        previous.forEach(({ control, disabled, editable }) => { control.disabled = disabled; if (editable !== null) control.setAttribute('contenteditable', editable); });
        save.removeAttribute('aria-busy'); save.textContent = 'Պահպանել';
        if (this.modal === overlay) (body.querySelector('[aria-invalid="true"]') || save).focus();
      }
    });
    this.saveButton = save; this.ready = !options.loading;
    save.hidden = !onSave; save.disabled = !!options.loading;
    footer.append(cancel, save); dialog.append(header, body, footer); overlay.append(dialog);
    overlay.onclick = event => { if (event.target === overlay) this.close(); };
    this.dirty = false; this.closing = false;
    body.addEventListener('input', event => { if (!event.target.matches('[data-profile-search]')) this.dirty = true; });
    body.addEventListener('change', event => { if (!event.target.matches('[data-profile-search]')) this.dirty = true; });
    this.previousFocus = document.activeElement;
    document.body.append(overlay); this.modal = overlay;
    this.previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const focusable = () => [...dialog.querySelectorAll('button,input,select,textarea,[contenteditable="true"]')]
      .filter(element => !element.disabled && !element.hidden && element.getClientRects().length);
    overlay.addEventListener('keydown', event => {
      if (this.closing) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); event.stopPropagation(); save.click(); }
      if (event.key === 'Tab') {
        const elements = focusable(), first = elements[0], last = elements.at(-1);
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    });
    (focusable().find(element => body.contains(element)) || close).focus();
    options.setupFormatting?.(dialog);
    return overlay;
  }

  setReady(ready) {
    this.ready = ready;
    if (this.saveButton) this.saveButton.disabled = !ready;
  }

  createButton(text, className, action) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = className; button.textContent = text; button.onclick = action;
    return button;
  }

  getFormData(content) {
    const data = {};
    content.querySelectorAll('input,textarea,select').forEach(input => {
      if (input.name || input.id) data[input.name || input.id] = input.type === 'checkbox' ? input.checked : input.value;
    });
    content.querySelectorAll('[contenteditable="true"]').forEach(editable => { data[editable.dataset.name || editable.id] = editable.innerHTML; });
    return data;
  }

  async close(force = false) {
    if (this.saving || (this.closing && !force)) return;
    const overlay = this.modal;
    if (!overlay) return;
    this.closing = true;
    try {
      if (!force && this.dirty && !await confirmAction('Չպահպանված փոփոխությունները չեղարկե՞լ։')) return;
      if (this.modal !== overlay) return;
      this.modal.remove(); this.modal = null; this.dirty = false;
      document.body.style.overflow = this.previousOverflow;
      this.previousFocus?.focus();
    } finally { this.closing = false; }
  }
}

/**
 * Create formatting toolbar for text editing
 * @returns {HTMLElement} Toolbar element
 */
function createFormattingToolbar() {
  const toolbar = document.createElement('div');
  toolbar.className = 'post-formatting-toolbar';
  toolbar.style.cssText = 'display: flex; gap: 10px;';
  toolbar.innerHTML = `
    <button type="button" class="format-btn bold-btn" title="Թավ" data-command="bold">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M15.6 10.79c.97-.67 1.65-1.77 1.65-2.79 0-2.26-1.75-4-4-4H7v14h7.04c2.09 0 3.71-1.7 3.71-3.79 0-1.52-.86-2.82-2.15-3.42zM10 6.5h3c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h-3v-3zm3.5 9H10v-3h3.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5z" />
      </svg>
    </button>
    <button type="button" class="format-btn italic-btn" title="Շեղ" data-command="italic">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M10 4v3h2.21l-3.42 8H6v3h8v-3h-2.21l3.42-8H18V4z" />
      </svg>
    </button>
  `;
  return toolbar;
}

/**
 * Setup formatting functionality for a modal
 * @param {HTMLElement} modalElement - Modal element
 * @param {string} editorSelector - Selector for the editor element
 */
function setupFormattingHandlers(modalElement, editorSelector = '#announcement-content') {
  const editor = modalElement.querySelector(editorSelector);
  const buttons = modalElement.querySelectorAll('.format-btn');

  // Add placeholder styling
  addFormattingStyles();

  function applyCommand(cmd) {
    editor.focus();
    document.execCommand(cmd, false, null);
    updateActiveButtons();
  }

  function updateActiveButtons() {
    buttons.forEach(btn => {
      const cmd = btn.dataset.command;
      btn.classList.toggle('active', document.queryCommandState(cmd));
    });
  }

  buttons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      applyCommand(btn.dataset.command);
    });
  });

  if (editor) {
    editor.addEventListener('keyup', updateActiveButtons);
    editor.addEventListener('mouseup', updateActiveButtons);
  }
}

/**
 * Add formatting styles to document
 */
function addFormattingStyles() {
  if (document.querySelector('style[data-formatting-styles]')) return;

  const style = document.createElement('style');
  style.textContent = `
    #announcement-content:empty:before {
      content: attr(data-placeholder);
      color: var(--font-color-secondary);
      pointer-events: none;
    }
    .format-btn {
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 2px solid var(--border-color);
      background: var(--card-background);
      border-radius: 8px;
      color: var(--font-color-secondary);
      cursor: pointer;
      transition: all 0.3s ease;
    }
    .format-btn:hover {
      border-color: var(--primary-blue);
      color: var(--primary-blue);
    }
    .format-btn.active {
      border-color: var(--primary-blue);
      color: var(--primary-blue);
      background: var(--window-background);
    }
  `;
  style.setAttribute('data-formatting-styles', 'true');
  document.head.appendChild(style);
}
export { Modal, createFormattingToolbar, setupFormattingHandlers };
