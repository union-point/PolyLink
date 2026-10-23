// waitForFunction treats a Promise as truthy before polling its resolved value.
// page.evaluate awaits the predicate; retry false results explicitly in Node.
export async function waitForAsync(page,predicate,arg,options={}){
  const timeout=options.timeout??30000,deadline=Date.now()+timeout;
  while(Date.now()<deadline){
    if(await page.evaluate(predicate,arg))return;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error(`Async browser condition did not become true within ${timeout}ms`);
}
