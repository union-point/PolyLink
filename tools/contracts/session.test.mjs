import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransport } from '../../js/data/http/transport.js';
const records=new Map();
globalThis.localStorage={getItem:key=>records.get(key)??null,setItem:(key,value)=>records.set(key,value),removeItem:key=>records.delete(key)};
let cookies='';globalThis.document={get cookie(){return cookies;},set cookie(value){const [pair,...attributes]=value.split(';');const [key,val]=pair.split('=');const values=new Map(cookies.split('; ').filter(Boolean).map(v=>v.split('=')));if(attributes.some(a=>a.trim()==='Max-Age=0'))values.delete(key);else values.set(key,val);cookies=[...values].map(v=>v.join('=')).join('; ');}};
function axiosFixture(adapter,refresh){
  const requestHandlers=[],responseHandlers=[];
  const api=async request=>{
    let prepared={...request,headers:{...request.headers}};
    for(const handler of requestHandlers)prepared=await handler(prepared);
    try{let response={data:await adapter(prepared),config:prepared};for(const [handler]of responseHandlers)response=await handler(response);return response;}
    catch(error){error.config??=prepared;for(const [,handler]of responseHandlers)return handler(error);throw error;}
  };
  api.interceptors={request:{use:handler=>requestHandlers.push(handler)},response:{use:(ok,fail)=>responseHandlers.push([ok,fail])}};
  return {create:()=>api,post:refresh};
}
test('one refresh serves parallel restores; logout rejects a late refresh and keeps the local marker',async()=>{
  records.clear();cookies='';let resolve,refreshes=0;
  const transport=createTransport(axiosFixture(async()=>({}),()=>{refreshes++;return new Promise(done=>{resolve=done;});}));
  const one=transport.restore(),two=transport.restore();assert.equal(refreshes,1);
  transport.markLoggedOut();resolve({data:{accessToken:'late-secret'}});
  for(const result of await Promise.allSettled([one,two]))assert.equal(result.reason.code,'SESSION_CHANGED');
  assert(transport.isLoggedOut());await assert.rejects(transport.restore(),error=>error.code==='UNAUTHORIZED');
  assert(![...records.values()].includes('late-secret'));transport.beginSession();assert(!transport.isLoggedOut());
});
test('an unauthorized operation refreshes once and preserves its operation bytes',async()=>{
  records.clear();cookies='';const requests=[];let refreshed=0;
  const transport=createTransport(axiosFixture(async request=>{
    requests.push(structuredClone(request));
    if(request.headers.Authorization==='Bearer old')throw {response:{status:401,data:{code:'UNAUTHORIZED'}}};
    return {id:'saved'};
  },async()=>{refreshed++;return {data:{accessToken:'new'}};}));
  transport.setToken('old');const operation={operationId:'immutable',packet:{nonce:'same',ciphertext:'same'}};
  assert.deepEqual(await transport.request({method:'post',url:'/chat/rooms/room/messages',data:operation}),{id:'saved'});
  assert.equal(refreshed,1);assert.deepEqual(requests[0].data,requests[1].data);
  assert.equal(requests[1].headers.Authorization,'Bearer new');
});
test('expired password commit keeps its original bearer for status replay and never auto-refreshes',async()=>{
  records.clear();cookies='';let refreshes=0;
  const transport=createTransport(axiosFixture(async request=>{throw {response:{status:401,data:{code:'UNAUTHORIZED'}},config:{...request,data:{loginSecret:'must-not-retain'}}};},async()=>{refreshes++;}));
  transport.setToken('old');
  await assert.rejects(transport.request({method:'post',url:'/auth/password-change/commit',data:{operationId:'same'}}),error=>error.code==='UNAUTHORIZED'&&!JSON.stringify(error).includes('must-not-retain'));
  assert.equal(refreshes,0);
});
