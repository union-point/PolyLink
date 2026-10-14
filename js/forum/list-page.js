import { forum } from '../services/index.js';
import { bootstrap, stateMessage, dateTime } from '../shared/ui.js';
import { escapeHtml as e, plainText } from '../shared/content.js';
import { majors } from '../data/models.js';

export async function initializeForumList() {
  if (!await bootstrap()) return;
  const list = document.getElementById('topics-container'), filter = document.getElementById('major-filter');
  let generation = 0;
  async function load() {
    const current = ++generation; stateMessage(list, 'Բեռնվում է...');
    try {
      const topics = await forum.list({ major: filter.value === 'all' ? '' : filter.value });
      if (current !== generation) return;
      if (!topics.length) { stateMessage(list, 'Թեմաներ չկան'); return; }
      list.innerHTML = topics.map(topic => `<div class="topic" data-major="${e(topic.major)}"><div class="topic-header"><h3><a href="topic.html?id=${encodeURIComponent(topic.id)}">${e(topic.title)}</a></h3><span class="topic-badge">${e(majors[topic.major] || topic.major)}</span></div>
        <p>${e(plainText(topic.content).slice(0, 220))}</p><div class="topic-meta"><span>Ավելացրեց՝ ${e(topic.author.name)}</span><span>${e(dateTime(topic.createdAt))}</span><span>${topic.replyCount} պատասխան</span></div></div>`).join('');
    } catch (error) { if (current === generation) stateMessage(list, error.message, { retry: load }); }
  }
  filter.onchange = load;
  await load();
}
