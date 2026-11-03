// Managed avatars always cross the authenticated backend transport.
import { config } from '../config.js';
let api, generation=0;
const cached=new Map(), sources=new Map();
export function configureAvatars(transport){api=transport;}
export function avatarId(value){
  value=sources.get(value)||value;
  if(typeof value!=='string')return null;
  try{return new URL(value,config.apiBaseUrl).pathname.match(/^\/auth\/avatars\/([0-9a-f-]{36})$/i)?.[1]||null;}catch{return null;}
}
export function clearAvatars(){
  generation++;
  for(const value of sources.keys())URL.revokeObjectURL(value);
  cached.clear();sources.clear();
}
export async function avatarURL(value){
  const id=avatarId(value);if(!id||!api)return value;
  if(!cached.has(id)){
    const epoch=generation;
    const pending=api.request({method:'get',url:`/auth/avatars/${id}`,responseType:'arraybuffer',maxContentLength:262144})
      .then(bytes=>{if(epoch!==generation)return 'image/logo.png';const blob=URL.createObjectURL(new Blob([bytes],{type:'image/jpeg'}));sources.set(blob,`/auth/avatars/${id}`);return blob;})
      .catch(()=>{cached.delete(id);return 'image/logo.png';});
    cached.set(id,pending);
  }
  return cached.get(id);
}
export async function hydrateAvatars(value){
  if(!value||typeof value!=='object'||value instanceof Blob||value instanceof ArrayBuffer)return value;
  for(const key of Object.keys(value)){
    if((key==='avatar'||key==='ProfilePhotoUrl')&&typeof value[key]==='string')value[key]=await avatarURL(value[key]);
    else if(value[key]&&typeof value[key]==='object')await hydrateAvatars(value[key]);
  }
  return value;
}
globalThis.addEventListener?.('pagehide',clearAvatars);
