import { createManagementClient } from './management-client.js';
import { adminShell } from './shell.js';
import { catalog, messages, errorText } from './catalog.js';
import { escapeHtml as e } from '../shared/content.js';
import { stateMessage, pending, confirmAction, start } from '../shared/ui.js';
import { DataError } from '../data/errors.js';

export function startAdminPage(config) { start(()=>mount(config)); }
async function mount({page,title,description,area,kinds}) {
  const main=document.getElementById('admin-main'),client=createManagementClient();
  let generation=0,rows=new Map(),cursor=null,dialogState=null,timer,loading=false;
  const shell=await adminShell(page,()=>{generation++;clearTimeout(timer);rows.clear();dialogState?.dispose();dialogState=null;});if(!shell)return;
  main.innerHTML=`<div class="admin-heading"><h1>${e(title)}</h1><p>${e(description)}</p></div><section class="admin-panel" aria-label="${e(title)}"><form class="admin-toolbar" novalidate><div class="admin-field"><label for="admin-kind">Ցանկ</label><select id="admin-kind" name="kind">${kinds.map(kind=>`<option value="${kind}">${e(catalog[kind].label)}</option>`).join('')}</select></div><div class="admin-field"><label for="admin-search">Որոնում</label><div class="admin-search"><input id="admin-search" name="q" type="search" maxlength="255" autocomplete="off" placeholder="${area==='registries'?'Անուն, էլ. փոստ կամ դիպլոմ':'Անվանում կամ կոդ'}"><button type="button" data-clear aria-label="Մաքրել որոնումը" hidden>×</button></div></div><button type="button" data-refresh>Թարմացնել</button><button type="button" class="primary" data-add>Ավելացնել</button></form><div class="admin-results-header"><h2 data-list-title></h2><span class="admin-muted" data-count></span></div><div class="admin-status" data-list-status></div><div class="admin-table-region" role="region" tabindex="0" aria-label="Գրառումների ցանկ"><table class="admin-table"><thead><tr><th scope="col">${area==='registries'?'Անուն և տվյալներ':'Անվանում'}</th><th scope="col">Վիճակ</th><th scope="col">Գործողություններ</th></tr></thead><tbody></tbody></table></div><div class="admin-paging"><button type="button" data-more hidden>Ցուցադրել ավելին</button></div></section>`;
  main.removeAttribute('aria-busy');
  const kind=main.querySelector('#admin-kind'),search=main.querySelector('#admin-search'),body=main.querySelector('tbody'),status=main.querySelector('[data-list-status]'),more=main.querySelector('[data-more]'),clear=main.querySelector('[data-clear]');
  const initial=new URLSearchParams(location.search).get('kind');if(kinds.includes(initial))kind.value=initial;
  const dirty=()=>!!dialogState?.dirty();shell.setDirty(dirty);
  window.addEventListener('beforeunload',event=>{if(dirty()){event.preventDefault();event.returnValue='';}});
  function locked(row){return area==='references'?row.protectionReasons.length>0:row.linked;}
  function lockReason(row){return area==='references'?row.protectionReasons.map(code=>messages[code]).join(' '):row.linked?messages.RECORD_LINKED:'';}
  function draw(){
    body.innerHTML=[...rows.values()].map(row=>{
      const name=area==='references'?row.name:[row.firstName,row.lastName].filter(Boolean).join(' ')||'Անունը լրացված չէ';
      const extra=area==='references'?(row.code||''):(row.email||row.diplomaNumber||'');
      const reason=lockReason(row);return `<tr data-id="${row.id}"><td><strong>${e(name)}</strong>${extra?`<small>${e(extra)}</small>`:''}<small>№ ${row.id}</small></td><td>${reason?`<span class="admin-badge">${e(reason)}</span>`:'<span class="admin-muted">Հասանելի է</span>'}${row.needsCorrection?'<small>Տվյալները լրացման կարիք ունեն։</small>':''}</td><td><div class="admin-row-actions"><button type="button" data-view>Դիտել</button><button type="button" data-edit ${locked(row)?`disabled title="${e(reason)}"`:''}>Փոփոխել</button><button type="button" data-delete class="danger" ${locked(row)?`disabled title="${e(reason)}"`:''}>Հեռացնել</button></div></td></tr>`;
    }).join('');main.querySelector('[data-count]').textContent=`${rows.size} գրառում`;
  }
  async function load(reset=true){
    if(!shell.active()||(!reset&&loading))return;clearTimeout(timer);const current=++generation,selected=kind.value,q=search.value.trim();loading=true;more.disabled=true;
    if(reset){cursor=null;rows.clear();draw();more.hidden=true;}stateMessage(status,'Բեռնվում է...');
    main.querySelector('[data-list-title]').textContent=catalog[selected].label;
    try{const result=await client.list(area,selected,{q,cursor:reset?'':cursor||''});if(current!==generation||!shell.active())return;result.items.forEach(row=>rows.set(row.id,row));cursor=result.nextCursor;draw();more.hidden=!cursor;status.replaceChildren();if(!rows.size)stateMessage(status,q?'Որոնման արդյունքներ չկան։':'Գրառումներ չկան։ Ավելացրեք առաջին գրառումը։');}
    catch(error){if(current!==generation||!shell.active()||shell.fail(error))return;stateMessage(status,errorText(error),{retry:()=>load(reset)});}
    finally{if(current===generation){loading=false;more.disabled=false;}}
  }
  const reload=async()=>{await load();};
  more.onclick=()=>load(false);main.querySelector('[data-refresh]').onclick=reload;
  main.querySelector('form').onsubmit=event=>{event.preventDefault();load();};
  kind.onchange=()=>{const url=new URL(location.href);url.searchParams.set('kind',kind.value);history.replaceState(null,'',url);load();};
  let composing=false;search.addEventListener('compositionstart',()=>{composing=true;clearTimeout(timer);});search.addEventListener('compositionend',()=>{composing=false;changed();});
  function changed(){clear.hidden=!search.value;clearTimeout(timer);generation++;if(!composing)timer=setTimeout(()=>load(),300);}
  search.addEventListener('input',changed);clear.onclick=()=>{search.value='';clear.hidden=true;search.focus();load();};
  main.querySelector('[data-add]').onclick=()=>openForm(null,kind.value);
  body.onclick=async event=>{
    const button=event.target.closest('button'),row=rows.get(button?.closest('tr')?.dataset.id);if(!row||button.disabled)return;const selected=kind.value;
    if(button.hasAttribute('data-delete')){
      if(!await confirmAction('Հեռացնե՞լ գրառումը։ Այս գործողությունը հետարկել հնարավոր չէ։'))return;
      await pending(button,status,async()=>{try{await client.delete(area,selected,row.id,row.version);if(shell.active())await load();}catch(error){if(!shell.fail(error)){stateMessage(status,errorText(error),{retry:reload});} }});return;
    }
    button.disabled=true;
    try{const fresh=await client.get(area,selected,row.id);if(shell.active())openForm(fresh,selected,button.hasAttribute('data-view'));}
    catch(error){if(!shell.fail(error))stateMessage(status,errorText(error),{retry:reload});}
    finally{if(button.isConnected)button.disabled=false;}
  };
  async function referenceOptions(resource,select,selected,alive){
    let next='',options=[];
    do{const page=await client.list('references',resource,{cursor:next});if(!alive())return;options.push(...page.items);next=page.nextCursor;}while(next);
    select.replaceChildren(new Option('Ընտրեք ցանկից',''));for(const row of options)select.add(new Option(row.name,row.id));
    if(selected&&!options.some(r=>r.id===selected)){const item=new Option('Արժեքն այլևս հասանելի չէ։ Ընտրեք նորը։',selected);item.disabled=true;select.add(item);}select.value=selected||'';
  }
  async function openForm(record,selected,view=false){
    if(dialogState||!shell.active())return;
    const previous=document.activeElement,dialog=document.createElement('dialog');dialog.className='admin-dialog';dialog.setAttribute('aria-labelledby','admin-dialog-title');
    const meta=catalog[selected],readOnly=!!record&&(view||locked(record));let saving=false,closed=false,optionsReady=true;
    const fields=area==='references'?[['name','Անվանում','text',meta.nameLimit],...(meta.codeLimit?[['code','Կոդ','text',meta.codeLimit]]:[])]:[['firstName','Անուն','text',100],['lastName','Ազգանուն','text',100],...(selected==='lecturers'?[['email','Էլ. փոստ','email',255],['departmentId','Ամբիոն','select','departments']]:[['diplomaNumber','Դիպլոմի համար','text',100],['specializationId','Մասնագիտություն','select','specializations'],['studyStartDate','Ուսման սկիզբ','date'],['studyEndDate','Ուսման ավարտ','date']])];
    dialog.innerHTML=`<form novalidate><header><h2 id="admin-dialog-title">${readOnly?'Դիտել':record?'Փոփոխել':'Ավելացնել'} · ${e(meta.singular)}</h2><button type="button" data-close aria-label="Փակել">×</button></header><div class="admin-form-body">${record&&lockReason(record)?`<p class="admin-badge">${e(lockReason(record))}</p>`:''}${record?.needsCorrection?'<p>Տվյալները լրացման կարիք ունեն։</p>':''}<div class="admin-form-fields">${fields.map(([key,label,type,max])=>`<div class="admin-field ${area==='references'?'wide':''}"><label for="admin-${key}">${label}</label>${type==='select'?`<select id="admin-${key}" name="${key}" required aria-describedby="admin-error-${key}"><option value="">Բեռնվում է...</option></select>`:`<input id="admin-${key}" name="${key}" type="${type}" ${max?`maxlength="${max}"`:''} required autocomplete="off" aria-describedby="admin-error-${key}">`}<small class="admin-field-error" id="admin-error-${key}"></small></div>`).join('')}</div><div data-options-status></div><div data-status class="admin-status" role="status"></div><button type="button" data-reload hidden>Վերբեռնել գրառումը</button></div><footer><button type="button" data-cancel>${readOnly?'Փակել':'Չեղարկել'}</button>${readOnly?'':'<button type="submit" class="primary">Պահպանել</button>'}</footer></form>`;
    document.body.append(dialog);const form=dialog.querySelector('form'),submit=form.querySelector('[type=submit]'),formStatus=form.querySelector('[data-status]'),optionsStatus=form.querySelector('[data-options-status]');
    const value=()=>Object.fromEntries(fields.filter(([key])=>!(area==='references'&&record&&key==='code')).map(([key])=>[key,form.elements[key].value]));
    for(const [key,,type] of fields){const input=form.elements[key];if(type==='select'){if(record?.[key])input.add(new Option(record[key],record[key]));input.value=record?.[key]||'';}else input.value=record?.[key]||'';if(readOnly||record&&key==='code'){if(type==='select')input.disabled=true;else input.readOnly=true;}}
    const initial=JSON.stringify(value()),isDirty=()=>!readOnly&&JSON.stringify(value())!==initial;
    function dispose(){closed=true;dialogState=null;dialog.close();dialog.remove();}
    async function close(force=false){if(saving&&!force)return;if(!force&&isDirty()&&!await confirmAction('Հրաժարվե՞լ չպահպանված փոփոխություններից։'))return;dispose();previous?.focus();}
    dialogState={dirty:isDirty,dispose};
    form.querySelector('[data-close]').onclick=form.querySelector('[data-cancel]').onclick=()=>close();dialog.oncancel=event=>{event.preventDefault();close();};
    async function options(){
      optionsReady=false;if(submit)submit.disabled=true;optionsStatus.replaceChildren();
      try{await Promise.all(fields.filter(([, ,type])=>type==='select').map(([key,,,resource])=>referenceOptions(resource,form.elements[key],form.elements[key].value,()=>!closed&&shell.active())));if(closed)return;optionsReady=true;}
      catch(error){if(!shell.fail(error)&&!closed)stateMessage(optionsStatus,errorText(error),{retry:options});}
      finally{if(submit&&!closed)submit.disabled=!optionsReady||saving;}
    }
    const reloadButton=form.querySelector('[data-reload]');reloadButton.onclick=async()=>{if(!await confirmAction('Վերբեռնելիս չպահպանված փոփոխությունները կկորչեն։ Շարունակե՞լ։'))return;try{const fresh=await client.get(area,selected,record.id);if(closed||!shell.active())return;await close(true);openForm(fresh,selected);}catch(error){if(!shell.fail(error)&&!closed)formStatus.textContent=errorText(error);}};
    form.addEventListener('input',event=>{event.target.removeAttribute('aria-invalid');const help=form.querySelector(`#admin-error-${event.target.name}`);if(help)help.textContent='';});
    form.onsubmit=async event=>{
      event.preventDefault();if(!submit||saving||!optionsReady||closed)return;
      await pending(submit,form,async()=>{
        fields.forEach(([key])=>{form.querySelector(`#admin-error-${key}`).textContent='';});reloadButton.hidden=true;
        const input=value(),errors={};
        for(const [key,,type] of fields){if(key==='code'&&record)continue;const field=form.elements[key];if(!field.value.trim()||!field.checkValidity())errors[key]='Լրացրեք վավեր արժեք։';}
        if(input.code&&!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(input.code))errors.code='Օգտագործեք լատինատառ փոքրատառեր, թվեր և միջանկյալ գծիկներ։';
        if(input.studyStartDate>input.studyEndDate)errors.studyEndDate='Ավարտը չի կարող նախորդել սկզբին։';
        try{
          if(Object.keys(errors).length)throw new DataError('VALIDATION','Ստուգեք լրացված դաշտերը։',errors);
          saving=true;form.setAttribute('aria-busy','true');form.querySelectorAll('input,select,button').forEach(el=>el.disabled=true);
          await (record?client.update(area,selected,record.id,{...input,version:record.version}):client.create(area,selected,input));
          if(closed||!shell.active())return;await close(true);await load();
        }catch(error){
          if(shell.fail(error)||closed)return;
          for(const [key,message] of Object.entries(error.fieldErrors||{})){const field=form.elements[key],help=form.querySelector(`#admin-error-${key}`);if(field&&help){field.setAttribute('aria-invalid','true');help.textContent=message==='Լրացրեք վավեր արժեք։'||error.code==='VALIDATION'&&errors[key]?message:'Ստուգեք դաշտի արժեքը։';}}
          if(record&&['VERSION_CONFLICT','REFERENCE_IN_USE','SYSTEM_VALUE','RECORD_LINKED','NOT_FOUND'].includes(error.code))reloadButton.hidden=false;
          formStatus.textContent=errorText(error);formStatus.setAttribute('role','alert');
          saving=false;form.querySelectorAll('input,select,button').forEach(el=>el.disabled=false);form.querySelector('[aria-invalid=true]')?.focus();
          if(error.code==='REGISTRY_CONFLICT'||error.fieldErrors?.departmentId||error.fieldErrors?.specializationId)await options();
        }finally{saving=false;form.removeAttribute('aria-busy');if(!closed){form.querySelectorAll('input,select,button').forEach(el=>el.disabled=false);if(submit)submit.disabled=!optionsReady;}}
      });if(!closed)submit.disabled=!optionsReady;
    };
    dialog.showModal();dialog.querySelector('input,select,[data-close]')?.focus();await options();
  }
  await load();
}
