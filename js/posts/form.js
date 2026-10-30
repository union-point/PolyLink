import { auth, posts } from '../services/index.js';
import { createEditor } from '../forum/editor.js';
import { escapeHtml as e, safeUrl } from '../shared/content.js';
import { pending, stateMessage, notify } from '../shared/ui.js';
import { sanitizePostHtml, validatePostInput } from './content.js';
export function postsStyles() {
  if (document.querySelector('link[data-posts-style]')) return;
  const link=document.createElement('link');link.rel='stylesheet';link.href='./css/posts.css';link.dataset.postsStyle='';document.head.append(link);
}
export function openPostForm({record=null,onSaved=()=>{}}={}) {
  postsStyles();
  const previous=document.activeElement,dialog=document.createElement('dialog');dialog.className='posts-modal';dialog.setAttribute('aria-label',record?'Փոփոխել հայտարարությունը':'Ավելացնել հայտարարություն');
  dialog.innerHTML=`<form class="posts-form" novalidate>
    <header class="posts-composer-header">
      <img class="posts-composer-avatar" src="image/logo.png" alt="" width="48" height="48">
      <div class="posts-composer-identity"><p class="posts-composer-name" data-author-name aria-busy="true">&nbsp;</p>
        <div class="posts-composer-selectors">
          <select name="category" required aria-label="Տեսակ"><option value="">Տեսակ</option>${record?.category?`<option value="${e(record.category)}" selected>${e(record.categoryName)}</option>`:''}</select>
          <select name="sphereCode" required aria-label="Ուղղություն"><option value="">Ուղղություն</option>${record?.sphereCode?`<option value="${e(record.sphereCode)}" selected>${e(record.sphereName)}</option>`:''}</select>
        </div>
      </div>
      <button type="button" data-close aria-label="Փակել"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
    </header>
    <div class="posts-composer-writing">
      <input name="title" id="announcement-title" aria-label="Վերնագիր" placeholder="Վերնագիր" required maxlength="255" value="${e(record?.title||'')}">
      <div data-editor></div>
    </div>
    <div class="posts-composer-feedback"><div data-options-status></div><div data-fields-errors role="alert"></div><p data-status role="status"></p></div>
    <footer><button type="button" data-cancel>Չեղարկել</button><button type="submit" class="primary-btn publish-btn">Պահպանել</button></footer>
  </form>`;
  document.body.append(dialog);const form=dialog.querySelector('form'),title=form.elements.title,category=form.elements.category,sphere=form.elements.sphereCode,submit=form.querySelector('[type=submit]');
  const editor=createEditor(form.querySelector('[data-editor]'),{value:record?.content||'',sanitize:sanitizePostHtml,compact:true});editor.element.id='announcement-content';
  const value=()=>({title:title.value,content:editor.element.innerHTML,category:category.value,sphereCode:sphere.value});
  const initial=JSON.stringify(value());let saving=false,closed=false,optionsReady=false;
  const dirty=()=>JSON.stringify(value())!==initial;
  const unload=event=>{if(dirty()){event.preventDefault();event.returnValue='';}};
  window.addEventListener('beforeunload',unload);
  function close(force=false){if(saving&&!force)return;if(!force&&dirty()&&!window.confirm('Հրաժարվե՞լ չպահպանված փոփոխություններից։'))return;closed=true;window.removeEventListener('beforeunload',unload);editor.destroy();dialog.close();dialog.remove();previous?.focus();}
  form.querySelector('[data-close]').onclick=form.querySelector('[data-cancel]').onclick=()=>close();
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)close();});
  const avatar=form.querySelector('.posts-composer-avatar');
  avatar.onerror=()=>{avatar.onerror=null;avatar.src='image/logo.png';};
  auth.me().then(user=>{
    if(closed)return;
    const name=form.querySelector('[data-author-name]');
    name.textContent=user?.name||[user?.firstName,user?.lastName].filter(Boolean).join(' ')||'Օգտատեր';
    name.removeAttribute('aria-busy');
    avatar.src=safeUrl(user?.avatar,{image:true})||'image/logo.png';
  }).catch(()=>{if(!closed){const name=form.querySelector('[data-author-name]');name.textContent='Օգտատեր';name.removeAttribute('aria-busy');}});
  async function options(){const host=form.querySelector('[data-options-status]');submit.disabled=true;stateMessage(host,'Բեռնվում են ընտրանքները...');try{const result=await posts.options();if(closed)return;const selectedCategory=category.value,selectedSphere=sphere.value;category.innerHTML='<option value="">Տեսակ</option>'+result.types.map(t=>`<option value="${e(t.code)}">${e(t.name)}</option>`).join('');sphere.innerHTML='<option value="">Ուղղություն</option>'+result.spheres.map(s=>`<option value="${e(s.code)}">${e(s.name)}</option>`).join('');category.value=selectedCategory;sphere.value=selectedSphere;host.replaceChildren();optionsReady=true;submit.disabled=false;}catch(error){if(!closed)stateMessage(host,error.message,{retry:options});}}
  form.onsubmit=async event=>{event.preventDefault();if(saving||!optionsReady)return;let saved;
    const success=await pending(submit,form,async()=>{
      const errors=form.querySelector('[data-fields-errors]');errors.replaceChildren();let input;
      try{input=validatePostInput({...value(),content:editor.get()});}catch(error){for(const [key,message] of Object.entries(error.fieldErrors||{})){const p=document.createElement('p');p.textContent=message;errors.append(p);}throw error;}
      saving=true;form.querySelectorAll('input,select,button').forEach(el=>el.disabled=true);editor.element.contentEditable='false';
      try{saved=record?await posts.update(record.id,input):await posts.create(input);}
      finally{saving=false;form.querySelectorAll('input,select,button').forEach(el=>el.disabled=false);editor.element.contentEditable='true';}
    });
    if(success){close(true);try{await onSaved(saved);}catch(error){notify(error.message);}}
  };
  dialog.showModal();title.focus();options();return {dialog,close,dirty};
}
