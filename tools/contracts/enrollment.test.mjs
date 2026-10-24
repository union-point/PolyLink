import test from 'node:test';
import assert from 'node:assert/strict';
import { universityEmail } from '../../js/data/validation.js';
import { createEnrollmentClient } from '../../js/auth/enrollment-client.js';
import { createIdentityClient } from '../../js/auth/identity-client.js';
import { createRecoveryClient } from '../../js/auth/recovery-client.js';

test('registration email contract permits only the exact normalized domain',()=>{
  assert.equal(universityEmail('  Person@POLYTECHNIC.AM '),'person@polytechnic.am');
  for(const value of ['a@sub.polytechnic.am','a@polytechnic.am.evil','a@evilpolytechnic.am','a@@polytechnic.am','a b@polytechnic.am','a@polytechnic․am'])assert.throws(()=>universityEmail(value));
});
test('enrollment client never restores application access and uses explicit enrollment routes',async()=>{
  const requests=[];const api={request:async request=>{requests.push(request);return {status:'enrollment'};},restore:()=>assert.fail('Enrollment cannot restore application access')};
  const client=createEnrollmentClient(api);
  await client.enrollment();await client.enrollmentOptions();await client.saveEnrollment({revision:3});await client.submitEnrollment({revision:4});await client.logoutEnrollment();
  assert.deepEqual(requests.map(r=>[r.method,r.url]),[['get','/auth/enrollment'],['get','/auth/enrollment/options'],['put','/auth/enrollment/profile'],['post','/auth/enrollment/submit'],['post','/auth/enrollment/logout']]);
});
test('pending password login returns enrollment without key setup or application refresh',async()=>{
  const requests=[];const api={request:async request=>{requests.push(request);if(request.url==='/auth/parameters')return {scheme:'PLK1',salt:'AAAAAAAAAAAAAAAAAAAAAA',opsLimit:2,memoryBytes:67108864};if(request.url==='/auth/login')return {status:'enrollment'};assert.fail(request.url);},setToken:()=>{},beginSession:()=>assert.fail('Pending login must not begin a session')};
  const client=createIdentityClient(api);
  try{assert.equal((await client.login({email:'pending@polytechnic.am',password:'Pending password!4',persistChallenge:true})).status,'enrollment');assert.deepEqual(requests.map(r=>r.url),['/auth/parameters','/auth/login']);assert(!JSON.stringify(requests).includes('Pending password!4'));assert.equal(client.isUnlocked(),false);}finally{client.close();}
});
test('registration returns restricted enrollment without retaining a password for later navigation',async()=>{
  const requests=[];const api={request:async request=>{requests.push(request);assert.equal(request.url,'/auth/register');return {status:'enrollment'};},setToken:()=>{}};
  const client=createIdentityClient(api);
  try{assert.equal((await client.register({email:'new@polytechnic.am',password:'New password!4',firstName:'New',lastName:'Applicant',role:'graduate'})).status,'enrollment');assert.equal(requests.length,1);assert.equal(requests[0].data.password,undefined);assert.equal(client.isUnlocked(),false);}finally{client.close();}
});
test('pending recovery only writes enrollment credentials and does not invoke vault recovery',async()=>{
  const requests=[];const client=createRecoveryClient({request:async request=>{requests.push(request);if(request.url==='/auth/recovery/status')return {state:'ENROLLMENT',email:'pending@polytechnic.am'};assert.equal(request.url,'/auth/enrollment/password');return {status:'enrollment'};}},{finish:()=>assert.fail('Pending recovery cannot log into the application')});
  const result=await client.resetPassword({newPassword:'Replacement password!4'});assert.equal(result.status,'enrollment');assert.equal(requests[1].data.password,undefined);assert.deepEqual(requests.map(r=>r.url),['/auth/recovery/status','/auth/enrollment/password']);
});
