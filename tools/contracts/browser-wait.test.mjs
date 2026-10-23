import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForAsync } from '../m1/browser-wait.mjs';
test('async browser wait retries resolved false instead of accepting the promise as truthy',async()=>{
 let attempts=0;
 const page={evaluate:async(predicate,arg)=>predicate(arg)};
 await waitForAsync(page,async value=>{await Promise.resolve();return ++attempts>=value;},3,{timeout:2000});
 assert.equal(attempts,3);
});
test('async browser wait survives a navigation but preserves application errors',async()=>{
 let attempts=0;
 await waitForAsync({evaluate:async()=>{if(++attempts===1)throw new Error('Execution context was destroyed, most likely because of a navigation');return true;}},()=>true,undefined,{timeout:2000});
 assert.equal(attempts,2);
 await assert.rejects(waitForAsync({evaluate:async()=>{throw new Error('Real application failure');}},()=>true),/Real application failure/);
});
