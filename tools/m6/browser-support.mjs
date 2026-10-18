import { isolateDecorativeAssets } from '../m1/browser-assets.mjs';
import { chromium } from '../m1/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
export const origin=process.env.M1_FRONTEND,api=process.env.M1_API,baseEmail=process.env.M1_BROWSER_EMAIL;
export const contexts=[],errors=[],payloads=[],uploads=[],sends=[],reads=[];
export const email=index=>baseEmail.replace('browser-',`m6-${index}-`),password='M6 Browser fixture pass!8';
export async function context(index,mock=false){
  const ctx=await chromium.launchPersistentContext(path.join(process.env.M1_ARTIFACT_DIR,`m6-${index}`),{headless:true,viewport:{width:1280,height:900},executablePath:process.env.M1_CHROMIUM||undefined});contexts.push(ctx);await isolateDecorativeAssets(ctx);ctx.setDefaultTimeout(30000);ctx.setDefaultNavigationTimeout(60000);
  await ctx.route('**/js/config.js',async route=>{const response=await route.fetch();let body=(await response.text()).replace('http://localhost:3004',api);if(mock)body=body.replace(/dataMode:\s*['"](?:http|mock)['"]/,"dataMode: 'mock'");await route.fulfill({response,body,contentType:'application/javascript'});});
  await ctx.route('**/axios@*/dist/axios.min.js',route=>route.fulfill({path:new URL('../m1/node_modules/axios/dist/axios.min.js',import.meta.url).pathname,contentType:'application/javascript'}));
  ctx.on('request',request=>{
    if(!request.url().startsWith(api))return;const data=request.postDataBuffer();
    if(request.url().endsWith('/attachments')&&data){assert(!data.includes(Buffer.from('private-image-name.png')));uploads.push({id:request.headers()['x-attachment-id'],hash:createHash('sha256').update(data).digest('hex'),length:data.length});}
    else if(data){const text=data.toString();payloads.push(text);if(request.url().endsWith('/messages')&&request.method()==='POST')sends.push(JSON.parse(text));if(request.url().endsWith('/read'))reads.push(JSON.parse(text).throughSequence);}
  });
  ctx.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));const p=ctx.pages()[0]||await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(origin+'/login.html');return {ctx,p};
}
export async function proof(address){for(let i=0;i<30;i++){const listing=await(await fetch(process.env.M1_MAILPIT_URL+'/api/v1/messages')).json(),item=listing.messages.find(m=>m.To.some(to=>to.Address===address));if(item){const mail=await(await fetch(process.env.M1_MAILPIT_URL+'/api/v1/message/'+item.ID)).json();return mail.Text.match(/\b\d{6}\b/)[0];}await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('Missing capture email');}
export const call=(p,feature,method,args=[])=>p.evaluate(async({feature,method,args})=>{const services=await import('/js/services/index.js');return services[feature][method](...args);},{feature,method,args});
export const chat=(p,method,...args)=>call(p,'chat',method,args);
export async function image(p,room,large=false,type='image/png'){
  return p.evaluate(async({room,large,type})=>{
    const canvas=document.createElement('canvas');canvas.width=2;canvas.height=2;canvas.getContext('2d').fillRect(0,0,2,2);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,type));const initial=new Uint8Array(await blob.arrayBuffer());
    const bytes=large?new Uint8Array(5*1024*1024):initial;if(large)bytes.set(initial);
    const {chat}=await import('/js/services/index.js');return chat.send(room,{file:new File([bytes],'private-image-name.png',{type})});
  },{room,large,type});
}
export async function downloadCode(p,id){return p.evaluate(async id=>{const {loadTransport}=await import('/js/data/http/transport.js');const api=await loadTransport();await api.restore();try{await api.request({method:'get',url:'/chat/attachments/'+id,responseType:'arraybuffer'});return 'allowed';}catch(e){return e.code;}},id);}
