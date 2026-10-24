import { forum } from '../services/index.js';
import { bootstrap, pending } from '../shared/ui.js';
import { createEditor } from './editor.js';
import { categoryOptions } from './view.js';
import { createRequestKey } from './contracts.js';

export async function initializeTopicCreation() {
  if (!await bootstrap()) return;
  const form=document.querySelector('.new-topic-form'), textarea=form.elements.content;
  form.elements.title.maxLength=255;
  categoryOptions(form.elements.categoryCode,await forum.categories());
  const host=document.createElement('div');textarea.replaceWith(host);
  const editor=createEditor(host),request=createRequestKey();
  form.onsubmit=event=>{
    event.preventDefault();
    pending(form.querySelector('[type="submit"]'),form,async()=>{
      const data={title:form.elements.title.value,categoryCode:form.elements.categoryCode.value,content:editor.get()};
      const topic=await forum.create({...data,requestId:request.for(data)});request.clear();location.href=`topic.html?id=${encodeURIComponent(topic.id)}`;
    });
  };
}
