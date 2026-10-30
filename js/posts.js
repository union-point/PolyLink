import { posts } from './services/index.js';
import { bootstrap, start, stateMessage } from './shared/ui.js';
import { escapeHtml as e, safeUrl } from './shared/content.js';
import { createPostFeed } from './posts/feed.js';
import { openPostForm } from './posts/form.js';
start(async()=>{
  const user=await bootstrap();if(!user)return;
  const list=document.querySelector('.announcements-list'),category=document.querySelector('.category-selector'),sphere=document.querySelector('.filters .tag-selector:not(.category-selector)'),status=document.querySelector('[data-options-status]'),create=document.querySelector('.create-post-btn');
  const feed=createPostFeed(list,{filters:()=>({category:category.value,sphereCode:sphere.value})});
  const avatar=document.querySelector('.avatar-wrapper img');avatar.src=safeUrl(user.avatar,{image:true})||'image/logo.png';avatar.onerror=()=>{avatar.onerror=null;avatar.src='image/logo.png';};
  create.hidden=!['graduate','lecturer'].includes(user.role);create.onclick=()=>openPostForm({onSaved:post=>feed.add(post)});
  async function options(){category.disabled=sphere.disabled=true;stateMessage(status,'Բեռնվում են ընտրանքները...');try{const result=await posts.options();category.innerHTML='<option value="">Բոլոր տեսակները</option>'+result.types.map(t=>`<option value="${e(t.code)}">${e(t.name)}</option>`).join('');sphere.innerHTML='<option value="">Բոլոր ուղղությունները</option>'+result.spheres.map(s=>`<option value="${e(s.code)}">${e(s.name)}</option>`).join('');category.disabled=sphere.disabled=false;status.replaceChildren();category.onchange=sphere.onchange=()=>feed.load();await feed.load();}catch(error){stateMessage(status,error.message,{retry:options});}}
  await options();
});
