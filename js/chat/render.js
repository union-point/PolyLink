import { escapeHtml as e, safeUrl } from '../shared/content.js';
import { dateTime } from '../shared/ui.js';

export function renderConversation(room, selectedId) {
  const time = room.lastMessage ? dateTime(room.lastMessage.createdAt).split(', ').at(-1) : '';
  const preview = room.lastMessage?.text || (room.lastMessage?.attachment ? '📎 Պատկեր' : 'Հաղորդագրություններ չկան');
  return `<div class="chat-item ${room.id === selectedId ? 'active' : ''}" data-room-id="${e(room.id)}" tabindex="0" role="button" aria-label="${e(room.name)}">
    <div class="avatar">${e(room.isGroup ? '👥' : room.name.slice(0, 1))}</div><div class="chat-info"><div class="chat-header"><span class="chat-name">${e(room.name)}</span><span class="chat-time">${e(time)}</span></div><div class="chat-preview">${e(preview)} ${room.unreadCount ? `<strong aria-label="Չկարդացված">(${room.unreadCount})</strong>` : ''}</div></div></div>`;
}
export function renderMessage(message, ownId, group = false) {
  const sent = message.sender.id === ownId;
  const timestamp = dateTime(message.createdAt);
  return `<div class="message ${sent ? 'sent' : 'received'}" data-message-id="${e(message.id)}"><div class="message-content">
    ${group ? `<div class="comment-author">${e(message.sender.name)}</div>` : ''}
    ${message.text ? `<div class="message-text">${e(message.text)} <button class="copy-btn" aria-label="Պատճենել հաղորդագրությունը">📋</button></div>` : ''}
    ${message.attachment ? `<img src="${e(safeUrl(message.attachment.url, { image: true }))}" alt="${e(message.attachment.name || 'Պատկեր')}" style="max-width:200px;max-height:240px;border-radius:8px;margin-top:5px;display:block;object-fit:contain">` : ''}
    <div class="message-time" title="${e(timestamp)}">${e(timestamp.split(', ').at(-1))}</div></div></div>`;
}
