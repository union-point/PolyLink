import { posts } from '../services/index.js';
import { createEditor } from '../forum/editor.js';
import { escapeHtml as e } from '../shared/content.js';
import { pending, stateMessage, notify } from '../shared/ui.js';
import { sanitizePostHtml, postPlainText, validatePostInput } from './content.js';
export function postsStyles() {
  if (document.querySelector('link[data-posts-style]')) return;
  const link=document.createElement('link');link.rel='stylesheet';link.href='./css/posts.css';link.dataset.postsStyle='';document.head.append(link);
}
export function openPostForm({record=null,onSaved=()=>{}}={}) {
  postsStyles();
  const previous=document.activeElement,dialog=document.createElement('dialog');dialog.className='posts-modal';dialog.setAttribute('aria-label',record?'Փոփոխել հայտարարությունը':'Ավելացնել հայտարարություն');
  dialog.innerHTML=`<form class="posts-form" novalidate><header><h2>${record?'Փոփոխել հայտարարությունը':'Ավելացնել հայտարարություն'}</h2><button type="button" data-close aria-label="Փակել">×</button></header><label>Վերնագիր <input name="title" id="announcement-title" required maxlength="255" value="${e(record?.title||'')}"></label><p data-title-count></p><label>Տեսակ <select name="category" required><option value="">Ընտրեք տեսակը</option>${record?.category?`<option value="${e(record.category)}" selected>${e(record.categoryName)}</option>`:''}</select></label><label>Ուղղություն <select name="sphereId" required><option value="">Ընտրեք ուղղությունը</option>${record?.sphereId?`<option value="${e(record.sphereId)}" selected>${e(record.sphereName)}</option>`:''}</select></label><div data-options-status></div><label>Բովանդակություն</label><div data-editor></div><p data-body-count aria-live="polite"></p><div data-fields-errors role="alert"></div><footer><button type="button" data-cancel>Չեղարկել</button><button type="submit" class="primary-btn publish-btn">Պահպանել</button></footer></form>`;
  document.body.append(dialog);const form=dialog.querySelector('form'),title=form.elements.title,category=form.elements.category,sphere=form.elements.sphereId,submit=form.querySelector('[type=submit]');
  const editor=createEditor(form.querySelector('[data-editor]'),{value:record?.content||'',sanitize:sanitizePostHtml});editor.element.id='announcement-content';
  const value=()=>({title:title.value,content:editor.element.innerHTML,category:category.value,sphereId:sphere.value});
  const initial=JSON.stringify(value());let saving=false,closed=false,optionsReady=false;
  const dirty=()=>JSON.stringify(value())!==initial;
  const unload=event=>{if(dirty()){event.preventDefault();event.returnValue='';}};
  window.addEventListener('beforeunload',unload);
  function close(force=false){if(saving&&!force)return;if(!force&&dirty()&&!window.confirm('Հրաժարվե՞լ չպահպանված փոփոխություններից։'))return;closed=true;window.removeEventListener('beforeunload',unload);dialog.close();dialog.remove();previous?.focus();}
  form.querySelector('[data-close]').onclick=form.querySelector('[data-cancel]').onclick=()=>close();
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)close();});
  function counts(){form.querySelector('[data-title-count]').textContent=`${title.value.length}/255`;const length=postPlainText(editor.element.innerHTML).length;form.querySelector('[data-body-count]').textContent=`${length}/20000`;}
  form.addEventListener('input',counts);counts();
  async function options(){const host=form.querySelector('[data-options-status]');submit.disabled=true;stateMessage(host,'Բեռնվում են ընտրանքները...');try{const result=await posts.options();if(closed)return;const selectedCategory=category.value,selectedSphere=sphere.value;category.innerHTML='<option value="">Ընտրեք տեսակը</option>'+result.types.map(t=>`<option value="${e(t.code)}">${e(t.name)}</option>`).join('');sphere.innerHTML='<option value="">Ընտրեք ուղղությունը</option>'+result.spheres.map(s=>`<option value="${e(s.id)}">${e(s.name)}</option>`).join('');category.value=selectedCategory;sphere.value=selectedSphere;host.replaceChildren();optionsReady=true;submit.disabled=false;}catch(error){if(!closed)stateMessage(host,error.message,{retry:options});}}
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
