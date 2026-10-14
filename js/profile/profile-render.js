import { posts } from '../services/index.js';
import { escapeHtml as e, sanitizeHtml, safeUrl } from '../shared/content.js';
import { dateRange, monthLabel, relativeTime, pending, stateMessage } from '../shared/ui.js';

export function educationEntry(data, editable = false) {
  const entry = document.createElement('div'); entry.className = 'item-entry'; entry.dataset.entryId = data.id;
  entry.innerHTML = `<div class="item-logo">${data.logo ? `<img src="${e(safeUrl(data.logo, { image: true }))}" class="entry-logo" alt="University Logo">` : '<i class="fas fa-graduation-cap"></i>'}</div>
    <div class="item-details"><p class="item-title">${e(data.institution)}</p><p class="item-subtitle">${e(data.degree)}</p><p class="item-date">${e(dateRange(data.startDate, data.endDate))}</p></div>
    ${editable ? '<div class="edit-icons"><i class="fas fa-pencil-alt edit-icon" tabindex="0" role="button" aria-label="Փոփոխել կրթությունը"></i></div>' : ''}`;
  return entry;
}
export function certificateEntry(data, editable = false) {
  const entry = document.createElement('div'); entry.className = 'item-entry'; entry.dataset.entryId = data.id;
  const url = safeUrl(data.credentialUrl);
  entry.innerHTML = `<div class="item-logo cert-logo-bg">${data.logo ? `<img src="${e(safeUrl(data.logo, { image: true }))}" class="entry-logo" alt="Certificate Logo">` : '<i class="fas fa-certificate cert-icon"></i>'}</div>
    <div class="item-details"><p class="item-title">${e(data.name)}</p><p class="item-subtitle">${e(data.organization)}</p><p class="item-date">Տրման ամսաթիվը՝ ${e(monthLabel(data.issueDate))}</p>
    ${url ? '<button class="show-cred-btn">Ցուցադրել հավաստագիրը <i class="fas fa-external-link-alt"></i></button>' : ''}</div>
    ${editable ? '<div class="edit-icons"><i class="fas fa-pencil-alt edit-icon" tabindex="0" role="button" aria-label="Փոփոխել հավաստագիրը"></i></div>' : ''}`;
  entry.querySelector('.show-cred-btn')?.addEventListener('click', () => window.open(url, '_blank', 'noopener,noreferrer'));
  return entry;
}
export function announcementEntry(post, editable = false) {
  const entry = document.createElement('div'); entry.className = 'item-entry';
  entry.innerHTML = `<div class="announcement-card" data-post-id="${e(post.id)}"><div class="announcement-content"><p><strong>${e(post.title)}</strong></p>${sanitizeHtml(post.content)}</div>
    <div class="comments-section"><button class="btn-comments">Մեկնաբանություններ (${post.comments.length})</button>
    ${editable ? '<div class="edit-icons"><button class="btn btn-edit primary-btn">Փոփոխել</button><button class="btn btn-delete secondary-btn">Հեռացնել</button></div>' : ''}</div></div>`;
  const card = entry.querySelector('.announcement-card'); card.record = post;
  attachComments(card, entry.querySelector('.btn-comments'));
  return entry;
}
function commentElement(comment) {
  const node = document.createElement('div'); node.className = 'comment'; node.dataset.commentId = comment.id; node.style.marginBottom = '12px';
  node.innerHTML = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px"><img src="${e(safeUrl(comment.author?.avatar || 'image/logo.png', { image: true }))}" alt="Օգտատեր" style="width:32px;height:32px;border-radius:50%;object-fit:cover">
    <span style="font-weight:600;font-size:14px">${e(comment.author?.name)}</span><span style="font-size:12px">${e(relativeTime(comment.createdAt))}</span></div>
    <p style="font-size:14px;margin:0;padding-left:32px">${e(comment.text)}</p>`;
  return node;
}
function attachComments(card, button) {
  let container;
  let count = card.record.comments.length;
  button.onclick = async () => {
    if (container) { container.hidden = !container.hidden; return; }
    await pending(button, card, async () => {
      const box = document.createElement('div'); box.className = 'comments-container'; box.style.cssText = 'margin-top:16px;padding-top:16px;border-top:1px solid var(--border-color)';
      const list = document.createElement('div'); list.className = 'comments-list';
      const form = document.createElement('div'); form.style.cssText = 'display:flex;gap:8px;margin-top:16px;flex-wrap:wrap';
      const input = document.createElement('input'); input.type = 'text'; input.placeholder = 'Գրել մեկնաբանություն...'; input.setAttribute('aria-label', 'Մեկնաբանություն'); input.maxLength = 2000; input.style.cssText = 'flex:1;padding:8px 12px;border-radius:12px;background:var(--card-background);color:var(--font-color-primary)';
      const send = document.createElement('button'); send.className = 'primary-btn'; send.textContent = 'Ուղարկել';
      form.append(input, send); box.append(list, form); card.append(box); container = box;
      async function load() {
        stateMessage(list, 'Բեռնվում է...');
        try {
          const comments = await posts.comments.list(card.dataset.postId);
          list.replaceChildren(...comments.map(commentElement)); if (!comments.length) stateMessage(list, 'Մեկնաբանություններ դեռ չկան');
          count = comments.length; button.textContent = `Մեկնաբանություններ (${count})`;
        } catch (error) { stateMessage(list, error.message, { retry: load }); }
      }
      send.onclick = () => pending(send, box, async () => {
        const comment = await posts.comments.create(card.dataset.postId, { text: input.value });
        list.querySelectorAll('[role="status"],button').forEach(node => node.remove());
        list.appendChild(commentElement(comment)); input.value = '';
        // Preserve the last read count even if initial comment rendering failed.
        button.textContent = `Մեկնաբանություններ (${++count})`;
      });
      input.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); send.click(); } };
      await load();
    });
  };
}
