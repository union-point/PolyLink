import { educationRange, profileDate } from './contracts.js';
import { createPostCard } from '../posts/cards.js';
import { escapeHtml as e, sanitizeHtml, safeUrl } from '../shared/content.js';
import { dateRange, monthLabel, relativeTime, pending, stateMessage } from '../shared/ui.js';

const sectionIcon = type => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${type === 'education'
  ? '<path d="m3 8 9-4 9 4-9 4-9-4Z"/><path d="M6 10v6c3 3 9 3 12 0v-6M21 8v7"/>'
  : '<rect x="4" y="3" width="16" height="14" rx="2"/><path d="M8 7h8M8 11h5M8 17v4l4-2 4 2v-4"/>'}</svg>`;

export function educationEntry(data, editable = false) {
  const entry = document.createElement('div'); entry.className = 'item-entry'; entry.dataset.entryId = data.id;
  entry.innerHTML = `<div class="item-logo">${sectionIcon('education')}</div>
    <div class="item-details"><p class="item-title">${e(data.institution)}</p><p class="item-subtitle">${e([data.degree,data.institute,data.specialization].filter(Boolean).join(' · '))}</p><p class="item-date">${e(educationRange(data))}</p></div>
    ${editable ? '<div class="edit-icons"><i class="fas fa-pencil-alt edit-icon" tabindex="0" role="button" aria-label="Փոփոխել կրթությունը"></i></div>' : ''}`;
  return entry;
}
export function certificateEntry(data, editable = false) {
  const entry = document.createElement('div'); entry.className = 'item-entry'; entry.dataset.entryId = data.id;
  const url = safeUrl(data.credentialUrl);
  entry.innerHTML = `<div class="item-logo">${sectionIcon('certificate')}</div>
    <div class="item-details"><p class="item-title">${e(data.name)}</p><p class="item-subtitle">${e(data.organization)}</p><p class="item-date">Տրման ամսաթիվը՝ ${e(profileDate(data.issueDate))}</p>
    ${url ? '<button class="show-cred-btn">Ցուցադրել հավաստագիրը <i class="fas fa-external-link-alt"></i></button>' : ''}</div>
    ${editable ? '<div class="edit-icons"><i class="fas fa-pencil-alt edit-icon" tabindex="0" role="button" aria-label="Փոփոխել հավաստագիրը"></i></div>' : ''}`;
  entry.querySelector('.show-cred-btn')?.addEventListener('click', () => window.open(url, '_blank', 'noopener,noreferrer'));
  return entry;
}
export function announcementEntry(post) {
  const entry=document.createElement('div');entry.className='item-entry';entry.append(createPostCard(post));return entry;
}
