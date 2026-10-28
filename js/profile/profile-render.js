import { createPostCard } from '../posts/cards.js';
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
export function announcementEntry(post) {
  const entry=document.createElement('div');entry.className='item-entry';entry.append(createPostCard(post));return entry;
}
