import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminClient, adminRequest } from '../../js/admin/client.js';
const settings = {scheme:'PLK1',salt:'AAAAAAAAAAAAAAAAAAAAAA',opsLimit:3,memoryBytes:67108864};
const challenge = {status:'challenge',challengeId:'12345678-1234-1234-1234-123456789abc',expiresAt:'2026-11-07T12:10:00Z',resendAfter:'2026-11-07T12:01:00Z'};
const admin = {id:'1',email:'owner@example.org',firstName:'Owner',lastName:'Fixture',role:'admin'};

test('admin login derives a credential and waits for second factor without member operations',async()=>{
  const calls=[];
  const client=createAdminClient(async(path,body)=>{calls.push({path,body});return path==='/parameters'?settings:path==='/login'?challenge:{status:'authenticated',admin};},async(password,value)=>{assert.equal(password,'password');assert.deepEqual(value,settings);return 'derived-login-secret';});
  const pending=await client.login(' OWNER@Example.org ','password');
  assert.equal(pending.challengeId,challenge.challengeId);
  assert.deepEqual(calls.map(call=>call.path),['/parameters','/login']);
  assert.deepEqual(calls[1].body,{email:'owner@example.org',scheme:'PLK1',loginSecret:'derived-login-secret'});
  assert(!JSON.stringify(calls).includes('password'));
  assert.deepEqual(await client.verify('login',pending.challengeId,'123456'),admin);
  assert(!calls.some(call=>call.path.includes('/keys')||call.path.includes('/auth/me')));
});
test('admin proof validation and response parsing reject bypasses and malformed sessions',async()=>{
  let count=0;const client=createAdminClient(async()=>{count++;return {status:'authenticated',admin:{...admin,role:'graduate'}};});
  await assert.rejects(client.verify('recovery',challenge.challengeId,'123456'),error=>error.code==='VALIDATION');
  await assert.rejects(client.verify('login',challenge.challengeId,'abc'),error=>error.code==='VALIDATION');
  assert.equal(count,0);
  await assert.rejects(client.verify('login',challenge.challengeId,'123456'),error=>error.code==='CONTRACT');
});
test('admin registration validates confirmation before deriving or sending credentials',async()=>{
  let contacted=false;const client=createAdminClient(async()=>{contacted=true;},async()=>{throw Error('Should not derive');});
  await assert.rejects(client.register({token:'token',firstName:'Owner',lastName:'Fixture',password:'Strong pass!9',confirmation:'different'}),error=>error.code==='VALIDATION');
  assert.equal(contacted,false);
});
test('admin transport uses only its isolated CSRF cookie and never a member bearer',async()=>{
  const previousFetch=globalThis.fetch,previousDocument=globalThis.document;
  const calls=[];globalThis.document={cookie:'__Host-plk-refresh-csrf=member; __Host-plk-admin-csrf=admin; __Host-plk-admin-challenge-csrf=challenge'};
  globalThis.fetch=async(url,request)=>{calls.push({url,request});return {ok:true,status:200,json:async()=>({})};};
  try {
    await adminRequest('/refresh',{});await adminRequest('/login/verify',{challengeId:challenge.challengeId,code:'123456'});
    assert.equal(calls[0].request.headers['X-CSRF-Token'],'admin');assert.equal(calls[1].request.headers['X-CSRF-Token'],'challenge');
    for(const {request} of calls){assert.equal(request.headers.Authorization,undefined);assert.equal(request.credentials,'include');assert.equal(request.cache,'no-store');}
  } finally {globalThis.fetch=previousFetch;globalThis.document=previousDocument;}
});

test('management transport scopes routes, preserves versions and rejects malformed authority data',async()=>{
 const {createManagementClient}=await import('../../js/admin/management-client.js');
 const calls=[],row={id:'2',name:'Reference',version:'opaque',protectionReasons:[]};
 const client=createManagementClient(async(path,options)=>{calls.push({path,options});return options?.method==='DELETE'?null:path.includes('?')?{items:[row],nextCursor:null}:row;});
 assert.equal((await client.list('references','degrees',{q:'A & B'})).items[0].id,'2');
 assert.match(calls[0].path,/q=A\+%26\+B/);
 await client.update('references','degrees','2',{name:'New',version:'opaque'});
 assert.equal(calls[1].options.method,'PUT');assert.equal(calls[1].options.data.version,'opaque');
 await client.delete('references','degrees','2','opaque');assert.deepEqual(calls[2].options.data,{version:'opaque'});
 await assert.rejects(client.list('references','roles'),e=>e.code==='VALIDATION');
 await assert.rejects(client.get('references','degrees','../auth'),e=>e.code==='VALIDATION');
 const {normalizeReference,normalizeRegistry,normalizeAdminPage}=await import('../../js/admin/contracts.js');
 assert.throws(()=>normalizeReference({...row,protectionReasons:['forged']}),e=>e.code==='CONTRACT');
 assert.throws(()=>normalizeAdminPage({items:[row]},normalizeReference),e=>e.code==='CONTRACT');
 assert.throws(()=>normalizeRegistry({id:'1',version:'v',linked:'false'},'lecturers'),e=>e.code==='CONTRACT');
});
