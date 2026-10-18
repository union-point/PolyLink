import { config } from '../../config.js';
import { DataError } from '../errors.js';
let axiosPromise;
function loadAxios(){
  if(window.axios)return Promise.resolve(window.axios);
  if(!axiosPromise)axiosPromise=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=config.axiosUrl;script.onload=()=>window.axios?resolve(window.axios):reject(new DataError('NETWORK','HTTP transport unavailable.'));script.onerror=()=>{axiosPromise=null;script.remove();reject(new DataError('NETWORK','HTTP transport unavailable.',{},true));};document.head.appendChild(script);});
  return axiosPromise;
}
const cookie=name=>document.cookie.split('; ').find(value=>value.startsWith(name+'='))?.split('=').slice(1).join('=')||'';
const csrfCookie=()=>cookie('__Host-plk-refresh-csrf');
const sessionChanged=()=>new DataError('SESSION_CHANGED','Your session changed. Please retry.');
export function createTransport(axios){
  try{localStorage.removeItem('polylink.http.accessToken');}catch{}
  const api=axios.create({baseURL:config.apiBaseUrl,withCredentials:true,timeout:15000});
  let accessToken=null,refreshing,generation=0,locallyLoggedOut=false;
  const isLoggedOut=()=>{try{return locallyLoggedOut||localStorage.getItem('polylink.http.loggedOut')==='true'||cookie('__Host-plk-local-logout')==='true';}catch{return locallyLoggedOut||cookie('__Host-plk-local-logout')==='true';}};
  function logoutMarker(value){
    locallyLoggedOut=value;
    try{value?localStorage.setItem('polylink.http.loggedOut','true'):localStorage.removeItem('polylink.http.loggedOut');}catch{}
    document.cookie=`__Host-plk-local-logout=${value?'true':''}; Path=/; Secure; SameSite=Lax; Max-Age=${value?31536000:0}`;
  }
  function normalize(error){
    if(error instanceof DataError)return error;
    const result=new DataError(error.response?.data?.code||(error.response?.status===401?'UNAUTHORIZED':error.response?'SERVICE_ERROR':'NETWORK'),error.response?.data?.message||'The request could not be completed.',{},!error.response||error.response.status>=500);
    result.response={status:error.response?.status};return result;
  }
  const refresh=async()=>{
    if(isLoggedOut())throw new DataError('UNAUTHORIZED','Please sign in.');
    if(!refreshing){
      const version=generation;
      const work=async()=>{
        if(version!==generation||isLoggedOut())throw sessionChanged();
        const response=await axios.post(`${config.apiBaseUrl}/auth/refresh`,{},{withCredentials:true,timeout:15000,headers:{'X-CSRF-Token':csrfCookie()}});
        if(version!==generation||isLoggedOut())throw sessionChanged();
        const body=response.data?.data??response.data;if(!body.accessToken)throw new DataError('CONTRACT','Refresh response is missing accessToken.');
        accessToken=body.accessToken;return accessToken;
      };
      refreshing=(globalThis.navigator?.locks?navigator.locks.request('polylink-session-refresh',work):work()).catch(error=>{throw normalize(error);}).finally(()=>{refreshing=null;});
    }
    return refreshing;
  };
  api.interceptors.request.use(request=>{
    request.headers ||= {};request._sessionGeneration=generation;
    if(accessToken)request.headers.Authorization=`Bearer ${accessToken}`;
    if(request.url.startsWith('/auth/recovery/')&&!['/auth/recovery/request','/auth/recovery/verify'].includes(request.url))request.headers['X-CSRF-Token']=cookie('__Host-plk-recovery-csrf');
    if(['/auth/refresh','/auth/logout'].includes(request.url))request.headers['X-CSRF-Token']=csrfCookie();
    return request;
  });
  api.interceptors.response.use(response=>{
    if(response.config?._sessionGeneration!==undefined&&response.config._sessionGeneration!==generation)throw sessionChanged();
    return response;
  },async error=>{
    const request=error.config;
    if(request&&request._sessionGeneration!==generation)throw sessionChanged();
    const renewable=!request?.url.startsWith('/auth/')||['/auth/me','/auth/password-change/prepare'].includes(request?.url);
    if(error.response?.status!==401||!request||request._retried||!request.headers?.Authorization||!renewable)throw error;
    request._retried=true;await refresh();request.headers.Authorization=`Bearer ${accessToken}`;return api(request);
  });
  return {
    request:request=>api(request).then(response=>response.data).catch(error=>{throw normalize(error);}),
    setToken:token=>{generation++;accessToken=token;},
    restore:async()=>{if(!accessToken)await refresh();},
    beginSession:()=>logoutMarker(false),
    markLoggedOut:()=>{logoutMarker(true);generation++;accessToken=null;},
    isLoggedOut,
  };
}
export async function loadTransport(){return createTransport(await loadAxios());}
