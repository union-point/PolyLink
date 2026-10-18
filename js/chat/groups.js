import { chat, search } from '../services/index.js';

// Text is assigned with DOM APIs; names and directory results are untrusted.
export function groupControls({user,onChange}){
  const dialog=document.createElement('dialog');dialog.className='group-dialog';dialog.setAttribute('aria-label','Group management');document.body.append(dialog);
  const title=document.createElement('h2'),form=document.createElement('form'),name=document.createElement('input'),query=document.createElement('input'),results=document.createElement('div'),members=document.createElement('div'),status=document.createElement('p'),actions=document.createElement('div');
  name.maxLength=100;name.required=true;name.setAttribute('aria-label','Group name');name.placeholder='Group name';
  query.type='search';query.placeholder='Find people';query.setAttribute('aria-label','Find people');status.setAttribute('role','status');
  form.append(name,query,results,members,status,actions);dialog.append(title,form);
  let room,draftName='',selected=new Map(),generation=0,busy=false,searchTimer;
  function button(label,work,parent=actions){const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=()=>run(work);parent.append(b);return b;}
  async function run(work){if(busy)return;busy=true;status.textContent='Saving…';dialog.querySelectorAll('button,input').forEach(n=>n.disabled=true);try{await work();status.textContent='';}catch(error){status.textContent=error.code==='RECIPIENT_UNCONFIGURED'?'This person must finish encrypted account setup before joining. The group is unchanged.':error.message;}finally{busy=false;dialog.querySelectorAll('button,input').forEach(n=>n.disabled=false);if(room){name.disabled=!room.canManage;query.disabled=!room.canManage;}}}
  async function reload(){room=await chat.participants(room.id);render();onChange();}
  function render(){
    title.textContent=room?'Group members':'Create group';name.value=room?.name||draftName;name.disabled=!!room&&!room.canManage;query.hidden=!!room&&!room.canManage;query.disabled=!!room&&!room.canManage;
    members.replaceChildren();actions.replaceChildren();
    if(room){
      for(const person of room.participants){const row=document.createElement('div'),label=document.createElement('span');label.textContent=person.name+(person.id===room.ownerId?' (owner)':'');row.append(label);members.append(row);
        if(room.canManage&&person.id!==user.id){button('Remove',async()=>{await chat.removeParticipant(room.id,person.id);await reload();},row);button('Make owner',async()=>{await chat.transferOwner(room.id,person.id);await reload();},row);}
      }
      if(room.canManage)button('Save name',async()=>{await chat.renameGroup(room.id,name.value);await reload();});
      if(!room.closed)button('Leave group',async()=>{await chat.leaveGroup(room.id);dialog.close();onChange();});
    }else{
      for(const [id,person] of selected){const row=document.createElement('div');row.textContent=person.firstName+' '+person.lastName;button('Remove selection',()=>{selected.delete(id);render();},row);members.append(row);}
      button('Create group',async()=>{const result=await chat.createGroup({name:name.value,userIds:[...selected.keys()]});dialog.close();onChange(result.roomId);});
    }
    button('Close',()=>dialog.close());
  }
  name.oninput=()=>{if(!room)draftName=name.value;};
  query.oninput=()=>{results.replaceChildren();clearTimeout(searchTimer);const revision=++generation;searchTimer=setTimeout(async()=>{try{const people=await search.people({q:query.value});if(revision!==generation||!dialog.open)return;results.replaceChildren();for(const person of people.filter(p=>p.id!==user.id&&!room?.participants.some(m=>m.id===p.id)&&!selected.has(p.id))){const row=document.createElement('div'),label=document.createElement('span');label.textContent=person.firstName+' '+person.lastName;row.append(label);button(room?'Add member':'Select',async()=>{if(room){await chat.addParticipant(room.id,person.id);await reload();}else{selected.set(person.id,person);render();}row.remove();},row);results.append(row);}}catch(error){if(revision===generation)status.textContent=error.message;}},200);};
  form.onsubmit=event=>event.preventDefault();dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});dialog.addEventListener('close',()=>{generation++;clearTimeout(searchTimer);});
  return {create(){room=null;draftName='';selected.clear();query.value='';results.replaceChildren();status.textContent='';render();dialog.showModal();name.focus();},async manage(id){room=await chat.participants(id);query.value='';results.replaceChildren();status.textContent='';render();dialog.showModal();}};
}
