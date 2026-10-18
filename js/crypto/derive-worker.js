import { deriveHere } from './sodium.js';
self.onmessage=async event=>{
  try{const result=await deriveHere(event.data.password,event.data.settings);self.postMessage(result,[result.login.buffer,result.wrapping.buffer]);}
  catch{self.postMessage({error:true});}
  finally{self.close();}
};
