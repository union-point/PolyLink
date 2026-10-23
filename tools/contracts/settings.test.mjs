import test from 'node:test';
import assert from 'node:assert/strict';
import { zip, fullExport } from '../../js/account-export.js';
import { spawnSync } from 'node:child_process';
test('ZIP is readable by an independent reader and preserves Unicode and binary files',async()=>{
 const blob=zip([['data.json','{"name":"Հայերեն"}'],['files/image',new Uint8Array([0,255,1,2])]]);
 const result=spawnSync('python3',['-c',`import io,sys,zipfile,json
z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))
assert json.loads(z.read('data.json'))['name']=='Հայերեն'
assert z.read('files/image')==bytes([0,255,1,2])
assert z.testzip() is None`],{input:Buffer.from(await blob.arrayBuffer())});
 assert.equal(result.status,0,result.stderr.toString());
});
test('ZIP rejects exports larger than the documented cap',()=>{
 assert.throws(()=>zip([['huge',new Uint8Array(100*1024*1024+1)]]),error=>error.code==='EXPORT_TOO_LARGE');
});
test('full export uses a header grant, walks pages and reports unavailable legacy assets',async()=>{
 const requests=[];const api={request:async request=>{requests.push(request);return {items:request.params.category==='profile'?[{FirstName:'Test',ProfilePhotoUrl:'https://example.invalid/private'}]:[],complete:true};}};
 const identity={accountProof:async(url,data)=>{assert.equal(url,'/account/export/authorize');assert.equal(data.password,'secret');return {grant:'test-grant'};}};
 const chat={exportOwn:async options=>{assert.equal(options.headers['X-Export-Grant'],'test-grant');return {messages:[],unavailable:[{messageId:'bad',reason:'DATA_INTEGRITY'}]};}};
 const result=await fullExport(api,identity,chat,{password:'secret'});
 assert.equal(result.type,'application/zip');assert.equal(requests.length,9);
 for(const request of requests){assert.equal(request.headers['X-Export-Grant'],'test-grant');assert(!request.url.includes('test-grant'));}
});
