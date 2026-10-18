import { config } from '../../config.js';
import { DataError } from '../errors.js';
let axiosPromise;
function loadAxios(){
  if(window.axios)return Promise.resolve(window.axios);
  if(!axiosPromise)axiosPromise=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=config.axiosUrl;script.onload=()=>window.axios?resolve(window.axios):reject(new DataError('NETWORK','HTTP transport unavailable.'));script.onerror=()=>{axiosPromise=null;script.remove();reject(new DataError('NETWORK','HTTP transport unavailable.',{},true));};document.head.appendChild(script);});
  return axiosPromise;
}
const csrfCookie=()=>document.cookie.split('; ').find(value=>value.startsWith('__Host-plk-refresh-csrf='))?.split('=').slice(1).join('=')||'';
export function createTransport(axios){
  localStorage.removeItem('polylink.http.accessToken');
  const api=axios.create({baseURL:config.apiBaseUrl,withCredentials:true,timeout:15000});
  let accessToken=null,refreshing;
  const isLoggedOut=()=>localStorage.getItem('polylink.http.loggedOut')==='true';
  const refresh=async()=>{
    if(isLoggedOut())throw new DataError('UNAUTHORIZED','Please sign in.');
    if(!refreshing){
      const work=async()=>{
        const response=await axios.post(`${config.apiBaseUrl}/auth/refresh`,{},{withCredentials:true,timeout:15000,headers:{'X-CSRF-Token':csrfCookie()}});
        const body=response.data?.data??response.data;if(!body.accessToken)throw new DataError('CONTRACT','Refresh response is missing accessToken.');
        accessToken=body.accessToken;return accessToken;
      };
      refreshing=(globalThis.navigator?.locks?navigator.locks.request('polylink-session-refresh',work):work()).finally(()=>{refreshing=null;});
    }
    return refreshing;
  };
  api.interceptors.request.use(request=>{
    request.headers ||= {};if(accessToken)request.headers.Authorization=`Bearer ${accessToken}`;
    if(['/auth/refresh','/auth/logout'].includes(request.url))request.headers['X-CSRF-Token']=csrfCookie();
    return request;
  });
  api.interceptors.response.use(response=>response,async error=>{
    const request=error.config;
    if(error.response?.status!==401||!request||request._retried||!request.headers?.Authorization||request.url.startsWith('/auth/')&&request.url!=='/auth/me')throw error;
    request._retried=true;await refresh();request.headers.Authorization=`Bearer ${accessToken}`;return api(request);
  });
  return {
    request:request=>api(request).then(response=>response.data).catch(error=>{
      if(error instanceof DataError)throw error;
      const result=new DataError(error.response?.data?.code||(error.response?.status===401?'UNAUTHORIZED':error.response?'SERVICE_ERROR':'NETWORK'),error.response?.data?.message||'The request could not be completed.',{},!error.response||error.response.status>=500);
      // Keep status without retaining Axios request/config, which can contain transient secrets.
      result.response={status:error.response?.status};throw result;
    }),
    setToken:token=>{accessToken=token;},
    restore:async()=>{if(!accessToken)await refresh();},
    beginSession:()=>localStorage.removeItem('polylink.http.loggedOut'),
    isLoggedOut,
  };
}
export async function loadTransport(){return createTransport(await loadAxios());}
