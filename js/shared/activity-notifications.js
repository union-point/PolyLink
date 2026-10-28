import { auth, notifications } from '../services/index.js';
import { createBrowserPresentation, notificationTarget } from './browser-notifications.js';
import { postsStyles } from '../posts/form.js';
import { stateMessage, dateTime } from './ui.js';
let active;
export function startActivityNotifications(user){
  if(active?.user===user)return active.stop;
  active?.stop();postsStyles();
  const host=document.querySelector('.header nav')||document.querySelector('.header')||document.body;
  const root=document.createElement('div');root.className='activity-inbox';root.innerHTML='<button type="button" data-activity-toggle aria-expanded="false" aria-label="Ծանուցումներ">Ծանուցումներ</button><section class="activity-panel" aria-label="Հայտարարությունների մեկնաբանությունների ծանուցումներ" hidden><div data-activity-items></div><div data-activity-status></div><button type="button" data-activity-refresh>Թարմացնել</button><button type="button" data-activity-more hidden>Ցուցադրել ավելին</button></section>';host.append(root);
  const toggle=root.querySelector('[data-activity-toggle]'),panel=root.querySelector('.activity-panel'),list=root.querySelector('[data-activity-items]'),status=root.querySelector('[data-activity-status]'),more=root.querySelector('[data-activity-more]'),refresh=root.querySelector('[data-activity-refresh]');
  const items=new Map(),presenter=createBrowserPresentation(user);let stopped=false,timer,cursor='initial',historyCursor=null,historyLoading=false,polling=false,delay=15000,unsubscribe;
  function render(){list.replaceChildren();const sorted=[...items.values()].sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)||(BigInt(a.id)>BigInt(b.id)?-1:1)).slice(0,200);items.clear();for(const item of sorted){items.set(item.id,item);const target=notificationTarget(item);if(!target)continue;const link=document.createElement('a');link.href=target;link.dataset.activityId=item.id;const label=document.createElement('span');label.textContent=`${item.title} · ${item.body}`;const date=document.createElement('time');date.dateTime=item.createdAt;date.textContent=dateTime(item.createdAt);link.append(label,date);list.append(link);}if(!items.size)stateMessage(list,'Ծանուցումներ չկան');more.hidden=!historyCursor||items.size>=200;}
  function ingest(records){for(const item of records)if(item.kind==='POST_COMMENT'&&notificationTarget(item))items.set(item.id,item);render();}
  async function history(reset=false){if(stopped||historyLoading)return;historyLoading=true;more.disabled=refresh.disabled=true;stateMessage(status,'Բեռնվում է...');try{const result=await notifications.history({cursor:reset?'':historyCursor||''});if(stopped)return;if(reset)items.clear();ingest(result.items);historyCursor=result.nextCursor;more.hidden=!historyCursor||items.size>=200;status.replaceChildren();}catch(error){if(!stopped)stateMessage(status,error.message,{retry:()=>history(reset)});}finally{historyLoading=false;more.disabled=refresh.disabled=false;}}
  async function poll(){if(stopped||polling)return;polling=true;try{const result=await notifications.list({cursor,limit:100});if(stopped)return;cursor=result.nextCursor;ingest(result.items);await presenter.present(result.items,cursor);delay=15000;}catch(error){delay=Math.min(delay*2,120000);if(!stopped)stateMessage(status,error.message,{retry:()=>{clearTimeout(timer);poll();}});}finally{polling=false;if(!stopped)timer=setTimeout(poll,delay);}}
  toggle.onclick=()=>{panel.hidden=!panel.hidden;toggle.setAttribute('aria-expanded',String(!panel.hidden));if(!panel.hidden)history(true);};more.onclick=()=>history();refresh.onclick=()=>history(true);
  const changed=()=>history(true);window.addEventListener('polylink-notifications-changed',changed);
  function stop(){if(stopped)return;stopped=true;clearTimeout(timer);presenter.stop();items.clear();root.remove();unsubscribe?.();window.removeEventListener('polylink-notifications-changed',changed);window.removeEventListener('pagehide',pagehide);window.removeEventListener('pageshow',pageshow);if(active?.stop===stop)active=null;}
  const pageshow=event=>{if(event.persisted)startActivityNotifications(user);};const pagehide=event=>{stop();if(event.persisted)window.addEventListener('pageshow',pageshow,{once:true});};window.addEventListener('pagehide',pagehide,{once:true});
  auth.subscribeSession((current,error)=>{if(!error&&current?.id!==user)stop();}).then(off=>{if(stopped)off();else unsubscribe=off;}).catch(()=>{});
  active={user,stop};
  // Establish the live watermark before history: comments arriving between reads deduplicate by ID.
  poll().then(()=>{if(!stopped)history(true);});return stop;
}
