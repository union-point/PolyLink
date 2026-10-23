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

// Only an opaque, per-tab reference goes in sessionStorage. Password derivatives
// cross the verification-page navigation encrypted with a non-extractable key.
const loginReference='polylink.http.loginChallenge';
export async function clearLoginChallenge(){
  let account;
  try{account=sessionStorage.getItem(loginReference);sessionStorage.removeItem(loginReference);}
  catch{return;}
  if(account)await transaction('readwrite',store=>store.delete(account));
}
async function pruneLoginChallenges(){
  const records=await transaction('readonly',store=>store.getAll());
  for(const record of records){
    if(record.account.startsWith('login-challenge:')&&record.expiresAt<=Date.now())await transaction('readwrite',store=>store.delete(record.account));
  }
}
export async function saveLoginChallenge({derived,settings,challenge}){
  await clearLoginChallenge();
  await pruneLoginChallenges();
  const account=`login-challenge:${crypto.randomUUID()}`;
  const expiresAt=typeof challenge.expiresAt==='string'?Date.parse(challenge.expiresAt):challenge.expiresAt;
  if(!Number.isFinite(expiresAt)||expiresAt<=Date.now())throw new Error('Request a new verification code.');
  const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const metadata=JSON.stringify([account,settings,challenge]);
  const plain=new Uint8Array([...derived.login,...derived.wrapping]);
  try{
    const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(metadata)},key,plain);
    await transaction('readwrite',store=>store.put({account,key,iv,ciphertext,settings,challenge,expiresAt}));
    try{sessionStorage.setItem(loginReference,account);}
    catch(error){await transaction('readwrite',store=>store.delete(account));throw error;}
  }finally{plain.fill(0);}
}
export async function loadLoginChallenge(challengeId){
  let account;
  try{account=sessionStorage.getItem(loginReference);}catch{return null;}
  if(!account)return null;
  const record=await transaction('readonly',store=>store.get(account));
  if(!record||record.expiresAt<=Date.now()){
    await clearLoginChallenge();return null;
  }
  if(record.challenge.challengeId!==challengeId)return null;
  if(record.key?.extractable!==false)throw new Error('Invalid verification key.');
  const metadata=JSON.stringify([account,record.settings,record.challenge]);
  const plain=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:record.iv,additionalData:encoder.encode(metadata)},record.key,record.ciphertext));
  try{
    if(plain.length!==64)throw new Error('Invalid verification context.');
    return {derived:{login:plain.slice(0,32),wrapping:plain.slice(32)},settings:record.settings,challenge:record.challenge,persisted:true};
  }finally{plain.fill(0);}
}
