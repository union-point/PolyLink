import { escapeHtml as e, safeUrl } from '../shared/content.js';
import { dateTime } from '../shared/ui.js';
import { icon } from './icons.js';

export function renderConversation(room, selectedId) {
  const time = room.lastMessage ? dateTime(room.lastMessage.createdAt).split(', ').at(-1) : '';
  const preview = room.lastMessage?.text || (room.lastMessage?.attachment ? '📎 Պատկեր' : 'Հաղորդագրություններ չկան');
  return `<div class="chat-item ${room.id === selectedId ? 'active' : ''}" data-room-id="${e(room.id)}" tabindex="0" role="button" aria-label="${e(room.name)}">
    <div class="avatar">${room.isGroup ? icon('group') : e(room.name.slice(0, 1))}</div><div class="chat-info"><div class="chat-header"><span class="chat-name">${e(room.name)}</span><span class="chat-time">${e(time)}</span></div><div class="chat-preview-row"><div class="chat-preview">${e(preview)}</div>${BigInt(room.unreadCount||0)>0n ? `<strong class="unread-badge" aria-label="Չկարդացված՝ ${e(room.unreadCount)}">${e(room.unreadCount)}</strong>` : ''}</div></div></div>`;
}
export function renderMessage(message, ownId, group = false) {
  const sent = message.sender.id === ownId;
  const timestamp = dateTime(message.createdAt);
  return `<div class="message ${sent ? 'sent' : 'received'}" data-message-id="${e(message.id)}" data-sequence="${e(message.sequence)}"><div class="message-content">
    ${group ? `<div class="message-author">${e(message.sender.name)}</div>` : ''}
    ${message.text ? `<div class="message-text">${e(message.text)} <button class="copy-btn" aria-label="Պատճենել հաղորդագրությունը">${icon('copy')}</button></div>` : ''}
    ${message.attachment ? `<img src="${e(safeUrl(message.attachment.url, { image: true }))}" alt="${e(message.attachment.name || 'Պատկեր')}" class="message-image">` : ''}
    <div class="message-time" title="${e(timestamp)}">${e(timestamp.split(', ').at(-1))}</div></div></div>`;
}
