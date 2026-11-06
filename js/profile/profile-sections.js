import { openPostForm } from '../posts/form.js';
import { Modal } from './profile-modal.js';
import { profiles } from '../services/index.js';
import { educationEntry, certificateEntry, announcementEntry } from './profile-render.js';
import { profileImage } from './images.js';
import { educationInput } from './contracts.js';
import { validateCertificate } from '../data/validation.js';
import { notify, confirmAction, pending, showError } from '../shared/ui.js';
import { safeUrl } from '../shared/content.js';
const modal = new Modal();
function field(form, label, control) {
  const wrap=document.createElement('label');wrap.style.cssText='display:block;margin:16px 0';
  const text=document.createElement('span');text.textContent=label;wrap.append(text,control);
  control.style.cssText='display:block;width:100%;padding:10px;margin-top:6px;border:1px solid var(--border-color);border-radius:8px;background:var(--card-background);color:var(--font-color-primary);box-sizing:border-box';
  form.append(wrap);return control;
}
function input(form,label,name,value='',type='text') {
  const el=document.createElement('input');el.name=name;el.type=type;el.value=value||'';return field(form,label,el);
}
function select(form,label,name,rows,value) {
  const search=input(form,`Որոնել՝ ${label}`,'','','search');search.removeAttribute('name');search.setAttribute('aria-label',`Որոնել՝ ${label}`);
  const el=document.createElement('select');el.name=name;
  let selected=String(value||'');
  const populate=()=>{
    const blank=new Option(name==='universityId'?'Ընտրեք հաստատությունը':'Նշված չէ','');
    const matches=rows.filter(row=>row.id===selected||row.name.toLocaleLowerCase().includes(search.value.toLocaleLowerCase()));
    el.replaceChildren(blank,...matches.map(row=>new Option(row.name,row.id)));el.value=selected;
  };
  populate();el.onchange=()=>{selected=el.value;};search.oninput=()=>{selected=el.value;populate();};return field(form,label,el);
}
function dateField(form,label,name,value) {
  const precision=document.createElement('select');precision.setAttribute('aria-label',`${label}՝ ճշգրտություն`);
  precision.append(new Option('Տարի','YEAR'),new Option('Ամիս','MONTH'));
  if(value?.length===10)precision.append(new Option('Նախկին ամսաթիվ','DAY'));
  precision.value=value?.length===4?'YEAR':value?.length===10?'DAY':'MONTH';
  field(form,`${label}՝ ճշգրտություն`,precision);
  const el=input(form,label,name,value?.slice(0,7),precision.value==='YEAR'?'number':'month');
  const apply=()=>{el.type=precision.value==='YEAR'?'number':'month';el.value=value?(precision.value==='YEAR'?value.slice(0,4):value.slice(0,7)):'';if(el.type==='number'){el.min='1900';el.max='2200';}};
  apply();precision.onchange=()=>{value=el.value;apply();};
  el.addEventListener('input',()=>{if(precision.value==='DAY')precision.value='MONTH';});
  return { el, precision, get:()=>precision.value==='DAY'?value:(el.value||null) };
}
function addDelete(form,entry,record,service) {
  if(!record.id)return;
  const button=document.createElement('button');button.type='button';button.className='delete-entry-btn';button.textContent='Հեռացնել';form.append(button);
  button.onclick=async()=>{
    if(modal.saving||button.disabled)return;
    button.disabled=true;
    try {
      if(!await confirmAction('Վստա՞հ եք, որ ցանկանում եք հեռացնել այս գրառումը։'))return;
      modal.saving=true;button.disabled=false;
      const saved=await pending(button,form,()=>service.delete(record.id));
      modal.saving=false;if(saved){entry.remove();modal.close(true);notify('Գրառումը հեռացվել է');}
    }finally{modal.saving=false;button.disabled=false;}
  };
}
function educationModal(entry,record={}) {
  const form=document.createElement('div'),status=document.createElement('p');status.textContent='Բեռնվում է…';status.setAttribute('role','status');form.append(status);
  let ready=false,options,controls,start,end,ongoing;
  modal.create(record.id?'Փոփոխել կրթությունը':'Ավելացնել կրթություն',form,async()=>{
    if(!ready)return false;
    const data=educationInput({...Object.fromEntries(Object.entries(controls).map(([key,el])=>[key,el.value])),startDate:start.get(),endDate:ongoing.checked?null:end.get(),isOngoing:ongoing.checked},options,record);
    const saved=record.id?await profiles.education.update(record.id,data):await profiles.education.create(data);
    if(entry){const replacement=educationEntry(saved,true);entry.replaceWith(replacement);attachEducationHandlers(replacement,saved);}else addEducationEntry(saved);
    notify('Կրթությունը պահպանվել է');
  });
  const load=async()=>{
    status.replaceChildren(document.createTextNode('Բեռնվում է…'));
    try {
      options=await profiles.education.options();if(!form.isConnected)return;
      form.replaceChildren();controls={};
      for(const [key,list,label] of [['universityId','universities','Ուսումնական հաստատություն *'],['degreeId','degrees','Աստիճան'],['instituteId','institutes','Ինստիտուտ'],['specializationId','specializations','Մասնագիտություն']])controls[key]=select(form,label,key,options[list],record[key]);
      if(!options.universities.length){const text=document.createElement('p');text.textContent='Հաստատությունների ցանկը դատարկ է։';form.append(text);}
      start=dateField(form,'Սկիզբ','startDate',record.startDate);end=dateField(form,'Ավարտ','endDate',record.endDate);
      ongoing=input(form,'Ուսումը շարունակվում է','isOngoing','','checkbox');ongoing.checked=!!record.isOngoing;
      const sync=()=>{end.el.disabled=ongoing.checked;end.precision.disabled=ongoing.checked;if(ongoing.checked){end.el.value='';if(end.precision.value==='DAY')end.precision.value='MONTH';}};ongoing.onchange=sync;sync();
      addDelete(form,entry,record,profiles.education);ready=true;
    }catch(error){
      showError(form,error);const retry=document.createElement('button');retry.type='button';retry.textContent='Կրկին փորձել';retry.onclick=()=>{retry.remove();load();};status.replaceChildren(retry);
    }
  };load();
}
export function showAddEducationModal(){educationModal(null);}
export function addEducationEntry(record){const entry=educationEntry(record,true);document.querySelector('.education-section').append(entry);attachEducationHandlers(entry,record);}
export function attachEducationHandlers(entry,record){const button=entry.querySelector('.edit-icon');if(button)button.onclick=()=>educationModal(entry,record);}
function certificateModal(entry,record={}) {
  const form=document.createElement('div');
  const name=input(form,'Հավաստագրի անվանում *','name',record.name);name.required=true;name.maxLength=255;
  const org=input(form,'Կազմակերպություն *','organization',record.organization);org.required=true;org.maxLength=255;
  input(form,'Տրման ամիս','issueDate',record.issueDate,'month');
  const url=input(form,'Հավաստագրի հղում (ոչ պարտադիր)','credentialUrl',record.credentialUrl,'url');url.maxLength=2048;
  addDelete(form,entry,record,profiles.certificates);
  modal.create(record.id?'Փոփոխել հավաստագիրը':'Ավելացնել հավաստագիր',form,async data=>{
    const input=validateCertificate(data);
    const saved=record.id?await profiles.certificates.update(record.id,input):await profiles.certificates.create(input);
    if(entry){const replacement=certificateEntry(saved,true);entry.replaceWith(replacement);attachLicenseHandlers(replacement,saved);}else addLicenseEntry(saved);
    notify('Հավաստագիրը պահպանվել է');
  });
}
export function showAddLicenseModal(){certificateModal(null);}
export function addLicenseEntry(record){const entry=certificateEntry(record,true);document.querySelector('.licenses-section').append(entry);attachLicenseHandlers(entry,record);}
export function attachLicenseHandlers(entry,record){const button=entry.querySelector('.edit-icon');if(button)button.onclick=()=>certificateModal(entry,record);}
export function showAddAnnouncementModal(){openPostForm({onSaved:saved=>document.dispatchEvent(new CustomEvent('polylink-post-created',{detail:saved}))});}
export function addAnnouncementEntry(record){const section=document.querySelector('.announcements-section');if(!section.querySelector(`[data-post-id="${CSS.escape(record.id)}"]`))section.prepend(announcementEntry(record));}
let imageSaving=false;
function uploadPhoto(kind) {
  if(imageSaving)return;
  const picker=document.createElement('input');picker.type='file';picker.accept='image/png,image/jpeg';
  picker.onchange=async()=>{const file=picker.files[0];if(!file||imageSaving)return;imageSaving=true;try{await pending(null,document.querySelector('.intro-card'),async()=>{
    profileImage(file);const user=await profiles.upload(kind,file);
    if(kind==='cover')document.querySelector('.banner-photo').style.backgroundImage=`url("${safeUrl(user.cover,{image:true})}")`;
    else document.querySelector('.profile-photo img').src=safeUrl(user.avatar,{image:true});notify('Լուսանկարը թարմացվել է');
  });}finally{imageSaving=false;}};picker.click();
}
export function handleBannerUpload(){uploadPhoto('cover');}
export function handleProfilePhotoUpload(){uploadPhoto('avatar');}
