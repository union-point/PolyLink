import { posts } from '../services/index.js';
import { renderPost, renderPostSummary, renderComment } from '../shared/posts.js';
import { pending, stateMessage, confirmAction, notify } from '../shared/ui.js';
import { openPostForm, postsStyles } from './form.js';
import { validateComment } from './content.js';
const drafts=new Map();
let unloadInstalled=false;
export function createPostCard(post,{onChanged=()=>{},onDeleted=()=>{}}={}) {
  postsStyles();if(!unloadInstalled){unloadInstalled=true;window.addEventListener('beforeunload',event=>{if([...drafts.entries()].some(([key,value])=>key.startsWith(`${document.body.dataset.accountId}:`)&&value.trim())){event.preventDefault();event.returnValue='';}});}
  const host=document.createElement('div');host.innerHTML=renderPost(post);const card=host.firstElementChild;card.record=post;
  const section=card.querySelector('[data-comments]'),toggle=card.querySelector('.comments-toggle'),list=card.querySelector('.comments'),status=card.querySelector('[data-comment-status]'),more=card.querySelector('.comments-more'),input=card.querySelector('.comment-input'),send=card.querySelector('.comment-btn');
  const draftKey=`${document.body.dataset.accountId}:${post.id}`;input.value=drafts.get(draftKey)||'';input.oninput=()=>drafts.set(draftKey,input.value);
  let loaded=false,loading=false,cursor=null,failed=false,comments=new Map();
  function summary(saved){post=saved;card.record=saved;card.dataset.category=saved.category||'';card.querySelector('[data-post-summary]').innerHTML=renderPostSummary(saved);toggle.textContent=`Մեկնաբանություններ (${saved.commentCount})`;}
  card.updatePost=summary;
  async function refreshCount(){try{summary(await posts.get(post.id));}catch(error){notify(error.message);}}
  async function load(reset=false){if(loading)return;loading=true;more.disabled=true;stateMessage(status,'Բեռնվում է...');try{const page=await posts.comments.list(post.id,{cursor:reset?'':cursor||''});if(!card.isConnected)return;if(reset){comments=new Map();list.replaceChildren();}for(const comment of page.items){if(comments.has(comment.id))continue;comments.set(comment.id,comment);list.insertAdjacentHTML('beforeend',renderComment(comment));}cursor=page.nextCursor;loaded=true;failed=false;status.replaceChildren();if(!comments.size)stateMessage(status,'Մեկնաբանություններ դեռ չկան');more.hidden=cursor===null;}catch(error){failed=true;stateMessage(status,error.message,{retry:()=>load(reset)});}finally{loading=false;more.disabled=false;}}
  toggle.onclick=()=>{section.hidden=!section.hidden;toggle.setAttribute('aria-expanded',String(!section.hidden));if(!section.hidden&&!loaded&&!loading)load();};more.onclick=()=>load();
  send.onclick=()=>pending(send,section,async()=>{const text=validateComment(input.value);const created=await posts.comments.create(post.id,{text});input.value='';drafts.delete(draftKey);await refreshCount();if(loaded&&!cursor&&!failed){comments.set(created.id,created);list.insertAdjacentHTML('beforeend',renderComment(created));status.replaceChildren();}else{stateMessage(status,'Նոր մեկնաբանությունն ավելացվել է։ Շարունակեք բեռնել՝ այն տեսնելու համար։');if(!loaded){const retry=document.createElement('button');retry.type='button';retry.textContent='Բեռնել մեկնաբանությունները';retry.onclick=()=>load(true);status.append(retry);}}});
  card.addEventListener('click',async event=>{
    const edit=event.target.closest('[data-post-edit]');if(edit){openPostForm({record:post,onSaved:saved=>{summary(saved);onChanged(saved,card);}});return;}
    const del=event.target.closest('[data-post-delete]');if(del){if(!await confirmAction('Հեռացնե՞լ հայտարարությունն ու դրա մեկնաբանությունները։'))return;await pending(del,card,async()=>{await posts.delete(post.id);drafts.delete(draftKey);card.remove();onDeleted(post.id,card);});return;}
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
