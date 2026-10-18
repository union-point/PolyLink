const databaseName='polylink-key-device-v1';
const encoder=new TextEncoder();
const binding=(account,id,version)=>encoder.encode(JSON.stringify(['PLK1','device-copy',account,id,version]));
function database(){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(databaseName,1);
    request.onupgradeneeded=()=>request.result.createObjectStore('devices',{keyPath:'account'});
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(new Error('Secure browser storage is unavailable.'));request.onblocked=()=>reject(new Error('Close other tabs to update secure browser storage.'));
  });
}
async function transaction(mode,work){
  const db=await database();
  try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction('devices',mode),request=work(tx.objectStore('devices'));
    let result;request.onsuccess=()=>{result=request.result;};request.onerror=()=>reject(request.error);
    tx.oncomplete=()=>resolve(result);tx.onerror=tx.onabort=()=>reject(new Error('Secure browser storage could not be saved.'));
  });}finally{db.close();}
}
async function locked(work){return globalThis.navigator?.locks?navigator.locks.request('polylink-device-record',work):work();}
export async function saveDevice(session,vaultKey){
  return locked(async()=>{
    const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
    const iv=crypto.getRandomValues(new Uint8Array(12)),id=crypto.randomUUID(),account=session.user.id,version=session.versions.vaultKey;
    const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:binding(account,id,version)},key,vaultKey);
    await transaction('readwrite',store=>store.put({account,id,key,iv,ciphertext,familyId:session.familyId,credential:session.versions.credential,vaultKeyVersion:version}));
  });
}
export async function openDevice(session){
  const record=await transaction('readonly',store=>store.get(session.user.id));
  if(!record||record.familyId!==session.familyId||record.credential!==session.versions.credential||record.vaultKeyVersion!==session.versions.vaultKey)return null;
  if(record.key?.extractable!==false)throw new Error('Invalid device key.');
  return new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:record.iv,additionalData:binding(record.account,record.id,record.vaultKeyVersion)},record.key,record.ciphertext));
}
export async function clearDevice(account,expected){
  return locked(async()=>{
    if(expected){const record=await transaction('readonly',store=>store.get(account));if(record&&(record.familyId!==expected.familyId||record.credential!==expected.versions.credential))return;}
    return account?transaction('readwrite',store=>store.delete(account)):transaction('readwrite',store=>store.clear());
  });
}
