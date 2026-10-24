import test from 'node:test';
import assert from 'node:assert/strict';
import { createHttpProvider } from '../../js/data/http/provider.js';
import { routes } from '../../js/data/http/routes.js';
import { normalizeForumTopic, normalizeReply, normalizeForumPage, createRequestKey } from '../../js/forum/contracts.js';
const author={id:'7',name:'Member',avatar:'',canOpenProfile:false};
const common={id:'1',content:'<p>Test</p>',createdAt:'2026-10-24T12:00:00Z',updatedAt:null,version:'1',author,canEdit:true,canDelete:true};
const topic={...common,title:'Title',categoryCode:'energy',categoryName:'Energy',excerpt:'Test',replyCount:34};
const reply={...common,topicId:'1',likeCount:4,liked:false,isTopicAuthor:true};
test('forum pages preserve pagination and use server-side filtering',async()=>{
 const requests=[];const provider=createHttpProvider(Promise.resolve({request:async request=>{requests.push(request);return {items:[topic],nextCursor:'opaque-next'};}}));
 const result=await provider.call('forum.list',{categoryCode:'energy',cursor:'prior',limit:20});
 assert.equal(result.nextCursor,'opaque-next');assert.equal(result.items[0].replyCount,34);
 assert.deepEqual(requests[0].params,{categoryCode:'energy',cursor:'prior',limit:20});
});
test('forum replies have their own normalizer and preserve permissions and liked state',async()=>{
 const provider=createHttpProvider(Promise.resolve({request:async()=>({items:[reply],nextCursor:null})}));
 const result=await provider.call('forum.replies.list','1',{sort:'popular'});
 assert.equal(result.items[0].likeCount,4);assert.equal(result.items[0].isTopicAuthor,true);assert.equal(result.nextCursor,null);
});
test('forum rejects malformed pages rather than dropping metadata or fabricating counts',()=>{
 for(const page of [[],{data:[topic],nextCursor:'x'},{items:[topic]},{items:[topic],nextCursor:''},{items:[{...topic,replyCount:'34'}],nextCursor:null}])assert.throws(()=>normalizeForumPage(page,normalizeForumTopic),e=>e.code==='CONTRACT');
 assert.throws(()=>normalizeReply(topic),e=>e.code==='CONTRACT');
});
test('deleted forum authors may have null IDs and no actionable link',()=>{
 const result=normalizeForumTopic({...topic,author:{...author,id:null,name:'Deleted account',canOpenProfile:false}});
 assert.equal(result.author.id,null);assert.equal(result.author.canOpenProfile,false);
});
test('forum writes carry complete input and explicit desired like state',()=>{
 assert.equal(routes['forum.update']('1',{expectedVersion:'9'}).method,'patch');
 assert.deepEqual(routes['forum.replies.like']('3',false).data,{liked:false});
 assert.deepEqual(routes['forum.delete']('1','9').params,{expectedVersion:'9'});
 const input={title:'A',content:'B',categoryCode:'energy',requestId:'key'};
 assert.deepEqual(routes['forum.create'](input).data,input);
});
test('create retries reuse their key until payload changes or creation succeeds',()=>{
 const request=createRequestKey(),data={content:'same'};
 const one=request.for(data);assert.equal(request.for({...data}),one);assert.notEqual(request.for({content:'changed'}),one);
 const two=request.for(data);request.clear();assert.notEqual(request.for(data),two);
});
test('HTTP forum errors propagate without a demo-data fallback',async()=>{
 const failure=Object.assign(new Error('Unavailable'),{code:'SERVICE_UNAVAILABLE'});
 const provider=createHttpProvider(Promise.resolve({request:async()=>{throw failure;}}));
 await assert.rejects(provider.call('forum.list'),error=>error===failure);
});
