import { DataError } from '../data/errors.js';
const invalid = field => { throw new DataError('VALIDATION', 'Խնդրում ենք ստուգել լրացված դաշտերը։', { [field]: 'Անվավեր արժեք' }); };
export function profileUpdate(data) {
  if (Object.keys(data).some(key => !['jobTitle','description'].includes(key))) invalid('profile');
  return Object.fromEntries([['jobTitle',150],['description',2000]].map(([key,max]) => {
    if (!(key in data) || (data[key] != null && typeof data[key] !== 'string')) invalid(key);
    const value=(data[key]??'').trim(); if(value.length>max) invalid(key); return [key,value];
  }));
}
export function period(value, field, allowDay=false) {
  if(value==null||value==='')return null;
  if(typeof value!=='string'||!(allowDay?/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/:/^\d{4}(?:-\d{2})?$/).test(value))invalid(field);
  const [year,month,day]=value.split('-').map(Number);
  if(year<1900||year>2200||(month!=null&&(month<1||month>12))||(day!=null&&(day<1||day>new Date(Date.UTC(year,month,0)).getUTCDate())))invalid(field);
  return value;
}
export function educationInput(data, options, old={}) {
  if(Object.keys(data).some(key=>!['universityId','degreeId','instituteId','specializationId','startDate','endDate','isOngoing'].includes(key)))invalid('education');
  const result={};
  for(const [key,list] of [['universityId','universities'],['degreeId','degrees'],['instituteId','institutes'],['specializationId','specializations']]) {
    const id=data[key]==null||data[key]===''?null:String(data[key]);
    if((key==='universityId'&&!id)||(id&&!options[list].some(item=>item.id===id))) invalid(key); result[key]=id;
  }
  for(const field of ['startDate','endDate'])result[field]=period(data[field],field,data[field]===old[field]);
  if(typeof data.isOngoing!=='boolean')invalid('isOngoing');result.isOngoing=data.isOngoing;
  const latest=value=>value.length===4?`${value}-12-31`:value.length===7?`${value}-31`:value;
  const earliest=value=>value.length===4?`${value}-01-01`:value.length===7?`${value}-01`:value;
  if((result.isOngoing&&result.endDate)||(result.startDate&&result.endDate&&latest(result.endDate)<earliest(result.startDate)))invalid('endDate');
  return result;
}
export function educationLabels(record,options) {
  const value={...record};
  for(const [key,list,label] of [['universityId','universities','institution'],['degreeId','degrees','degree'],['instituteId','institutes','institute'],['specializationId','specializations','specialization']])value[label]=options[list].find(row=>row.id===value[key])?.name||'';
  value.logo=options.universities.find(row=>row.id===value.universityId)?.logo||'';
  for(const field of ['start','end'])value[`${field}Precision`]=!value[`${field}Date`]?null:({4:'YEAR',7:'MONTH',10:'DAY'})[value[`${field}Date`].length];
  return value;
}
export function profileDate(value) {
  if(!value)return 'Նշված չէ';
  if(/^\d{4}$/.test(value))return value;
  const [year,month]=value.split('-').map(Number);
  return new Date(Date.UTC(year,month-1,1)).toLocaleDateString('hy-AM',{year:'numeric',month:'long',timeZone:'UTC'});
}
export function educationRange(record) { return `${profileDate(record.startDate)} – ${record.isOngoing?'Շարունակվում է':profileDate(record.endDate)}`; }
export function normalizeEducationOptions(value) {
  const out={};for(const key of ['universities','degrees','institutes','specializations']){
    if(!Array.isArray(value?.[key]))throw new DataError('CONTRACT','Invalid education options.');
    out[key]=value[key].map(row=>({id:String(row.id),name:String(row.name),...(row.logo?{logo:row.logo}:{})}));
  }return out;
}
