import { forum } from '../services/index.js';
import { bootstrap, dateTime } from '../shared/ui.js';
import { escapeHtml as e } from '../shared/content.js';
import { authorHtml, categoryOptions, paginatedList } from './view.js';

export async function initializeForumList() {
  if (!await bootstrap()) return;
  const list = document.getElementById('topics-container'), filter = document.getElementById('category-filter');
  categoryOptions(filter,await forum.categories(),{all:true});
  const pages = paginatedList(list,cursor=>forum.list({categoryCode:filter.value,cursor:cursor||'',limit:20}),topics=>{
    list.innerHTML=topics.map(topic=>`<article class="topic" data-topic-id="${e(topic.id)}"><div class="topic-header"><h3><a href="topic.html?id=${encodeURIComponent(topic.id)}">${e(topic.title)}</a></h3><span class="topic-badge">${e(topic.categoryName)}</span></div><p>${e(topic.excerpt)}</p><div class="topic-meta"><span>Ավելացրեց՝ ${authorHtml(topic.author)}</span><span>${e(dateTime(topic.createdAt))}</span><span>${topic.replyCount} պատասխան</span></div></article>`).join('');
  });
  filter.onchange=()=>pages.refresh();await pages.refresh();
}
