import { escapeHtml as e, safeUrl } from './content.js';
import { sanitizePostHtml } from '../posts/content.js';
import { dateTime } from './ui.js';
function attribution(author) {const name=e(author?.name);return author?.canOpenProfile&&author.id?`<a href="user.html?id=${encodeURIComponent(author.id)}">${name}</a>`:name;}
export function renderComment(comment) {
  return `<div class="comment" data-comment-id="${e(comment.id)}"><img src="${e(safeUrl(comment.author.avatar||'image/logo.png',{image:true}))}" alt="" class="comment-icon"><div class="comment-content"><p class="comment-author">${attribution(comment.author)}</p><p class="comment-text">${e(comment.text)}</p><p class="comment-time">${e(dateTime(comment.createdAt))}${comment.updatedAt?' · փոփոխված':''}</p><div class="comment-actions">${comment.canEdit?'<button type="button" data-comment-edit>Փոփոխել</button>':''}${comment.canDelete?'<button type="button" data-comment-delete>Հեռացնել</button>':''}</div></div></div>`;
}
export function renderPostSummary(post) {
  return `<div class="announcement-header"><img src="${e(safeUrl(post.author.avatar||'image/logo.png',{image:true}))}" alt="" class="user-icon"><div class="announcement-info"><h3 class="user-name">${attribution(post.author)}</h3><p class="announcement-date">${e(dateTime(post.createdAt))}${post.updatedAt?' · փոփոխված':''}</p></div>${post.categoryName?`<span class="post-type-badge">${e(post.categoryName)}</span>`:''}</div><div class="announcement-content">${post.title?`<h2>${e(post.title)}</h2>`:''}${sanitizePostHtml(post.content)}</div>`;
}
const icon=path=>`<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
export function renderCommentToggle(count) {
  return `${icon('<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5a9.5 9.5 0 0 1 19 0Z"/>')}<span class="comments-label">Մեկնաբանություններ</span><span>(${count})</span>`;
}
export function renderPostOwnerActions(post) {
  return `${post.canEdit?`<button type="button" data-post-edit aria-label="Փոփոխել">${icon('<path d="m15 4 5 5M4 20l4-1L21 6a2 2 0 0 0-4-4L4 15Z"/>')}<span class="post-action-label">Փոփոխել</span></button>`:''}${post.canDelete?`<button type="button" data-post-delete aria-label="Հեռացնել">${icon('<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>')}<span class="post-action-label">Հեռացնել</span></button>`:''}`;
}
const emojis=[['😀','Ժպիտ'],['😊','Ուրախ'],['😂','Ծիծաղ'],['😍','Հիացած'],['🥳','Տոն'],['🤔','Մտածում'],['👍','Հավանում'],['👏','Ծափեր'],['🙌','Ողջույն'],['❤️','Սեր'],['🎉','Շնորհավորանք'],['🚀','Առաջ']];
export function renderPost(post) {
  return `<article class="announcement-card post-card" data-post-id="${e(post.id)}" data-category="${e(post.category||'')}">
    <div data-post-summary>${renderPostSummary(post)}</div>
    <div class="comments-section">
      <div class="post-actions">
        <button type="button" class="comments-toggle" aria-label="Մեկնաբանություններ (${post.commentCount})" aria-expanded="false">${renderCommentToggle(post.commentCount)}</button>
        <div class="post-owner-actions">${renderPostOwnerActions(post)}</div>
        <select class="comment-sort" aria-label="Մեկնաբանությունների դասավորում"><option value="newest">Նորերը սկզբում</option><option value="oldest">Հները սկզբում</option></select>
      </div>
      <section data-comments hidden>
        <div class="comments"></div><div data-comment-status></div>
        <button type="button" class="comments-more" hidden>Ցուցադրել ավելին</button>
        <div class="comment-field">
          <img class="comment-avatar" src="image/logo.png" alt="" width="40" height="40">
          <div class="comment-entry">
            <textarea class="comment-input" rows="1" aria-label="Մեկնաբանություն" placeholder="Գրեք…" maxlength="2000"></textarea>
            <button type="button" class="emoji-toggle" aria-label="Ավելացնել էմոջի" aria-haspopup="dialog" aria-expanded="false"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 14a4 4 0 0 0 8 0M8 9h.01M16 9h.01"/></svg></button>
            <div class="emoji-popover" role="dialog" aria-label="Ընտրեք էմոջի" hidden><div class="emoji-grid">${emojis.map(([emoji,label])=>`<button type="button" data-emoji="${emoji}" aria-label="${label}">${emoji}</button>`).join('')}</div></div>
          </div>
          <button type="button" class="comment-btn">Հրապարակել</button>
        </div>
      </section>
    </div>
  </article>`;
}
