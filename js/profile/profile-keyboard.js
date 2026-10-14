export function initializeKeyboardNavigation(editor) {
  const main = document.querySelector('.main-content'); main.id = 'main-content'; main.tabIndex = -1;
  if (!document.querySelector('.skip-link')) {
    const skip = document.createElement('a'); skip.className = 'skip-link'; skip.href = '#main-content'; skip.textContent = 'Անցնել հիմնական բովանդակությանը';
    skip.style.cssText = 'position:absolute;left:16px;top:-60px;z-index:10000;padding:12px;background:white;color:#17339c';
    skip.onfocus = () => { skip.style.top = '8px'; }; skip.onblur = () => { skip.style.top = '-60px'; }; document.body.prepend(skip);
  }
  document.querySelectorAll('.edit-icon,.banner-edit-icon,.profile-photo-area > .profile-photo').forEach(element => {
    element.tabIndex = 0; element.setAttribute('role', 'button');
    if (!element.hasAttribute('aria-label')) element.setAttribute('aria-label', element.classList.contains('fa-plus') ? 'Ավելացնել' : element.classList.contains('banner-edit-icon') ? 'Փոխել բանների նկարը' : element.classList.contains('edit-icon') ? 'Փոփոխել' : 'Փոխել պրոֆիլի նկարը');
  });
  document.addEventListener('keydown', event => {
    const modal = document.querySelector('.modal-overlay');
    const dialog = document.querySelector('#custom-confirm-backdrop:not(.hidden)');
    if (dialog) return;
    if (modal) {
      const buttons = [...modal.querySelectorAll('button,input,select,textarea,[contenteditable]')].filter(element => !element.disabled);
      if (event.key === 'Escape') { event.preventDefault(); modal.click(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); modal.querySelector('.modal-footer .primary-btn')?.click(); }
      if (event.key === 'Tab') {
        const first = buttons[0], last = buttons.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey) {
      const key = event.key.toLowerCase();
      if (['s','e','n'].includes(key)) event.preventDefault();
      if (key === 's' && editor.isEditing) editor.save();
      if (key === 'e') editor.startEditing();
      if (key === 'n' && !editor.isEditing) editor.onAdd?.();
    }
    if (event.key === 'Escape' && editor.isEditing) editor.cancel();
    if (event.key === 'Enter' && !event.shiftKey && editor.isEditing && event.target.isContentEditable) { event.preventDefault(); editor.save(); }
    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('.edit-icon,[role="button"]') && event.target.tagName !== 'BUTTON') { event.preventDefault(); event.target.click(); }
    if (['ArrowDown','ArrowUp','ArrowLeft','ArrowRight'].includes(event.key) && !event.target.matches('input,textarea,[contenteditable="true"]')) {
      const section = event.target.closest(['ArrowLeft','ArrowRight'].includes(event.key) ? '.item-entry,.action-buttons' : '.profile-section');
      if (!section) return;
      const actions = [...section.querySelectorAll('button,[role="button"]')];
      const index = actions.indexOf(event.target), delta = ['ArrowDown','ArrowRight'].includes(event.key) ? 1 : -1;
      if (index >= 0 && actions[index + delta]) { event.preventDefault(); actions[index + delta].focus(); }
    }
  });
}
