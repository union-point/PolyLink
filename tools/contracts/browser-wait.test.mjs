import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForAsync } from '../m1/browser-wait.mjs';
test('async browser wait retries resolved false instead of accepting the promise as truthy',async()=>{
 let attempts=0;
 const page={evaluate:async(predicate,arg)=>predicate(arg)};
 await waitForAsync(page,async value=>{await Promise.resolve();return ++attempts>=value;},3,{timeout:2000});
 assert.equal(attempts,3);
});
