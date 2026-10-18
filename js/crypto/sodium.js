let ready;
export function sodium(){
  ready ||= import('./vendor/libsodium-wrappers.mjs').then(async module=>{await module.default.ready;return module.default;});
  return ready;
}
export const aad=(...items)=>JSON.stringify(['PLK1',...items]);
export function parameters(value){
  if(value?.scheme!=='PLK1'||!Number.isInteger(value.opsLimit)||value.opsLimit<2||value.opsLimit>4||!Number.isSafeInteger(value.memoryBytes)||value.memoryBytes<67108864||value.memoryBytes>268435456||!/^[-\w]{22}$/.test(value.salt))throw new Error('Invalid password derivation parameters.');
  return value;
}
export async function deriveHere(password,settings){
  parameters(settings);const s=await sodium();
  const salt=s.from_base64(settings.salt,s.base64_variants.URLSAFE_NO_PADDING);
  if(salt.length!==16)throw new Error('Invalid password salt.');
  const master=s.crypto_pwhash(32,password,salt,settings.opsLimit,settings.memoryBytes,s.crypto_pwhash_ALG_ARGON2ID13);
  try{return {login:s.crypto_kdf_derive_from_key(32,1,'PLK1AUTH',master),wrapping:s.crypto_kdf_derive_from_key(32,1,'PLK1WRAP',master)};}
  finally{s.memzero(master);}
}
export async function derive(password,settings){
  parameters(settings);
  if(typeof Worker==='undefined')return deriveHere(password,settings);
  const worker=new Worker(new URL('./derive-worker.js',import.meta.url),{type:'module'});
  return new Promise((resolve,reject)=>{
    worker.onmessage=event=>{worker.terminate();event.data.error?reject(new Error('Password derivation failed.')):resolve(event.data);};
    worker.onerror=()=>{worker.terminate();reject(new Error('Password derivation is unavailable in this browser.'));};
    worker.postMessage({password,settings});
  });
}
export async function seal(plaintext,key,binding){
  const s=await sodium(),nonce=s.randombytes_buf(24);
  return {scheme:'PLK1',nonce:s.to_base64(nonce,s.base64_variants.URLSAFE_NO_PADDING),ciphertext:s.to_base64(s.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext,binding,null,nonce,key),s.base64_variants.URLSAFE_NO_PADDING)};
}
export async function open(packet,key,binding,maxBytes=1048592){
  const s=await sodium();
  if(packet?.scheme!=='PLK1')throw new Error('Unsupported encrypted data format.');
  const nonce=s.from_base64(packet.nonce,s.base64_variants.URLSAFE_NO_PADDING),cipher=s.from_base64(packet.ciphertext,s.base64_variants.URLSAFE_NO_PADDING);
  if(nonce.length!==24||cipher.length<16||cipher.length>maxBytes)throw new Error('Invalid encrypted packet.');
  return s.crypto_aead_xchacha20poly1305_ietf_decrypt(null,cipher,binding,nonce,key);
}
