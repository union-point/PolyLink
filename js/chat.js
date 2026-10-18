import { chat } from './services/index.js';
import { bootstrap, start, pending, stateMessage, showError, confirmAction } from './shared/ui.js';
import { validateImage } from './data/validation.js';
import { renderConversation, renderMessage } from './chat/render.js';
import { mergeMessages, pollDelay } from './chat/history.js';

start(async()=>{
  const user=await bootstrap();if(!user)return;
  const area=document.querySelector('.chat-area'),list=document.querySelector('.chat-list'),history=document.querySelector('.messages');
  const input=document.querySelector('.message-input input'),contactSearch=document.querySelector('.search-box input'),row=document.querySelector('.message-input');
  const send=document.querySelector('.send-icon'),attach=document.querySelector('.attachment-btn'),emoji=document.querySelector('.emoji-btn'),menuButton=document.querySelector('.menu-btn'),searchButton=document.querySelector('.chat-actions .action-icon:not(.menu-btn)');
  let rooms=[],selected=null,state=null,generation=0,saving=false,polling=false,pollAgain=false,timer,failures=0,stopped=false,ackTimer;
  const drafts=new Map(),attachments=new Map();
  function button(element,label){element.type='button';element.setAttribute('aria-label',label);element.style.border='0';element.style.background='transparent';}
  button(send,'Ուղարկել հաղորդագրությունը');button(attach,'Կցել պատկեր');button(emoji,'Ընտրել էմոջի');button(menuButton,'Նամակագրության գործողություններ');button(searchButton,'Search loaded history');
  input.maxLength=5000;input.setAttribute('aria-label','Հաղորդագրություն');contactSearch.setAttribute('aria-label','Փնտրել զրուցակից');
  const fileStatus=document.createElement('div');fileStatus.style.cssText='padding:4px 16px;font-size:13px';row.before(fileStatus);
  const search=document.createElement('input');search.type='search';search.placeholder='Search loaded history only';search.setAttribute('aria-label','Search loaded history only');search.hidden=true;search.style.cssText='padding:10px;background:var(--card-background);color:var(--font-color-primary)';history.before(search);
  const earlier=document.createElement('button');earlier.type='button';earlier.textContent='Load earlier messages';earlier.dataset.loadEarlier='';earlier.hidden=true;history.before(earlier);
  const incoming=document.createElement('button');incoming.type='button';incoming.textContent='New messages ↓';incoming.dataset.newMessages='';incoming.hidden=true;history.after(incoming);
  const pollStatus=document.createElement('p');pollStatus.setAttribute('role','status');pollStatus.dataset.pollStatus='';history.after(pollStatus);
  const valid=s=>state===s&&!s.abort.signal.aborted;
  const bottom=()=>history.scrollHeight-history.scrollTop-history.clientHeight<40;
  function renderList(){const visible=rooms.filter(room=>room.name.toLowerCase().includes(contactSearch.value.toLowerCase()));if(!visible.length)stateMessage(list,'Նամակագրություններ չեն գտնվել');else list.innerHTML=visible.map(room=>renderConversation(room,selected?.id)).join('');}
  function renderHistory(s,{initial=false}={}){
    if(!valid(s))return;
    const wasBottom=bottom(),box=history.getBoundingClientRect();
    const anchor=[...history.querySelectorAll('.message')].find(node=>node.getBoundingClientRect().bottom>box.top);
    const anchorId=anchor?.dataset.messageId,offset=anchor?anchor.getBoundingClientRect().top-box.top:0,oldTop=history.scrollTop;
    const visible=s.records.filter(record=>!search.value||(record.text||'').toLowerCase().includes(search.value.toLowerCase()));
    if(!visible.length)stateMessage(history,search.value?'No matches in loaded history':'Հաղորդագրություններ չկան');
    else history.innerHTML=visible.map(record=>renderMessage(record,user.id,selected?.isGroup)).join('');
    earlier.hidden=!s.hasMore;earlier.disabled=s.loading>0;
    if(initial||wasBottom&&!search.value){history.scrollTop=history.scrollHeight;incoming.hidden=true;}
    else{
      const next=[...history.querySelectorAll('.message')].find(node=>node.dataset.messageId===anchorId);
      history.scrollTop=next?oldTop+next.getBoundingClientRect().top-history.getBoundingClientRect().top-offset:oldTop;
    }
    earlier.hidden=!s.hasMore;earlier.disabled=s.loading>0;
    scheduleAck();
  }
  function updateFile(){fileStatus.replaceChildren();const file=selected&&attachments.get(selected.id);if(!file)return;const label=document.createElement('span');label.textContent=`📎 ${file.name}`;const remove=document.createElement('button');remove.type='button';remove.textContent='Հեռացնել';remove.onclick=()=>{attachments.delete(selected.id);updateFile();};fileStatus.append(label,remove);}
  function header(){
    document.querySelector('.contact-name').textContent=selected?.name||'Ընտրեք նամակագրություն';document.querySelector('.contact-info .avatar').textContent=selected?selected.isGroup?'👥':selected.name.slice(0,1):'';
    document.querySelector('.contact-status').textContent=!selected?'':selected.closed?'Նամակագրությունն ավարտված է':selected.blocked?'Արգելափակված է':selected.canSend===false?'Sending is unavailable':selected.isGroup?'Խմբային նամակագրություն':'Անձնական նամակագրություն';
    input.disabled=!selected||selected.canSend===false||selected.closed||saving;send.disabled=input.disabled;attach.disabled=input.disabled;emoji.disabled=input.disabled;menuButton.disabled=!selected;renderMenu();
  }
  function cancel(){if(state){state.abort.abort();chat.release(state.id).catch(()=>{});}state=null;clearTimeout(ackTimer);incoming.hidden=true;}
  async function getPage(s,params){
    s.loading++;earlier.disabled=true;
    const request=s.chain.catch(()=>{}).then(()=>{if(!valid(s))throw new DOMException('Selection changed','AbortError');return chat.page(s.id,{...params,signal:s.abort.signal});});s.chain=request;
    try{return await request;}finally{s.loading--;if(valid(s))earlier.disabled=s.loading>0;else if(selected?.id!==s.id)chat.release(s.id).catch(()=>{});}
  }
  function merge(s,page,{initial=false,older=false}={}){
    if(!valid(s))return;
    const previous=s.records.length,previousLast=s.records.at(-1)?.sequence,atBottom=bottom();
    s.records=mergeMessages(s.records,page.items);
    if(initial||older){s.before=page.nextBefore;s.hasMore=page.hasMore;}
    if(!older&&page.nextAfter!=null)s.after=page.nextAfter;
    // An unchanged poll does not rebuild the DOM or disturb selection/scroll.
    if(initial||s.records.length!==previous)renderHistory(s,{initial});
    if(!initial&&!older&&s.records.at(-1)?.sequence!==previousLast&&!atBottom)incoming.hidden=false;
  }
  async function selectRoom(room){
    if(selected)drafts.set(selected.id,input.value);cancel();const current=++generation;selected=room;
    const s=state={id:room.id,generation:current,records:[],after:'0',before:null,hasMore:false,loading:0,chain:Promise.resolve(),abort:new AbortController(),ack:BigInt(room.lastReadSequence||'0')};
    input.value=drafts.get(room.id)||'';search.value='';window.history.replaceState(null,'',`message.html?room=${encodeURIComponent(room.id)}`);header();updateFile();renderList();stateMessage(history,'Բեռնվում է...');earlier.hidden=true;
    try{const page=await getPage(s,{});merge(s,page,{initial:true});}
    catch(error){if(valid(s))stateMessage(history,error.message,{retry:()=>selectRoom(room)});}
  }
  async function loadEarlier(){const s=state;if(!s||!s.hasMore||s.loading)return;try{merge(s,await getPage(s,{before:s.before}),{older:true});}catch(error){if(valid(s))showError(area,error);}}
  earlier.onclick=loadEarlier;
  function scheduleAck(){clearTimeout(ackTimer);ackTimer=setTimeout(acknowledge,150);}
  async function acknowledge(){
    const s=state;if(!s||!valid(s)||document.visibilityState!=='visible'||s.acking)return;
    const box=history.getBoundingClientRect();let sequence=s.ack;
    for(const node of history.querySelectorAll('.message')){
      const rect=node.getBoundingClientRect(),image=node.querySelector('img');
      if(rect.top>=box.top-1&&rect.bottom<=box.bottom+1&&(!image||(image.complete&&image.naturalWidth)))sequence=BigInt(node.dataset.sequence)>sequence?BigInt(node.dataset.sequence):sequence;
    }
    if(sequence<=s.ack)return;s.acking=true;
    try{const result=await chat.read(s.id,sequence.toString());s.ack=BigInt(result?.lastReadSequence||sequence);const room=rooms.find(r=>r.id===s.id);if(room){room.unreadCount=result?.unreadCount??room.unreadCount;room.lastReadSequence=s.ack.toString();renderList();}}
    catch(error){if(valid(s))pollStatus.textContent=error.message;}
    finally{s.acking=false;}
  }
  history.addEventListener('scroll',()=>{if(bottom())incoming.hidden=true;scheduleAck();if(history.scrollTop<50)loadEarlier();});
  history.addEventListener('load',scheduleAck,true);incoming.onclick=()=>{history.scrollTop=history.scrollHeight;incoming.hidden=true;scheduleAck();};
  search.oninput=()=>state&&renderHistory(state);searchButton.onclick=()=>{search.hidden=!search.hidden;if(!search.hidden)search.focus();else{search.value='';if(state)renderHistory(state);}};
  contactSearch.oninput=renderList;
  async function refresh(){
    if(stopped||document.visibilityState==='hidden')return;if(polling){pollAgain=true;return;}polling=true;const startGeneration=generation;
    try{
      const latest=await chat.list();if(stopped)return;rooms=latest;renderList();
      if(startGeneration!==generation)return;
      const id=selected?.id||new URLSearchParams(location.search).get('room'),target=rooms.find(r=>r.id===id)||(!selected&&!id?rooms[0]:null);
      if(!target){if(selected)drafts.set(selected.id,input.value);cancel();selected=null;header();updateFile();stateMessage(history,id?'Նամակագրությունը հասանելի չէ։':'Ընտրեք նամակագրություն');earlier.hidden=true;return;}
      if(!selected||selected.id!==target.id)await selectRoom(target);
      else{
        selected=target;header();const s=state;if(s&&!s.loading){
          do{const after=s.after,page=await getPage(s,{after});if(!valid(s))return;merge(s,page);if(!page.hasMore)break;if(BigInt(s.after)<=BigInt(after))throw new Error('History cursor did not advance.');}while(valid(s));
        }
      }
      failures=0;pollStatus.textContent='';
    }catch(error){failures++;pollStatus.textContent=`${error.message} Retrying…`;if(!rooms.length)stateMessage(list,error.message,{retry:()=>schedule(0)});}
    finally{polling=false;if(!stopped)schedule(pollAgain?0:pollDelay(failures));pollAgain=false;}
  }
  function schedule(delay=0){clearTimeout(timer);if(!stopped&&document.visibilityState!=='hidden')timer=setTimeout(refresh,delay);}
  list.onclick=event=>{const item=event.target.closest('.chat-item'),room=item&&rooms.find(r=>r.id===item.dataset.roomId);if(room)selectRoom(room);};list.onkeydown=event=>{if(['Enter',' '].includes(event.key)){const item=event.target.closest('.chat-item');if(item){event.preventDefault();item.click();}}};
  send.onclick=async()=>{
    if(!selected||saving||selected.canSend===false)return;const id=selected.id,text=input.value,file=attachments.get(id);saving=true;input.disabled=true;attach.disabled=true;
    const saved=await pending(send,area,()=>chat.send(id,{text,file}));saving=false;
    if(saved){drafts.delete(id);attachments.delete(id);if(selected?.id===id)input.value='';}
    header();updateFile();schedule(0);
  };
  input.oninput=()=>{if(selected)drafts.set(selected.id,input.value);};input.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();send.click();}};
  const fileInput=document.createElement('input');fileInput.type='file';fileInput.accept='image/png,image/jpeg,image/gif,image/webp';fileInput.hidden=true;document.body.append(fileInput);attach.onclick=()=>fileInput.click();fileInput.onchange=()=>{if(!selected||!fileInput.files[0])return;try{validateImage(fileInput.files[0]);attachments.set(selected.id,fileInput.files[0]);updateFile();}catch(error){showError(area,error);}fileInput.value='';};
  const picker=document.createElement('div');picker.hidden=true;picker.style.cssText='padding:8px;background:var(--card-background)';row.before(picker);for(const value of ['😀','😂','😍','🥺','😎','😭','👍','🎉','❤️','🔥']){const b=document.createElement('button');b.type='button';b.textContent=value;b.onclick=()=>{if(!input.disabled&&input.value.length+value.length<=5000){input.value+=value;input.dispatchEvent(new Event('input'));input.focus();}};picker.append(b);}emoji.onclick=()=>{picker.hidden=!picker.hidden;};
  const dropdown=document.createElement('div');dropdown.className='chat-dropdown';dropdown.hidden=true;dropdown.style.cssText='position:absolute;top:110%;right:0;background:var(--card-background);border:1px solid var(--border-color);z-index:100;min-width:180px';document.querySelector('.chat-actions').style.position='relative';document.querySelector('.chat-actions').append(dropdown);
  const closeMenu=()=>{dropdown.hidden=true;menuButton.setAttribute('aria-expanded','false');};
  function renderMenu(){
    dropdown.replaceChildren();if(!selected)return;const room=selected,peer=room.participants.find(p=>p.id!==user.id);
    const actions=[
      ['🗑️','Ջնջել նամակագրությունը',async()=>{if(!await confirmAction('Հեռացնե՞լ ձեր տեսանելի նամակագրությունը։'))return;await chat.hide(room.id);drafts.delete(room.id);attachments.delete(room.id);cancel();generation++;selected=null;input.value='';window.history.replaceState(null,'','message.html');header();updateFile();stateMessage(history,'Ընտրեք նամակագրություն');schedule(0);}],
      ['🚫',room.blocked?'Ապաարգելափակել':'Արգելափակել',async()=>{await chat.block(peer.id,!room.blocked);schedule(0);},room.isGroup||!peer],
      ['👤','Դիտել էջը',()=>{location.href=`user.html?id=${encodeURIComponent(peer.id)}`;},room.isGroup||!peer],
      [room.muted?'🔔':'🔕',room.muted?'Միացնել ծանուցումները':'Անջատել ծանուցումները',async()=>{await chat.mute(room.id,!room.muted);schedule(0);}]
    ];
    for(const [icon,label,action,disabled]of actions){const b=document.createElement('button');b.type='button';b.className='chat-dropdown-item';b.textContent=`${icon} ${label}`;b.disabled=!!disabled;b.style.cssText='display:block;width:100%;border:0;background:transparent;text-align:left';b.onclick=async()=>{if(await pending(b,area,action))closeMenu();};dropdown.append(b);}
  }
  menuButton.onclick=()=>{dropdown.hidden=!dropdown.hidden;menuButton.setAttribute('aria-expanded',String(!dropdown.hidden));};document.addEventListener('click',event=>{if(!event.target.closest('.chat-actions'))closeMenu();});document.addEventListener('keydown',event=>{if(event.key==='Escape'){closeMenu();picker.hidden=true;}});
  history.onclick=event=>{const b=event.target.closest('.copy-btn');if(!b)return;const message=state?.records.find(r=>r.id===b.closest('.message').dataset.messageId);if(message)pending(b,area,async()=>{await navigator.clipboard.writeText(message.text);b.textContent='✓';setTimeout(()=>{b.textContent='📋';},1000);});};
  const unsubscribe=await chat.subscribe(event=>{if(['chat.send','chat.incoming','chat.read','chat.mute','chat.hide','chat.block','reset'].includes(event.operation))schedule(0);});
  const visibility=()=>{if(document.visibilityState==='hidden')clearTimeout(timer);else{schedule(0);scheduleAck();}};document.addEventListener('visibilitychange',visibility);
  window.addEventListener('pagehide',event=>{stopped=true;clearTimeout(timer);cancel();if(!event.persisted)unsubscribe();});window.addEventListener('pageshow',event=>{if(event.persisted){stopped=false;selected=null;generation++;schedule(0);}});
  header();await refresh();
});
