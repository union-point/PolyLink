import { createAdminClient } from './client.js';
import { initializeTheme, stateMessage } from '../shared/ui.js';
import { escapeHtml as e } from '../shared/content.js';
import { config } from '../config.js';
import { errorText } from './catalog.js';
const routes=[['academic','admin-academic.html','Ակադեմիական տվյալներ'],['content','admin-content.html','Հրապարակումներ և ֆորում'],['registry','admin-registry.html','Ռեեստրի գրառումներ']];
export async function adminShell(page,clear) {
  initializeTheme();const client=createAdminClient(),main=document.getElementById('admin-main'),header=document.querySelector('[data-admin-header]');
  let identity,ended=false,checking=false,dirty=()=>false;
  function purge(message) {if(ended)return;ended=true;clear();document.querySelectorAll('.admin-dialog').forEach(dialog=>{dialog.close();dialog.remove();});header.replaceChildren();main.replaceChildren();main.removeAttribute('aria-busy');stateMessage(main,message);const link=document.createElement('a');link.href='admin-login.html';link.textContent='Ադմինիստրատորի մուտք';link.className='admin-button';main.append(link);}
  function fail(error){if(error.code==='UNAUTHORIZED'){purge(errorText(error));return true;}return false;}
  async function check(){
    if(ended||checking||document.visibilityState==='hidden')return;checking=true;
    try {const next=await client.session();if(ended)return;if(next.id!==identity.id){purge('Հաշիվը փոխվել է։ Կրկին բացեք կառավարման էջը։');return;}main.inert=false;document.querySelector('[data-admin-session-error]')?.remove();}
    catch(error){if(!fail(error)){main.inert=true;const status=document.querySelector('[data-admin-session-error]')||document.createElement('aside');status.dataset.adminSessionError='';status.className='admin-session-error';stateMessage(status,errorText(error),{retry:check});header.after(status);}}
    finally{checking=false;}
  }
  try{identity=await client.session();}catch(error){if(!fail(error)){stateMessage(main,errorText(error),{retry:()=>location.reload()});main.removeAttribute('aria-busy');}return null;}
  header.innerHTML=`<div class="admin-topbar"><a class="admin-brand" href="admin-academic.html"><img src="image/favicon.svg" alt="" width="36" height="36">PolyLink <span>Կառավարում</span></a><div class="admin-account"><span>${e(identity.firstName)} ${e(identity.lastName)}<small>${e(identity.email)}</small></span><button type="button" data-admin-logout>Դուրս գալ</button></div></div><nav class="admin-nav" aria-label="Կառավարման բաժիններ">${routes.map(([key,url,label])=>`<a href="${url}" ${key===page?'aria-current="page"':''}>${label}</a>`).join('')}</nav>${config.dataMode==='mock'?'<p class="admin-mock-notice" role="status">Ցուցադրական ռեժիմ․ տվյալները պահվում են միայն այս դիտարկիչում։</p>':''}`;
  header.querySelector('[data-admin-logout]').onclick=async event=>{
    if(dirty()&&!await (await import('../shared/ui.js')).confirmAction('Հրաժարվե՞լ չպահպանված փոփոխություններից։'))return;
    event.target.disabled=true;
    try{await client.logout();purge('Դուք դուրս եք եկել։');}catch(error){if(!fail(error)){event.target.disabled=false;stateMessage(document.querySelector('[data-shell-status]'),errorText(error));}}
  };
  const shellStatus=document.createElement('div');shellStatus.dataset.shellStatus='';header.append(shellStatus);
  const interval=setInterval(check,15000);
  window.addEventListener('focus',check);document.addEventListener('visibilitychange',check);
  window.addEventListener('pagehide',event=>{main.inert=true;main.style.visibility='hidden';if(!event.persisted)clearInterval(interval);});
  window.addEventListener('pageshow',event=>{if(event.persisted){main.style.visibility='';check();}});
  header.querySelectorAll('nav a,.admin-brand').forEach(link=>link.addEventListener('click',async event=>{if(!dirty())return;event.preventDefault();if(await (await import('../shared/ui.js')).confirmAction('Հրաժարվե՞լ չպահպանված փոփոխություններից։')){dirty=()=>false;clear();location.href=link.href;}}));
  return {fail,active:()=>!ended,setDirty:fn=>{dirty=fn;}};
}
