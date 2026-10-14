import { forum } from '../services/index.js';
import { bootstrap, pending } from '../shared/ui.js';
import { escapeHtml } from '../shared/content.js';

export async function initializeTopicCreation() {
  if (!await bootstrap()) return;
  const form = document.querySelector('.new-topic-form');
  form.onsubmit = event => {
    event.preventDefault();
    pending(form.querySelector('[type="submit"]'), form, async () => {
      await forum.create({ title: form.elements.title.value, major: form.elements.major.value, content: escapeHtml(form.elements.content.value).replace(/\n/g, '<br>') });
      location.href = 'forum.html';
    });
  };
}
