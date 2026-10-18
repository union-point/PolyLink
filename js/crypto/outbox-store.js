// Contains only vault-encrypted records; no plaintext draft, message or room key.
function database(){return new Promise((resolve,reject)=>{
  const request=indexedDB.open('polylink-outbox-v1',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('operations',{keyPath:'id'});
  request.onsuccess=()=>resolve(request.result);request.onerror=request.onblocked=()=>reject(new Error('Encrypted outbox storage is unavailable.'));
});}
async function run(mode,work){const db=await database();try{return await new Promise((resolve,reject)=>{
  const tx=db.transaction('operations',mode),request=work(tx.objectStore('operations'));let result;
  request.onsuccess=()=>{result=request.result;};tx.oncomplete=()=>resolve(result);tx.onerror=tx.onabort=()=>reject(new Error('Encrypted outbox could not be saved.'));
});}finally{db.close();}}
export const outboxStore={
  get:id=>run('readonly',store=>store.get(id)),
  put:value=>run('readwrite',store=>store.put(value)),
  remove:id=>run('readwrite',store=>store.delete(id)),
  async clear(account){const values=await run('readonly',store=>store.getAll());for(const value of values)if(!account||value.account===account)await this.remove(value.id);}
};
