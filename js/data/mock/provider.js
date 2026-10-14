import { transaction, nextId } from './store.js';
import { DataError } from '../errors.js';
import { email, password, required, validateEducation, validateCertificate, validatePost, validateTopic, validateImage, richContent } from '../validation.js';

const now = () => new Date().toISOString();
const defaults = () => ({ isProfilePublic: true, showEmail: false, twoFactorEnabled: false, language: 'hy', emailEnabled: true, newListingNotifications: true, forumReplyNotifications: true, directMessageNotifications: true });
const readOperations = new Set(['auth.me', 'profiles.get', 'profiles.education.list', 'profiles.certificates.list', 'posts.list', 'posts.comments.list', 'forum.list', 'forum.get', 'forum.replies.list', 'search.people', 'chat.list', 'chat.messages', 'settings.get', 'settings.export']);
const publicOperations = new Set(['auth.me', 'auth.login', 'auth.register', 'auth.verifySecondFactor', 'auth.resendChallenge', 'auth.forgotPassword', 'auth.verifyRecovery', 'auth.resetPassword', 'auth.logout']);

function find(records, id) {
  const item = records.find(record => record.id === String(id));
  if (!item) throw new DataError('NOT_FOUND', 'Տվյալները չեն գտնվել։');
  return item;
}
function me(state) {
  const user = state.users.find(user => user.id === state.sessionUserId && user.status === 'active');
  if (!user) throw new DataError('UNAUTHORIZED', 'Խնդրում ենք մուտք գործել։');
  return user;
}
function owner(state, item) {
  if (item.userId !== me(state).id) throw new DataError('FORBIDDEN', 'Այս գործողությունը հասանելի չէ։');
  return item;
}
function author(state, id) {
  const user = find(state.users, id);
  return { id: user.id, name: user.name, avatar: user.avatar };
}
function profile(state, user) {
  const settings = state.settings[user.id] || defaults();
  const own = state.sessionUserId === user.id;
  if (user.status !== 'active' || (!own && !settings.isProfilePublic)) throw new DataError('NOT_FOUND', 'Պրոֆիլը հասանելի չէ։');
  const { email: address, ...publicUser } = user;
  return { ...publicUser, ...(own || settings.showEmail ? { email: address } : {}),
    education: state.education.filter(record => record.userId === user.id),
    licenses: state.certificates.filter(record => record.userId === user.id) };
}
function commentView(state, record) { return { ...record, author: author(state, record.userId) }; }
function postView(state, record) {
  return { ...record, author: author(state, record.userId), comments: state.comments.filter(comment => comment.postId === record.id).map(comment => commentView(state, comment)) };
}
function topicView(state, record) { return { ...record, author: author(state, record.userId), replyCount: state.replies.filter(reply => reply.topicId === record.id).length }; }
function replyView(state, record) {
  const { likes, ...reply } = record;
  return { ...reply, author: author(state, record.userId), likeCount: likes.length, liked: likes.includes(state.sessionUserId) };
}
function preference(room, id) {
  room.preferences[id] ||= { muted: false, hidden: false, deletedAt: null, readAt: null };
  return room.preferences[id];
}
function roomForUser(state, id) {
  const room = find(state.rooms, id);
  if (!room.participants.includes(me(state).id)) throw new DataError('FORBIDDEN', 'Նամակագրությունը հասանելի չէ։');
  return room;
}
function isBlocked(state, first, second) { return state.blocks.some(block => block.userId === first && block.targetId === second); }
function messageView(state, message) {
  return { ...message, sender: author(state, message.senderId) };
}
function roomView(state, room) {
  const userId = me(state).id;
  const pref = preference(room, userId);
  const messages = state.messages.filter(message => message.roomId === room.id && (!pref.deletedAt || message.createdAt > pref.deletedAt));
  const participants = room.participants.map(id => author(state, id));
  const other = room.participants.find(id => id !== userId);
  return { id: room.id, isGroup: room.isGroup, closed: room.participants.length < 2, name: room.name || participants.filter(person => person.id !== userId).map(person => person.name).join(', ') || 'Ջնջված օգտատեր', participants,
    muted: pref.muted, blocked: isBlocked(state, userId, other), unreadCount: messages.filter(message => message.senderId !== userId && (!pref.readAt || message.createdAt > pref.readAt)).length,
    lastMessage: messages.length ? messageView(state, messages.at(-1)) : null };
}
function challenge(state, id, purpose) {
  const item = find(state.challenges, id);
  if (item.purpose !== purpose || item.consumed || item.expiresAt <= Date.now() || item.attempts >= 5) throw new DataError('VALIDATION', 'Վավերացման ժամկետը լրացել է։ Պահանջեք նոր կոդ։');
  return item;
}
function newChallenge(state, userId, purpose) {
  const item = { id: nextId(state, 'challenge'), userId, purpose, expiresAt: Date.now() + 600000, sentAt: Date.now(), consumed: false, verified: false, attempts: 0 };
  state.challenges.push(item);
  return { challengeId: item.id, expiresAt: item.expiresAt, resendAfter: 60 };
}
function checkCode(item, code) {
  item.attempts += 1;
  if (String(code) !== '123456') return new DataError('VALIDATION', 'Սխալ վավերացման կոդ։', { code: 'Սխալ կոդ' });
  return null;
}
async function digest(address, secret) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${address}:${secret}`));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
const operations = {
  'auth.me': state => state.sessionUserId ? profile(state, me(state)) : null,
  'auth.logout': state => { state.sessionUserId = null; return null; },
  'auth.register': (state, data) => {
    const address = email(data.email);
    if (state.users.some(user => user.email === address)) throw new DataError('CONFLICT', 'Տվյալ էլ․ փոստն արդեն գրանցված է։', { email: 'Արդեն գրանցված է' });
    const user = { id: nextId(state, 'user'), firstName: required(data.firstName, 'firstName', 100), lastName: required(data.lastName, 'lastName', 100), email: address, role: 'graduate', status: 'active', onboardingComplete: false, jobTitle: '', description: '', avatar: 'image/logo.png', cover: 'image/background1.jpg', institute: '', specialization: '', graduationYear: '' };
    user.name = `${user.firstName} ${user.lastName}`;
    state.users.push(user); state.credentials[user.id] = data.digest; state.settings[user.id] = defaults();
    state.sessionUserId = user.id;
    return profile(state, user);
  },
  'auth.login': (state, data) => {
    const user = state.users.find(user => user.email === data.email && state.credentials[user.id] === data.digest);
    if (!user) throw new DataError('UNAUTHORIZED', 'Սխալ էլ․ փոստ կամ գաղտնաբառ։');
    if (state.settings[user.id]?.twoFactorEnabled) { state.sessionUserId = null; return { status: 'challenge', ...newChallenge(state, user.id, 'second-factor') }; }
    user.status = 'active'; state.sessionUserId = user.id;
    return { status: 'authenticated', user: profile(state, user) };
  },
  'auth.verifySecondFactor': (state, data) => {
    const item = challenge(state, data.challengeId, 'second-factor');
    const failure = checkCode(item, data.code);
    if (failure) return failure; // Commit attempt counter before propagating the error.
    item.consumed = true; state.sessionUserId = item.userId;
    const user = find(state.users, item.userId); user.status = 'active';
    return profile(state, user);
  },
  'auth.resendChallenge': (state, id) => {
    const item = find(state.challenges, id);
    if (item.consumed || Date.now() - item.sentAt < 60000) throw new DataError('VALIDATION', 'Խնդրում ենք սպասել մինչև նոր կոդ պահանջելը։');
    item.sentAt = Date.now(); item.expiresAt = Date.now() + 600000; item.attempts = 0; item.verified = false;
    return { challengeId: item.id, expiresAt: item.expiresAt, resendAfter: 60 };
  },
  'auth.forgotPassword': (state, address) => {
    const user = state.users.find(user => user.email === address);
    // Unknown addresses get an indistinguishable challenge that cannot authorize a reset.
    return newChallenge(state, user?.id || null, 'recovery');
  },
  'auth.verifyRecovery': (state, data) => {
    const item = challenge(state, data.challengeId, 'recovery');
    const failure = checkCode(item, data.code);
    if (failure) return failure;
    if (!item.userId) return new DataError('VALIDATION', 'Սխալ վավերացման կոդ։');
    item.verified = true;
    return { recoveryToken: item.id };
  },
  'auth.resetPassword': (state, data) => {
    const item = challenge(state, data.recoveryToken, 'recovery');
    if (!item.verified || !item.userId) throw new DataError('FORBIDDEN', 'Նախ վավերացրեք վերականգնման կոդը։');
    state.credentials[item.userId] = data.digest; find(state.users, item.userId).passwordChangedAt = now(); item.consumed = true;
    state.challenges.filter(record => record.userId === item.userId).forEach(record => { record.consumed = true; });
    state.sessionUserId = null;
    return null;
  },
  'profiles.get': (state, id) => profile(state, id ? find(state.users, id) : me(state)),
  'profiles.update': (state, data) => {
    const user = me(state);
    for (const key of ['firstName', 'lastName']) if (key in data) user[key] = required(data[key], key, 100);
    for (const key of ['jobTitle', 'description', 'institute', 'specialization', 'department', 'graduationYear']) if (key in data) user[key] = String(data[key] || '').trim();
    user.name = `${user.firstName} ${user.lastName}`;
    return profile(state, user);
  },
  'profiles.onboard': (state, data) => {
    const user = me(state);
    const role = data.role === 'teacher' ? 'lecturer' : data.role;
    if (!['graduate', 'lecturer'].includes(role)) throw new DataError('VALIDATION', 'Ընտրեք դերը։');
    required(data.description, 'description');
    if (role === 'graduate') {
      const start = Number(data.startYear), end = Number(data.endYear);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1900 || end < start || end > 2200) throw new DataError('VALIDATION', 'Ստուգեք ուսման տարիները։');
      const entry = { id: nextId(state, 'education'), userId: user.id, institution: 'Հայաստանի ազգային պոլիտեխնիկական համալսարան', degree: 'Բակալավր', institute: data.institute, specialization: data.specialization, startDate: `${start}-09`, endDate: `${end}-06`, logo: 'image/logo.png' };
      state.education = state.education.filter(record => record.userId !== user.id || !record.onboarding);
      state.education.push({ ...entry, onboarding: true }); user.graduationYear = String(end);
    }
    Object.assign(user, { role, institute: role === 'graduate' ? data.institute : '', department: role === 'lecturer' ? data.department : '', specialization: data.specialization, description: data.description, onboardingComplete: true });
    return profile(state, user);
  },
  'profiles.education.list': state => state.education.filter(record => record.userId === me(state).id),
  'profiles.education.create': (state, data) => { const entry = { ...validateEducation(data), id: nextId(state, 'education'), userId: me(state).id }; state.education.push(entry); return entry; },
  'profiles.education.update': (state, id, data) => Object.assign(owner(state, find(state.education, id)), validateEducation(data)),
  'profiles.education.delete': (state, id) => { owner(state, find(state.education, id)); state.education = state.education.filter(record => record.id !== String(id)); return null; },
  'profiles.certificates.list': state => state.certificates.filter(record => record.userId === me(state).id),
  'profiles.certificates.create': (state, data) => { const entry = { ...validateCertificate(data), id: nextId(state, 'certificate'), userId: me(state).id }; state.certificates.push(entry); return entry; },
  'profiles.certificates.update': (state, id, data) => Object.assign(owner(state, find(state.certificates, id)), validateCertificate(data)),
  'profiles.certificates.delete': (state, id) => { owner(state, find(state.certificates, id)); state.certificates = state.certificates.filter(record => record.id !== String(id)); return null; },
  'profiles.upload': (state, kind, file) => {
    if (!['avatar', 'cover'].includes(kind)) throw new DataError('VALIDATION', 'Անվավեր պատկերի տեսակ։');
    const id = nextId(state, 'media'); state.media.push({ id, userId: me(state).id, blob: validateImage(file) });
    me(state)[kind] = `media:${id}`;
    return profile(state, me(state));
  },
  'posts.list': (state, filters = {}) => {
    if (filters.userId) profile(state, find(state.users, filters.userId));
    return state.posts.filter(post => (!filters.userId || post.userId === String(filters.userId)) && (!filters.category || post.category === filters.category) && (!filters.sphere || post.sphere === filters.sphere))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)).map(post => postView(state, post));
  },
  'posts.create': (state, data) => { const post = { ...validatePost(data), id: nextId(state, 'post'), userId: me(state).id, createdAt: now() }; state.posts.push(post); return postView(state, post); },
  'posts.update': (state, id, data) => { const post = owner(state, find(state.posts, id)); Object.assign(post, validatePost({ ...post, ...data })); return postView(state, post); },
  'posts.delete': (state, id) => { owner(state, find(state.posts, id)); state.posts = state.posts.filter(post => post.id !== String(id)); state.comments = state.comments.filter(comment => comment.postId !== String(id)); return null; },
  'posts.comments.list': (state, id) => { find(state.posts, id); return state.comments.filter(comment => comment.postId === String(id)).map(comment => commentView(state, comment)); },
  'posts.comments.create': (state, postId, data) => { find(state.posts, postId); const comment = { id: nextId(state, 'comment'), postId: String(postId), userId: me(state).id, text: required(data.text, 'text', 2000), createdAt: now() }; state.comments.push(comment); return commentView(state, comment); },
  'posts.comments.update': (state, postId, id, data) => {
    const comment = owner(state, find(state.comments, id)); if (comment.postId !== String(postId)) throw new DataError('NOT_FOUND', 'Մեկնաբանությունը չի գտնվել։');
    comment.text = required(data.text, 'text', 2000); return commentView(state, comment);
  },
  'posts.comments.delete': (state, postId, id) => { const comment = owner(state, find(state.comments, id)); if (comment.postId !== String(postId)) throw new DataError('NOT_FOUND', 'Մեկնաբանությունը չի գտնվել։'); state.comments = state.comments.filter(record => record.id !== String(id)); return null; },
  'forum.list': (state, filters = {}) => state.topics.filter(topic => !filters.major || topic.major === filters.major).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(topic => topicView(state, topic)),
  'forum.get': (state, id) => topicView(state, find(state.topics, id)),
  'forum.create': (state, data) => { const topic = { ...validateTopic(data), id: nextId(state, 'topic'), userId: me(state).id, createdAt: now() }; state.topics.push(topic); return topicView(state, topic); },
  'forum.update': (state, id, data) => { const topic = owner(state, find(state.topics, id)); Object.assign(topic, validateTopic({ ...topic, ...data })); return topicView(state, topic); },
  'forum.delete': (state, id) => { owner(state, find(state.topics, id)); state.topics = state.topics.filter(record => record.id !== String(id)); state.replies = state.replies.filter(record => record.topicId !== String(id)); return null; },
  'forum.replies.list': (state, id, sort = 'newest') => {
    find(state.topics, id);
    const list = state.replies.filter(reply => reply.topicId === String(id)).map(reply => replyView(state, reply));
    return list.sort((a, b) => (sort === 'popular' ? b.likeCount - a.likeCount : 0) || (sort === 'oldest' ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt)) || a.id.localeCompare(b.id));
  },
  'forum.replies.create': (state, id, data) => { find(state.topics, id); const reply = { id: nextId(state, 'reply'), topicId: String(id), userId: me(state).id, content: richContent(data.content), createdAt: now(), likes: [] }; state.replies.push(reply); return replyView(state, reply); },
  'forum.replies.like': (state, id, liked) => { const reply = find(state.replies, id), userId = me(state).id; reply.likes = reply.likes.filter(id => id !== userId); if (liked) reply.likes.push(userId); return replyView(state, reply); },
  'search.people': (state, filters = {}) => state.users.filter(user => user.status === 'active' && (user.id === state.sessionUserId || state.settings[user.id]?.isProfilePublic) &&
    (!filters.q || `${user.name} ${user.jobTitle} ${user.specialization}`.toLowerCase().includes(filters.q.trim().toLowerCase())) &&
    (!filters.specialization || user.specialization === filters.specialization) && (!filters.institute || user.institute === filters.institute) &&
    (!filters.year || user.graduationYear === String(filters.year))).map(user => profile(state, user)),
  'chat.list': state => state.rooms.filter(room => room.participants.includes(me(state).id) && !preference(room, me(state).id).hidden).map(room => roomView(state, room)),
  'chat.openDirect': (state, userId) => {
    const own = me(state).id; find(state.users, userId);
    if (own === String(userId)) throw new DataError('VALIDATION', 'Ընտրեք այլ օգտատեր։');
    if (isBlocked(state, own, String(userId)) || isBlocked(state, String(userId), own)) throw new DataError('FORBIDDEN', 'Օգտատիրոջ հետ կապ հաստատել հնարավոր չէ։');
    let room = state.rooms.find(room => !room.isGroup && room.participants.length === 2 && room.participants.includes(own) && room.participants.includes(String(userId)));
    if (!room) { room = { id: nextId(state, 'room'), isGroup: false, participants: [own, String(userId)], preferences: {} }; state.rooms.push(room); }
    preference(room, own).hidden = false;
    return roomView(state, room);
  },
  'chat.messages': (state, id) => { const room = roomForUser(state, id); const pref = preference(room, me(state).id); return state.messages.filter(message => message.roomId === String(id) && (!pref.deletedAt || message.createdAt > pref.deletedAt)).map(message => messageView(state, message)); },
  'chat.send': (state, roomId, data) => {
    const room = roomForUser(state, roomId), own = me(state).id;
    if (room.participants.length < 2) throw new DataError('FORBIDDEN', 'Նամակագրությունն ավարտված է։');
    if (room.participants.some(id => id !== own && (isBlocked(state, own, id) || isBlocked(state, id, own)))) throw new DataError('FORBIDDEN', 'Հաղորդագրությունը չի կարող ուղարկվել։ Օգտատերը արգելափակված է։');
    const text = String(data.text || '').trim();
    if (!text && !data.file) throw new DataError('VALIDATION', 'Մուտքագրեք հաղորդագրություն։');
    if (text.length > 5000) throw new DataError('VALIDATION', 'Հաղորդագրությունը չափազանց երկար է։');
    let attachment = null;
    if (data.file) { const id = nextId(state, 'media'); state.media.push({ id, userId: own, blob: validateImage(data.file) }); attachment = { url: `media:${id}`, name: data.file.name, type: data.file.type }; }
    const message = { id: nextId(state, 'message'), roomId: room.id, senderId: own, text, attachment, createdAt: now() }; state.messages.push(message);
    room.participants.forEach(id => { preference(room, id).hidden = false; });
    return messageView(state, message);
  },
  'chat.read': (state, id) => { preference(roomForUser(state, id), me(state).id).readAt = now(); return null; },
  'chat.mute': (state, id, value) => { const room = roomForUser(state, id); preference(room, me(state).id).muted = Boolean(value); return roomView(state, room); },
  'chat.hide': (state, id) => { const pref = preference(roomForUser(state, id), me(state).id); pref.hidden = true; pref.deletedAt = now(); return null; },
  'chat.block': (state, userId, value) => { const own = me(state).id; find(state.users, userId); state.blocks = state.blocks.filter(block => block.userId !== own || block.targetId !== String(userId)); if (value) state.blocks.push({ userId: own, targetId: String(userId) }); return null; },
  'settings.get': state => state.settings[me(state).id] || defaults(),
  'settings.update': (state, data) => {
    const settings = state.settings[me(state).id] ||= defaults();
    for (const key of Object.keys(defaults())) if (key in data) {
      if (key === 'language') { if (!['hy', 'en', 'ru'].includes(data.language)) throw new DataError('VALIDATION', 'Անվավեր լեզու։'); settings.language = data.language; }
      else settings[key] = Boolean(data[key]);
    }
    return settings;
  },
  'settings.changeEmail': (state, data) => {
    const user = me(state);
    if (state.credentials[user.id] !== data.oldDigest) throw new DataError('UNAUTHORIZED', 'Սխալ գաղտնաբառ։');
    if (state.users.some(other => other.id !== user.id && other.email === data.email)) throw new DataError('CONFLICT', 'Տվյալ էլ․ փոստն արդեն գրանցված է։');
    user.email = data.email; state.credentials[user.id] = data.newDigest;
    state.challenges.filter(item => item.userId === user.id).forEach(item => { item.consumed = true; });
    return profile(state, user);
  },
  'settings.changePassword': (state, data) => { const user = me(state); if (state.credentials[user.id] !== data.oldDigest) throw new DataError('UNAUTHORIZED', 'Սխալ գաղտնաբառ։'); state.credentials[user.id] = data.newDigest; user.passwordChangedAt = now(); state.challenges.filter(item => item.userId === user.id).forEach(item => { item.consumed = true; }); return null; },
  'settings.deactivate': (state, data) => { const user = me(state); if (state.credentials[user.id] !== data.digest) throw new DataError('UNAUTHORIZED', 'Սխալ գաղտնաբառ։'); user.status = 'deactivated'; state.sessionUserId = null; return null; },
  'settings.deleteAccount': (state, data) => {
    const user = me(state), id = user.id;
    if (state.credentials[id] !== data.digest) throw new DataError('UNAUTHORIZED', 'Սխալ գաղտնաբառ։');
    const postIds = state.posts.filter(item => item.userId === id).map(item => item.id);
    const topicIds = state.topics.filter(item => item.userId === id).map(item => item.id);
    for (const key of ['education', 'certificates', 'posts', 'topics', 'media']) state[key] = state[key].filter(item => item.userId !== id);
    state.comments = state.comments.filter(item => item.userId !== id && !postIds.includes(item.postId));
    state.replies = state.replies.filter(item => item.userId !== id && !topicIds.includes(item.topicId));
    state.replies.forEach(item => { item.likes = item.likes.filter(userId => userId !== id); });
    state.messages = state.messages.filter(item => item.senderId !== id);
    state.rooms.forEach(room => { room.participants = room.participants.filter(userId => userId !== id); delete room.preferences[id]; });
    state.rooms = state.rooms.filter(room => room.participants.length);
    state.blocks = state.blocks.filter(item => item.userId !== id && item.targetId !== id);
    state.challenges = state.challenges.filter(item => item.userId !== id);
    state.users = state.users.filter(item => item.id !== id); delete state.credentials[id]; delete state.settings[id]; state.sessionUserId = null;
    return null;
  },
  'settings.export': state => {
    const user = me(state), id = user.id;
    return { exportedAt: now(), user: profile(state, user), settings: state.settings[id], posts: state.posts.filter(item => item.userId === id), comments: state.comments.filter(item => item.userId === id), topics: state.topics.filter(item => item.userId === id), replies: state.replies.filter(item => item.userId === id).map(({ likes, ...item }) => item), messages: state.messages.filter(item => item.senderId === id) };
  },
};

export function createMockProvider() {
  const listeners = new Set();
  const urls = new Map();
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('polylink-mock-updates') : null;
  const notify = event => listeners.forEach(listener => listener(event));
  if (channel) channel.onmessage = event => notify(event.data);
  window.addEventListener('pagehide', event => { if (event.persisted) return; for (const url of urls.values()) URL.revokeObjectURL(url); channel?.close(); });
  async function hydrate(result) {
    const media = await transaction(state => state.media);
    function walk(value) {
      if (typeof value === 'string' && value.startsWith('media:')) {
        const id = value.slice(6), item = media.find(item => item.id === id);
        if (!item) return '';
        if (!urls.has(id)) urls.set(id, URL.createObjectURL(item.blob));
        return urls.get(id);
      }
      if (Array.isArray(value)) return value.map(walk);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, value]) => [key, walk(value)]));
      return value;
    }
    return walk(result);
  }
  async function call(operation, ...args) {
    if (!operations[operation]) throw new DataError('UNSUPPORTED', 'Այս գործողությունը հասանելի չէ։');
    const scenario = await transaction(state => {
      const failure = state.scenario.failures[operation];
      delete state.scenario.failures[operation];
      return { latency: state.scenario.latency, failure };
    }, { write: true });
    if (scenario.latency) await new Promise(resolve => setTimeout(resolve, scenario.latency));
    if (scenario.failure) throw new DataError(scenario.failure.code, scenario.failure.message, {}, true);
    // Hashing is outside IndexedDB transactions; no production credentials enter mock fixtures.
    if (['auth.register', 'auth.login'].includes(operation)) {
      const data = { ...args[0], email: email(args[0].email) };
      if (operation === 'auth.register') password(data.password);
      data.digest = await digest(data.email, data.password); delete data.password; args = [data];
    }
    if (operation === 'auth.forgotPassword') args = [email(args[0])];
    if (operation === 'auth.resetPassword') {
      const item = await transaction(state => challenge(state, args[0].recoveryToken, 'recovery'));
      const address = await transaction(state => find(state.users, item.userId).email);
      args = [{ recoveryToken: args[0].recoveryToken, digest: await digest(address, password(args[0].newPassword)) }];
    }
    if (['settings.changeEmail', 'settings.changePassword', 'settings.deactivate', 'settings.deleteAccount'].includes(operation)) {
      const user = await transaction(state => me(state)), data = args[0];
      if (operation === 'settings.changeEmail') {
        const address = email(data.email); args = [{ email: address, oldDigest: await digest(user.email, data.password), newDigest: await digest(address, data.password) }];
      } else if (operation === 'settings.changePassword') args = [{ oldDigest: await digest(user.email, data.oldPassword), newDigest: await digest(user.email, password(data.newPassword)) }];
      else args = [{ digest: await digest(user.email, data.password) }];
    }
    const write = !readOperations.has(operation);
    const result = await transaction(state => {
      if (!publicOperations.has(operation)) me(state);
      return operations[operation](state, ...args);
    }, { write });
    if (result instanceof DataError) throw result;
    if (write) { const event = { operation, at: now() }; notify(event); channel?.postMessage(event); }
    if (operation === 'settings.export') {
      const media = await transaction(state => state.media.filter(item => item.userId === me(state).id));
      const assets = await Promise.all(media.map(item => new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve({ id: item.id, type: item.blob.type, dataUrl: reader.result }); reader.onerror = () => reject(new DataError('STORAGE', 'Չհաջողվեց արտահանել պատկերները։')); reader.readAsDataURL(item.blob);
      })));
      return { ...result, media: assets };
    }
    return hydrate(result);
  }
  return {
    call,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    controls: {
      async reset() { for (const url of urls.values()) URL.revokeObjectURL(url); urls.clear(); await transaction(() => null, { reset: true }); notify({ operation: 'reset' }); channel?.postMessage({ operation: 'reset' }); },
      async latency(milliseconds) { if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > 30000) throw new DataError('VALIDATION', 'Delay must be between 0 and 30000 ms'); await transaction(state => { state.scenario.latency = milliseconds; }, { write: true }); },
      async failNext(operation, code = 'SERVICE_ERROR', message = 'Ցուցադրական սխալ։ Կրկին փորձեք։') { if (!operations[operation]) throw new DataError('VALIDATION', 'Unknown operation'); await transaction(state => { state.scenario.failures[operation] = { code, message }; }, { write: true }); },
      async clearScenarios() { await transaction(state => { state.scenario = { latency: 0, failures: {} }; }, { write: true }); },
      async incoming(roomId, text) {
        const result = await transaction(state => {
          const room = roomForUser(state, roomId), own = me(state).id;
          const senderId = room.participants.find(id => id !== own);
          if (!senderId) throw new DataError('VALIDATION', 'No other participant');
          if (isBlocked(state, own, senderId) || isBlocked(state, senderId, own)) throw new DataError('FORBIDDEN', 'Օգտատերը արգելափակված է։');
          const message = { id: nextId(state, 'message'), roomId: room.id, senderId, text: required(text, 'text', 5000), createdAt: now(), attachment: null };
          state.messages.push(message); preference(room, own).hidden = false; return messageView(state, message);
        }, { write: true });
        notify({ operation: 'chat.incoming' }); channel?.postMessage({ operation: 'chat.incoming' }); return result;
      },
      operations: Object.keys(operations),
    },
  };
}
