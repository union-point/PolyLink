import { sodium, aad } from './sodium.js';
import { DataError } from '../data/errors.js';
export const imageLimit=5*1024*1024;
const types=new Set(['image/png','image/jpeg','image/gif','image/webp']);
export function imageMetadata(value){
  if(!value||Object.keys(value).sort().join(',')!=='id,key,name,nonce,size,type'||!types.has(value.type)||!Number.isInteger(value.size)||value.size<1||value.size>imageLimit||typeof value.name!=='string'||value.name.length>255||!/^[-\w]{43}$/.test(value.key)||!/^[-\w]{32}$/.test(value.nonce)||!(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/).test(value.id))throw new DataError('DATA_INTEGRITY','Invalid encrypted image metadata.');
  return value;
}
export async function validateImageBytes(bytes,type,size=bytes.length){
  if(!types.has(type)||bytes.length!==size||size<1||size>imageLimit)throw new DataError('VALIDATION','Choose a PNG, JPEG, GIF or WebP image no larger than 5 MiB.');
  const at=(start,values)=>values.every((v,i)=>bytes[start+i]===v);
  const actual=at(0,[137,80,78,71,13,10,26,10])?'image/png':at(0,[255,216,255])?'image/jpeg':at(0,[71,73,70,56])&&(bytes[4]===55||bytes[4]===57)&&bytes[5]===97?'image/gif':at(0,[82,73,70,70])&&at(8,[87,69,66,80])?'image/webp':null;
  if(actual!==type)throw new DataError('VALIDATION','The image contents do not match its type.');
  const blob=new Blob([bytes],{type});
  if(typeof createImageBitmap==='function'){
    let bitmap;try{bitmap=await createImageBitmap(blob);if(!bitmap.width||!bitmap.height)throw new Error();}
    catch{throw new DataError('VALIDATION','This image could not be decoded.');}finally{bitmap?.close();}
  }else if(typeof Image!=='undefined'){
    const url=URL.createObjectURL(blob);
    try{await new Promise((resolve,reject)=>{const image=new Image();image.onload=resolve;image.onerror=reject;image.src=url;});}
    catch{throw new DataError('VALIDATION','This image could not be decoded.');}finally{URL.revokeObjectURL(url);}
  }
  return blob;
}
export async function encryptImage(file,room,owner){
  if(!(file instanceof Blob)||file.size<1||file.size>imageLimit||!types.has(file.type))throw new DataError('VALIDATION','Choose a PNG, JPEG, GIF or WebP image no larger than 5 MiB.');
  const bytes=new Uint8Array(await file.arrayBuffer()),s=await sodium(),key=s.randombytes_buf(32),nonce=s.randombytes_buf(24),id=crypto.randomUUID();
  const b64=value=>s.to_base64(value,s.base64_variants.URLSAFE_NO_PADDING);
  try{
    await validateImageBytes(bytes,file.type);
    const name=(file.name||'image').slice(0,255);
    return {attachment:{id,name,type:file.type,size:bytes.length,key:b64(key),nonce:b64(nonce)},upload:{id,ciphertext:b64(s.crypto_aead_xchacha20poly1305_ietf_encrypt(bytes,aad('image',room,owner,id),null,nonce,key))},fileSignature:b64(s.crypto_generichash(32,bytes))};
  }finally{key.fill(0);bytes.fill(0);}
}
export async function decryptImage(ciphertext,metadata,room,owner){
  imageMetadata(metadata);const s=await sodium(),from=value=>s.from_base64(value,s.base64_variants.URLSAFE_NO_PADDING);let key,plain;
  try{
    if(ciphertext.length!==metadata.size+16)throw new Error();
    key=from(metadata.key);const nonce=from(metadata.nonce);if(key.length!==32||nonce.length!==24)throw new Error();
    plain=s.crypto_aead_xchacha20poly1305_ietf_decrypt(null,ciphertext,aad('image',room,owner,metadata.id),nonce,key);
    return await validateImageBytes(plain,metadata.type,metadata.size);
  }catch{throw new DataError('DATA_INTEGRITY','An encrypted image could not be authenticated or decoded.');}
  finally{key?.fill(0);plain?.fill(0);}
}
