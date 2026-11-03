import test from 'node:test';
import assert from 'node:assert/strict';
import {createEnrollmentClient} from '../../js/auth/enrollment-client.js';
import {configureAvatars,avatarURL,avatarId,clearAvatars,hydrateAvatars} from '../../js/shared/avatar-images.js';

test('ambiguous avatar retries reuse operation identity and bind the expected version',async()=>{
 const requests=[];let fail=true;
 const client=createEnrollmentClient({request:async request=>{requests.push(request);if(fail){fail=false;throw {retryable:true};}return {url:'/auth/avatars/one'};}});
 await assert.rejects(client.uploadEnrollmentAvatar('bytes','previous'));
 await client.uploadEnrollmentAvatar('bytes','previous');
 assert.deepEqual(requests[0].data,requests[1].data);
 assert.equal(requests[1].data.expectedPhotoId,'previous');
 await client.removeEnrollmentAvatar('newer');assert.equal(requests[2].params.expectedPhotoId,'newer');
});
test('avatars use authenticated transport, deduplicate and revoke blob URLs',async()=>{
 const id='12345678-1234-1234-1234-123456789abc',requests=[];
 configureAvatars({request:async request=>{requests.push(request);return new Uint8Array([1,2,3]).buffer;}});
 const value=await hydrateAvatars({author:{avatar:`/auth/avatars/${id}`}});
 assert.match(value.author.avatar,/^blob:/);assert.equal(avatarId(value.author.avatar),id);
 assert.equal(await avatarURL(`/auth/avatars/${id}`),value.author.avatar);assert.equal(requests.length,1);
 assert.equal(requests[0].url,`/auth/avatars/${id}`);
 clearAvatars();assert.equal(avatarId(value.author.avatar),null);
});
