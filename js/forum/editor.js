import { escapeHtml, sanitizeHtml, safeUrl } from '../shared/content.js';
import { DataError } from '../data/errors.js';

export function createEditor(host, { value = '', label = 'Բովանդակություն', sanitize = sanitizeHtml, compact = false } = {}) {
  const root = document.createElement('div'); root.className = 'forum-editor';
  root.innerHTML = `<div class="forum-toolbar" role="toolbar" aria-label="Ձևաչափում"><button type="button" data-command="bold" aria-label="Թավ"><strong>B</strong></button><button type="button" data-command="italic" aria-label="Շեղ"><em>I</em></button><button type="button" data-link aria-label="Հղում">Հղում</button></div><div class="forum-richtext" contenteditable="true" role="textbox" aria-multiline="true" data-name="content" aria-label="${escapeHtml(label)}"></div><div class="forum-link" hidden><label>Հղում <input type="url" placeholder="https://example.org" aria-label="Հղման հասցե"></label><button type="button" data-apply-link>Ավելացնել հղումը</button></div><p class="forum-editor-hint">Առավելագույնը 20000 նիշ։ Առանց կցորդների։</p>`;
  if (compact) {
    root.classList.add('forum-editor-compact');
    root.querySelector('.forum-editor-hint').remove();
    root.querySelector('.forum-link').innerHTML = `<label>Հղում <input type="url" placeholder="https://example.org" aria-label="Հղման հասցե"></label><div class="posts-link-actions"><button type="button" data-dismiss-link>Չեղարկել</button><button type="button" data-apply-link>Ավելացնել</button></div>`;
    root.querySelector('.forum-link').setAttribute('role', 'dialog');
    root.querySelector('.forum-link').setAttribute('aria-label', 'Ավելացնել հղում');
    root.querySelector('[data-link]').innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m10 13 4-4m-6 7-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 1 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 1)"/></svg>';
    root.querySelector('[contenteditable]').dataset.placeholder = 'Ի՞նչ եք ցանկանում կիսվել…';
  }
  host.replaceChildren(root);
  const editor = root.querySelector('[contenteditable]'), links = root.querySelector('.forum-link'), url = links.querySelector('input');
  const linkButton = root.querySelector('[data-link]');
  const listeners = new AbortController();
  let range;
  function updateToolbar() {
    if (!compact) return;
    const selected = selection();
    if (selected) range = selected;
    root.querySelectorAll('[data-command]').forEach(button => button.setAttribute('aria-pressed', String(!!selected && document.queryCommandState(button.dataset.command))));
  }
  function closeLink({ focus = true } = {}) {
    links.hidden = true;
    linkButton.setAttribute('aria-expanded', 'false');
    url.setCustomValidity('');
    if (focus) linkButton.focus();
  }
  if (compact) {
    linkButton.setAttribute('aria-haspopup', 'dialog');
    linkButton.setAttribute('aria-expanded', 'false');
    document.addEventListener('selectionchange', updateToolbar, { signal: listeners.signal });
    document.addEventListener('pointerdown', event => {
      if (!links.hidden && !links.contains(event.target) && !linkButton.contains(event.target)) closeLink({ focus: false });
    }, { signal: listeners.signal });
    root.querySelector('[data-dismiss-link]').onclick = () => closeLink();
    links.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeLink(); }
      if (event.key === 'Enter' && event.target === url) { event.preventDefault(); root.querySelector('[data-apply-link]').click(); }
      if (event.key === 'Tab') {
        const controls = [...links.querySelectorAll('input,button')];
        if (event.shiftKey && event.target === controls[0]) { event.preventDefault(); controls.at(-1).focus(); }
        else if (!event.shiftKey && event.target === controls.at(-1)) { event.preventDefault(); controls[0].focus(); }
      }
    });
    // Capture Escape before the browser sends a cancel event to the parent dialog.
    root.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !links.hidden) { event.preventDefault(); event.stopPropagation(); closeLink(); }
    }, { capture: true });
    updateToolbar();
  }
  function selection() { const selected = window.getSelection(); return selected?.rangeCount && editor.contains(selected.anchorNode) && editor.contains(selected.focusNode) ? selected.getRangeAt(0).cloneRange() : null; }
  root.querySelectorAll('[data-command]').forEach(button => {
    button.onmousedown = event => event.preventDefault();
    button.onclick = () => { editor.focus(); document.execCommand(button.dataset.command, false); updateToolbar(); };
  });
  root.querySelector('[data-link]').onmousedown = () => { range = selection(); };
  linkButton.onclick = () => {
    if (!links.hidden) { closeLink(); return; }
    links.hidden = false;
    if (compact) {
      linkButton.setAttribute('aria-expanded', 'true');
      const node = range?.startContainer;
      const anchor = (node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement)?.closest('a');
      url.value = anchor && editor.contains(anchor) ? anchor.getAttribute('href') : '';
    }
    url.focus();
  };
  root.querySelector('[data-apply-link]').onclick = () => {
    const href = safeUrl(url.value);
    if (!href) { url.setCustomValidity('Օգտագործեք HTTP, HTTPS կամ mailto հղում։'); url.reportValidity(); return; }
    url.setCustomValidity(''); editor.focus();
    if (range && editor.contains(range.commonAncestorContainer)) { const selected = window.getSelection(); selected.removeAllRanges(); selected.addRange(range); }
    const selected = window.getSelection();
    if (selected?.isCollapsed) document.execCommand('insertHTML', false, `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${escapeHtml(href)}</a>`);
    else document.execCommand('createLink', false, href);
    if (!compact) editor.innerHTML = sanitize(editor.innerHTML);
    closeLink({ focus: false }); url.value = ''; updateToolbar();
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  };
  url.oninput = () => url.setCustomValidity('');
  editor.onpaste = event => {
    event.preventDefault();
    const html = event.clipboardData?.getData('text/html') || escapeHtml(event.clipboardData?.getData('text/plain') || '').replace(/\n/g,'<br>');
    document.execCommand('insertHTML', false, sanitize(html));
  };
  editor.ondrop = event => event.preventDefault();
  editor.innerHTML = sanitize(value);
  return {
    element: editor,
    destroy() { listeners.abort(); },
    get() { if (editor.innerHTML.length > 100000) throw new DataError('VALIDATION','Բովանդակությունը չափազանց երկար է։',{content:'Առավելագույնը 100000 նիշ HTML։'}); return sanitize(editor.innerHTML); },
    set(value) { editor.innerHTML = sanitize(value); },
    focus() { editor.focus(); },
  };
}
