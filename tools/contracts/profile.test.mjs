import test from 'node:test';
import assert from 'node:assert/strict';
import { profileUpdate, period, educationInput, educationRange } from '../../js/profile/contracts.js';
import { profileOptions, saveEducation } from '../../js/data/mock/profile-state.js';
import { createHttpProvider } from '../../js/data/http/provider.js';
import { normalizeEducation } from '../../js/data/http/normalize.js';
import { validateCertificate } from '../../js/data/validation.js';
import { fullExport } from '../../js/account-export.js';
const options=profileOptions(),input={universityId:options.universities[0].id,startDate:'2020',endDate:'2020-01',isOngoing:false};
test('education validates references and compares partial dates while preserving legacy days',()=>{
 assert.equal(educationInput(input,options).startDate,'2020');
 assert.throws(()=>educationInput({...input,universityId:'missing'},options));
 assert.throws(()=>educationInput({...input,startDate:'2020-02',endDate:'2020-01'},options));
 assert.throws(()=>educationInput({...input,isOngoing:true},options));
 assert.throws(()=>period('2020-13','startDate'));assert.throws(()=>period('1899','startDate'));
 const saved=saveEducation({}, {...input,startDate:'2019-09-23'}, {startDate:'2019-09-23'});assert.equal(saved.startPrecision,'DAY');assert.equal(saved.institution,options.universities[0].name);
 const dto=normalizeEducation({id:'1',...saved});assert.equal(dto.startDate,'2019-09-23');assert.equal(dto.universityId,input.universityId);
 assert.match(educationRange({...saved,endDate:null,isOngoing:false}),/Նշված չէ/);assert.match(educationRange({...saved,endDate:null,isOngoing:true}),/Շարունակվում է/);
});
test('identity is immutable and certificates require organization with safe links',()=>{
 assert.throws(()=>profileUpdate({firstName:'Forged',jobTitle:'',description:''}));assert.throws(()=>profileUpdate({jobTitle:'x'.repeat(151),description:''}));assert.deepEqual(profileUpdate({jobTitle:'',description:''}),{jobTitle:'',description:''});
 for(const data of [{name:'Certificate',organization:''},{name:'Certificate',organization:'Issuer',credentialUrl:'javascript:alert(1)'},{name:'Certificate',organization:'Issuer',issueDate:'2020-13'}])assert.throws(()=>validateCertificate(data));
 assert.equal(validateCertificate({name:'Certificate',organization:'Issuer',credentialUrl:'https://example.org/proof'}).credentialUrl,'https://example.org/proof');
});
test('HTTP education options and precision travel through the provider without label writes',async()=>{
 const requests=[],provider=createHttpProvider({request:async r=>{requests.push(r);return r.url.endsWith('options')?options:{id:'1',...saveEducation({},input)};}});
 assert.equal((await provider.call('profiles.education.options')).universities.length,options.universities.length);
 const record=await provider.call('profiles.education.create',input);assert.equal(record.startDate,'2020');assert.equal(record.startPrecision,'YEAR');assert.equal(requests[1].data.universityId,input.universityId);assert(!('institution' in requests[1].data));
});
test('export downloads managed profile media with grant and stores image bytes in ZIP',async()=>{
 const requests=[],url='https://api.invalid/auth/avatars/photo';
 const api={request:async r=>{requests.push(r);if(r.url==='/account/export/profile-media')return [{id:'photo',kind:'avatar',url}];if(r.url.includes('/profile-media/'))return new Uint8Array([255,216,255]).buffer;return {items:r.params.category==='profile'?[{ProfilePhotoUrl:url}]:[],complete:true};}};
 const blob=await fullExport(api,{accountProof:async()=>({grant:'proof'})},{exportOwn:async()=>({messages:[],unavailable:[]})},{password:'test'});
 const text=new TextDecoder().decode(await blob.arrayBuffer());assert(text.includes('files/profile-avatar-photo.jpg'));assert(!text.includes('Legacy file has no authorized storage mapping'));
 assert(requests.every(r=>r.headers['X-Export-Grant']==='proof'));
});
