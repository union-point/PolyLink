import { createSeed } from './seed.js';
import { educationInput, educationLabels, profileUpdate } from '../../profile/contracts.js';
const seed=createSeed();
const references={};
for(const [list,label,extras] of [['universities','institution',[]],['degrees','degree',['Բակալավր']],['institutes','institute',['ՏՀՏԷ']],['specializations','specialization',['Ծրագրային ճարտարագիտություն']]]){
 const names=[...new Set([...seed.education.map(row=>row[label]).filter(Boolean),...extras])];
 references[list]=names.map((name,index)=>({id:String(index+1),name,...(list==='universities'?{logo:seed.education.find(row=>row.institution===name)?.logo||''}:{})}));
}
export function profileOptions(state){return structuredClone(state?.profileReferences||references);}
export function upgradeProfiles(state){
 for(const row of state.education){
  for(const [key,list,label] of [['universityId','universities','institution'],['degreeId','degrees','degree'],['instituteId','institutes','institute'],['specializationId','specializations','specialization']])if(!(key in row))row[key]=references[list].find(item=>item.name===row[label])?.id||null;
  row.isOngoing??=false;
 }
}
export function saveEducation(state,data,old={}){return educationLabels(educationInput(data,state.profileReferences||references,old),state.profileReferences||references);}
export { profileUpdate };
