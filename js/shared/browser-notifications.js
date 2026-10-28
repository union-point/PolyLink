const preference=user=>`polylink.notifications.${user}`;
export function browserNotificationsEnabled(user){try{return localStorage.getItem(preference(user))==='true';}catch{return false;}}
export async function enableBrowserNotifications(user,enabled){
  if(enabled){
    if(!('Notification' in window)||!navigator.locks)throw new Error('Այս դիտարկիչը չի աջակցում ծանուցումները։');
    if(await Notification.requestPermission()!=='granted')throw new Error('Դիտարկիչում ծանուցումների թույլտվությունը մերժված է։');
  }
  localStorage.setItem(preference(user),String(enabled));localStorage.removeItem(`${preference(user)}.cursor`);
}
export function notificationTarget(item){
  if(item.kind==='DIRECT_MESSAGE'&&item.roomId)return `message.html?room=${encodeURIComponent(item.roomId)}`;
  if(item.kind==='FORUM_REPLY'&&item.topicId&&item.replyId)return `topic.html?id=${encodeURIComponent(item.topicId)}&reply=${encodeURIComponent(item.replyId)}`;
  if(item.kind==='POST_COMMENT'&&item.postId)return `post.html?id=${encodeURIComponent(item.postId)}`;
  return null;
}
// Presentation consumes the shared activity stream; it never starts a second poller.
export function createBrowserPresentation(user){
  let stopped=false;const shown=new Map();
  const channel=typeof BroadcastChannel==='undefined'?null:new BroadcastChannel(`polylink-notification-read-${user}`);
  const closeRead=data=>{const item=shown.get(data.roomId);if(item&&BigInt(item.sequence)<=BigInt(data.through)){item.close();shown.delete(data.roomId);}};
  if(channel)channel.onmessage=event=>closeRead(event.data);
  const onRead=event=>{closeRead(event.detail);channel?.postMessage(event.detail);};window.addEventListener('polylink-chat-read',onRead);
  return {
    async present(items,through){
      if(stopped||!browserNotificationsEnabled(user)||globalThis.Notification?.permission!=='granted'||!navigator.locks)return;
      await navigator.locks.request(preference(user),{ifAvailable:true},async lock=>{
        if(!lock||stopped)return;
        const storageKey=`${preference(user)}.cursor`,previous=localStorage.getItem(storageKey)||'0';
        for(const item of items){
          if(stopped||!browserNotificationsEnabled(user))return;
          if(!/^\d+$/.test(item.id)||BigInt(item.id)<=BigInt(/^\d+$/.test(previous)?previous:'0'))continue;
          const target=notificationTarget(item);if(!target)continue;
          const key=item.kind==='DIRECT_MESSAGE'?item.roomId:item.kind==='FORUM_REPLY'?`forum:${item.topicId}`:`post:${item.postId}`;
          const tag=item.kind==='DIRECT_MESSAGE'?`polylink-chat-${item.roomId}`:item.kind==='FORUM_REPLY'?`polylink-forum-${item.topicId}`:`polylink-post-${item.postId}`;
          shown.get(key)?.close();const notification=new Notification(item.title,{body:item.body,tag});if(item.kind==='DIRECT_MESSAGE')notification.sequence=item.sequence;shown.set(key,notification);
          notification.onclick=()=>{window.focus();location.href=target;notification.close();};
        }
        // Never regress the cross-tab watermark when an older tab finishes later.
        const latest=localStorage.getItem(storageKey)||'0';if(/^\d+$/.test(through)&&(!/^\d+$/.test(latest)||BigInt(through)>BigInt(latest)))localStorage.setItem(storageKey,through);
      });
    },
    stop(){stopped=true;for(const item of shown.values())item.close();shown.clear();channel?.close();window.removeEventListener('polylink-chat-read',onRead);},
  };
}
export async function startBrowserNotifications(user){const {startActivityNotifications}=await import('./activity-notifications.js');return startActivityNotifications(user);}
