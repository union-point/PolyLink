import { showError } from '../shared/ui.js';
// ============================================
// MODAL CLASS
// ============================================

/**
 * Modal class for creating and managing modal dialogs
 */
class Modal {
  constructor() {
    this.modal = null;
    this.saving = false;
  }

  /**
   * Create a modal dialog
   * @param {string} title - Modal title
   * @param {HTMLElement} content - Modal content
   * @param {Function} onSave - Callback when save is clicked
   * @param {Object} options - Additional options
   */
  create(title, content, onSave, options = {}) {
    // Remove existing modal if any
    this.close();

    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 1000;
      animation: fadeIn 0.3s ease;
    `;

    // Create modal container
    const modal = document.createElement('div');
    modal.className = 'modal-container';
    modal.style.cssText = `
      background: var(--card-background);
      border-radius: 12px;
      padding: 24px;
      max-width: 600px;
      width: 90%;
      max-height: 80vh;
      overflow-y: auto;
      box-shadow: 0 1px 4px var(--font-color-primary);
      animation: slideUp 0.3s ease;
      color: var(--font-color-primary);
    `;

    // Modal header
    const header = this.createHeader(title);

    // Modal content
    const contentEl = document.createElement('div');
    contentEl.className = 'modal-content';
    contentEl.style.marginBottom = '20px';
    contentEl.appendChild(content);

    // Modal footer
    const footer = this.createFooter(contentEl, onSave, options);

    modal.appendChild(header);
    modal.appendChild(contentEl);
    modal.appendChild(footer);
    overlay.appendChild(modal);

    // Close on overlay click
    overlay.onclick = (e) => {
      if (e.target === overlay) {
        this.close();
      }
    };

    document.body.appendChild(overlay);
    this.modal = overlay;
    this.previousFocus = document.activeElement;
    modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', title);
    (contentEl.querySelector('input,select,textarea,[contenteditable]') || modal.querySelector('button'))?.focus();

    // Add animations
    this.addAnimations();

    // Setup formatting toolbar if provided
    if (options.setupFormatting) {
      options.setupFormatting(modal);
    }
  }

  /**
   * Create modal header
   * @param {string} title - Modal title
   * @returns {HTMLElement} Header element
   */
  createHeader(title) {
    const header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border-color);
    `;

    const titleEl = document.createElement('h2');
    titleEl.textContent = title;
    titleEl.style.cssText = `
      margin: 0;
      font-size: 24px;
      color: var(--font-color-primary);
    `;

    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '&times;';
    closeBtn.style.cssText = `
      background: none;
      border: none;
      font-size: 32px;
      cursor: pointer;
      color: var(--font-color-secondary);
      line-height: 1;
      padding: 0;
      width: 32px;
      height: 32px;
    `;
    closeBtn.onclick = () => this.close();

    header.appendChild(titleEl);
    header.appendChild(closeBtn);

    return header;
  }

  /**
   * Create modal footer
   * @param {HTMLElement} contentEl - Content element
   * @param {Function} onSave - Save callback
   * @param {Object} options - Additional options
   * @returns {HTMLElement} Footer element
   */
  createFooter(contentEl, onSave, options) {
    const footer = document.createElement('div');
    footer.className = 'modal-footer';
    footer.style.cssText = `
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      padding-top: 16px;
      border-top: 1px solid var(--border-color);
      align-items: center;
    `;

    // Add custom footer content if provided (e.g., formatting toolbar)
    if (options.customFooterLeft) {
      footer.style.justifyContent = 'space-between';
      footer.appendChild(options.customFooterLeft);
    }

    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = 'display: flex; gap: 12px;';

    const saveBtn = this.createButton('Պահպանել', 'primary-btn', async () => {
      if (this.saving) return;
      this.saving = true; saveBtn.disabled = true; saveBtn.setAttribute('aria-busy', 'true');
      try {
        const result = onSave ? await onSave(this.getFormData(contentEl)) : undefined;
        if (result !== false) { this.saving = false; this.close(); }
      } catch (error) { showError(contentEl, error); }
      finally { this.saving = false; saveBtn.disabled = false; saveBtn.removeAttribute('aria-busy'); }
    });

    const cancelBtn = this.createButton('Չեղարկել', 'secondary-btn', () => this.close());
    if (!onSave) saveBtn.hidden = true;

    buttonContainer.appendChild(cancelBtn);
    buttonContainer.appendChild(saveBtn);
    footer.appendChild(buttonContainer);

    return footer;
  }

  /**
   * Create a button
   * @param {string} text - Button text
   * @param {string} className - Button class
   * @param {Function} onClick - Click handler
   * @returns {HTMLElement} Button element
   */
  createButton(text, className, onClick) {
    const button = document.createElement('button');
    button.className = className;
    button.textContent = text;
    button.style.cssText = `
      padding: 10px 24px;
      border-radius: 20px;
      font-weight: 600;
      font-size: 14px;
    `;
    button.onclick = onClick;
    return button;
  }

  /**
   * Get form data from modal content
   * @param {HTMLElement} contentEl - Content element
   * @returns {Object} Form data
   */
  getFormData(contentEl) {
    const formData = {};
    const inputs = contentEl.querySelectorAll('input, textarea, select');
    inputs.forEach(input => {
      formData[input.name || input.id] = input.value;
    });
    // Handle contenteditable elements
    const editables = contentEl.querySelectorAll('[contenteditable="true"]');
    editables.forEach(editable => {
      formData[editable.dataset.name || editable.id] = editable.innerHTML;
    });
    return formData;
  }

  /**
   * Close the modal
   */
  close() {
    if (this.saving) return;
    if (this.modal) {
      this.modal.remove();
      this.modal = null;
      this.previousFocus?.focus();
    }
  }

  /**
   * Add modal animations to document
   */
  addAnimations() {
    if (document.querySelector('style[data-modal-animations]')) return;

    const style = document.createElement('style');
    style.textContent = `
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes slideUp {
        from {
          transform: translateY(50px);
          opacity: 0;
        }
        to {
          transform: translateY(0);
          opacity: 1;
        }
      }
    `;
    style.setAttribute('data-modal-animations', 'true');
    document.head.appendChild(style);
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
