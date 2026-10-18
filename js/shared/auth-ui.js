import { DataError } from '../data/errors.js';
import { rememberChallenge } from '../services/workflow.js';

export function initializePasswordControls(passwordId = 'password') {
  window.addEventListener('pagehide',()=>document.querySelectorAll('input[type=password]').forEach(input=>{input.value='';}));
  document.querySelectorAll('.toggle-password').forEach(button => {
    button.onclick = () => {
      const input = button.parentElement.querySelector('input');
      input.type = input.type === 'password' ? 'text' : 'password';
      button.textContent = input.type === 'password' ? '👁️' : '🙈';
    };
  });
  const input = document.getElementById(passwordId);
  const bar = document.getElementById('strength-bar');
  if (!input || !bar) return;
  const rules = { length: /.{8,}/, uppercase: /[A-Z]/, number: /\d/, special: /[^\w\s]/ };
  input.addEventListener('input', () => {
    let count = 0;
    for (const [name, pattern] of Object.entries(rules)) { const matches = pattern.test(input.value); document.getElementById(`req-${name}`)?.classList.toggle('met', matches); if (matches) count++; }
    const level = count < 3 ? 'weak' : count === 3 ? 'medium' : 'strong';
    bar.className = `password-strength-bar ${level}`;
    const label = document.getElementById('strength-text'); label.className = `strength-text ${level}`; label.textContent = { weak: 'Թույլ', medium: 'Միջին', strong: 'Ուժեղ' }[level];
  });
}
export function passwordsMatch(first, second) {
  if (!first || first !== second) throw new DataError('VALIDATION', 'Գաղտնաբառերը չեն համընկնում։', { confirmPassword: 'Գաղտնաբառերը չեն համընկնում' });
}
export function goToProfile(user) { location.href = user.onboardingComplete ? 'profile.html' : 'profile_info.html'; }
export function finishLogin(result) {
  if (result.status === 'challenge') { rememberChallenge('second-factor', result); location.href = '2fa-verify.html'; }
  else if (result.user && result.storageUnavailable) {
    const region=document.createElement('p');region.setAttribute('role','status');region.textContent='Այս դիտարկիչը չկարողացավ հիշել մուտքը։ Էջերի միջև անցնելիս կարող է կրկին պահանջվել գաղտնաբառը։';
    const button=document.createElement('button');button.type='button';button.textContent='Շարունակել';button.onclick=()=>goToProfile(result.user);
    (document.querySelector('form')||document.body).append(region,button);
  }
  else if (result.user) goToProfile(result.user);
  else throw new DataError('CONTRACT', 'Login response is missing the user.');
}

// The HTTP login flow keeps password derivatives in memory while verification is inline.
export async function inlineCode(auth, challenge, purpose, container){
  const panel=document.createElement('div');panel.dataset.inlineVerification='';
  const label=document.createElement('label');label.textContent='Մուտքագրեք էլ․ փոստով ուղարկված կոդը';
  const input=document.createElement('input');input.type='text';input.inputMode='numeric';input.autocomplete='one-time-code';input.maxLength=6;input.pattern='[0-9]{6}';input.setAttribute('aria-label','Վավերացման կոդ');
  const verify=document.createElement('button');verify.type='button';verify.textContent='Հաստատել';
  const resend=document.createElement('button');resend.type='button';resend.textContent='Ուղարկել նորից';
  const status=document.createElement('p');status.setAttribute('role','status');
  const restart=document.createElement('button');restart.type='button';restart.textContent='Սկսել նորից';restart.onclick=()=>location.reload();
  panel.append(label,input,verify,resend,restart,status);container.appendChild(panel);input.focus();
  return new Promise(resolve=>{
    let current=challenge;
    verify.onclick=async()=>{
      if(!/^[0-9]{6}$/.test(input.value)){status.textContent='Մուտքագրեք վեցանիշ կոդը։';return;}
      verify.disabled=true;
      try{
        const proof={challengeId:current.challengeId,code:input.value};
        const result=purpose==='EMAIL_VERIFY'?await auth.verifyEmail(proof):await auth.verifySecondFactor(proof);
        input.value='';panel.remove();resolve(result);
      }catch(error){status.textContent=error.message;}
      finally{verify.disabled=false;}
    };
    resend.onclick=async()=>{
      if(Date.now()<Date.parse(current.resendAfter)){status.textContent='Խնդրում ենք սպասել՝ նոր կոդ պահանջելուց առաջ։';return;}
      resend.disabled=true;
      try{current=await auth.resendChallenge({challengeId:current.challengeId});status.textContent='Նոր կոդն ուղարկված է։';}
      catch(error){status.textContent=error.message;}
      finally{resend.disabled=false;}
    };
  });
}

export async function unlockIdentity(auth,user){
  const panel=document.createElement('form');panel.dataset.identityUnlock='';
  panel.style.cssText='position:fixed;inset:15% 20%;z-index:5000;background:var(--card-background,#fff);padding:24px;border:1px solid #888;overflow:auto';
  const label=document.createElement('label');label.textContent=user.storageUnavailable?'Secure browser storage is unavailable. Enter your password to use this page; navigation will require it again.':'Մուտք գործեք՝ այս դիտարկիչում տվյալները բացելու համար';
  const input=document.createElement('input');input.type='password';input.autocomplete='current-password';input.required=true;input.setAttribute('aria-label','Գաղտնաբառ');
  const button=document.createElement('button');button.type='submit';button.textContent='Մուտք գործել';
  const error=document.createElement('p');error.setAttribute('role','alert');panel.append(label,input,button,error);document.body.appendChild(panel);
  return new Promise(resolve=>{
    panel.onsubmit=async event=>{
      event.preventDefault();button.disabled=true;
      try{let result=await auth.login({email:user.email,password:input.value});input.value='';if(result.status==='challenge')result=await inlineCode(auth,result,'LOGIN',panel);panel.remove();resolve(result.user);}
      catch(failure){error.textContent=failure.message;}
      finally{button.disabled=false;}
    };
  });
}
