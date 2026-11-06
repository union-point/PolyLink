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
