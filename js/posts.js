import { posts } from './services/index.js';
import { bootstrap, start, pending, stateMessage } from './shared/ui.js';
import { renderPost, renderComment } from './shared/posts.js';

start(async () => {
  const user = await bootstrap();
  if (!user) return;
  const list = document.querySelector('.announcements-list');
  const modal = document.getElementById('postModal');
  const title = document.getElementById('announcement-title');
  const content = document.getElementById('announcement-content');
  const publish = modal.querySelector('.publish-btn');
  const category = document.querySelector('.filters .category-selector');
  const sphere = document.querySelector('.filters .tag-selector:not(.category-selector)');
  let generation = 0;
  let previousFocus;
  const drafts = new Map();
  function saveDrafts() { list.querySelectorAll('.announcement-card').forEach(card => drafts.set(card.dataset.postId, card.querySelector('.comment-input').value)); }
  async function load() {
    saveDrafts();
    const current = ++generation;
    stateMessage(list, 'Բեռնվում է...');
    try {
      const records = await posts.list({ category: category.value, sphere: sphere.value });
      if (current !== generation) return;
      if (!records.length) { stateMessage(list, 'Հայտարարություններ չկան'); return; }
      list.innerHTML = records.map(renderPost).join('');
      list.querySelectorAll('.announcement-card').forEach(card => { card.querySelector('.comment-input').value = drafts.get(card.dataset.postId) || ''; });
    } catch (error) { if (current === generation) stateMessage(list, error.message, { retry: load }); }
  }
  document.querySelectorAll('.modal-user-img').forEach(image => { image.src = user.avatar || 'image/logo.png'; });
  modal.querySelector('.modal-user-name').textContent = user.name;
  function close() {
    if (publish.disabled) return;
    modal.style.display = 'none'; title.value = ''; content.innerHTML = ''; modal.querySelector('#category-selector').value = 'job';
    modal.querySelector('[data-status]')?.remove(); previousFocus?.focus();
    modal.querySelectorAll('.format-btn').forEach(button => button.classList.remove('active'));
  }
  document.querySelector('.create-post-btn').onclick = event => {
    previousFocus = event.currentTarget; modal.style.display = 'block'; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); title.focus();
  };
  modal.querySelectorAll('.btn-cancel,.close-btn').forEach(button => { button.onclick = close; });
  const closeButton = modal.querySelector('.close-btn');
  closeButton.setAttribute('role', 'button'); closeButton.tabIndex = 0; closeButton.setAttribute('aria-label', 'Փակել');
  closeButton.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); close(); } };
  document.addEventListener('keydown', event => {
    if (modal.style.display !== 'block') return;
    if (event.key === 'Escape') close();
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); publish.click(); }
    if (event.key === 'Tab') {
      const focusable = [...modal.querySelectorAll('input,select,button,[contenteditable],[tabindex="0"]')].filter(element => !element.disabled);
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  publish.onclick = async () => {
    const saved = await pending(publish, modal.querySelector('.modal-content'), async () => {
      await posts.create({ title: title.value, content: content.innerHTML, category: modal.querySelector('#category-selector').value, sphere: sphere.value });
    });
    if (saved) { close(); await load(); }
  };
  list.addEventListener('click', async event => {
    const button = event.target.closest('.comment-btn'); if (!button) return;
    const card = button.closest('.announcement-card'), input = card.querySelector('.comment-input');
    await pending(button, card.querySelector('.comments-section'), async () => {
      const comment = await posts.comments.create(card.dataset.postId, { text: input.value });
      card.querySelector('.comments').insertAdjacentHTML('beforeend', renderComment(comment));
      card.querySelector('h4').textContent = `Մեկնաբանություններ (${card.querySelectorAll('.comment').length})`;
      input.value = ''; drafts.delete(card.dataset.postId);
    });
  });
  list.addEventListener('keydown', event => { if (event.key === 'Enter' && event.target.matches('.comment-input')) { event.preventDefault(); event.target.parentElement.querySelector('.comment-btn').click(); } });
  modal.querySelectorAll('.format-btn').forEach(button => { button.onmousedown = event => event.preventDefault(); button.onclick = () => { content.focus(); document.execCommand(button.dataset.command, false); button.classList.toggle('active', document.queryCommandState(button.dataset.command)); }; });
  category.onchange = sphere.onchange = load;
  await load();
});
