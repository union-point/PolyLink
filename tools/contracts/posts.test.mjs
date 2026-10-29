import test from 'node:test';
import assert from 'node:assert/strict';
import { createHttpProvider } from '../../js/data/http/provider.js';
import { routes } from '../../js/data/http/routes.js';
import { normalizePost, normalizeComment, normalizePostPage, normalizePostOptions } from '../../js/posts/contracts.js';
const author={id:'7',name:'Member',avatar:'',canOpenProfile:false};
const post={id:'1',author,createdAt:'2026-10-24T12:00:00.1234567Z',updatedAt:null,canEdit:true,canDelete:true,title:null,content:'<p>Legacy</p>',category:null,categoryName:null,sphereCode:null,sphereName:null,commentCount:45};
const comment={id:'2',author,postId:'1',createdAt:post.createdAt,updatedAt:null,canEdit:false,canDelete:false,text:'<b>plain</b>'};
test('posts forward combined filters and preserve page envelope and full timestamp precision',async()=>{
 const requests=[],provider=createHttpProvider(Promise.resolve({request:async r=>{requests.push(r);return {items:[post],nextCursor:'opaque'};}}));
 const filters={category:'job',sphereCode:'engineering',userId:'7',cursor:'prior'};const page=await provider.call('posts.list',filters);
 assert.equal(page.items.length,1);assert.equal(page.items[0].commentCount,45);assert.equal(page.nextCursor,'opaque');assert.equal(page.items[0].createdAt,post.createdAt);assert.equal(page.items[0].title,null);assert.ok(!('comments'in page.items[0]));assert.equal(requests[0].url,'/posts');assert.deepEqual(requests[0].params,filters);
});
test('posts comments retain independent parent paging and permissions',async()=>{
 const requests=[],provider=createHttpProvider(Promise.resolve({request:async r=>{requests.push(r);return {items:[comment],nextCursor:null};}}));
 const page=await provider.call('posts.comments.list','1',{cursor:'earlier'});assert.deepEqual(requests[0].params,{cursor:'earlier'});assert.equal(page.items[0].text,'<b>plain</b>');assert.equal(page.items[0].canDelete,false);
});
test('strict post DTOs reject fabricated fields and malformed envelopes',()=>{
 for(const value of [{...post,commentCount:'45'},{...post,category:'unknown'},{...post,title:undefined},{...post,createdAt:'2026-01-01 12:00:00'},{...post,canEdit:1},{...post,sphereCode:'13'}])assert.throws(()=>normalizePost(value),e=>e.code==='CONTRACT');
 for(const page of [[],{items:[post]},{items:[post],nextCursor:''},{items:Array(21).fill(post),nextCursor:null}])assert.throws(()=>normalizePostPage(page),e=>e.code==='CONTRACT');
 assert.throws(()=>normalizeComment(post),e=>e.code==='CONTRACT');assert.equal(normalizePost({...post,author:{...author,id:null}}).author.id,null);
});
test('post options include exactly supported types and unique reference codes with Other',()=>{
 const options={types:['job','internship','training'].map(code=>({code,name:code})),spheres:[{code:'other',name:'Այլ'}]};assert.deepEqual(normalizePostOptions(options),options);
 assert.throws(()=>normalizePostOptions({...options,spheres:[]}),e=>e.code==='CONTRACT');
 assert.throws(()=>normalizePostOptions({...options,spheres:[{code:'123',name:'Invalid code'}]}),e=>e.code==='CONTRACT');
 assert.throws(()=>normalizePostOptions({...options,spheres:[...options.spheres,...options.spheres]}),e=>e.code==='CONTRACT');
 assert.throws(()=>normalizePostOptions({...options,types:[options.types[0]]}),e=>e.code==='CONTRACT');
});
test('post writes use full replacement and preserve unknown fields for server rejection',()=>{
 const input={title:'A',content:'B',category:'job',sphereCode:'other',forged:true};assert.deepEqual(routes['posts.create'](input).data,input);assert.deepEqual(routes['posts.update']('1',input),{method:'put',url:'/posts/1',data:input});assert.equal(routes['posts.get']('1').url,'/posts/1');assert.ok(!('expectedVersion'in routes['posts.delete']('1')));
});
test('posts HTTP failures propagate without fallback data',async()=>{const failure=new Error('Offline'),provider=createHttpProvider(Promise.resolve({request:async()=>{throw failure;}}));await assert.rejects(provider.call('posts.list'),e=>e===failure);});

test('browser notification targets dispatch explicit kinds and ignore unknown events',async()=>{
 const {notificationTarget}=await import('../../js/shared/browser-notifications.js');
 assert.equal(notificationTarget({kind:'POST_COMMENT',postId:'7'}),'post.html?id=7');
 assert.equal(notificationTarget({kind:'FORUM_REPLY',topicId:'2',replyId:'3'}),'topic.html?id=2&reply=3');
 assert.equal(notificationTarget({kind:'DIRECT_MESSAGE',roomId:'room'}),'message.html?room=room');
 assert.equal(notificationTarget({kind:'ANNOUNCEMENT',roomId:'room'}),null);
 assert.equal(notificationTarget({kind:'POST_COMMENT'}),null);
});

test('shared browser presentation persists a zero baseline and never treats unknown activity as chat',async()=>{
 const {createBrowserPresentation}=await import('../../js/shared/browser-notifications.js');
 const records=new Map([['polylink.notifications.viewer','true']]),shown=[];
 globalThis.localStorage={getItem:key=>records.get(key)??null,setItem:(key,value)=>records.set(key,value)};
 globalThis.window={addEventListener(){},removeEventListener(){},focus(){}};
 Object.defineProperty(globalThis,'navigator',{value:{locks:{request:async(key,options,action)=>action({})}},configurable:true});
 globalThis.BroadcastChannel=undefined;
 globalThis.Notification=class{static permission='granted';constructor(title,options){Object.assign(this,{title,...options});shown.push(this);}close(){}};
 const presenter=createBrowserPresentation('viewer');await presenter.present([],'0');assert.equal(records.get('polylink.notifications.viewer.cursor'),'0');
 await presenter.present([{id:'1',kind:'ANNOUNCEMENT',title:'Ignored',roomId:'room'}],'1');assert.equal(shown.length,0);
 await presenter.present([{id:'2',kind:'POST_COMMENT',postId:'7',title:'Member',body:'Comment'}],'2');assert.equal(shown[0].tag,'polylink-post-7');
 await presenter.present([{id:'2',kind:'POST_COMMENT',postId:'7',title:'Member'}],'2');assert.equal(shown.length,1);presenter.stop();
});
