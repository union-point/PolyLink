import { posts } from '../services/index.js';
import { createPostCard } from './cards.js';
import { stateMessage } from '../shared/ui.js';
import { postsStyles } from './form.js';
export function createPostFeed(host,{filters=()=>({}),onDeleted=()=>{}}={}) {
  postsStyles();const list=document.createElement('div'),status=document.createElement('div'),more=document.createElement('button');list.className='post-feed-list';more.type='button';more.className='post-more';more.textContent='Ցուցադրել ավելին';more.hidden=true;host.replaceChildren(list,status,more);
  let generation=0,cursor=null,loading=false,records=new Map();
  const matches=post=>{const f=filters();return (!f.category||f.category===post.category)&&(!f.sphereId||f.sphereId===post.sphereId)&&(!f.userId||f.userId===post.author.id);};
  const cardFor=post=>createPostCard(post,{onChanged:(saved,card)=>{records.set(saved.id,saved);if(!matches(saved)){card.remove();records.delete(saved.id);}if(!records.size)stateMessage(status,'Հայտարարություններ չկան');},onDeleted:id=>{records.delete(id);onDeleted(id);if(!records.size)stateMessage(status,'Հայտարարություններ չկան');}});
  async function load(reset=false){if(loading&&!reset)return;const current=reset?++generation:generation;loading=true;more.disabled=true;if(reset){cursor=null;records=new Map();list.replaceChildren();more.hidden=true;}stateMessage(status,'Բեռնվում է...');try{const page=await posts.list({...filters(),...(cursor?{cursor}:{})});if(current!==generation)return;for(const post of page.items){if(records.has(post.id))continue;records.set(post.id,post);list.append(cardFor(post));}cursor=page.nextCursor;more.hidden=cursor===null;status.replaceChildren();if(!records.size)stateMessage(status,'Հայտարարություններ չկան');}catch(error){if(current===generation)stateMessage(status,error.message,{retry:()=>load(reset)});}finally{if(current===generation){loading=false;more.disabled=false;}}}
  more.onclick=()=>load();return {load:()=>load(true),add(post){if(records.has(post.id)||!matches(post))return;records.set(post.id,post);status.replaceChildren();list.prepend(cardFor(post));}};
}
