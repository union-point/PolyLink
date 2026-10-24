import { notifications } from '../services/index.js';
const preference=user=>`polylink.notifications.${user}`;
export function browserNotificationsEnabled(user){try{return localStorage.getItem(preference(user))==='true';}catch{return false;}}
export async function enableBrowserNotifications(user,enabled){
  if(enabled){
    if(!('Notification' in window)||!navigator.locks)throw new Error('Այս դիտարկիչը չի աջակցում ծանուցումները։');
    if(await Notification.requestPermission()!=='granted')throw new Error('Դիտարկիչում ծանուցումների թույլտվությունը մերժված է։');
  }
  localStorage.setItem(preference(user),String(enabled));
  localStorage.removeItem(`${preference(user)}.cursor`);
}
export function startBrowserNotifications(user){
  let stopped=false,timer,delay=15000;const shown=new Map();
  const channel=typeof BroadcastChannel==='undefined'?null:new BroadcastChannel(`polylink-notification-read-${user}`);
  const closeRead=data=>{const item=shown.get(data.roomId);if(item&&BigInt(item.sequence)<=BigInt(data.through)){item.close();shown.delete(data.roomId);}};
  if(channel)channel.onmessage=event=>closeRead(event.data);
  const onRead=event=>{closeRead(event.detail);channel?.postMessage(event.detail);};window.addEventListener('polylink-chat-read',onRead);
  const tick=async()=>{
    if(stopped)return;
    try{
      if(browserNotificationsEnabled(user)&&globalThis.Notification?.permission==='granted'&&navigator.locks){
        await navigator.locks.request(preference(user),{ifAvailable:true},async lock=>{
          if(!lock||stopped)return;
          const key=`${preference(user)}.cursor`,cursor=localStorage.getItem(key)||'initial';
          const result=await notifications.list({cursor,limit:100});
          if(stopped||!browserNotificationsEnabled(user))return;
          for(const item of result.items){
            const forum=item.kind==='FORUM_REPLY',key=forum?`forum:${item.topicId}`:item.roomId;
            shown.get(key)?.close();
            const notification=new Notification(item.title,{body:item.body,tag:forum?`polylink-forum-${item.topicId}`:`polylink-chat-${item.roomId}`});
            if(!forum)notification.sequence=item.sequence;
            shown.set(key,notification);
            notification.onclick=()=>{window.focus();location.href=forum?`topic.html?id=${encodeURIComponent(item.topicId)}&reply=${encodeURIComponent(item.replyId)}`:`message.html?room=${encodeURIComponent(item.roomId)}`;notification.close();};
          }
          localStorage.setItem(key,result.nextCursor);
        });
      }
      delay=15000;
    }catch{delay=Math.min(delay*2,120000);}
    finally{if(!stopped)timer=setTimeout(tick,delay);}
  };
  tick();
  const stop=()=>{stopped=true;clearTimeout(timer);for(const item of shown.values())item.close();channel?.close();window.removeEventListener('polylink-chat-read',onRead);};
  window.addEventListener('pagehide',stop,{once:true});
  const restore=event=>{if(event.persisted){window.removeEventListener('pageshow',restore);startBrowserNotifications(user);}};window.addEventListener('pageshow',restore);return stop;
}
