import { forum } from '../services/index.js';
import { bootstrap, pending, stateMessage, dateTime, confirmAction, showError } from '../shared/ui.js';
import { escapeHtml as e, sanitizeHtml, safeUrl } from '../shared/content.js';
import { authorHtml, avatarUrl, paginatedList, editDiscussion } from './view.js';
import { createEditor } from './editor.js';
import { createRequestKey } from './contracts.js';

export async function initializeTopic() {
  const user=await bootstrap();if(!user)return;
  const main=document.querySelector('main'),params=new URLSearchParams(location.search),id=params.get('id');
  const missing=message=>{stateMessage(main,message);const back=document.createElement('a');back.href='forum.html';back.textContent='Վերադառնալ ֆորում';main.appendChild(back);};
  if(!id||!id.trim()){missing('Թեմայի նույնացուցիչը բացակայում է։');return;}
  let topic,categories;
  try{[topic,categories]=await Promise.all([forum.get(id),forum.categories()]);}
  catch(error){missing(error.message);return;}
  function drawTopic(){
    document.title=`${topic.title} | PolyLink`;
    main.querySelector('.topic-title').textContent=topic.title;
    main.querySelector('.topic-badge').textContent=topic.categoryName;
    main.querySelector('.topic-author-info .author-name').innerHTML=authorHtml(topic.author);
    main.querySelector('.post-date').textContent=dateTime(topic.createdAt);
    const avatar=main.querySelector('.author-avatar img');avatar.src=safeUrl(topic.author.avatar||'image/logo.png',{image:true});avatar.alt=topic.author.name;
    main.querySelector('.post-content').innerHTML=sanitizeHtml(topic.content);
    main.querySelector('.reply-count').textContent=`(${topic.replyCount})`;
    main.querySelector('[data-topic-actions]')?.remove();
    if(topic.canEdit||topic.canDelete){const actions=document.createElement('div');actions.dataset.topicActions='';actions.className='forum-owner-actions';actions.innerHTML=`${topic.canEdit?'<button type="button" data-edit-topic>Խմբագրել թեման</button>':''}${topic.canDelete?'<button type="button" data-delete-topic>Ջնջել թեման</button>':''}`;main.querySelector('.original-post').appendChild(actions);
      actions.querySelector('[data-edit-topic]')?.addEventListener('click',()=>editDiscussion({item:topic,categories,topic:true,save:data=>forum.update(id,data),latest:()=>forum.get(id),onSaved:fresh=>{topic=fresh;drawTopic();}}));
      actions.querySelector('[data-delete-topic]')?.addEventListener('click',event=>pending(event.currentTarget,actions,async()=>{if(!await confirmAction('Ջնջե՞լ թեման։ Կջնջվեն բոլոր օգտատերերի պատասխանները և դրանց հավանումները։'))return;await forum.delete(id,topic.version);location.href='forum.html';}));
    }
  }
  drawTopic();
  const section=main.querySelector('.replies-section'),list=document.createElement('div');list.className='replies-list';section.appendChild(list);
  const sort=main.querySelector('.sort-select'),form=main.querySelector('.reply-form');
  form.querySelector('.form-avatar img').src=safeUrl(user.avatar||'image/logo.png',{image:true});
  const formContent=form.querySelector('.form-content');formContent.replaceChildren();const host=document.createElement('div');formContent.appendChild(host);
  const editor=createEditor(host,{label:'Պատասխան'}),submit=document.createElement('button');submit.type='submit';submit.className='submit-btn';submit.textContent='Հրապարակել պատասխան';formContent.appendChild(submit);
  const renderReplies=replies=>{list.innerHTML=replies.map(reply=>`<article id="reply-${e(reply.id)}" class="reply-item ${reply.isTopicAuthor?'highlighted':''}" data-reply-id="${e(reply.id)}"><div class="reply-avatar"><img src="${avatarUrl(reply.author)}" alt="${e(reply.author.name)}"></div><div class="reply-content"><div class="reply-header"><div class="reply-author"><span class="author-name">${authorHtml(reply.author)}</span>${reply.isTopicAuthor?'<span class="author-badge">Հեղինակ</span>':''}</div><span class="reply-date">${e(dateTime(reply.createdAt))}${reply.updatedAt?' · խմբագրված':''}</span></div><div class="reply-text">${sanitizeHtml(reply.content)}</div><div class="reply-actions"><button type="button" class="reply-action-btn like-btn ${reply.liked?'active':''}" aria-label="Օգտակար պատասխան" aria-pressed="${reply.liked}">Օգտակար <span>${reply.likeCount}</span></button><button type="button" class="reply-action-btn reply-btn">Պատասխանել</button>${reply.canEdit?'<button type="button" class="reply-action-btn" data-edit-reply>Խմբագրել</button>':''}${reply.canDelete?'<button type="button" class="reply-action-btn" data-delete-reply>Ջնջել</button>':''}</div></div></article>`).join('');};
  const pages=paginatedList(list,cursor=>forum.replies.list(id,{sort:sort.value,cursor:cursor||'',limit:20}),renderReplies);
  let refreshGeneration=0;
  async function refreshReplies(){
    const current=++refreshGeneration;
    try{const [fresh]=await Promise.all([forum.get(id),pages.refresh()]);if(current===refreshGeneration){topic=fresh;drawTopic();}}
    catch(error){showError(section,error);}
  }
  pages.controls.querySelector('[data-refresh]').onclick=refreshReplies;
  sort.onchange=refreshReplies;
  list.onclick=event=>{
    if(event.target.closest('.reply-btn')){editor.focus();return;}
    const item=event.target.closest('[data-reply-id]');if(!item)return;
    const reply=pages.get(item.dataset.replyId);if(!reply)return;
    const edit=event.target.closest('[data-edit-reply]');
    if(edit){editDiscussion({item:reply,categories,save:data=>forum.replies.update(reply.id,data),latest:()=>forum.replies.get(reply.id),onSaved:fresh=>pages.replace(fresh)});return;}
    const remove=event.target.closest('[data-delete-reply]');
    if(remove){pending(remove,item,async()=>{if(!await confirmAction('Ջնջե՞լ պատասխանը և դրա հավանումները։'))return;await forum.replies.delete(reply.id,reply.version);await refreshReplies();});return;}
    const like=event.target.closest('.like-btn');
    if(like)pending(like,item,async()=>{const fresh=await forum.replies.like(reply.id,!reply.liked);if(sort.value==='popular')await refreshReplies();else pages.replace(fresh);});
  };
  const request=createRequestKey();
  form.onsubmit=event=>{event.preventDefault();pending(submit,form,async()=>{const data={content:editor.get()};await forum.replies.create(id,{...data,requestId:request.for(data)});editor.set('');request.clear();sort.value='newest';await refreshReplies();});};
  await pages.refresh();
  const linked=params.get('reply');
  if(linked){
    try{const target=await forum.replies.get(linked);if(target.topicId===id){let element=document.getElementById(`reply-${linked}`);if(!element){const preview=document.createElement('section');preview.className='forum-linked-reply';preview.innerHTML=`<h3>Հղված պատասխան</h3><p>${authorHtml(target.author)}</p><div>${sanitizeHtml(target.content)}</div>`;section.prepend(preview);element=preview;}element.tabIndex=-1;element.focus();element.scrollIntoView({block:'center'});}}
    catch(error){showError(section,error);}
  }
}
