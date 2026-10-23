import { DataError } from './data/errors.js';
const LIMIT=100*1024*1024;
const encoder=new TextEncoder();
const table=Uint32Array.from({length:256},(_,i)=>{for(let n=0;n<8;n++)i=i&1?0xedb88320^(i>>>1):i>>>1;return i>>>0;});
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes)crc=table[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
// ZIP STORE entries keep archive creation dependency-free and bound to the export cap.
export function zip(files){
  if(files.length>65535)throw new DataError('EXPORT_TOO_LARGE','Export contains too many files.');
  const chunks=[],central=[];let offset=0,total=0;
  for(const [path,source] of files){
    const name=encoder.encode(path),bytes=typeof source==='string'?encoder.encode(source):source;
    total+=bytes.length;if(total>LIMIT)throw new DataError('EXPORT_TOO_LARGE','Export exceeds 100 MiB.');
    const header=new Uint8Array(30+name.length),h=new DataView(header.buffer),crc=crc32(bytes);
    h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x800,true);h.setUint32(14,crc,true);h.setUint32(18,bytes.length,true);h.setUint32(22,bytes.length,true);h.setUint16(26,name.length,true);header.set(name,30);
    const record=new Uint8Array(46+name.length),c=new DataView(record.buffer);c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x800,true);c.setUint32(16,crc,true);c.setUint32(20,bytes.length,true);c.setUint32(24,bytes.length,true);c.setUint16(28,name.length,true);c.setUint32(42,offset,true);record.set(name,46);
    chunks.push(header,bytes);central.push(record);offset+=header.length+bytes.length;
  }
  const end=new Uint8Array(22),view=new DataView(end.buffer);view.setUint32(0,0x06054b50,true);view.setUint16(8,files.length,true);view.setUint16(10,files.length,true);view.setUint32(12,central.reduce((n,b)=>n+b.length,0),true);view.setUint32(16,offset,true);
  return new Blob([...chunks,...central,end],{type:'application/zip'});
}
export async function fullExport(api,identity,chat,{password}){
  const {grant}=await identity.accountProof('/account/export/authorize',{password});
  const headers={'X-Export-Grant':grant},data={},unavailable=[],files=[];let size=0;
  const account=bytes=>{size+=bytes;if(size>LIMIT)throw new DataError('EXPORT_TOO_LARGE','Export exceeds 100 MiB.');};
  for(const category of ['profile','settings','education','certificates','workExperience','posts','comments','topics','replies']){
    data[category]=[];let offset=0;
    for(;;){const page=await api.request({method:'get',url:'/account/export/data',params:{category,offset},headers});account(encoder.encode(JSON.stringify(page.items)).length);data[category].push(...page.items);if(page.complete)break;if(page.nextOffset<=offset)throw new DataError('CONTRACT','Export cursor did not advance.');offset=page.nextOffset;}
  }
  const messages=await chat.exportOwn({headers,exportUrl:'/account/export/messages',onSize:account});data.messages=messages.messages;unavailable.push(...(messages.unavailable||[]));
  for(const message of data.messages){
    if(message.attachment?.data){const binary=atob(message.attachment.data),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));const path=`files/message-${files.length+1}`;files.push([path,bytes]);delete message.attachment.data;message.attachment.path=path;}
  }
  // Legacy URLs have no authenticated object-store mapping; never fetch arbitrary remote URLs.
  for(const [category,rows] of Object.entries(data))for(const row of rows){
    for(const [key,value] of Object.entries(row))if(typeof value==='string'&&/url$/i.test(key)&&value){
      if(value.startsWith('data:')){
        const match=/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(value);
        if(match){const bytes=Uint8Array.from(atob(match[2]),c=>c.charCodeAt(0)),path=`files/asset-${files.length+1}`;account(bytes.length);files.push([path,bytes]);row[key]={path,type:match[1]};continue;}
      }
      unavailable.push({category,field:key,reason:'Legacy file has no authorized storage mapping'});
    }
  }
  const manifest={version:1,exportedAt:new Date().toISOString(),counts:Object.fromEntries(Object.entries(data).map(([key,value])=>[key,value.length])),unavailable};
  return zip([['data.json',JSON.stringify(data,null,2)],['manifest.json',JSON.stringify(manifest,null,2)],...files]);
}
