// Inline sensitive-action inputs; passwords are cleared immediately after use.
export function requestPassword(container) {
  return new Promise((resolve,reject)=>{
    const form=document.createElement('form');
    const label=document.createElement('label');label.textContent='Ընթացիկ գաղտնաբառ';
    const input=document.createElement('input');input.type='password';input.autocomplete='current-password';input.required=true;label.append(input);
    const submit=document.createElement('button');submit.type='submit';submit.textContent='Հաստատել';
    const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Չեղարկել';
    const close=()=>{input.value='';form.remove();};
    cancel.onclick=()=>{close();reject(new Error('Գործողությունը չեղարկված է'));};
    form.onsubmit=event=>{event.preventDefault();const value=input.value;close();resolve(value);};
    form.append(label,submit,cancel);container.append(form);input.focus();
  });
}
export function verifyEmailChange(settings,initial,container){
  return new Promise((resolve,reject)=>{
    let challenge=initial;const form=document.createElement('form'),label=document.createElement('label'),code=document.createElement('input'),save=document.createElement('button'),resend=document.createElement('button'),cancel=document.createElement('button'),status=document.createElement('p');
    code.inputMode='numeric';code.autocomplete='one-time-code';code.pattern='[0-9]{6}';code.required=true;code.maxLength=6;
    save.type='submit';save.textContent='Հաստատել';resend.type='button';resend.textContent='Կրկին ուղարկել';cancel.type='button';cancel.textContent='Չեղարկել';
    const update=()=>{label.textContent=challenge.stage==='OLD'?'Կոդը՝ ընթացիկ էլ․ փոստից':'Կոդը՝ նոր էլ․ փոստից';label.append(code);code.value='';code.focus();};
    const busy=value=>{save.disabled=resend.disabled=cancel.disabled=value;};
    cancel.onclick=()=>{form.remove();reject(new Error('Գործողությունը չեղարկված է'));};
    resend.onclick=async()=>{busy(true);try{challenge=await settings.resendEmailChange({requestId:challenge.requestId});status.textContent='Կոդն ուղարկվել է';}catch(error){status.textContent=error.message;}finally{busy(false);}};
    form.onsubmit=async event=>{event.preventDefault();busy(true);try{const result=await settings.verifyEmailChange({requestId:challenge.requestId,code:code.value});code.value='';if(result.status==='completed'){form.remove();resolve(result);}else{challenge=result;update();}}catch(error){status.textContent=error.message;}finally{busy(false);}};
    form.append(label,save,resend,cancel,status);container.append(form);update();
  });
}
