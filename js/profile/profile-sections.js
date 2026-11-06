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
let fieldSequence = 0;
function field(form, label, control) {
  const wrap = document.createElement('div'); wrap.className = 'profile-form-field';
  const text = document.createElement('label'); text.className = 'profile-field-label';
  control.id ||= `profile-field-${++fieldSequence}`; text.htmlFor = control.id;
  text.textContent = label.replace(/ \*$/, '');
  if (label.endsWith(' *')) {
    const required = document.createElement('span'); required.className = 'profile-field-required';
    required.textContent = ' *'; required.setAttribute('aria-hidden', 'true'); text.append(required);
  }
  control.classList.add('profile-form-control'); wrap.append(text, control); form.append(wrap);
  control.field = wrap; return control;
}
function input(form, label, name, value = '', type = 'text') {
  const el = document.createElement('input'); el.name = name; el.type = type; el.value = value || '';
  return field(form, label, el);
}
function select(form, label, name, rows, value) {
  const el = document.createElement('select'); el.name = name; el.required = name === 'universityId';
  field(form, label, el);
  const search = document.createElement('input'); search.type = 'search'; search.hidden = true;
  search.className = 'profile-form-control profile-select-search'; search.dataset.profileSearch = '';
  search.id = `${el.id}-search`; search.placeholder = 'Որոնել ցանկում…';
  search.setAttribute('aria-label', `Որոնել՝ ${label.replace(/ \*$/, '')}`);
  const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'profile-search-toggle';
  toggle.setAttribute('aria-label', search.getAttribute('aria-label')); toggle.setAttribute('aria-controls', search.id); toggle.setAttribute('aria-expanded', 'false');
  toggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg>';
  const labelRow = document.createElement('div'); labelRow.className = 'profile-field-label-row';
  labelRow.append(el.field.firstChild, toggle); el.field.prepend(labelRow); el.before(search);
  let selected = String(value || '');
  const populate = () => {
    const blank = new Option(name === 'universityId' ? 'Ընտրեք հաստատությունը' : 'Նշված չէ', '');
    const matches = rows.filter(row => row.id === selected || row.name.toLocaleLowerCase().includes(search.value.toLocaleLowerCase()));
    el.replaceChildren(blank, ...matches.map(row => new Option(row.name, row.id))); el.value = selected;
  };
  const hide = () => { search.hidden = true; toggle.setAttribute('aria-expanded', 'false'); search.value = ''; populate(); };
  toggle.onclick = () => {
    if (search.hidden) { search.hidden = false; toggle.setAttribute('aria-expanded', 'true'); search.focus(); }
    else { hide(); toggle.focus(); }
  };
  search.onkeydown = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); hide(); toggle.focus(); } };
  search.oninput = () => { selected = el.value; populate(); };
  el.onchange = () => { selected = el.value; hide(); };
  populate(); return el;
}
function dateField(form, label, name, value) {
  const el = document.createElement('input'); el.name = name;
  field(form, label, el);
  const row = document.createElement('div'); row.className = 'profile-date-controls';
  const precision = document.createElement('select'); precision.className = 'profile-form-control profile-date-precision';
  precision.setAttribute('aria-label', `${label}՝ ճշգրտություն`);
  precision.append(new Option('Տարի', 'YEAR'), new Option('Ամիս', 'MONTH'));
  if (value?.length === 10) precision.append(new Option('Նախկին', 'DAY'));
  precision.value = value?.length === 4 ? 'YEAR' : value?.length === 10 ? 'DAY' : 'MONTH';
  el.before(row); row.append(precision, el);
  const apply = () => {
    el.type = precision.value === 'YEAR' ? 'number' : 'month';
    el.value = value ? (precision.value === 'YEAR' ? value.slice(0, 4) : value.slice(0, 7)) : '';
    el.min = precision.value === 'YEAR' ? '1900' : '1900-01'; el.max = precision.value === 'YEAR' ? '2200' : '2200-12';
    el.placeholder = precision.value === 'YEAR' ? 'ՏՏՏՏ' : '';
  };
  apply(); precision.onchange = () => { value = el.value; apply(); };
  el.addEventListener('input', () => { if (precision.value === 'DAY') precision.value = 'MONTH'; });
  return { el, precision, get: () => precision.value === 'DAY' ? value : (el.value || null) };
}
function formNote(form) {
  const note = document.createElement('p'); note.className = 'profile-form-note'; note.textContent = '* Պարտադիր դաշտեր'; form.append(note);
}
function addDelete(form,entry,record,service) {
  if(!record.id)return;
  const area=document.createElement('div');area.className='profile-delete-area';
  const button=document.createElement('button');button.type='button';button.className='delete-entry-btn';button.textContent='Հեռացնել գրառումը';area.append(button);form.append(area);
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
  const form=document.createElement('div'),status=document.createElement('p');form.className='profile-form';status.className='profile-form-loading';status.textContent='Բեռնվում է…';status.setAttribute('role','status');form.append(status);
  let ready=false,options,controls,start,end,ongoing;
  modal.create(record.id?'Փոփոխել կրթությունը':'Ավելացնել կրթություն',form,async()=>{
    if(!ready)return false;
    const data=educationInput({...Object.fromEntries(Object.entries(controls).map(([key,el])=>[key,el.value])),startDate:start.get(),endDate:ongoing.checked?null:end.get(),isOngoing:ongoing.checked},options,record);
    const saved=record.id?await profiles.education.update(record.id,data):await profiles.education.create(data);
    if(entry){const replacement=educationEntry(saved,true);entry.replaceWith(replacement);attachEducationHandlers(replacement,saved);}else addEducationEntry(saved);
    notify('Կրթությունը պահպանվել է');
  }, {icon:'education',description:'Նշեք ձեր կրթական տվյալները։',loading:true});
  const load=async()=>{
    status.replaceChildren(document.createTextNode('Բեռնվում է…'));
    try {
      options=await profiles.education.options();if(!form.isConnected)return;
      form.replaceChildren();controls={};
      const references=document.createElement('div');references.className='profile-reference-fields';form.append(references);
      for(const [key,list,label] of [['universityId','universities','Ուսումնական հաստատություն *'],['degreeId','degrees','Աստիճան'],['instituteId','institutes','Ինստիտուտ'],['specializationId','specializations','Մասնագիտություն']]){controls[key]=select(references,label,key,options[list],record[key]);if(key==='universityId'||key==='specializationId')controls[key].field.classList.add('profile-field-wide');}
      if(!options.universities.length){const text=document.createElement('p');text.textContent='Հաստատությունների ցանկը դատարկ է։';form.append(text);}
      const period=document.createElement('fieldset');period.className='profile-period';
      const legend=document.createElement('legend');legend.textContent='Ժամանակահատված';period.append(legend);
      const dates=document.createElement('div');dates.className='profile-date-fields';period.append(dates);form.append(period);
      start=dateField(dates,'Սկիզբ','startDate',record.startDate);end=dateField(dates,'Ավարտ','endDate',record.endDate);
      const ongoingLabel=document.createElement('label');ongoingLabel.className='profile-ongoing';
      ongoing=document.createElement('input');ongoing.type='checkbox';ongoing.name='isOngoing';ongoing.checked=!!record.isOngoing;
      const ongoingText=document.createElement('span');ongoingText.textContent='Ուսումը շարունակվում է';ongoingLabel.append(ongoing,ongoingText);period.append(ongoingLabel);
      const sync=()=>{end.el.disabled=ongoing.checked;end.precision.disabled=ongoing.checked;end.el.field.classList.toggle('profile-field-disabled',ongoing.checked);if(ongoing.checked){end.el.value='';if(end.precision.value==='DAY')end.precision.value='MONTH';}};ongoing.onchange=sync;sync();
      formNote(form);addDelete(form,entry,record,profiles.education);ready=true;modal.setReady(options.universities.length>0);
      form.querySelector('select')?.focus();
    }catch(error){
      showError(form,error);const retry=document.createElement('button');retry.type='button';retry.className='secondary-btn profile-retry';retry.textContent='Կրկին փորձել';retry.onclick=()=>{retry.remove();load();};status.replaceChildren(retry);
    }
  };load();
}
export function showAddEducationModal(){educationModal(null);}
export function addEducationEntry(record){const entry=educationEntry(record,true);document.querySelector('.education-section').append(entry);attachEducationHandlers(entry,record);}
export function attachEducationHandlers(entry,record){const button=entry.querySelector('.edit-icon');if(button)button.onclick=()=>educationModal(entry,record);}
function certificateModal(entry,record={}) {
  const form=document.createElement('div');form.className='profile-form';
  const name=input(form,'Հավաստագրի անվանում *','name',record.name);name.required=true;name.maxLength=255;
  const org=input(form,'Կազմակերպություն *','organization',record.organization);org.required=true;org.maxLength=255;
  const date=input(form,'Տրման ամիս','issueDate',record.issueDate,'month');date.min='1900-01';date.max='2200-12';
  const url=input(form,'Հավաստագրի հղում','credentialUrl',record.credentialUrl,'url');url.maxLength=2048;url.placeholder='https://…';
  const hint=document.createElement('p');hint.className='profile-field-hint';hint.textContent='Հղումը և տրման ամիսը պարտադիր չեն։';url.field.append(hint);
  formNote(form);addDelete(form,entry,record,profiles.certificates);
  modal.create(record.id?'Փոփոխել հավաստագիրը':'Ավելացնել հավաստագիր',form,async data=>{
    const input=validateCertificate(data);
    const saved=record.id?await profiles.certificates.update(record.id,input):await profiles.certificates.create(input);
    if(entry){const replacement=certificateEntry(saved,true);entry.replaceWith(replacement);attachLicenseHandlers(replacement,saved);}else addLicenseEntry(saved);
    notify('Հավաստագիրը պահպանվել է');
  }, {icon:'certificate',description:'Ավելացրեք ձեր մասնագիտական ձեռքբերումը։'});
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
