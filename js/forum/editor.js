import { escapeHtml, sanitizeHtml, safeUrl } from '../shared/content.js';
import { DataError } from '../data/errors.js';

export function createEditor(host, { value = '', label = 'Բովանդակություն' } = {}) {
  const root = document.createElement('div'); root.className = 'forum-editor';
  root.innerHTML = `<div class="forum-toolbar" role="toolbar" aria-label="Ձևաչափում"><button type="button" data-command="bold" aria-label="Թավ"><strong>B</strong></button><button type="button" data-command="italic" aria-label="Շեղ"><em>I</em></button><button type="button" data-link aria-label="Հղում">Հղում</button></div><div class="forum-richtext" contenteditable="true" role="textbox" aria-multiline="true" data-name="content" aria-label="${escapeHtml(label)}"></div><div class="forum-link" hidden><label>Հղում <input type="url" placeholder="https://example.org" aria-label="Հղման հասցե"></label><button type="button" data-apply-link>Ավելացնել հղումը</button></div><p class="forum-editor-hint">Առավելագույնը 20000 նիշ։ Առանց կցորդների։</p>`;
  host.replaceChildren(root);
  const editor = root.querySelector('[contenteditable]'), links = root.querySelector('.forum-link'), url = links.querySelector('input');
  let range;
  function selection() { const selected = window.getSelection(); return selected?.rangeCount && editor.contains(selected.anchorNode) && editor.contains(selected.focusNode) ? selected.getRangeAt(0).cloneRange() : null; }
  root.querySelectorAll('[data-command]').forEach(button => {
    button.onmousedown = event => event.preventDefault();
    button.onclick = () => { editor.focus(); document.execCommand(button.dataset.command, false); };
  });
  root.querySelector('[data-link]').onmousedown = () => { range = selection(); };
  root.querySelector('[data-link]').onclick = () => { links.hidden = !links.hidden; if (!links.hidden) url.focus(); };
  root.querySelector('[data-apply-link]').onclick = () => {
    const href = safeUrl(url.value);
    if (!href) { url.setCustomValidity('Օգտագործեք HTTP, HTTPS կամ mailto հղում։'); url.reportValidity(); return; }
    url.setCustomValidity(''); editor.focus();
    if (range && editor.contains(range.commonAncestorContainer)) { const selected = window.getSelection(); selected.removeAllRanges(); selected.addRange(range); }
    const selected = window.getSelection();
    if (selected?.isCollapsed) document.execCommand('insertHTML', false, `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${escapeHtml(href)}</a>`);
    else document.execCommand('createLink', false, href);
    editor.innerHTML = sanitizeHtml(editor.innerHTML); links.hidden = true; url.value = '';
  };
  url.oninput = () => url.setCustomValidity('');
  editor.onpaste = event => {
    event.preventDefault();
    const html = event.clipboardData?.getData('text/html') || escapeHtml(event.clipboardData?.getData('text/plain') || '').replace(/\n/g,'<br>');
    document.execCommand('insertHTML', false, sanitizeHtml(html));
  };
  editor.ondrop = event => event.preventDefault();
  editor.innerHTML = sanitizeHtml(value);
  return {
    element: editor,
    get() { if (editor.innerHTML.length > 100000) throw new DataError('VALIDATION','Բովանդակությունը չափազանց երկար է։',{content:'Առավելագույնը 100000 նիշ HTML։'}); return sanitizeHtml(editor.innerHTML); },
    set(value) { editor.innerHTML = sanitizeHtml(value); },
    focus() { editor.focus(); },
  };
}
