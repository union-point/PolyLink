import { createAdminClient } from './client.js';
import { initializeTheme, stateMessage } from '../shared/ui.js';
import { escapeHtml as e } from '../shared/content.js';
import { config } from '../config.js';
import { errorText } from './catalog.js';
const routes=[['academic','admin-academic.html','Ակադեմիական տվյալներ'],['content','admin-content.html','Հրապարակումներ և ֆորում'],['registry','admin-registry.html','Ռեեստրի գրառումներ']];
export async function adminShell(page,clear) {
  initializeTheme();const client=createAdminClient(),main=document.getElementById('admin-main'),header=document.querySelector('[data-admin-header]');
  let identity,ended=false,checking=false,dirty=()=>false;
  function purge(message) {if(ended)return;ended=true;document.querySelector('[data-common-confirm] [data-confirm-no],#confirm-no')?.click();clear();delete document.body.dataset.adminCheck;main.inert=false;document.querySelector('[data-admin-session-error]')?.remove();document.querySelectorAll('.admin-dialog').forEach(dialog=>{dialog.close();dialog.remove();});header.replaceChildren();main.replaceChildren();main.removeAttribute('aria-busy');stateMessage(main,message);const link=document.createElement('a');link.href='admin-login.html';link.textContent='Ադմինիստրատորի մուտք';link.className='admin-button';main.append(link);}
  function fail(error){if(error.code==='UNAUTHORIZED'){purge(errorText(error));return true;}return false;}
  let suspended=[],restoreFocus=null,selection=null;
  function block(){
    if(document.body.hasAttribute('data-admin-check'))return;
    restoreFocus=document.activeElement;
    selection=typeof restoreFocus?.selectionStart==='number'?[restoreFocus.selectionStart,restoreFocus.selectionEnd]:null;
    document.querySelector('[data-common-confirm] [data-confirm-no],#confirm-no')?.click();
    suspended=[...document.querySelectorAll('.admin-dialog[open]')];
    suspended.forEach(dialog=>dialog.close());
    document.body.dataset.adminCheck='';main.inert=true;
  }
  function resume(){
    main.inert=false;delete document.body.dataset.adminCheck;
    document.querySelector('[data-admin-session-error]')?.remove();
    suspended.filter(dialog=>dialog.isConnected).forEach(dialog=>dialog.showModal());suspended=[];
    if(restoreFocus?.isConnected){restoreFocus.focus();if(selection)restoreFocus.setSelectionRange(...selection);}
    restoreFocus=null;selection=null;
  }
  async function check(event){
    if(ended||checking||document.visibilityState==='hidden')return;
    checking=true;if(event||document.body.hasAttribute('data-admin-check'))block();
    try {
      const next=await client.session();if(ended)return;
      if(next.id!==identity.id){purge('Հաշիվը փոխվել է։ Կրկին բացեք կառավարման էջը։');return;}
      if(document.body.hasAttribute('data-admin-check'))resume();
    }catch(error){
      if(!fail(error)){
        block();const status=document.querySelector('[data-admin-session-error]')||document.createElement('aside');
        status.dataset.adminSessionError='';status.className='admin-session-error';
        stateMessage(status,errorText(error),{retry:()=>check()});document.body.append(status);
      }
    }finally{checking=false;}
  }
  try{identity=await client.session();}catch(error){if(!fail(error)){stateMessage(main,errorText(error),{retry:()=>location.reload()});main.removeAttribute('aria-busy');}return null;}
  header.innerHTML=`<div class="admin-topbar"><a class="admin-brand" href="admin-academic.html"><img src="image/favicon.svg" alt="" width="36" height="36">PolyLink <span>Կառավարում</span></a><div class="admin-account"><span>${e(identity.firstName)} ${e(identity.lastName)}<small>${e(identity.email)}</small></span><button type="button" data-admin-logout>Դուրս գալ</button></div></div><nav class="admin-nav" aria-label="Կառավարման բաժիններ">${routes.map(([key,url,label])=>`<a href="${url}" ${key===page?'aria-current="page"':''}>${label}</a>`).join('')}</nav>${config.dataMode==='mock'?'<p class="admin-mock-notice" role="status">Ցուցադրական ռեժիմ․ տվյալները պահվում են միայն այս դիտարկիչում։</p>':''}`;
  header.querySelector('[data-admin-logout]').onclick=async event=>{
    if(dirty()&&!await (await import('../shared/ui.js')).confirmAction('Հրաժարվե՞լ չպահպանված փոփոխություններից։'))return;if(ended)return;
    event.target.disabled=true;
    try{await client.logout();purge('Դուք դուրս եք եկել։');}catch(error){if(!fail(error)){event.target.disabled=false;stateMessage(document.querySelector('[data-shell-status]'),errorText(error));}}
  };
  const shellStatus=document.createElement('div');shellStatus.dataset.shellStatus='';header.append(shellStatus);
  const interval=setInterval(check,15000);
  window.addEventListener('focus',check);document.addEventListener('visibilitychange',check);
  window.addEventListener('pagehide',event=>{block();if(!event.persisted)clearInterval(interval);});
  window.addEventListener('pageshow',event=>{if(event.persisted){check(event);}});
  header.querySelectorAll('nav a,.admin-brand').forEach(link=>link.addEventListener('click',async event=>{if(!dirty())return;event.preventDefault();if(await (await import('../shared/ui.js')).confirmAction('Հրաժարվե՞լ չպահպանված փոփոխություններից։')&&!ended){dirty=()=>false;clear();location.href=link.href;}}));
  return {fail,active:()=>!ended,setDirty:fn=>{dirty=fn;}};
}
