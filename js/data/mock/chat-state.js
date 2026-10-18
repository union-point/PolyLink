import { DataError } from '../errors.js';
export function sequence(value){if(typeof value!=='string'||!(/^(0|[1-9][0-9]{0,18})$/).test(value)||BigInt(value)>9223372036854775807n)throw new DataError('VALIDATION','Invalid message sequence.');return BigInt(value);}
export function preference(room,id){return room.preferences[id]||=( {muted:false,hidden:false,historyCutoff:'0',lastReadSequence:'0'} );}
export function upgradeChatState(state){
  if(state.chatVersion===2)return;
  for(const room of state.rooms){
    const messages=state.messages.filter(m=>m.roomId===room.id).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));let last=0n;
    for(const message of messages){message.sequence=(++last).toString();}
    room.lastSequence=last.toString();
    for(const id of room.participants){const pref=preference(room,id);pref.historyCutoff='0';pref.lastReadSequence='0';
      for(const message of messages){if(pref.deletedAt&&message.createdAt<=pref.deletedAt)pref.historyCutoff=message.sequence;if(pref.readAt&&message.createdAt<=pref.readAt)pref.lastReadSequence=message.sequence;}
      delete pref.deletedAt;delete pref.readAt;
    }
  }
  state.chatVersion=2;
}
export const blocked=(state,a,b)=>state.blocks.some(block=>block.userId===a&&block.targetId===b);
export function canSend(state,room){return !room.closed&&(room.isGroup?room.participants.length>=1:room.participants.length===2)&&room.participants.every(id=>state.users.find(user=>user.id===id)?.status==='active')&&(room.isGroup||!blocked(state,room.participants[0],room.participants[1])&&!blocked(state,room.participants[1],room.participants[0]));}
export function visibleMessages(state,room,id){const cutoff=sequence(preference(room,id).historyCutoff);if(!room.participants.includes(id))throw new DataError('NOT_FOUND','The conversation is unavailable.');return state.messages.filter(message=>message.roomId===room.id&&sequence(message.sequence)>cutoff).sort((a,b)=>sequence(a.sequence)<sequence(b.sequence)?-1:1);}
export function markRead(state,room,id,through){const value=sequence(through),pref=preference(room,id);if(value>0n&&!visibleMessages(state,room,id).some(m=>m.sequence===through))throw new DataError('VALIDATION','The shown message is unavailable.');if(value>sequence(pref.lastReadSequence))pref.lastReadSequence=through;}
export function hideRoom(room,id){const pref=preference(room,id);pref.hidden=true;pref.historyCutoff=room.lastSequence||'0';if(sequence(pref.lastReadSequence)<sequence(pref.historyCutoff))pref.lastReadSequence=pref.historyCutoff;return {historyCutoff:pref.historyCutoff};}
export function appendMessage(state,room,message){room.lastSequence=(sequence(room.lastSequence||'0')+1n).toString();message.sequence=room.lastSequence;state.messages.push(message);for(const id of room.participants)if(id!==message.senderId)preference(room,id).hidden=false;return message;}
export function messagePage(messages,{before,after,limit=50}={}){
  if(before!=null&&after!=null||!Number.isInteger(limit)||limit<1||limit>100)throw new DataError('VALIDATION','Invalid history page.');
  const cursor=before!=null?sequence(before):after!=null?sequence(after):9223372036854775807n;
  const filtered=messages.filter(m=>after!=null?sequence(m.sequence)>cursor:sequence(m.sequence)<cursor),hasMore=filtered.length>limit;
  const items=after!=null?filtered.slice(0,limit):filtered.slice(-limit);
  return {items,hasMore,nextBefore:items[0]?.sequence??null,nextAfter:items.at(-1)?.sequence??after??'0'};
}
