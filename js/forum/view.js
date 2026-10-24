import { escapeHtml as e, safeUrl, sanitizeHtml } from '../shared/content.js';
import { pending, confirmAction, stateMessage } from '../shared/ui.js';
import { createEditor } from './editor.js';

export const authorHtml = author => author.canOpenProfile && author.id !== null ? `<a href="user.html?id=${encodeURIComponent(author.id)}">${e(author.name)}</a>` : e(author.name);
export const avatarUrl = author => e(safeUrl(author.avatar || 'image/logo.png', {image:true}));
export function categoryOptions(select, categories, { all = false, selected = '' } = {}) {
  select.replaceChildren();
  const option = new Option(all ? 'Բոլոր կատեգորիաները' : 'Ընտրեք կատեգորիան', ''); option.disabled = !all; select.add(option);
  for (const category of categories) select.add(new Option(category.name, category.code));
  select.value = selected;
}

export function paginatedList(host, load, render) {
  const controls = document.createElement('div'); controls.className = 'forum-page-controls';
  controls.innerHTML = '<button type="button" data-refresh>Թարմացնել</button><button type="button" data-more hidden>Բեռնել ավելին</button><p role="status" data-page-status></p>';
  host.after(controls);
  const more = controls.querySelector('[data-more]'), refresh = controls.querySelector('[data-refresh]'), status = controls.querySelector('[data-page-status]');
  let generation = 0, cursor = null, records = new Map(), busy = false;
  async function run(reset) {
    if (!reset && (busy || !cursor)) return;
    const current = ++generation;
    if (reset) { cursor = null; records = new Map(); }
    busy = true; more.disabled = true; status.setAttribute('role','status'); status.textContent = 'Բեռնվում է...';
    try {
      const page = await load(reset ? null : cursor);
      if (current !== generation) return;
      for (const item of page.items) records.set(item.id,item);
      cursor = page.nextCursor; more.hidden = !cursor;
      if (records.size) render([...records.values()]); else stateMessage(host,'Տվյալներ չկան։');
      status.textContent = '';
      return [...records.values()];
    } catch (error) {
      if (current === generation) { status.textContent = error.message; status.setAttribute('role','alert'); more.hidden = !cursor; }
    } finally { if (current === generation) { busy = false; more.disabled = false; } }
  }
  refresh.onclick = () => run(true); more.onclick = () => run(false);
  return { refresh: () => run(true), get: id => records.get(id), items: () => [...records.values()], replace(item) { if(records.has(item.id)){records.set(item.id,item);render([...records.values()]);} }, controls };
}

export function editDiscussion({ item, categories, topic = false, save, latest, onSaved }) {
  const dialog = document.createElement('dialog'); dialog.className = 'forum-edit-dialog'; dialog.dataset.forumEdit = '';
  dialog.innerHTML = `<form><h2>Խմբագրել ${topic ? 'թեման' : 'պատասխանը'}</h2>${topic ? '<label>Վերնագիր<input name="title" maxlength="255" required></label><label>Կատեգորիա<select name="categoryCode" required></select></label>' : ''}<div data-editor></div><div class="forum-edit-actions"><button type="submit" data-save>Պահպանել</button><button type="button" data-cancel>Չեղարկել</button></div><div data-conflict hidden><p>Ձեր սևագիրը պահպանված է։ Համեմատեք վերջին տարբերակի հետ։</p><button type="button" data-reload-latest>Բեռնել վերջին տարբերակը</button><section data-latest hidden></section></div></form>`;
  document.body.appendChild(dialog);
  const form = dialog.querySelector('form'), editor = createEditor(dialog.querySelector('[data-editor]'),{value:item.content}), conflict = dialog.querySelector('[data-conflict]'), latestPanel = dialog.querySelector('[data-latest]');
  let expectedVersion = item.version;
  if (topic) { form.elements.title.value = item.title; categoryOptions(form.elements.categoryCode,categories,{selected:item.categoryCode}); }
  const close = () => { dialog.close(); dialog.remove(); };
  dialog.querySelector('[data-cancel]').onclick = close;
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  form.onsubmit = event => {
    event.preventDefault();
    pending(form.querySelector('[data-save]'), form, async () => {
      const data = {content:editor.get(),expectedVersion};
      if(topic)Object.assign(data,{title:form.elements.title.value,categoryCode:form.elements.categoryCode.value});
      let saved;
      try { saved = await save(data); }
      catch(error) { if(error.code==='EDIT_CONFLICT')conflict.hidden=false; throw error; }
      close(); await onSaved(saved);
    });
  };
  dialog.querySelector('[data-reload-latest]').onclick = event => pending(event.currentTarget,form,async()=>{
    const fresh = await latest(); latestPanel.hidden=false;
    latestPanel.innerHTML=`<h3>Վերջին տարբերակ</h3>${topic?`<p>${e(fresh.title)}</p><p>${e(fresh.categoryName)}</p>`:''}<div>${sanitizeHtml(fresh.content)}</div><button type="button" data-use-latest>Օգտագործել վերջին տարբերակը</button><button type="button" data-keep-draft>Շարունակել իմ սևագրով</button>`;
    latestPanel.querySelector('[data-use-latest]').onclick=()=>{
      editor.set(fresh.content);if(topic){form.elements.title.value=fresh.title;form.elements.categoryCode.value=fresh.categoryCode;}expectedVersion=fresh.version;conflict.hidden=true;
    };
    latestPanel.querySelector('[data-keep-draft]').onclick=()=>{expectedVersion=fresh.version;conflict.hidden=true;editor.focus();};
  });
  dialog.showModal();editor.focus();
}
