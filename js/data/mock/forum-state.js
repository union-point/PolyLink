import { DataError } from '../errors.js';
import { majors } from '../models.js';
import { richContent, required } from '../validation.js';
import { plainText, sanitizeHtml } from '../../shared/content.js';
import { nextId } from './store.js';
const invalid = field => new DataError('VALIDATION', 'Խնդրում ենք ստուգել լրացված դաշտերը։', { [field]: 'Անվավեր արժեք։' });
const missing = () => new DataError('NOT_FOUND', 'Թեման կամ պատասխանը չի գտնվել։');
const find = (items, id) => { const item = items.find(item => item.id === String(id)); if (!item) throw missing(); return item; };
const fields = (data, allowed) => { if (!data || typeof data !== 'object') throw invalid('content'); for (const key of Object.keys(data)) if (!allowed.includes(key)) throw invalid(key); };
const content = value => { if (typeof value !== 'string' || value.length > 100000) throw invalid('content'); return richContent(value); };
function category(code) { if (!Object.hasOwn(majors, code)) throw invalid('categoryCode'); return code; }
function access(state) {
  const user = state.users.find(user => user.id === state.sessionUserId && user.status === 'active');
  if (!user) throw new DataError('UNAUTHORIZED', 'Խնդրում ենք մուտք գործել։');
  if (!['graduate', 'lecturer'].includes(user.role)) throw new DataError('FORBIDDEN', 'Այս գործողությունը հասանելի չէ։');
  return user;
}
export function upgradeForumState(state) {
  state.forumRequests ||= [];
  for (const topic of state.topics) { topic.categoryCode ||= topic.major; delete topic.major; topic.version ||= '1'; topic.updatedAt ??= null; }
  for (const reply of state.replies) { reply.version ||= '1'; reply.updatedAt ??= null; }
}
function author(state, id) {
  const user = find(state.users, id), deleted = user.status === 'deleted';
  return { id: deleted ? null : id, name: deleted ? 'Ջնջված օգտատեր' : user.name, avatar: deleted ? '' : user.avatar || '', canOpenProfile: !deleted && user.status === 'active' && (id === state.sessionUserId || (state.settings[id]?.isProfilePublic ?? true)) };
}
function topicView(state, topic) {
  const clean = sanitizeHtml(topic.content);
  return { id: topic.id, title: topic.title, content: clean, excerpt: plainText(clean).slice(0,220), categoryCode: topic.categoryCode, categoryName: majors[topic.categoryCode], version: topic.version, createdAt: topic.createdAt, updatedAt: topic.updatedAt, author: author(state,topic.userId), replyCount: state.replies.filter(reply=>reply.topicId===topic.id).length, canEdit: topic.userId===state.sessionUserId, canDelete: topic.userId===state.sessionUserId };
}
function replyView(state, reply) {
  return { id: reply.id, topicId: reply.topicId, content: sanitizeHtml(reply.content), version: reply.version, createdAt: reply.createdAt, updatedAt: reply.updatedAt, author: author(state,reply.userId), likeCount: reply.likes.length, liked: reply.likes.includes(state.sessionUserId), canEdit: reply.userId===state.sessionUserId, canDelete: reply.userId===state.sessionUserId, isTopicAuthor: reply.userId===find(state.topics,reply.topicId).userId };
}
function own(state, item, version) {
  if (item.userId !== access(state).id) throw new DataError('FORBIDDEN', 'Այս գործողությունը հասանելի չէ։');
  if (typeof version !== 'string' || !/^[1-9][0-9]*$/.test(version)) throw invalid('expectedVersion');
  if (version !== item.version) throw new DataError('EDIT_CONFLICT', 'Բովանդակությունը փոխվել է։ Ձեր սևագիրը պահպանված է․ բեռնեք վերջին տարբերակը։');
}
function compare(a,b,sort='newest') {
  const date = a.createdAt.localeCompare(b.createdAt), id = a.id.localeCompare(b.id, undefined, {numeric:true});
  return sort==='oldest' ? date||id : (sort==='popular' ? b.likeCount-a.likeCount : 0)||-date||-id;
}
function page(items, options, scope, sort) {
  const limit = options.limit ?? 20; if (!Number.isInteger(limit)||limit<1||limit>100) throw invalid('limit');
  let after;
  if (options.cursor) {
    try { const parsed=JSON.parse(atob(options.cursor)); if(parsed.scope!==scope||!parsed.key?.id||!parsed.key?.createdAt)throw Error();after=parsed.key; }
    catch { throw invalid('cursor'); }
  }
  const sorted=items.sort((a,b)=>compare(a,b,sort)).filter(item=>!after||compare(item,after,sort)>0);
  const visible=sorted.slice(0,limit), last=visible.at(-1);
  return {items:visible,nextCursor:sorted.length>limit?btoa(JSON.stringify({scope,key:{id:last.id,createdAt:last.createdAt,likeCount:last.likeCount}})):null};
}
function create(state, operation, input, payload, build, view) {
  if (typeof input.requestId!=='string'||!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(input.requestId)) throw invalid('requestId');
  const user=access(state), fingerprint=JSON.stringify(payload), now=Date.now();
  state.forumRequests=state.forumRequests.filter(item=>item.at>now-86400000);
  const prior=state.forumRequests.find(item=>item.user===user.id&&item.op===operation&&item.key===input.requestId);
  if(prior){if(prior.fingerprint!==fingerprint)throw new DataError('REQUEST_CONFLICT','Հարցման նույնացուցիչն արդեն օգտագործված է։');return view(prior.id);}
  const item=build(user.id);state.forumRequests.push({user:user.id,op:operation,key:input.requestId,fingerprint,id:item.id,at:now});return view(item.id);
}
export const forumOperations = {
  'forum.categories': state => { access(state); return Object.entries(majors).map(([code,name],i)=>({id:String(i+1),code,name})); },
  'forum.list': (state,options={}) => { access(state);if(options.categoryCode)category(options.categoryCode);return page(state.topics.filter(item=>!options.categoryCode||item.categoryCode===options.categoryCode).map(item=>topicView(state,item)),options,`topics:${options.categoryCode||''}`,'newest'); },
  'forum.get': (state,id) => { access(state);return topicView(state,find(state.topics,id)); },
  'forum.create': (state,input) => {
    fields(input,['title','content','categoryCode','requestId']);const payload={title:required(input.title,'title',255),content:content(input.content),categoryCode:category(input.categoryCode)};
    return create(state,'topic',input,payload,userId=>{const item={...payload,id:nextId(state,'topic'),userId,createdAt:new Date().toISOString(),updatedAt:null,version:'1'};state.topics.push(item);return item;},id=>topicView(state,find(state.topics,id)));
  },
  'forum.update': (state,id,input) => { fields(input,['title','content','categoryCode','expectedVersion']);if(Object.keys(input).length<2)throw invalid('content');const item=find(state.topics,id);own(state,item,input.expectedVersion);if('title'in input)item.title=required(input.title,'title',255);if('content'in input)item.content=content(input.content);if('categoryCode'in input)item.categoryCode=category(input.categoryCode);item.version=String(BigInt(item.version)+1n);item.updatedAt=new Date().toISOString();return topicView(state,item); },
  'forum.delete': (state,id,version) => { const item=find(state.topics,id);own(state,item,version);state.topics=state.topics.filter(topic=>topic!==item);state.replies=state.replies.filter(reply=>reply.topicId!==item.id);return null; },
  'forum.replies.get': (state,id) => { access(state);return replyView(state,find(state.replies,id)); },
  'forum.replies.list': (state,id,options={}) => { access(state);find(state.topics,id);const sort=options.sort||'newest';if(!['newest','oldest','popular'].includes(sort))throw invalid('sort');return page(state.replies.filter(item=>item.topicId===String(id)).map(item=>replyView(state,item)),options,`replies:${id}:${sort}`,sort); },
  'forum.replies.create': (state,id,input) => { fields(input,['content','requestId']);find(state.topics,id);const payload={content:content(input.content),topicId:String(id)};return create(state,'reply',input,payload,userId=>{const item={...payload,id:nextId(state,'reply'),userId,createdAt:new Date().toISOString(),updatedAt:null,version:'1',likes:[]};state.replies.push(item);return item;},id=>replyView(state,find(state.replies,id))); },
  'forum.replies.update': (state,id,input) => { fields(input,['content','expectedVersion']);const item=find(state.replies,id);own(state,item,input.expectedVersion);item.content=content(input.content);item.version=String(BigInt(item.version)+1n);item.updatedAt=new Date().toISOString();return replyView(state,item); },
  'forum.replies.delete': (state,id,version) => { const item=find(state.replies,id);own(state,item,version);state.replies=state.replies.filter(reply=>reply!==item);return null; },
  'forum.replies.like': (state,id,liked) => { const user=access(state),item=find(state.replies,id);if(typeof liked!=='boolean')throw invalid('liked');item.likes=item.likes.filter(id=>id!==user.id);if(liked)item.likes.push(user.id);return replyView(state,item); },
};
