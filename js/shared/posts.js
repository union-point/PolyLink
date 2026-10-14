import { escapeHtml as e, sanitizeHtml, safeUrl } from './content.js';
import { dateTime } from './ui.js';
import { categories } from '../data/models.js';

export function renderComment(comment) {
  return `<div class="comment" data-comment-id="${e(comment.id)}">
    <img src="${e(safeUrl(comment.author?.avatar || 'image/logo.png', { image: true }))}" alt="Օգտատեր" class="comment-icon">
    <div class="comment-content"><p class="comment-author">${e(comment.author?.name)}</p>
    <p class="comment-text">${e(comment.text)}</p><p class="comment-time">${e(dateTime(comment.createdAt))}</p></div></div>`;
}
export function renderPost(post) {
  return `<div class="announcement-card" data-category="${e(post.category)}" data-post-id="${e(post.id)}">
    <div class="announcement-header"><img src="${e(safeUrl(post.author?.avatar || 'image/logo.png', { image: true }))}" alt="Օգտատեր" class="user-icon">
      <div class="announcement-info"><h3 class="user-name">${e(post.author?.name)}</h3><p class="announcement-date">${e(dateTime(post.createdAt))}</p></div>
      <span class="category-badge ${e(post.category)}">${e(categories[post.category] || post.category)}</span></div>
    <div class="announcement-content"><p><strong>${e(post.title)}</strong></p>${sanitizeHtml(post.content)}</div>
    <div class="comments-section"><h4>Մեկնաբանություններ (${post.comments.length})</h4><div class="comments">${post.comments.map(renderComment).join('')}</div>
      <div class="comment-field"><input class="comment-input" type="text" aria-label="Մեկնաբանություն" placeholder="Գրեք մեկնաբանություն..." maxlength="2000">
      <button class="comment-btn">Ուղարկել</button></div></div></div>`;
}
