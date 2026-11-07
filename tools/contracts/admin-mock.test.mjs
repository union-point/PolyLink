import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockAdminProvider } from '../../js/admin/mock.js';
import { createSeed } from '../../js/data/mock/seed.js';

function fixture(){
 const state=createSeed(),values=new Map();let clock=Date.now();
 const transaction=async action=>{const copy=structuredClone(state);const result=action(copy);Object.assign(state,copy);return structuredClone(result);};
 const storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
 const provider=createMockAdminProvider({transaction,storage,now:()=>clock});
 return {provider,state,storage,transaction,now:()=>clock,advance:ms=>clock+=ms};
}
const derivation={scheme:'PLK1',salt:'AAAAAAAAAAAAAAAAAAAAAA',opsLimit:3,memoryBytes:67108864};
async function register(f,email='admin@example.org'){
 const invite=await f.provider.provisionInvitation(email);
 await f.provider.request('/auth/registration/invitation',{method:'POST',data:{token:invite.token}});
 const draft={token:invite.token,firstName:'Անի',lastName:'Ադմին',loginSecret:'derived-secret',derivation};
 const challenge=await f.provider.request('/auth/registration/start',{method:'POST',data:draft});
 const code=await f.provider.takeCode(email);
 await f.provider.request('/auth/registration/verify',{method:'POST',data:{challengeId:challenge.challengeId,code}});
 return invite;
}
async function login(f,email='admin@example.org'){
 const challenge=await f.provider.request('/auth/login',{method:'POST',data:{email,scheme:'PLK1',loginSecret:'derived-secret'}});
 await assert.rejects(f.provider.request('/auth/session'),e=>e.code==='UNAUTHORIZED');
 const code=await f.provider.takeCode(email);
 return (await f.provider.request('/auth/login/verify',{method:'POST',data:{challengeId:challenge.challengeId,code}})).admin;
}
const call=(f,path,data,method='POST')=>f.provider.request(path,{method,data});

test('mock admin invitations are one use, registration creates no session, and every login requires a browser-bound factor',async()=>{
 const f=fixture(),member=f.state.sessionUserId,invite=await register(f);
 assert.equal(f.state.sessionUserId,member);assert(!JSON.stringify(f.state.adminMock.invitations).includes(invite.token));
 await assert.rejects(call(f,'/auth/registration/invitation',{token:invite.token}),e=>e.code==='NOT_FOUND');
 const admin=await login(f);assert.equal(admin.role,'admin');assert.equal((await f.provider.request('/auth/session')).email,'admin@example.org');
 const previous=f.storage.getItem('polylink.admin.mock.session');await call(f,'/auth/refresh',{});assert.notEqual(f.storage.getItem('polylink.admin.mock.session'),previous);
 await f.provider.disable(admin.id);await assert.rejects(f.provider.request('/auth/session'),e=>e.code==='UNAUTHORIZED');
});
test('mock references enforce system, usage, uniqueness and stale versions and synchronize member options',async()=>{
 const f=fixture();await register(f);await login(f);
 const base='/references/post-types',initial=await f.provider.request(base);
 const builtIn=initial.items.find(r=>r.code==='job');await assert.rejects(call(f,base+'/'+builtIn.id,{version:builtIn.version},'DELETE'),e=>e.code==='SYSTEM_VALUE');
 const created=await call(f,base,{name:'Custom type',code:'custom'});assert(f.state.postTypes.some(r=>r.code==='custom'));
 await assert.rejects(call(f,base,{name:'Duplicate code',code:'custom'}),e=>e.code==='DUPLICATE_CODE');
 const path=base+'/'+created.id,edited=await call(f,path,{name:'Renamed',version:created.version},'PUT');
 await assert.rejects(call(f,path,{name:'Stale',version:created.version},'PUT'),e=>e.code==='VERSION_CONFLICT');
 f.state.posts.push({category:'custom'});await assert.rejects(call(f,path,{version:edited.version},'DELETE'),e=>e.code==='REFERENCE_IN_USE');f.state.posts.pop();
 await call(f,path,{version:edited.version},'DELETE');assert(!f.state.postTypes.some(r=>r.code==='custom'));
 const university=await call(f,'/references/universities',{name:'New university'});assert(f.state.profileReferences.universities.some(r=>r.id===university.id));
});
test('mock registry normalizes identity keys and enforces linked status, valid dates and reference ids',async()=>{
 const f=fixture();await register(f);await login(f);
 const input={firstName:'Անի',lastName:'Օրինակ',diplomaNumber:' ＡＢ   12 ',specializationId:'1',studyStartDate:'2020-09-01',studyEndDate:'2024-06-01'};
 const row=await call(f,'/registries/alumni',input);
 await assert.rejects(call(f,'/registries/alumni',{...input,diplomaNumber:'ab 12'}),e=>e.code==='DUPLICATE_DIPLOMA');
 await assert.rejects(call(f,'/registries/alumni',{...input,diplomaNumber:'new',studyEndDate:'2024-02-30'}),e=>e.code==='VALIDATION');
 await assert.rejects(call(f,'/registries/alumni',{...input,diplomaNumber:'new',specializationId:'999'}),e=>e.code==='VALIDATION');
 f.state.adminMock.registries.alumni.find(r=>r.id===row.id).linked=true;
 await assert.rejects(call(f,'/registries/alumni/'+row.id,{version:row.version},'DELETE'),e=>e.code==='RECORD_LINKED');
});
test('mock challenge expiry, attempt budget, replay and foreign browser checks persist',async()=>{
 const f=fixture();await register(f);const data={email:'admin@example.org',scheme:'PLK1',loginSecret:'derived-secret'};
 const c=await call(f,'/auth/login',data);const code=await f.provider.takeCode(data.email);
 const other=createMockAdminProvider({transaction:f.transaction,storage:{getItem:()=>null,setItem(){},removeItem(){}},now:f.now});
 await assert.rejects(other.request('/auth/login/verify',{method:'POST',data:{challengeId:c.challengeId,code}}),e=>e.code==='UNAUTHORIZED');
 for(let i=0;i<5;i++)await assert.rejects(call(f,'/auth/login/verify',{challengeId:c.challengeId,code:code==='000000'?'000001':'000000'}),e=>e.code==='UNAUTHORIZED');
 await assert.rejects(call(f,'/auth/login/verify',{challengeId:c.challengeId,code}),e=>e.code==='UNAUTHORIZED');
 const fresh=await call(f,'/auth/login',data);f.advance(600001);await assert.rejects(call(f,'/auth/login/verify',{challengeId:fresh.challengeId,code:await f.provider.takeCode(data.email)}),e=>e.code==='UNAUTHORIZED');
});
test('mock invitation boundary and query-bound pagination reject stale or foreign proofs',async()=>{
 const f=fixture(),invite=await f.provider.provisionInvitation('future@example.org');f.advance(86400000);
 await assert.rejects(call(f,'/auth/registration/invitation',{token:invite.token}),e=>e.code==='NOT_FOUND');
 await register(f);await login(f);
 for(let n=0;n<52;n++)await call(f,'/references/professions',{name:'Fixture '+n});
 const page=await f.provider.request('/references/professions?q=Fixture');assert.equal(page.items.length,50);assert(page.nextCursor);
 await assert.rejects(f.provider.request('/references/degrees?cursor='+page.nextCursor),e=>e.code==='VALIDATION');
 assert.equal((await f.provider.request('/references/professions?q=Fixture&cursor='+page.nextCursor)).items.length,2);
});
