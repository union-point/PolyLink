import { auth, posts } from '../services/index.js';
import { renderPost, renderPostSummary, renderPostOwnerActions, renderCommentToggle, renderComment } from '../shared/posts.js';
import { pending, stateMessage, confirmAction, notify } from '../shared/ui.js';
import { openPostForm, postsStyles } from './form.js';
import { safeUrl } from '../shared/content.js';
import { validateComment } from './content.js';
const drafts=new Map();
let unloadInstalled=false;
let viewerAccount,viewerPromise;
function viewer(){
  if(viewerAccount!==document.body.dataset.accountId||!viewerPromise){
    viewerAccount=document.body.dataset.accountId;
    viewerPromise=auth.me().catch(()=>{viewerPromise=null;return null;});
  }
  return viewerPromise;
}
export function createPostCard(post,{onChanged=()=>{},onDeleted=()=>{}}={}) {
  postsStyles();if(!unloadInstalled){unloadInstalled=true;window.addEventListener('beforeunload',event=>{if([...drafts.entries()].some(([key,value])=>key.startsWith(`${document.body.dataset.accountId}:`)&&value.trim())){event.preventDefault();event.returnValue='';}});}
  const host=document.createElement('div');host.innerHTML=renderPost(post);const card=host.firstElementChild;card.record=post;
  card.addEventListener('error',event=>{
    const image=event.target;
    if(image.matches?.('.user-icon,.comment-icon,.comment-avatar')&&image.getAttribute('src')!=='image/logo.png')image.src='image/logo.png';
  },true);
  const section=card.querySelector('[data-comments]'),toggle=card.querySelector('.comments-toggle'),list=card.querySelector('.comments'),status=card.querySelector('[data-comment-status]'),more=card.querySelector('.comments-more'),input=card.querySelector('.comment-input'),send=card.querySelector('.comment-btn');
  const draftKey=`${document.body.dataset.accountId}:${post.id}`;input.value=drafts.get(draftKey)||'';input.oninput=()=>drafts.set(draftKey,input.value);
  const sort=card.querySelector('.comment-sort'),emojiButton=card.querySelector('.emoji-toggle'),emojiPanel=card.querySelector('.emoji-popover');
  const avatar=card.querySelector('.comment-avatar');
  avatar.onerror=()=>{avatar.onerror=null;avatar.src='image/logo.png';};
  let loaded=false,loading=false,cursor=null,failed=false,comments=new Map(),generation=0,emojiListeners;
  let selectionStart=input.value.length,selectionEnd=selectionStart;
  const rememberSelection=()=>{selectionStart=input.selectionStart;selectionEnd=input.selectionEnd;};
  input.addEventListener('select',rememberSelection);input.addEventListener('keyup',rememberSelection);input.addEventListener('click',rememberSelection);
  function hideEmoji(focus=false){emojiPanel.hidden=true;emojiButton.setAttribute('aria-expanded','false');emojiListeners?.abort();if(focus)emojiButton.focus();}
  card.dispose=()=>{generation++;hideEmoji();};
  emojiButton.onpointerdown=rememberSelection;
  emojiButton.onclick=()=>{
    if(!emojiPanel.hidden){hideEmoji();return;}
    const entry=input.getBoundingClientRect(),bounds=card.getBoundingClientRect(),width=Math.min(260,bounds.width-32);
    emojiPanel.style.width=`${width}px`;
    emojiPanel.style.left=`${Math.max(bounds.left+16,Math.min(entry.right-width,bounds.right-16-width))-entry.left}px`;
    emojiPanel.style.right='auto';
    emojiPanel.hidden=false;emojiButton.setAttribute('aria-expanded','true');
    emojiListeners=new AbortController();
    window.addEventListener('resize',()=>hideEmoji(),{signal:emojiListeners.signal});
    document.addEventListener('pointerdown',event=>{if(!emojiPanel.contains(event.target)&&!emojiButton.contains(event.target))hideEmoji();},{signal:emojiListeners.signal});
    emojiPanel.querySelector('button').focus();
  };
  // Keep pointer presses from blurring the focused emoji before its click runs.
  emojiPanel.addEventListener('pointerdown',event=>{if(event.target.closest('[data-emoji]'))event.preventDefault();});
  emojiPanel.onclick=event=>{
    const button=event.target.closest('[data-emoji]');if(!button)return;
    if(input.value.length-(selectionEnd-selectionStart)+button.dataset.emoji.length>input.maxLength)return;
    input.setRangeText(button.dataset.emoji,selectionStart,selectionEnd,'end');
    input.dispatchEvent(new Event('input',{bubbles:true}));rememberSelection();hideEmoji();input.focus();
  };
  card.addEventListener('keydown',event=>{if(event.key==='Escape'&&!emojiPanel.hidden){event.preventDefault();event.stopPropagation();hideEmoji(true);}});
  emojiPanel.addEventListener('focusout',event=>{if(!emojiPanel.contains(event.relatedTarget)&&event.relatedTarget!==emojiButton)hideEmoji();});
  function summary(saved){post=saved;card.record=saved;card.dataset.category=saved.category||'';card.querySelector('[data-post-summary]').innerHTML=renderPostSummary(saved);card.querySelector('.post-owner-actions').innerHTML=renderPostOwnerActions(saved);toggle.innerHTML=renderCommentToggle(saved.commentCount);toggle.setAttribute('aria-label',`Մեկնաբանություններ (${saved.commentCount})`);}
  card.updatePost=summary;
  async function refreshCount(){try{summary(await posts.get(post.id));}catch(error){notify(error.message);}}
  async function load(reset=false){
    if(loading&&!reset)return;
    const request=++generation;loading=true;more.disabled=true;
    if(reset){comments=new Map();list.replaceChildren();cursor=null;loaded=false;more.hidden=true;}
    list.setAttribute('aria-busy','true');stateMessage(status,'Բեռնվում է...');
    try{
      const page=await posts.comments.list(post.id,{cursor:cursor||'',sort:sort.value});
      if(request!==generation||!card.isConnected)return;
      for(const comment of page.items){if(comments.has(comment.id))continue;comments.set(comment.id,comment);list.insertAdjacentHTML('beforeend',renderComment(comment));}
      cursor=page.nextCursor;loaded=true;failed=false;status.replaceChildren();
      if(!comments.size)stateMessage(status,'Մեկնաբանություններ դեռ չկան');
      more.hidden=cursor===null;
    }catch(error){if(request===generation){failed=true;stateMessage(status,error.message,{retry:()=>load(reset)});}}
    finally{if(request===generation){loading=false;more.disabled=false;list.removeAttribute('aria-busy');}}
  }
  toggle.onclick=()=>{
    section.hidden=!section.hidden;toggle.setAttribute('aria-expanded',String(!section.hidden));
    if(section.hidden){hideEmoji();return;}
    viewer().then(user=>{if(card.isConnected)avatar.src=safeUrl(user?.avatar,{image:true})||'image/logo.png';});
    if(!loaded&&!loading)load();
  };
  sort.onchange=()=>{
    if(!section.hidden)load(true);
    else{generation++;loading=false;loaded=false;cursor=null;comments.clear();list.replaceChildren();}
  };
  more.onclick=()=>load();
  send.onclick=()=>pending(send,section,async()=>{
    const text=validateComment(input.value);input.disabled=true;emojiButton.disabled=true;hideEmoji();
    try{
      const created=await posts.comments.create(post.id,{text});input.value='';drafts.delete(draftKey);await refreshCount();
      if(loaded&&!loading&&!failed&&(sort.value==='newest'||!cursor)){
        if(!comments.has(created.id)){comments.set(created.id,created);list.insertAdjacentHTML(sort.value==='newest'?'afterbegin':'beforeend',renderComment(created));}status.replaceChildren();
      }else{
        stateMessage(status,'Նոր մեկնաբանությունն ավելացվել է։ Շարունակեք բեռնել՝ այն տեսնելու համար։');
        if(!loaded){const retry=document.createElement('button');retry.type='button';retry.textContent='Բեռնել մեկնաբանությունները';retry.onclick=()=>load(true);status.append(retry);}
      }
    }finally{input.disabled=false;emojiButton.disabled=false;}
  });
  card.addEventListener('click',async event=>{
    const edit=event.target.closest('[data-post-edit]');if(edit){openPostForm({record:post,onSaved:saved=>{summary(saved);onChanged(saved,card);}});return;}
    const del=event.target.closest('[data-post-delete]');if(del){if(!await confirmAction('Հեռացնե՞լ հայտարարությունն ու դրա մեկնաբանությունները։'))return;await pending(del,card,async()=>{await posts.delete(post.id);drafts.delete(draftKey);card.dispose();card.remove();onDeleted(post.id,card);});return;}
    const row=event.target.closest('[data-comment-id]');if(!row)return;const comment=comments.get(row.dataset.commentId);if(!comment)return;
    if(event.target.closest('[data-comment-edit]'))openCommentEdit(comment,async text=>{const saved=await posts.comments.update(post.id,comment.id,{text});comments.set(saved.id,saved);row.outerHTML=renderComment(saved);});
    const remove=event.target.closest('[data-comment-delete]');if(remove){if(!await confirmAction('Հեռացնե՞լ մեկնաբանությունը։'))return;await pending(remove,section,async()=>{await posts.comments.delete(post.id,comment.id);comments.delete(comment.id);row.remove();await refreshCount();});}
  });
  return card;
}
function openCommentEdit(comment,save){
  const previous=document.activeElement,dialog=document.createElement('dialog');dialog.className='posts-modal';dialog.setAttribute('aria-label','Փոփոխել մեկնաբանությունը');dialog.innerHTML='<form class="posts-form"><label>Մեկնաբանություն<textarea name="text" maxlength="2000" required></textarea></label><footer><button type="button" data-cancel>Չեղարկել</button><button type="submit">Պահպանել</button></footer></form>';document.body.append(dialog);const form=dialog.querySelector('form'),input=form.elements.text,button=form.querySelector('[type=submit]');input.value=comment.text;let saving=false;
  const dirty=()=>input.value!==comment.text;const unload=event=>{if(dirty()){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',unload);
  function close(force=false){if(saving)return;if(!force&&dirty()&&!window.confirm('Հրաժարվե՞լ չպահպանված փոփոխություններից։'))return;window.removeEventListener('beforeunload',unload);dialog.close();dialog.remove();previous?.focus();}
  form.querySelector('[data-cancel]').onclick=()=>close();dialog.oncancel=event=>{event.preventDefault();close();};dialog.onclick=event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)close();}};
  form.onsubmit=async event=>{event.preventDefault();const success=await pending(button,form,async()=>{const text=validateComment(input.value);saving=true;input.disabled=true;try{await save(text);}finally{saving=false;input.disabled=false;}});if(success)close(true);};dialog.showModal();input.focus();
}
