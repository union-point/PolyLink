import { config } from '../config.js';
import { transaction } from '../data/mock/store.js';
import { profileOptions, upgradeProfiles } from '../data/mock/profile-state.js';
import { upgradePostsState } from '../data/mock/posts-state.js';
import { majors } from '../data/models.js';
import { DataError } from '../data/errors.js';

const kinds = {universities:[255,0],institutes:[255,0],departments:[255,0],specializations:[255,0],professions:[150,0],degrees:[100,0],'post-types':[100,16],'post-spheres':[150,32],'forum-categories':[255,32]};
const registryFields={lecturers:['firstName','lastName','email','departmentId'],alumni:['firstName','lastName','diplomaNumber','specializationId','studyStartDate','studyEndDate']};
const fail=(code,message='Չհաջողվեց կատարել գործողությունը։',field)=>{throw new DataError(code,message,field?{[field]:message}:{});};
const invalid=field=>fail('VALIDATION','Ստուգեք դաշտը։',field);
const fields=(value,allowed)=>{if(!value||typeof value!=='object'||Array.isArray(value))invalid('input');for(const key of Object.keys(value))if(!allowed.includes(key))invalid(key);};
const text=(value,key,max)=>{if(typeof value!=='string'||!value.trim()||value.trim().length>max||/[\p{Cc}\p{Cs}]/u.test(value))invalid(key);return value.trim();};
const email=value=>{const result=text(value,'email',255).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(result))invalid('email');return result;};
const slug=(value,max)=>{const result=text(value,'code',max);if(!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(result))invalid('code');return result;};
const normalize=value=>String(value).normalize('NFKC').trim().replace(/[\s\p{Z}]+/gu,' ').toLowerCase();
const secret=()=>crypto.randomUUID()+crypto.randomUUID();
async function digest(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');}
const safeAdmin=a=>Object.fromEntries(['id','email','firstName','lastName','role'].map(key=>[key,a[key]]));
const clone=value=>structuredClone(value);

export function upgradeAdminMockState(state){
  upgradeProfiles(state);upgradePostsState(state);
  state.adminMock??={admins:[],invitations:[],challenges:[],sessions:[],mail:[],cursors:{},limits:[]};
  const a=state.adminMock;
  if(!a.references){
    const profile=profileOptions(state);a.references={};
    for(const kind of Object.keys(kinds))a.references[kind]=[];
    for(const kind of ['universities','institutes','specializations','degrees'])a.references[kind]=profile[kind].map(row=>({...row,version:'1'}));
    a.references.departments=[{id:'1',name:'Ծրագրային ապահովման ամբիոն',version:'1'}];a.references.professions=[{id:'1',name:'Դասախոս',version:'1'}];
    a.references['post-types']=state.postTypes.map((r,i)=>({...r,id:String(i+1),version:'1'}));
    a.references['post-spheres']=state.postSpheres.map((r,i)=>({...r,id:String(i+1),version:'1'}));
    a.references['forum-categories']=Object.entries(majors).map(([code,name],i)=>({id:String(i+1),code,name,version:'1'}));
    const poly=a.references.universities.find(r=>/պոլիտեխնիկ|polytechnic/i.test(r.name));if(poly)poly.system=true;
    for(const row of a.references['post-types'])if(['job','internship','training'].includes(row.code))row.system=true;
    a.references['post-spheres'].find(r=>r.code==='other').system=true;
    a.registries={lecturers:[{id:'1',firstName:'Demo',lastName:'Lecturer',email:'new.lecturer@polytechnic.am',departmentId:'1',version:'1',linked:false}],alumni:[{id:'1',firstName:'Demo',lastName:'Graduate',diplomaNumber:'DEMO-2025',specializationId:'1',studyStartDate:'2021-09-01',studyEndDate:'2025-06-01',version:'1',linked:false}]};
  }
  return a;
}
function syncReferences(state){
  const refs=state.adminMock.references;
  state.postTypes=refs['post-types'].map(({code,name})=>({code,name}));state.postSpheres=refs['post-spheres'].map(({code,name})=>({code,name}));
  state.forumCategories=refs['forum-categories'].map(({id,code,name})=>({id,code,name}));
  state.profileReferences=Object.fromEntries(['universities','institutes','specializations','degrees'].map(kind=>[kind,refs[kind].map(({id,name,logo})=>({id,name,...(logo?{logo}:{})}))]));
}
function used(state,kind,row){
  const a=state.adminMock, education={universities:'universityId',institutes:'instituteId',specializations:'specializationId',degrees:'degreeId'};
  if(education[kind]&&state.education.some(r=>r[education[kind]]===row.id))return true;
  if(kind==='departments'&&a.registries.lecturers.some(r=>r.departmentId===row.id))return true;
  if(kind==='specializations'&&a.registries.alumni.some(r=>r.specializationId===row.id))return true;
  if(kind==='post-types'&&state.posts.some(r=>r.category===row.code))return true;
  if(kind==='post-spheres'&&state.posts.some(r=>r.sphereCode===row.code))return true;
  if(kind==='forum-categories'&&state.topics.some(r=>(r.categoryCode||r.major)===row.code))return true;
  const pendingKey={institutes:'instituteId',departments:'departmentId',specializations:'specializationId',professions:'professionId'}[kind];
  for(const user of state.users){
    if(pendingKey&&user.status==='pending'&&String(user.enrollment?.profile?.[pendingKey])===row.id)return true;
    if(user.role==='lecturer'&&((kind==='departments'&&user.department===row.name)||(kind==='professions'&&user.profession===row.name)))return true;
  }
  return false;
}
function referenceView(state,kind,row){return {id:row.id,name:row.name,version:row.version,...(row.code?{code:row.code}:{}),protectionReasons:[...(row.system?['SYSTEM_VALUE']:[]),...(used(state,kind,row)?['REFERENCE_IN_USE']:[])]};}
function registryView(row,kind){return {id:row.id,version:row.version,...Object.fromEntries(registryFields[kind].map(key=>[key,row[key]??null])),linked:row.linked===true,needsCorrection:registryFields[kind].some(key=>!row[key])};}
function find(items,id){return items.find(row=>row.id===id)||fail('NOT_FOUND','Գրառումը չի գտնվել։');}
function version(row,data){if(typeof data.version!=='string'||!data.version)invalid('version');if(data.version!==row.version)fail('VERSION_CONFLICT','Գրառումը փոփոխվել է։ Վերաբեռնեք այն։');}

export function createMockAdminProvider({transaction: transact,storage,now=()=>Date.now()}={}){
  const store=()=>storage||globalThis.sessionStorage;
  function browser(){let id=store().getItem('polylink.admin.mock.browser');if(!id){id=secret();store().setItem('polylink.admin.mock.browser',id);}return id;}
  const run=action=>transact(state=>{const a=upgradeAdminMockState(state);return action(state,a);},{write:true});
  function current(a){const s=a.sessions.find(row=>row.token===store().getItem('polylink.admin.mock.session')&&row.browser===browser());const admin=a.admins.find(row=>row.id===s?.adminId&&row.enabled);if(!s||!admin||s.idle<=now()||s.absolute<=now())fail('UNAUTHORIZED','Մուտք գործեք ադմինիստրատորի հաշվով։');return {session:s,admin};}
  const challengeView=c=>({status:'challenge',challengeId:c.id,expiresAt:new Date(c.expires).toISOString(),resendAfter:new Date(c.resend).toISOString()});
  function issue(a,purpose,values,expires){
    const recent=a.limits.filter(t=>t.email===values.email&&t.at>now()-600000);if(recent.length>=10)fail('RATE_LIMITED','Շատ փորձեր։ Փորձեք ավելի ուշ։');a.limits.push({email:values.email,at:now()});
    for(const c of a.challenges)if(c.browser===browser()&&c.purpose===purpose)c.invalid=true;
    const bytes=new Uint32Array(1);crypto.getRandomValues(bytes);const c={id:crypto.randomUUID(),purpose,browser:browser(),...values,expires:Math.min(now()+600000,expires??Infinity),resend:now()+60000,attempts:0,code:String(bytes[0]%1000000).padStart(6,'0')};a.challenges.push(c);a.mail.push({email:c.email,code:c.code});return challengeView(c);
  }
  async function request(path,{method='GET',data}={}){
    const url=new URL(path,'https://mock.invalid'),parts=url.pathname.split('/').filter(Boolean);method=method.toUpperCase();
    if(parts[0]==='auth'){
      const route=parts.slice(1).join('/');
      if(route==='parameters'&&method==='POST')return run((state,a)=>{fields(data,['email']);const address=email(data.email);return clone(a.admins.find(r=>r.email===address)?.derivation||{scheme:'PLK1',salt:'AAAAAAAAAAAAAAAAAAAAAA',opsLimit:3,memoryBytes:67108864});});
      if(route==='registration/invitation'&&method==='POST'){fields(data,['token']);const hash=await digest(text(data.token,'token',200));return run((state,a)=>{const invite=a.invitations.find(r=>r.hash===hash&&!r.used&&r.expires>now());if(!invite)fail('NOT_FOUND','Հրավերը հասանելի չէ։');return {email:invite.email,expiresAt:new Date(invite.expires).toISOString()};});}
      if(route==='registration/start'&&method==='POST'){
        fields(data,['token','firstName','lastName','loginSecret','derivation']);const hash=await digest(text(data.token,'token',200)),verifier=await digest(text(data.loginSecret,'loginSecret',200));
        const firstName=text(data.firstName,'firstName',100),lastName=text(data.lastName,'lastName',100),d=data.derivation;
        if(d?.scheme!=='PLK1'||typeof d.salt!=='string'||![2,3].includes(d.opsLimit)||d.memoryBytes!==67108864)invalid('derivation');
        return run((state,a)=>{const invite=a.invitations.find(r=>r.hash===hash&&!r.used&&r.expires>now());if(!invite||a.admins.some(r=>r.email===invite.email))fail('NOT_FOUND','Հրավերը հասանելի չէ։');return issue(a,'registration',{invitation:hash,email:invite.email,firstName,lastName,verifier,derivation:clone(d)},invite.expires);});
      }
      if(route==='login'&&method==='POST'){
        fields(data,['email','scheme','loginSecret']);const address=email(data.email),verifier=await digest(text(data.loginSecret,'loginSecret',200));if(data.scheme!=='PLK1')invalid('scheme');
        return run((state,a)=>{const admin=a.admins.find(r=>r.email===address&&r.enabled&&r.verifier===verifier);if(!admin)fail('UNAUTHORIZED','Մուտքի տվյալները սխալ են։');return issue(a,'login',{email:address,adminId:admin.id});});
      }
      if(['registration/verify','login/verify','registration/resend','login/resend'].includes(route)&&method==='POST'){
        const [purpose,operation]=route.split('/');fields(data,operation==='verify'?['challengeId','code']:['challengeId']);
        // Failed attempts must commit before returning a rejection.
        const result=await run((state,a)=>{
          const c=a.challenges.find(r=>r.id===data.challengeId&&r.browser===browser()&&r.purpose===purpose);
          if(operation==='verify'&&c?.completed&&purpose==='registration'&&c.code===data.code)return {status:'registered'};
          if(!c||c.invalid||c.completed||c.expires<=now()||c.attempts>=5)return {failure:'UNAUTHORIZED'};
          if(purpose==='login'&&!a.admins.some(r=>r.id===c.adminId&&r.enabled))return {failure:'UNAUTHORIZED'};
          const invite=purpose==='registration'?a.invitations.find(r=>r.hash===c.invitation&&!r.used&&r.expires>now()):null;
          if(purpose==='registration'&&(!invite||a.admins.some(r=>r.email===c.email)))return {failure:'UNAUTHORIZED'};
          if(operation==='resend'){if(c.resend>now())return {failure:'RATE_LIMITED'};const b=new Uint32Array(1);crypto.getRandomValues(b);c.code=String(b[0]%1000000).padStart(6,'0');c.resend=now()+60000;a.mail.push({email:c.email,code:c.code});return challengeView(c);}
          if(!/^[0-9]{6}$/.test(data.code)||c.code!==data.code){c.attempts++;return {failure:'UNAUTHORIZED'};}
          c.completed=true;
          if(purpose==='registration'){invite.used=true;const id=String(Math.max(0,...a.admins.map(r=>Number(r.id)))+1);a.admins.push({id,email:c.email,firstName:c.firstName,lastName:c.lastName,role:'admin',verifier:c.verifier,derivation:c.derivation,enabled:true});return {status:'registered'};}
          const admin=a.admins.find(r=>r.id===c.adminId);const token=secret();a.sessions.push({token,adminId:admin.id,browser:browser(),idle:now()+1800000,absolute:now()+43200000});store().setItem('polylink.admin.mock.session',token);return {status:'authenticated',admin:safeAdmin(admin)};
        });
        if(result.failure)fail(result.failure,result.failure==='RATE_LIMITED'?'Փորձեք ավելի ուշ։':'Կոդը սխալ է կամ ժամկետանց։');return result;
      }
      if(route==='session'&&method==='GET')return run((state,a)=>safeAdmin(current(a).admin));
      if(route==='refresh'&&method==='POST')return run((state,a)=>{const {session,admin}=current(a);session.token=secret();session.idle=Math.min(now()+1800000,session.absolute);store().setItem('polylink.admin.mock.session',session.token);return safeAdmin(admin);});
      if(route==='logout'&&method==='POST')return run((state,a)=>{const {session}=current(a);a.sessions=a.sessions.filter(r=>r!==session);store().removeItem('polylink.admin.mock.session');return null;});
      fail('NOT_FOUND');
    }
    return run((state,a)=>{
      const {admin}=current(a),[area,kind,id]=parts;
      if(parts.length>3||!['references','registries'].includes(area)||(area==='references'?!kinds[kind]:!registryFields[kind]))fail('NOT_FOUND');
      const list=area==='references'?a.references[kind]:a.registries[kind];const view=row=>area==='references'?referenceView(state,kind,row):registryView({...row,linked:row.linked||state.users.some(u=>u.registryClaim===(kind==='alumni'?'graduate-':'lecturer-')+row.id)},kind);
      if(method==='GET'){
        if(id)return view(find(list,id));
        for(const key of url.searchParams.keys())if(!['q','cursor'].includes(key))invalid(key);
        const q=(url.searchParams.get('q')||'').trim();if(q.length>255||/\p{Cc}/u.test(q))invalid('q');const scope=JSON.stringify([admin.id,area,kind,q]);let after=0;
        const cursor=url.searchParams.get('cursor');if(cursor){const saved=a.cursors[cursor];if(!saved||saved.scope!==scope)invalid('cursor');after=saved.after;}
        const matches=list.filter(row=>Number(row.id)>after&&normalize((area==='references'?[row.name,row.code]:[row.firstName,row.lastName,row.email,row.diplomaNumber]).filter(v=>typeof v==='string').join(' ')).includes(normalize(q))).sort((a,b)=>Number(a.id)-Number(b.id));
        const selected=matches.slice(0,50);let nextCursor=null;if(matches.length>50){nextCursor=crypto.randomUUID();a.cursors[nextCursor]={scope,after:Number(selected.at(-1).id)};}return {items:selected.map(view),nextCursor};
      }
      if(!['POST','PUT','DELETE'].includes(method)||(method==='POST'&&id)||(method!=='POST'&&!id))fail('NOT_FOUND');
      const row=id?find(list,id):null;
      const allowed=method==='DELETE'?['version']:area==='references'?['name',...(method==='POST'&&kinds[kind][1]?['code']:[]),...(row?['version']:[])]:[...registryFields[kind],...(row?['version']:[])];fields(data,allowed);
      if(row){version(row,data);if(area==='references'){const reasons=referenceView(state,kind,row).protectionReasons;if(reasons.length)fail(reasons[0],'Այս արժեքը պաշտպանված է կամ օգտագործվում է։');}else if(view(row).linked)fail('RECORD_LINKED','Կապակցված գրառումը փոփոխել հնարավոր չէ։');}
      if(method==='DELETE'){list.splice(list.indexOf(row),1);syncReferences(state);return null;}
      let values;
      if(area==='references'){
        const [nameLimit,codeLimit]=kinds[kind];values={name:text(data.name,'name',nameLimit)};if(method==='POST'&&codeLimit)values.code=slug(data.code,codeLimit);
        if(list.some(r=>r!==row&&normalize(r.name)===normalize(values.name)))fail('DUPLICATE_NAME','Այս անվանումն արդեն գոյություն ունի։','name');
        if(values.code&&list.some(r=>r!==row&&r.code===values.code))fail('DUPLICATE_CODE','Այս կոդն արդեն գոյություն ունի։','code');
      }else{
        values={firstName:text(data.firstName,'firstName',100),lastName:text(data.lastName,'lastName',100)};
        const lecturer=kind==='lecturers',key=lecturer?'email':'diplomaNumber',ref=lecturer?'departmentId':'specializationId',refKind=lecturer?'departments':'specializations';
        values[key]=lecturer?email(data[key]):text(data[key],key,100);
        if(list.some(r=>r!==row&&(lecturer?String(r[key]).trim().toLowerCase():normalize(r[key]))===(lecturer?values[key].trim().toLowerCase():normalize(values[key]))))fail(lecturer?'DUPLICATE_EMAIL':'DUPLICATE_DIPLOMA','Այս արժեքն արդեն գոյություն ունի։',key);
        if(typeof data[ref]!=='string'||!a.references[refKind].some(r=>r.id===data[ref]))invalid(ref);values[ref]=data[ref];
        if(!lecturer){for(const field of ['studyStartDate','studyEndDate']){const date=data[field];if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)invalid(field);values[field]=date;}if(values.studyStartDate>values.studyEndDate)invalid('studyEndDate');}
      }
      a.sequences??={};const sequenceKey=area+':'+kind;
      if(!row)a.sequences[sequenceKey]=Math.max(a.sequences[sequenceKey]||0,...list.map(r=>Number(r.id)))+1;
      const saved=row||{id:String(a.sequences[sequenceKey]),version:'0',...(area==='registries'?{linked:false}:{})};Object.assign(saved,values,{version:String(Number(saved.version)+1)});if(!row)list.push(saved);syncReferences(state);return view(saved);
    });
  }
  return {
    request,
    async provisionInvitation(address){const normalized=email(address),token=secret(),hash=await digest(token);return run((state,a)=>{if(a.admins.some(r=>r.email===normalized))fail('DUPLICATE_EMAIL');const expires=now()+86400000;a.invitations.push({email:normalized,hash,expires,used:false});return {token,email:normalized,expiresAt:new Date(expires).toISOString()};});},
    takeCode(address){return run((state,a)=>{const index=a.mail.findLastIndex(r=>r.email===address.toLowerCase());if(index<0)return null;const [mail]=a.mail.splice(index,1);return mail.code;});},
    disable(id){return run((state,a)=>{const admin=find(a.admins,String(id));admin.enabled=false;a.sessions=a.sessions.filter(s=>s.adminId!==admin.id);for(const c of a.challenges)if(c.adminId===admin.id)c.invalid=true;});},
  };
}
let provider;
function local(){if(config.dataMode!=='mock')fail('UNAVAILABLE','Ցուցադրական ադմինիստրատորը հասանելի է միայն mock ռեժիմում։');return provider??=createMockAdminProvider({transaction});}
export const mockAdminRequest=(...args)=>local().request(...args);
export const provisionMockInvitation=(...args)=>local().provisionInvitation(...args);
export const takeMockCode=(...args)=>local().takeCode(...args);
export const disableMockAdmin=(...args)=>local().disable(...args);
