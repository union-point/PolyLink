import { DataError } from '../data/errors.js';
import { validateImage } from '../data/validation.js';
import { validateImageBytes } from '../crypto/images.js';
export function profileImage(file) {
  validateImage(file);
  if(!['image/png','image/jpeg'].includes(file.type))throw new DataError('VALIDATION','Ընտրեք JPG կամ PNG պատկեր (առավելագույնը 5 ՄԲ)։');
  return file;
}
// Mock storage mirrors the production image representation; HTTP normalization is authoritative.
export async function normalizeMockImage(kind,file) {
  profileImage(file);await validateImageBytes(new Uint8Array(await file.arrayBuffer()),file.type);
  const bitmap=await createImageBitmap(file);
  try {
    const {width:w,height:h}=bitmap;
    if(w>4096||h>4096||w*h>16000000)throw new DataError('VALIDATION','Պատկերը չափազանց մեծ է։');
    const avatar=kind==='avatar',scale=Math.min(1,1920/w,1080/h),canvas=document.createElement('canvas');
    canvas.width=avatar?256:Math.max(1,Math.floor(w*scale));canvas.height=avatar?256:Math.max(1,Math.floor(h*scale));
    const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);
    if(avatar){const side=Math.min(w,h);ctx.drawImage(bitmap,(w-side)/2,(h-side)/2,side,side,0,0,256,256);}else ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.85));
    if(!blob)throw new DataError('VALIDATION','Պատկերը հնարավոր չէ մշակել։');return blob;
  }finally{bitmap.close();}
}
