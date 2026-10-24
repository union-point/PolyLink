import { auth } from './services/index.js';
import { start, initializeTheme, pending, showError } from './shared/ui.js';
import { finishLogin, inlineCode, initializePasswordControls } from './shared/auth-ui.js';

start(async () => {
  initializeTheme();initializePasswordControls();
  const form=document.getElementById('profile-info-form'),fields=document.getElementById('profile-fields');
  const codeForm=document.getElementById('enrollment-code'),loginForm=document.getElementById('enrollment-login');
  const status=document.getElementById('enrollment-status');
  let state,challenge,dirty=false;
  const element=name=>document.getElementById(name);
  function roleFields(){
    const graduate=element('role').value==='graduate';
    for(const [selector,enabled] of [['[data-graduate]',graduate],['[data-lecturer]',!graduate]]) {
      const group=document.querySelector(selector);group.hidden=!enabled;
      group.querySelectorAll('input,select').forEach(input=>{input.disabled=!enabled;input.required=enabled;});
    }
  }
  function render(next){
    state=next;element('enrollment-email').textContent=state.email;
    if(next.status==='admitted'){form.hidden=true;codeForm.hidden=true;loginForm.hidden=false;element('password').focus();return;}
    for(const [key,value] of Object.entries(next.profile)) if(element(key))element(key).value=value??'';
    roleFields();fields.disabled=false;dirty=false;challenge=next.challenge;codeForm.hidden=!challenge;
  }
  try{
    const next=await auth.enrollment();
    if(next.status==='enrollment'){
      const options=await auth.enrollmentOptions();
      for(const [field,list] of [['specializationId',options.specializations],['departmentId',options.departments],['professionId',options.professions]])
        element(field).replaceChildren(new Option('Ընտրեք…',''),...list.map(item=>new Option(item.name,String(item.id))));
    }
    render(next);
  }catch(error){showError(form,error);return;}
  form.addEventListener('input',()=>{dirty=true;codeForm.hidden=true;});
  element('role').onchange=roleFields;
  function profile(){
    const graduate=element('role').value==='graduate';
    const numeric=name=>element(name).value?Number(element(name).value):null;
    return {revision:state.revision,role:element('role').value,firstName:element('firstName').value,lastName:element('lastName').value,
      diplomaNumber:graduate?element('diplomaNumber').value:null,specializationId:graduate?numeric('specializationId'):null,startYear:graduate?numeric('startYear'):null,endYear:graduate?numeric('endYear'):null,
      departmentId:graduate?null:numeric('departmentId'),professionId:graduate?null:numeric('professionId'),biography:element('biography').value};
  }
  async function save(){render(await auth.saveEnrollment(profile()));status.textContent='Տվյալները պահպանված են։';}
  element('save-profile').onclick=()=>{if(form.reportValidity())pending(element('save-profile'),form,save);};
  form.onsubmit=event=>{event.preventDefault();pending(element('submit-profile'),form,async()=>{
    if(dirty||!state.profile.diplomaNumber&&state.profile.role==='graduate'||!state.profile.professionId&&state.profile.role==='lecturer')await save();
    challenge=await auth.submitEnrollment({revision:state.revision});codeForm.hidden=false;element('verification-code').focus();status.textContent='Կոդն ուղարկված է։';
  });};
  codeForm.onsubmit=event=>{event.preventDefault();pending(codeForm.querySelector('[type=submit]'),codeForm,async()=>{
    const result=await auth.verifyEmail({challengeId:challenge.challengeId,code:element('verification-code').value});element('verification-code').value='';render(result);
  });};
  element('resend-code').onclick=()=>pending(element('resend-code'),codeForm,async()=>{challenge=await auth.resendChallenge({challengeId:challenge.challengeId});status.textContent='Նոր կոդն ուղարկված է։';});
  loginForm.onsubmit=event=>{event.preventDefault();pending(loginForm.querySelector('[type=submit]'),loginForm,async()=>{
    let result;
    try{result=await auth.login({email:state.email,password:element('password').value});}finally{element('password').value='';}
    if(result.status==='challenge')result=await inlineCode(auth,result,'LOGIN',loginForm);
    finishLogin(result);
  });};
  element('enrollment-logout').onclick=()=>pending(element('enrollment-logout'),form,async()=>{await auth.logoutEnrollment();location.href='login.html';});
});
