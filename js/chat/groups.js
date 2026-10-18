import { chat, search } from '../services/index.js';
import { icon } from './icons.js';

// Directory names are untrusted; only static icons use innerHTML.
export function groupControls({user,onChange,getContacts=()=>[]}){
  const make=(tag,className,text)=>{const node=document.createElement(tag);node.className=className;if(text)node.textContent=text;return node;};
  const dialog=make('dialog','group-dialog');dialog.setAttribute('aria-labelledby','group-dialog-title');document.body.append(dialog);
  const heading=make('div','dialog-header'),avatar=make('div','avatar'),headingText=make('div','dialog-heading'),title=make('h2',''),subtitle=make('p','');
  title.id='group-dialog-title';avatar.innerHTML=icon('group');headingText.append(title,subtitle);heading.append(avatar,headingText);
  const form=make('form','group-form'),body=make('div','dialog-body'),nameLabel=make('label','dialog-field'),name=make('input',''),queryLabel=make('label','dialog-field'),query=make('input','');
  const contactsTitle=make('h3','section-label','Ձեր կոնտակտները'),contacts=make('div','people-list'),selection=make('div','selected-people'),results=make('div','people-list'),membersTitle=make('h3','section-label'),members=make('div','people-list'),status=make('p','dialog-status'),actions=make('div','dialog-footer');
  name.maxLength=100;name.required=true;name.placeholder='Օրինակ՝ Համալսարանի ընկերներ';nameLabel.append(make('span','','Խմբի անունը'),name);
  query.type='search';query.placeholder='Անուն կամ ազգանուն';queryLabel.append(make('span','','Որոնել մարդկանց'),query);status.setAttribute('role','status');
  body.append(nameLabel,selection,contactsTitle,contacts,queryLabel,results,membersTitle,members,status);form.append(body,actions);dialog.append(heading,form);
  let room,draftName='',selected=new Map(),people=[],generation=0,busy=false,searchTimer;
  const personName=person=>person.name||[person.firstName,person.lastName].filter(Boolean).join(' ');
  function button(label,work,parent=actions,className='dialog-button'){const b=make('button',className,label);b.type='button';b.onclick=()=>run(work);parent.append(b);return b;}
  const close=button('',()=>dialog.close(),heading,'icon-button');close.innerHTML=icon('close');close.setAttribute('aria-label','Փակել');
  function availability(){
    dialog.querySelectorAll('button,input').forEach(node=>node.disabled=busy);
    name.disabled=busy||!!room&&!room.canManage;query.disabled=busy||!!room&&!room.canManage;
    const create=actions.querySelector('[data-create]');if(create)create.disabled=busy||!name.value.trim()||!selected.size;
    dialog.setAttribute('aria-busy',String(busy));
  }
  async function run(work){if(busy)return;busy=true;status.textContent='Պահպանվում է…';availability();try{await work();status.textContent='';}catch(error){status.textContent=error.code==='RECIPIENT_UNCONFIGURED'?'Այս օգտատերը նախ պետք է ավարտի գաղտնագրված հաշվի կարգավորումը։ Խումբը չի փոփոխվել։':error.message;}finally{busy=false;availability();}}
  async function reload(){room=await chat.participants(room.id);render();onChange();}
  function personRow(person){
    const row=make('div','person-row'),picture=make('div','avatar',personName(person).slice(0,1)),details=make('div','person-details');
    details.append(make('span','person-name',personName(person)));row.append(picture,details);return row;
  }
  function selectable(person,parent){
    const row=personRow(person),b=make('button','person-row');b.type='button';b.append(...row.childNodes);const mark=make('span','selection-mark');mark.innerHTML=icon(selected.has(person.id)?'check':'plus');b.append(mark);
    b.setAttribute('aria-pressed',String(selected.has(person.id)));b.setAttribute('aria-label',`${selected.has(person.id)?'Հեռացնել ընտրվածներից':'Ավելացնել'}՝ ${personName(person)}`);
    b.onclick=()=>run(async()=>{if(room){await chat.addParticipant(room.id,person.id);await reload();}else{if(selected.has(person.id))selected.delete(person.id);else if(selected.size<99)selected.set(person.id,person);render();}});parent.append(b);
  }
  function renderPeople(){
    const existing=person=>person.id!==user.id&&!room?.participants.some(member=>member.id===person.id);
    contacts.replaceChildren();const known=getContacts().filter(existing);contactsTitle.hidden=contacts.hidden=!!room&&!room.canManage;
    if(!contacts.hidden){for(const person of known)selectable(person,contacts);if(!known.length)contacts.append(make('p','people-empty','Ձեր կոնտակտները կհայտնվեն այստեղ։ Մարդկանց կարող եք գտնել ստորև։'));}
    results.replaceChildren();if(query.value.trim()){const found=people.filter(existing);for(const person of found)selectable(person,results);if(!found.length)results.append(make('p','people-empty','Օգտատերեր չեն գտնվել։'));}
    results.hidden=!query.value.trim()||!!room&&!room.canManage;
  }
  function render(){
    title.textContent=room?'Խմբի մասին':'Ստեղծել խումբ';subtitle.textContent=room?`${room.participants.length} մասնակից`:'Անուն տվեք խմբին և ընտրեք մասնակիցներին։';
    name.value=room?.name||draftName;queryLabel.hidden=!!room&&!room.canManage;selection.replaceChildren();members.replaceChildren();actions.replaceChildren();
    if(room)body.replaceChildren(nameLabel,membersTitle,members,contactsTitle,contacts,queryLabel,results,status);
    else body.replaceChildren(nameLabel,selection,contactsTitle,contacts,queryLabel,results,membersTitle,members,status);
    membersTitle.hidden=members.hidden=!room;if(room)membersTitle.textContent='Մասնակիցներ';
    if(room){
      for(const person of room.participants){const row=personRow(person),details=row.querySelector('.person-details');details.append(make('span','person-role',person.id===room.ownerId?'Խմբի սեփականատեր':person.id===user.id?'Դուք':'Մասնակից'));members.append(row);
        if(room.canManage&&person.id!==user.id){const controls=make('div','person-actions');row.append(controls);
          button('Սեփականատեր դարձնել',async()=>{await chat.transferOwner(room.id,person.id);await reload();},controls,'text-button');
          button('Հեռացնել',async()=>{await chat.removeParticipant(room.id,person.id);await reload();},controls,'text-button danger');
        }
      }
      if(room.canManage)button('Պահպանել անունը',async()=>{if(!name.reportValidity())return;await chat.renameGroup(room.id,name.value);await reload();},actions,'dialog-button primary');
    }else{
      for(const [id,person] of selected){const chip=button('',()=>{selected.delete(id);render();},selection,'person-chip');chip.append(make('span','',personName(person)));chip.insertAdjacentHTML('beforeend',icon('close'));chip.setAttribute('aria-label',`Հեռացնել ընտրվածներից՝ ${personName(person)}`);}
      const create=button(`Ստեղծել խումբ${selected.size?` · ${selected.size+1}`:''}`,async()=>{if(!form.reportValidity()||!name.value.trim()||!selected.size)return;const result=await chat.createGroup({name:name.value,userIds:[...selected.keys()]});dialog.close();onChange(result.roomId);},actions,'dialog-button primary');create.dataset.create='';
    }
    button('Փակել',()=>dialog.close());renderPeople();availability();
  }
  name.oninput=()=>{if(!room)draftName=name.value;availability();};
  query.oninput=()=>{
    results.replaceChildren();people=[];clearTimeout(searchTimer);const revision=++generation;
    if(!query.value.trim()){renderPeople();return;}results.hidden=false;results.append(make('p','people-empty','Որոնվում է…'));
    searchTimer=setTimeout(async()=>{try{const found=await search.people({q:query.value});if(revision!==generation||!dialog.open)return;people=found;renderPeople();availability();}catch(error){if(revision===generation&&dialog.open)status.textContent=error.message;}},200);
  };
  form.onsubmit=event=>{event.preventDefault();actions.querySelector('[data-create]')?.click();};dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});dialog.addEventListener('close',()=>{generation++;clearTimeout(searchTimer);});
  return {
    create(){room=null;draftName='';selected.clear();people=[];generation++;query.value='';status.textContent='';render();dialog.showModal();name.focus();},
    async manage(id){const revision=++generation;const details=await chat.participants(id);if(revision!==generation)return;room=details;selected.clear();people=[];query.value='';status.textContent='';render();if(!dialog.open)dialog.showModal();close.focus();}
  };
}
