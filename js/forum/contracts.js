import { DataError } from '../data/errors.js';
const bad = () => new DataError('CONTRACT', 'Ֆորումի API պատասխանի ձևաչափը սխալ է։');
const identifier = value => { if (typeof value !== 'string' || !value) throw bad(); return value; };
const count = value => { if (!Number.isSafeInteger(value) || value < 0) throw bad(); return value; };
const text = value => { if (typeof value !== 'string') throw bad(); return value; };
const flag = value => { if (typeof value !== 'boolean') throw bad(); return value; };
export function normalizeCategory(value) {
  if (!value || typeof value !== 'object') throw bad();
  return { id: identifier(value.id), code: text(value.code), name: text(value.name) };
}
export function normalizeForumAuthor(value) {
  if (!value || typeof value !== 'object') throw bad();
  return { id: value.id === null ? null : identifier(value.id), name: text(value.name), avatar: text(value.avatar), canOpenProfile: flag(value.canOpenProfile) };
}
function common(value) {
  if (!value || typeof value !== 'object') throw bad();
  if (!Number.isFinite(Date.parse(value.createdAt)) || (value.updatedAt !== null && !Number.isFinite(Date.parse(value.updatedAt)))) throw bad();
  return { id: identifier(value.id), content: text(value.content), author: normalizeForumAuthor(value.author), createdAt: value.createdAt, updatedAt: value.updatedAt, version: identifier(value.version), canEdit: flag(value.canEdit), canDelete: flag(value.canDelete) };
}
export function normalizeForumTopic(value) {
  return { ...common(value), title: text(value.title), categoryCode: text(value.categoryCode), categoryName: text(value.categoryName), excerpt: text(value.excerpt), replyCount: count(value.replyCount) };
}
export function normalizeReply(value) {
  return { ...common(value), topicId: identifier(value.topicId), likeCount: count(value.likeCount), liked: flag(value.liked), isTopicAuthor: flag(value.isTopicAuthor) };
}
export function normalizeForumPage(value, normalize) {
  if (!value || !Array.isArray(value.items) || (value.nextCursor !== null && (typeof value.nextCursor !== 'string' || !value.nextCursor))) throw bad();
  return { items: value.items.map(normalize), nextCursor: value.nextCursor };
}
export function createRequestKey() {
  let previous, key;
  return {
    for(data) { const next = JSON.stringify(data); if (next !== previous) { previous = next; key = crypto.randomUUID(); } return key; },
    clear() { previous = key = undefined; },
  };
}
