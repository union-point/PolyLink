// SQL BIGINT cursors stay strings throughout merge and comparison.
export function mergeMessages(existing,incoming){
  const byId=new Map(existing.map(message=>[message.id,message]));
  for(const message of incoming){const old=byId.get(message.id);if(old&&old.sequence!==message.sequence)throw new Error('Message sequence changed.');byId.set(message.id,old||message);}
  return [...byId.values()].sort((a,b)=>BigInt(a.sequence)<BigInt(b.sequence)?-1:BigInt(a.sequence)>BigInt(b.sequence)?1:0);
}
export const pollDelay=failures=>Math.min(30000,2500*2**Math.min(failures,4))*(0.9+Math.random()*0.2);
