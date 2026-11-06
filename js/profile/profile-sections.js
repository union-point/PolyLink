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
  el.replaceChildren(...rows.map(row => new Option(row.name, row.id)));
  if (rows.some(row => String(row.id) === String(value))) el.value = String(value);
  if (!rows.length) {
    el.append(new Option('Հասանելի տարբերակներ չկան', ''));
    el.disabled = true;
  }
  return el;
}
// Native calendar controls work on browsers that render type="month" as plain text.
// Profile dates use month precision; retain an unchanged legacy year/day verbatim.
function dateField(form, label, name, value) {
  const initial = value ? `${value.slice(0, 4)}-${value.slice(5, 7) || '01'}-${value.slice(8, 10) || '01'}` : '';
  const el = input(form, label, name, initial, 'date');
  el.min = '1900-01-01'; el.max = '2200-12-31';
  const hint = document.createElement('p'); hint.className = 'profile-field-hint';
  hint.id = `${el.id}-hint`;
  hint.textContent = 'Ընտրեք ամսաթիվը․ պահպանվում են ամիսը և տարին։';
  el.setAttribute('aria-describedby', hint.id); el.field.append(hint);
  return { el, get: () => el.value === initial ? (value || null) : (el.value.slice(0, 7) || null) };
}

function formNote(form) {
  const note = document.createElement('p'); note.className = 'profile-form-note'; note.textContent = '* Պարտադիր դաշտեր'; form.append(note);
}
function addDelete(form,entry,record,service) {
  if(!record.id)return;
  const button=document.createElement('button');button.type='button';button.className='delete-entry-btn';button.textContent='Հեռացնել';
  button.onclick=async()=>{
    if(modal.saving||button.disabled)return;
    button.disabled=true;
    try {
      if(!await confirmAction('Վստա՞հ եք, որ ցանկանում եք հեռացնել այս գրառումը։'))return;
      modal.saving=true;button.disabled=false;
      const saved=await pending(button,form,()=>service.delete(record.id));
      modal.saving=false;if(saved){const section=entry.closest('.education-section,.licenses-section');entry.remove();if(section)section.hidden=!section.querySelector('.item-entry');modal.close(true);notify('Գրառումը հեռացվել է');}
    }finally{modal.saving=false;button.disabled=false;}
  };
  return button;
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
      const sync=()=>{end.el.disabled=ongoing.checked;end.el.field.classList.toggle('profile-field-disabled',ongoing.checked);};ongoing.onchange=sync;sync();
      formNote(form);const remove=addDelete(form,entry,record,profiles.education);if(remove)modal.modal.querySelector('.profile-modal-footer').prepend(remove);ready=true;modal.setReady(options.universities.length>0);
      form.querySelector('select')?.focus();
    }catch(error){
      showError(form,error);const retry=document.createElement('button');retry.type='button';retry.className='secondary-btn profile-retry';retry.textContent='Կրկին փորձել';retry.onclick=()=>{retry.remove();load();};status.replaceChildren(retry);
    }
  };load();
}
export function showAddEducationModal(){educationModal(null);}
export function addEducationEntry(record){const entry=educationEntry(record,true);const section=document.querySelector('.education-section');section.append(entry);section.hidden=false;attachEducationHandlers(entry,record);}
export function attachEducationHandlers(entry,record){const button=entry.querySelector('.edit-icon');if(button)button.onclick=()=>educationModal(entry,record);}
function certificateModal(entry,record={}) {
  const form=document.createElement('div');form.className='profile-form';
  const name=input(form,'Հավաստագրի անվանում *','name',record.name);name.required=true;name.maxLength=255;
  const org=input(form,'Կազմակերպություն *','organization',record.organization);org.required=true;org.maxLength=255;
  const date=dateField(form,'Տրման ամսաթիվ','issueDate',record.issueDate);
  const url=input(form,'Հավաստագրի հղում','credentialUrl',record.credentialUrl,'url');url.maxLength=2048;url.placeholder='https://…';
  const hint=document.createElement('p');hint.className='profile-field-hint';hint.textContent='Հղումը և տրման ամիսը պարտադիր չեն։';url.field.append(hint);
  formNote(form);const remove=addDelete(form,entry,record,profiles.certificates);
  modal.create(record.id?'Փոփոխել հավաստագիրը':'Ավելացնել հավաստագիր',form,async data=>{
    const input=validateCertificate({...data,issueDate:date.get()});
    const saved=record.id?await profiles.certificates.update(record.id,input):await profiles.certificates.create(input);
    if(entry){const replacement=certificateEntry(saved,true);entry.replaceWith(replacement);attachLicenseHandlers(replacement,saved);}else addLicenseEntry(saved);
    notify('Հավաստագիրը պահպանվել է');
  }, {customFooterLeft:remove,icon:'certificate',description:'Ավելացրեք ձեր մասնագիտական ձեռքբերումը։'});
}
export function showAddLicenseModal(){certificateModal(null);}
export function addLicenseEntry(record){const entry=certificateEntry(record,true);const section=document.querySelector('.licenses-section');section.append(entry);section.hidden=false;attachLicenseHandlers(entry,record);}
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
