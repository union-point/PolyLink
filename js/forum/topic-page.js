import { forum } from '../services/index.js';
import { bootstrap, pending, stateMessage, dateTime } from '../shared/ui.js';
import { escapeHtml as e, sanitizeHtml, safeUrl } from '../shared/content.js';
import { majors } from '../data/models.js';
import { DataError } from '../data/errors.js';
const helpfulIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg>';

export async function initializeTopic() {
  const user = await bootstrap(); if (!user) return;
  const main = document.querySelector('main'), id = new URLSearchParams(location.search).get('id') || '1';
  let topic;
  try { topic = await forum.get(id); }
  catch (error) { stateMessage(main, error.message, { retry: () => location.reload() }); return; }
  document.title = `${topic.title} | PolyLink`;
  main.querySelector('.topic-title').textContent = topic.title;
  main.querySelector('.topic-badge').textContent = majors[topic.major] || topic.major;
  main.querySelector('.topic-author-info .author-name').textContent = topic.author.name;
  main.querySelector('.post-date').textContent = dateTime(topic.createdAt);
  main.querySelector('.author-avatar img').src = safeUrl(topic.author.avatar || 'image/logo.png', { image: true });
  main.querySelector('.author-avatar img').alt = topic.author.name;
  main.querySelector('.post-content').innerHTML = sanitizeHtml(topic.content);
  const section = main.querySelector('.replies-section'), list = document.createElement('div'); list.className = 'replies-list'; section.appendChild(list);
  const sort = main.querySelector('.sort-select'), form = main.querySelector('.reply-form'), text = form.querySelector('.reply-textarea');
  text.setAttribute('aria-label', 'Պատասխան');
  form.querySelector('.form-avatar img').src = safeUrl(user.avatar || 'image/logo.png', { image: true });
  let generation = 0;
  async function loadReplies() {
    const current = ++generation; stateMessage(list, 'Բեռնվում է...');
    try {
      const replies = await forum.replies.list(id, sort.value);
      if (current !== generation) return;
      main.querySelector('.reply-count').textContent = `(${replies.length})`;
      if (!replies.length) { stateMessage(list, 'Պատասխաններ դեռ չկան'); return; }
      list.innerHTML = replies.map(reply => `<div class="reply-item ${reply.author.id === topic.author.id ? 'highlighted' : ''}" data-reply-id="${e(reply.id)}"><div class="reply-avatar"><img src="${e(safeUrl(reply.author.avatar || 'image/logo.png', { image: true }))}" alt="${e(reply.author.name)}"></div><div class="reply-content"><div class="reply-header"><div class="reply-author"><span class="author-name">${e(reply.author.name)}</span>${reply.author.id === topic.author.id ? '<span class="author-badge">Հեղինակ</span>' : ''}</div><span class="reply-date">${e(dateTime(reply.createdAt))}</span></div><div class="reply-text">${sanitizeHtml(reply.content)}</div><div class="reply-actions"><button class="reply-action-btn like-btn ${reply.liked ? 'active' : ''}" aria-label="Օգտակար պատասխան" aria-pressed="${reply.liked}">${helpfulIcon}<span>${reply.likeCount}</span></button><button class="reply-action-btn reply-btn">Պատասխանել</button></div></div></div>`).join('');
    } catch (error) { if (current === generation) stateMessage(list, error.message, { retry: loadReplies }); }
  }
  list.onclick = event => {
    const replyButton = event.target.closest('.reply-btn'); if (replyButton) { text.focus(); return; }
    const button = event.target.closest('.like-btn'); if (!button) return;
    pending(button, button.closest('.reply-content'), async () => {
      const reply = await forum.replies.like(button.closest('.reply-item').dataset.replyId, button.getAttribute('aria-pressed') !== 'true');
      button.setAttribute('aria-pressed', String(reply.liked)); button.classList.toggle('active', reply.liked); button.querySelector('span').textContent = reply.likeCount;
      if (sort.value === 'popular') await loadReplies();
    });
  };
  const formats = [...form.querySelectorAll('.format-btn')];
  const linkLabel = document.createElement('label'); linkLabel.hidden = true; linkLabel.textContent = 'Հղում';
  const linkInput = document.createElement('input'); linkInput.type = 'url'; linkInput.name = 'link'; linkInput.placeholder = 'https://example.org';
  linkInput.style.cssText = 'width:100%;box-sizing:border-box;padding:10px;margin:8px 0;border-radius:8px;border:1px solid var(--border-color);background:var(--card-background);color:var(--font-color-primary)';
  linkLabel.appendChild(linkInput); text.after(linkLabel);
  formats.forEach((button, index) => { button.setAttribute('aria-pressed', 'false'); button.onclick = () => {
    const active = !button.classList.contains('active');
    if (index === 2) {
      linkLabel.hidden = !active; linkInput.required = active;
      if (active) linkInput.focus(); else linkInput.value = '';
    }
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  }; });
  form.onsubmit = event => {
    event.preventDefault();
    pending(form.querySelector('[type="submit"]'), form, async () => {
      let content = e(text.value).replace(/\n/g, '<br>');
      if (formats[0]?.classList.contains('active')) content = `<strong>${content}</strong>`;
      if (formats[1]?.classList.contains('active')) content = `<em>${content}</em>`;
      if (formats[2]?.classList.contains('active')) {
        const url = safeUrl(linkInput.value);
        if (!url) throw new DataError('VALIDATION', 'Անվավեր հղում։', { link: 'Օգտագործեք https:// հղում' });
        content = `<a href="${e(url)}">${content}</a>`;
      }
      await forum.replies.create(id, { content: `<p>${content}</p>` }); text.value = '';
      formats.forEach(button => { button.classList.remove('active'); button.setAttribute('aria-pressed', 'false'); });
      linkLabel.hidden = true; linkInput.required = false; linkInput.value = '';
      await loadReplies();
    });
  };
  sort.onchange = loadReplies;
  await loadReplies();
}
