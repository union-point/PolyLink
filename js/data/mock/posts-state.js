import { DataError } from '../errors.js';
import { nextId } from './store.js';
import { sanitizePostHtml, validatePostInput, validateComment } from '../../posts/content.js';
const types=[{code:'job',name:'Աշխատանք'},{code:'internship',name:'Պրակտիկա'},{code:'training',name:'Դասընթաց'}];
const spheres=[{id:'1',name:'Ծրագրավորում',isOther:false},{id:'2',name:'Ինժեներություն',isOther:false},{id:'3',name:'Տվյալների գիտություն',isOther:false},{id:'5',name:'Մարկետինգ',isOther:false},{id:'4',name:'Այլ',isOther:true}];
const missing=()=>new DataError('NOT_FOUND','Հայտարարությունը կամ մեկնաբանությունը հասանելի չէ։');
const invalid=field=>new DataError('VALIDATION','Անվավեր արժեք։',{[field]:'Ստուգեք դաշտը։'});
const find=(items,id)=>{const item=items.find(item=>item.id===String(id));if(!item)throw missing();return item;};
const fields=(data,keys)=>{if(!data||typeof data!=='object'||Array.isArray(data))throw invalid('input');for(const key of Object.keys(data))if(!keys.includes(key))throw invalid(key);};
const time=()=>new Date().toISOString();
export function upgradePostsState(state) {
  if(state.postsDataVersion===1)return;
  const mapping={'programming':'1','engineering':'2','data-science':'3','marketing':'5','other':'4'};
  for(const post of state.posts){post.sphereId??=mapping[post.sphere]||null;delete post.sphere;post.updatedAt??=null;}
  for(const comment of state.comments)comment.updatedAt??=null;
  for(const setting of Object.values(state.settings))setting.postCommentNotifications??=true;
  state.activity??=[];state.activitySequence??=0;state.postCursors??={};state.postsDataVersion=1;
}
function user(state,write=false){const user=state.users.find(u=>u.id===state.sessionUserId&&u.status==='active');if(!user)throw new DataError('UNAUTHORIZED','Մուտք գործեք։');if(write&&!['graduate','lecturer'].includes(user.role))throw new DataError('FORBIDDEN','Այս գործողությունը հասանելի չէ։');return user;}
function own(state,item){if(item.userId!==user(state,true).id)throw new DataError('FORBIDDEN','Այս գործողությունը հասանելի չէ։');return item;}
function author(state,id){const u=state.users.find(u=>u.id===id);const deleted=!u||u.status==='deleted';return {id:deleted?null:id,name:deleted?'Ջնջված օգտատեր':u.name,avatar:deleted?'':u.avatar||'',canOpenProfile:!deleted&&u.status==='active'&&(id===state.sessionUserId||state.settings[id]?.isProfilePublic!==false)};}
function common(state,item){const editable=item.userId===state.sessionUserId&&state.users.find(u=>u.id===item.userId)?.status==='active';return {id:item.id,createdAt:item.createdAt,updatedAt:item.updatedAt??null,author:author(state,item.userId),canEdit:editable,canDelete:editable};}
function postView(state,item){const type=types.find(t=>t.code===item.category),sphere=spheres.find(s=>s.id===item.sphereId);return {...common(state,item),title:item.title?.trim()?item.title:null,content:sanitizePostHtml(item.content),category:type?.code??null,categoryName:type?.name??null,sphereId:sphere?.id??null,sphereName:sphere?.name??null,commentCount:state.comments.filter(c=>c.postId===item.id).length};}
function commentView(state,item){return {...common(state,item),postId:item.postId,text:item.text};}
function input(data){fields(data,['title','content','category','sphereId']);const result=validatePostInput(data);if(!spheres.some(s=>s.id===result.sphereId))throw invalid('sphereId');return result;}
const compare=(a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt)||a.id.localeCompare(b.id,undefined,{numeric:true});
function page(state,items,scope,cursor,view,descending=false){
  user(state);if(cursor){const key=state.postCursors[cursor];if(!key||key.scope!==scope||key.user!==state.sessionUserId)throw invalid('cursor');items=items.filter(item=>(descending?-1:1)*compare(item,key)>0);}
  items.sort((a,b)=>(descending?-1:1)*compare(a,b));const visible=items.slice(0,20);let nextCursor=null;
  if(items.length>20){nextCursor=crypto.randomUUID();state.postCursors[nextCursor]={scope,user:state.sessionUserId,id:visible.at(-1).id,createdAt:visible.at(-1).createdAt};}
  return {items:visible.map(item=>view(state,item)),nextCursor};
}
function parentComment(state,post,id){find(state.posts,post);const comment=find(state.comments,id);if(comment.postId!==String(post))throw missing();return comment;}
function clearActivity(state,predicate){state.activity=state.activity.filter(item=>!predicate(item));}
export const postOperations={
  'posts.options':state=>{user(state);return {types,spheres};},
  'posts.get':(state,id)=>{user(state);return postView(state,find(state.posts,id));},
  'posts.list':(state,filters={})=>{fields(filters,['category','sphereId','userId','cursor']);if(filters.category&&!types.some(t=>t.code===filters.category))throw invalid('category');if(filters.sphereId&&!spheres.some(s=>s.id===filters.sphereId))throw invalid('sphereId');if(filters.userId&&(typeof filters.userId!=='string'||!/^([1-9][0-9]*|user-[0-9]+)$/.test(filters.userId)))throw invalid('userId');const scope=JSON.stringify([filters.category||'',filters.sphereId||'',filters.userId||'']);return page(state,state.posts.filter(p=>(!filters.category||p.category===filters.category)&&(!filters.sphereId||p.sphereId===filters.sphereId)&&(!filters.userId||p.userId===filters.userId)),scope,filters.cursor,postView,true);},
  'posts.create':(state,data)=>{const actor=user(state,true);const record={...input(data),id:nextId(state,'post'),userId:actor.id,createdAt:time(),updatedAt:null};state.posts.push(record);return postView(state,record);},
  'posts.update':(state,id,data)=>{const post=own(state,find(state.posts,id)),values=input(data);if(Object.entries(values).some(([key,value])=>post[key]!==value))Object.assign(post,values,{updatedAt:time()});return postView(state,post);},
  'posts.delete':(state,id)=>{const post=own(state,find(state.posts,id));clearActivity(state,item=>item.postId===post.id);state.comments=state.comments.filter(c=>c.postId!==post.id);state.posts=state.posts.filter(p=>p!==post);return null;},
  'posts.comments.list':(state,post,params={})=>{find(state.posts,post);fields(params,['cursor']);return page(state,state.comments.filter(c=>c.postId===String(post)),`comments:${post}`,params.cursor,commentView);},
  'posts.comments.create':(state,postId,data)=>{const actor=user(state,true),post=find(state.posts,postId);fields(data,['text']);const comment={id:nextId(state,'comment'),postId:post.id,userId:actor.id,text:validateComment(data.text),createdAt:time(),updatedAt:null};state.comments.push(comment);if(post.userId!==actor.id&&state.users.find(u=>u.id===post.userId)?.status==='active')state.activity.push({id:String(++state.activitySequence),kind:'POST_COMMENT',userId:post.userId,actorId:actor.id,postId:post.id,commentId:comment.id,createdAt:comment.createdAt});return commentView(state,comment);},
  'posts.comments.update':(state,post,id,data)=>{const comment=own(state,parentComment(state,post,id));fields(data,['text']);const text=validateComment(data.text);if(text!==comment.text)Object.assign(comment,{text,updatedAt:time()});return commentView(state,comment);},
  'posts.comments.delete':(state,post,id)=>{const comment=own(state,parentComment(state,post,id));clearActivity(state,item=>item.commentId===comment.id);state.comments=state.comments.filter(c=>c!==comment);return null;},
};
function eligible(state){return state.activity.filter(item=>item.userId===user(state).id&&state.settings[item.userId]?.postCommentNotifications!==false&&state.users.find(u=>u.id===item.actorId)?.status==='active'&&state.posts.some(p=>p.id===item.postId)&&state.comments.some(c=>c.id===item.commentId));}
function activityView(state,item){const {userId,actorId,...safe}=item;return {...safe,title:author(state,actorId).name,body:'Նոր մեկնաբանություն ձեր հայտարարության տակ'};}
export const activityOperations={
  'notifications.list':(state,{cursor='initial',limit=50}={})=>{user(state);if(!Number.isInteger(limit)||limit<1||limit>100)throw invalid('limit');if(cursor==='initial')return {items:[],nextCursor:String(state.activitySequence)};if(!/^[0-9]+$/.test(cursor))throw invalid('cursor');const scan=state.activity.filter(i=>i.userId===state.sessionUserId&&BigInt(i.id)>BigInt(cursor)).slice(0,limit);const ids=new Set(scan.map(i=>i.id));return {items:eligible(state).filter(i=>ids.has(i.id)).map(i=>activityView(state,i)),nextCursor:scan.at(-1)?.id||cursor};},
  'notifications.history':(state,{cursor=''}={})=>{const scope=`history:${state.sessionUserId}`;let before=Infinity;if(cursor){const key=state.postCursors[cursor];if(!key||key.scope!==scope)throw invalid('cursor');before=key.before;}const records=eligible(state).filter(i=>Number(i.id)<before).sort((a,b)=>Number(b.id)-Number(a.id)),visible=records.slice(0,20);let nextCursor=null;if(records.length>20){nextCursor=crypto.randomUUID();state.postCursors[nextCursor]={scope,before:Number(visible.at(-1).id)};}return {items:visible.map(i=>activityView(state,i)),nextCursor};},
};
