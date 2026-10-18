import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
const origin=`http://localhost:${port}`;
const server=spawn('python3',[path.join(root,'server.py'),'--port',String(port)],{stdio:'ignore'});
let browser;
try{
  for(let i=0;i<50;i++){try{await fetch(origin+'/login.html');break;}catch{await new Promise(resolve=>setTimeout(resolve,100));}}
  browser=await chromium.launch({headless:true,executablePath:process.env.M1_CHROMIUM||undefined});
  const page=await browser.newPage();await page.goto(origin+'/login.html');
  const samples=await page.evaluate(async()=>{
    const {derive}=await import('/js/crypto/sodium.js');const results=[];
    for(let i=0;i<3;i++){
      const start=performance.now();const keys=await derive('Synthetic PLK1 fixture only!',{scheme:'PLK1',salt:'AAECAwQFBgcICQoLDA0ODw',opsLimit:2,memoryBytes:67108864});
      results.push(Math.round(performance.now()-start));keys.login.fill(0);keys.wrapping.fill(0);
    }
    return results;
  });
  console.log(JSON.stringify({browser:browser.version(),algorithm:'Argon2id13',worker:true,opsLimit:2,memoryBytes:67108864,sampleMilliseconds:samples,medianMilliseconds:[...samples].sort((a,b)=>a-b)[1]}));
}finally{await browser?.close();server.kill('SIGTERM');}
