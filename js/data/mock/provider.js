import { postOperations, activityOperations, upgradePostsState } from './posts-state.js';
import { searchOperations } from './search-state.js';
import { forumOperations, upgradeForumState } from './forum-state.js';
import { upgradeChatState, preference, blocked as isBlocked, canSend, visibleMessages, markRead, hideRoom, appendMessage, messagePage } from './chat-state.js';
import { validateImageBytes } from '../../crypto/images.js';
import { transaction, nextId } from './store.js';
import { DataError } from '../errors.js';
import { universityEmail, email, password, required, validateEducation, validateCertificate, validatePost, validateImage, richContent } from '../validation.js';

const now = () => new Date().toISOString();
const defaults = () => ({ isProfilePublic: true, showEmail: false, twoFactorEnabled: false, language: 'hy', emailEnabled: true, newListingNotifications: true, forumReplyNotifications: true, directMessageNotifications: true, postCommentNotifications: true });
const readOperations = new Set(['auth.me', 'profiles.get', 'profiles.education.list', 'profiles.certificates.list', 'posts.options', 'posts.get', 'posts.list', 'posts.comments.list', 'notifications.list', 'notifications.history', 'forum.categories', 'forum.list', 'forum.get', 'forum.replies.list', 'forum.replies.get', 'search.people', 'search.page', 'search.filters', 'chat.list', 'chat.messages', 'chat.page', 'chat.participants', 'chat.loadDraft', 'settings.get', 'settings.export']);
const publicOperations = new Set(['auth.uploadEnrollmentAvatar','auth.removeEnrollmentAvatar','auth.enrollment','auth.enrollmentOptions','auth.saveEnrollment','auth.submitEnrollment','auth.logoutEnrollment','auth.verifyEmail','auth.me', 'auth.login', 'auth.register', 'auth.verifySecondFactor', 'auth.resendChallenge', 'auth.forgotPassword', 'auth.verifyRecovery', 'auth.resetPassword', 'auth.logout']);

function find(records, id) {
  const item = records.find(record => record.id === String(id));
  if (!item) throw new DataError('NOT_FOUND', 'Տվյալները չեն գտնվել։');
  return item;
}
function me(state) {
  const user = state.users.find(user => user.id === state.sessionUserId && user.status === 'active');
  if (!user) throw new DataError('UNAUTHORIZED', 'Խնդրում ենք մուտք գործել։');
  return user;
}
function enrollmentUser(state) {
  const user=state.users.find(user=>user.id===state.enrollmentUserId);
  if(!user||!user.enrollment||Date.now()-user.enrollment.savedAt>=7*86400000)throw new DataError('UNAUTHORIZED','Մուտք գործեք՝ գրանցումը շարունակելու համար։');
  return user;
}
function enrollmentState(state) {
  const user=enrollmentUser(state),entry=user.enrollment;
  return user.status==='active'?{status:'admitted',email:user.email}:{status:'enrollment',email:user.email,revision:entry.revision,profile:entry.profile,avatar:user.avatar,challenge:entry.challenge,expiresAt:new Date(entry.savedAt+7*86400000).toISOString()};
}
const enrollmentOptions={institutes:[{id:1,name:'ՏՀՏԷ'}],specializations:[{id:1,name:'Ծրագրային ճարտարագիտություն'}],departments:[{id:1,name:'Ծրագրային ապահովման ամբիոն'}],professions:[{id:1,name:'Դասախոս'}]};
function checkRegistry(state,user) {
  const p=user.enrollment.profile;
  if(!enrollmentOptions.institutes.some(item=>item.id===p.instituteId))throw new DataError('VALIDATION','Ընտրեք ֆակուլտետը/ինստիտուտը։');
  const normalize=value=>String(value??'').normalize('NFKC').replace(/[\s\p{Z}]+/gu,' ').trim().toLowerCase();
  const graduate=p.role==='graduate';
  const valid=graduate?normalize(p.firstName)==='demo'&&normalize(p.lastName)==='graduate'&&normalize(p.diplomaNumber)==='demo-2025'&&p.specializationId===1&&p.startYear===2021&&p.endYear===2025:normalize(p.firstName)==='demo'&&normalize(p.lastName)==='lecturer'&&user.email==='new.lecturer@polytechnic.am'&&p.departmentId===1&&p.professionId===1;
  if(!valid||state.users.some(other=>other.id!==user.id&&other.registryClaim===(graduate?'graduate-1':'lecturer-1')))throw new DataError('REGISTRY_MISMATCH','Տվյալները չեն համապատասխանում ցուցադրական գրանցամատյանին։');
  return graduate?'graduate-1':'lecturer-1';
}
function owner(state, item) {
  if (item.userId !== me(state).id) throw new DataError('FORBIDDEN', 'Այս գործողությունը հասանելի չէ։');
  return item;
}
function author(state, id) {
  const user = find(state.users, id);
  return { id: user.id, name: user.name, avatar: user.avatar };
}
function profile(state, user) {
  const settings = state.settings[user.id] || defaults();
  const own = state.sessionUserId === user.id;
  if (user.status !== 'active' || (!own && !settings.isProfilePublic)) throw new DataError('NOT_FOUND', 'Պրոֆիլը հասանելի չէ։');
  const { email: address, enrollment, registryClaim, ...publicUser } = user;
  return { ...publicUser, ...(own || settings.showEmail ? { email: address } : {}),
    education: state.education.filter(record => record.userId === user.id),
    licenses: state.certificates.filter(record => record.userId === user.id) };
}
function roomForUser(state, id) {
  const room = find(state.rooms, id);
  if (!room.participants.includes(me(state).id)) throw new DataError('FORBIDDEN', 'Նամակագրությունը հասանելի չէ։');
  return room;
}
function messageView(state, message) {
  return { ...message, sender: message.deleted?{id:'',name:''}:author(state, message.senderId) };
}
function roomView(state, room) {
  const userId = me(state).id;
  const pref = preference(room, userId);
  const messages = visibleMessages(state,room,userId);
  const participants = room.participants.map(id => author(state, id));
  const other = room.participants.find(id => id !== userId);
  return { id: room.id, isGroup: room.isGroup, closed: !!room.closed||(!room.isGroup&&room.participants.length<2), ownerId:room.ownerId, metadataVersion:room.metadataVersion||'1',canManage:room.isGroup&&room.ownerId===userId&&!room.closed,keySnapshot:{versions:{membership:room.membershipVersion||'1'},keyState:'ready'}, name: room.name || participants.filter(person => person.id !== userId).map(person => person.name).join(', ') || 'Ջնջված օգտատեր', participants,
    muted: pref.muted, blocked: !room.isGroup&&isBlocked(state,userId,other), canSend:canSend(state,room), historyCutoff:pref.historyCutoff,lastReadSequence:pref.lastReadSequence,lastSequence:room.lastSequence||'0',unreadCount:messages.filter(message=>message.senderId!==userId&&BigInt(message.sequence)>BigInt(pref.lastReadSequence)).length,
    lastMessage: messages.length ? messageView(state, messages.at(-1)) : null };
}
function challenge(state, id, purpose) {
  const item = find(state.challenges, id);
  if (item.purpose !== purpose || item.consumed || item.expiresAt <= Date.now() || item.attempts >= 5) throw new DataError('VALIDATION', 'Վավերացման ժամկետը լրացել է։ Պահանջեք նոր կոդ։');
  return item;
}
function newChallenge(state, userId, purpose) {
  const item = { id: nextId(state, 'challenge'), userId, purpose, expiresAt: Date.now() + 600000, sentAt: Date.now(), consumed: false, verified: false, attempts: 0 };
  state.challenges.push(item);
  return { challengeId: item.id, expiresAt: item.expiresAt, resendAfter: 60 };
}
function checkCode(item, code) {
  item.attempts += 1;
  if (String(code) !== '123456') return new DataError('VALIDATION', 'Սխալ վավերացման կոդ։', { code: 'Սխալ կոդ' });
  return null;
}
async function digest(address, secret) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${address}:${secret}`));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function groupOwner(state,id){const room=roomForUser(state,id);if(!room.isGroup||room.closed||room.ownerId!==me(state).id)throw new DataError('FORBIDDEN','Only the group owner can do this.');return room;}
function memberChange(room){room.membershipVersion=(BigInt(room.membershipVersion||'1')+1n).toString();}
function compareUserIds(a,b){return /^\d+$/.test(a)&&/^\d+$/.test(b)?(BigInt(a)<BigInt(b)?-1:BigInt(a)>BigInt(b)?1:0):a.localeCompare(b);}
function leaveMember(room,id){room.participants=room.participants.filter(person=>person!==id);memberChange(room);if(!room.participants.length)room.closed=true;}
const operations = {
  'chat.saveDraft':(state,id,text)=>{preference(roomForUser(state,id),me(state).id).draft=text;},
  'chat.loadDraft':(state,id)=>preference(roomForUser(state,id),me(state).id).draft||'',
  'chat.createGroup':(state,{name,userIds})=>{
    name=String(name||'').trim();const ids=[...new Set([me(state).id,...userIds.map(String)])];
    if(!name||name.length>100||ids.length<2||ids.length>100||ids.some(id=>find(state.users,id).status!=='active'))throw new DataError('VALIDATION','Choose a name and 2–100 active participants.');
    const room={id:nextId(state,'room'),isGroup:true,name,ownerId:me(state).id,metadataVersion:'1',membershipVersion:'1',participants:ids,preferences:{},lastSequence:'0'};state.rooms.push(room);return {roomId:room.id};
  },
  'chat.participants':(state,id)=>roomView(state,roomForUser(state,id)),
  'chat.renameGroup':(state,id,name)=>{const room=groupOwner(state,id);name=String(name||'').trim();if(!name||name.length>100)throw new DataError('VALIDATION','Enter a group name.');room.name=name;room.metadataVersion=(BigInt(room.metadataVersion||'1')+1n).toString();return {roomId:id};},
  'chat.transferOwner':(state,id,target)=>{const room=groupOwner(state,id);if(!room.participants.includes(String(target))||find(state.users,target).status!=='active')throw new DataError('VALIDATION','Choose a current active member.');room.ownerId=String(target);room.metadataVersion=(BigInt(room.metadataVersion||'1')+1n).toString();return {roomId:id};},
  'chat.addParticipant':(state,id,target)=>{const room=groupOwner(state,id);target=String(target);if(room.participants.includes(target)||room.participants.length>=100||find(state.users,target).status!=='active')throw new DataError('VALIDATION','This person cannot be added.');room.participants.push(target);const pref=preference(room,target);pref.hidden=false;pref.muted=false;pref.historyCutoff=room.lastSequence||'0';pref.lastReadSequence=pref.historyCutoff;memberChange(room);return {roomId:id};},
  'chat.removeParticipant':(state,id,target)=>{const room=groupOwner(state,id);target=String(target);if(!room.participants.includes(target)||target===me(state).id)throw new DataError('VALIDATION','Choose another member.');leaveMember(room,target);return {roomId:id};},
  'chat.leaveGroup':(state,id)=>{const room=roomForUser(state,id),own=me(state).id;if(!room.isGroup)throw new DataError('VALIDATION','This is not a group.');if(room.ownerId===own&&room.participants.length>1)throw new DataError('OWNER_TRANSFER_REQUIRED','Transfer ownership before leaving.');leaveMember(room,own);return {roomId:id};},
  'auth.me': state => state.sessionUserId ? profile(state, me(state)) : null,
  'auth.logout': state => { state.sessionUserId = null; return null; },
  'auth.uploadEnrollmentAvatar':(state,content)=>{
    const user=enrollmentUser(state),id=nextId(state,'media');
    state.media=state.media.filter(item=>`media:${item.id}`!==user.avatar);
    state.media.push({id,userId:user.id,blob:new Blob([Uint8Array.from(atob(content),c=>c.charCodeAt(0))],{type:'image/jpeg'})});
    user.avatar=`media:${id}`;return {url:user.avatar};
  },
  'auth.removeEnrollmentAvatar':state=>{const user=enrollmentUser(state);state.media=state.media.filter(item=>`media:${item.id}`!==user.avatar);user.avatar='';return null;},
  'auth.enrollment':state=>({...enrollmentState(state),avatar:enrollmentUser(state).avatar}),
  'auth.enrollmentOptions':state=>{enrollmentUser(state);return enrollmentOptions;},
  'auth.logoutEnrollment':state=>{state.enrollmentUserId=null;return null;},
  'auth.saveEnrollment':(state,data)=>{
    const user=enrollmentUser(state),entry=user.enrollment;
    if(user.status!=='pending'||data.revision!==entry.revision)throw new DataError('REVISION_CONFLICT','Թարմացրեք էջը։');
    if(!['graduate','lecturer'].includes(data.role))throw new DataError('VALIDATION','Ընտրեք դերը։');
    required(data.firstName,'firstName',100);required(data.lastName,'lastName',100);
    if(!enrollmentOptions.institutes.some(item=>item.id===data.instituteId))throw new DataError('VALIDATION','Ընտրեք ֆակուլտետը/ինստիտուտը։',{instituteId:'Ընտրեք ֆակուլտետը/ինստիտուտը։'});
    if(data.role==='graduate') {required(data.diplomaNumber,'diplomaNumber',100);if(!data.specializationId||!data.startYear||data.endYear<data.startYear)throw new DataError('VALIDATION','Լրացրեք ուսման տվյալները։');}
    else if(!data.departmentId||!data.professionId)throw new DataError('VALIDATION','Ընտրեք ամբիոնը և մասնագիտությունը։');
    entry.profile={...data};delete entry.profile.revision;entry.revision++;entry.savedAt=Date.now();delete entry.challenge;
    state.challenges.filter(c=>c.userId===user.id&&c.purpose==='enrollment').forEach(c=>c.consumed=true);
    return enrollmentState(state);
  },
  'auth.submitEnrollment':(state,{revision})=>{
    const user=enrollmentUser(state),entry=user.enrollment;
    if(user.status!=='pending'||revision!==entry.revision)throw new DataError('REVISION_CONFLICT','Թարմացրեք էջը։');
    checkRegistry(state,user);
    if(entry.challenge){const previous=find(state.challenges,entry.challenge.challengeId);if(Date.now()-previous.sentAt<60000)throw new DataError('RATE_LIMITED','Խնդրում ենք սպասել։');previous.consumed=true;}
    entry.challenge=newChallenge(state,user.id,'enrollment');find(state.challenges,entry.challenge.challengeId).revision=entry.revision;
    return entry.challenge;
  },
  'auth.verifyEmail':(state,{challengeId,code})=>{
    const user=enrollmentUser(state),entry=user.enrollment;
    if(user.status==='active'&&entry.completed===challengeId&&code==='123456')return enrollmentState(state);
    const item=challenge(state,challengeId,'enrollment');
    if(item.userId!==user.id||item.revision!==entry.revision)throw new DataError('UNAUTHORIZED','Անվավեր կոդ։');
    const failure=checkCode(item,code);if(failure)return failure;
    const claim=checkRegistry(state,user);item.consumed=true;entry.completed=challengeId;user.registryClaim=claim;
    const graduate=entry.profile.role==='graduate';
    state.education.push({id:nextId(state,'education'),userId:user.id,institution:'Հայաստանի ազգային պոլիտեխնիկական համալսարան',degree:null,institute:enrollmentOptions.institutes.find(item=>item.id===entry.profile.instituteId).name,specialization:graduate?enrollmentOptions.specializations.find(item=>item.id===entry.profile.specializationId).name:null,startDate:graduate?'2021-09-01':null,endDate:graduate?'2025-06-01':null});
    Object.assign(user,{firstName:entry.profile.firstName,lastName:entry.profile.lastName,role:entry.profile.role,status:'active',onboardingComplete:true});user.name=`${user.firstName} ${user.lastName}`;
    return enrollmentState(state);
  },
  'auth.register': (state, data) => {
    const address=universityEmail(data.email);
    const expired=state.users.find(user=>user.email===address&&user.status==='pending'&&Date.now()-user.enrollment.savedAt>=7*86400000);
    if(expired){expired.email=`expired-${expired.id}@deleted.invalid`;delete state.credentials[expired.id];delete expired.enrollment;expired.status='deleted';}
    state.sessionUserId=null;state.enrollmentUserId=null;
    if(!state.users.some(user=>user.email===address)) {
      const user={id:nextId(state,'user'),firstName:required(data.firstName,'firstName',100),lastName:required(data.lastName,'lastName',100),email:address,role:data.role||'graduate',status:'pending',onboardingComplete:false,jobTitle:'',description:'',avatar:'image/logo.png',cover:'image/background1.jpg',institute:'',specialization:'',graduationYear:''};
      user.name=`${user.firstName} ${user.lastName}`;user.enrollment={revision:1,savedAt:Date.now(),profile:{firstName:user.firstName,lastName:user.lastName,role:user.role}};
      state.users.push(user);state.credentials[user.id]=data.digest;state.settings[user.id]=defaults();state.enrollmentUserId=user.id;
    }
    return {status:'enrollment'};
  },
  'auth.login': (state, data) => {
    const user = state.users.find(user => ['active','pending'].includes(user.status)&&user.email === data.email && state.credentials[user.id] === data.digest);
    if (!user) throw new DataError('UNAUTHORIZED', 'Սխալ էլ․ փոստ կամ գաղտնաբառ։');
    if(user.status==='pending'){state.sessionUserId=null;state.enrollmentUserId=user.id;enrollmentUser(state);return {status:'enrollment'};}
    state.enrollmentUserId=null;
    if (state.settings[user.id]?.twoFactorEnabled) { state.sessionUserId = null; return { status: 'challenge', ...newChallenge(state, user.id, 'second-factor') }; }
    user.status = 'active'; state.sessionUserId = user.id;
    return { status: 'authenticated', user: profile(state, user) };
  },
  'auth.verifySecondFactor': (state, data) => {
    const item = challenge(state, data.challengeId, 'second-factor');
    const failure = checkCode(item, data.code);
    if (failure) return failure; // Commit attempt counter before propagating the error.
    item.consumed = true; state.sessionUserId = item.userId;
    const user = find(state.users, item.userId); user.status = 'active';
    return profile(state, user);
  },
  'auth.resendChallenge': (state, input) => {
    const id=typeof input==='string'?input:input.challengeId;
    const item = find(state.challenges, id);
    if (item.consumed || Date.now() - item.sentAt < 60000) throw new DataError('VALIDATION', 'Խնդրում ենք սպասել մինչև նոր կոդ պահանջելը։');
    item.sentAt = Date.now(); item.expiresAt = Date.now() + 600000; item.attempts = 0; item.verified = false;
    return { challengeId: item.id, expiresAt: item.expiresAt, resendAfter: 60 };
  },
  'auth.forgotPassword': (state, address) => {
    const user = state.users.find(user => user.email === address);
    // Unknown addresses get an indistinguishable challenge that cannot authorize a reset.
    return newChallenge(state, user?.id || null, 'recovery');
  },
  'auth.verifyRecovery': (state, data) => {
    const item = challenge(state, data.challengeId, 'recovery');
    const failure = checkCode(item, data.code);
    if (failure) return failure;
    if (!item.userId) return new DataError('VALIDATION', 'Սխալ վավերացման կոդ։');
    item.verified = true;
    return { recoveryToken: item.id };
  },
  'auth.resetPassword': (state, data) => {
    const item = challenge(state, data.recoveryToken, 'recovery');
    if (!item.verified || !item.userId) throw new DataError('FORBIDDEN', 'Նախ վավերացրեք վերականգնման կոդը։');
    state.credentials[item.userId] = data.digest; find(state.users, item.userId).passwordChangedAt = now(); item.consumed = true;
    state.challenges.filter(record => record.userId === item.userId).forEach(record => { record.consumed = true; });
    state.sessionUserId = null;
    return null;
  },
  'profiles.get': (state, id) => profile(state, id ? find(state.users, id) : me(state)),
  'profiles.update': (state, data) => {
    const user = me(state);
    for (const key of ['firstName', 'lastName']) if (key in data) user[key] = required(data[key], key, 100);
    for (const key of ['jobTitle', 'description', 'institute', 'specialization', 'department', 'graduationYear']) if (key in data) user[key] = String(data[key] || '').trim();
    user.name = `${user.firstName} ${user.lastName}`;
    return profile(state, user);
  },
  'profiles.onboard': (state, data) => {
    const user = me(state);
    const role = data.role;
    if(user.onboardingComplete&&role!==user.role)throw new DataError('FORBIDDEN','Հաշվի դերը չի կարող փոխվել։');
    if (!['graduate', 'lecturer'].includes(role)) throw new DataError('VALIDATION', 'Ընտրեք դերը։');
    required(data.description, 'description');
    if (role === 'graduate') {
      const start = Number(data.startYear), end = Number(data.endYear);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1900 || end < start || end > 2200) throw new DataError('VALIDATION', 'Ստուգեք ուսման տարիները։');
      const entry = { id: nextId(state, 'education'), userId: user.id, institution: 'Հայաստանի ազգային պոլիտեխնիկական համալսարան', degree: 'Բակալավր', institute: data.institute, specialization: data.specialization, startDate: `${start}-09`, endDate: `${end}-06`, logo: 'image/logo.png' };
      state.education = state.education.filter(record => record.userId !== user.id || !record.onboarding);
      state.education.push({ ...entry, onboarding: true }); user.graduationYear = String(end);
    }
    Object.assign(user, { role, institute: role === 'graduate' ? data.institute : '', department: role === 'lecturer' ? data.department : '', specialization: data.specialization, description: data.description, onboardingComplete: true });
    return profile(state, user);
  },
  'profiles.education.list': state => state.education.filter(record => record.userId === me(state).id),
  'profiles.education.create': (state, data) => { const entry = { ...validateEducation(data), id: nextId(state, 'education'), userId: me(state).id }; state.education.push(entry); return entry; },
  'profiles.education.update': (state, id, data) => Object.assign(owner(state, find(state.education, id)), validateEducation(data)),
  'profiles.education.delete': (state, id) => { owner(state, find(state.education, id)); state.education = state.education.filter(record => record.id !== String(id)); return null; },
  'profiles.certificates.list': state => state.certificates.filter(record => record.userId === me(state).id),
  'profiles.certificates.create': (state, data) => { const entry = { ...validateCertificate(data), id: nextId(state, 'certificate'), userId: me(state).id }; state.certificates.push(entry); return entry; },
  'profiles.certificates.update': (state, id, data) => Object.assign(owner(state, find(state.certificates, id)), validateCertificate(data)),
  'profiles.certificates.delete': (state, id) => { owner(state, find(state.certificates, id)); state.certificates = state.certificates.filter(record => record.id !== String(id)); return null; },
  'profiles.upload': (state, kind, file) => {
    if (!['avatar', 'cover'].includes(kind)) throw new DataError('VALIDATION', 'Անվավեր պատկերի տեսակ։');
    const id = nextId(state, 'media'); state.media.push({ id, userId: me(state).id, blob: validateImage(file) });
    me(state)[kind] = `media:${id}`;
    return profile(state, me(state));
  },
  ...postOperations,
  ...activityOperations,
  ...forumOperations,
  ...searchOperations,
  'chat.list': state => state.rooms.filter(room => room.participants.includes(me(state).id) && !preference(room, me(state).id).hidden).map(room => roomView(state, room)),
  'chat.openDirect': (state, userId) => {
    const own = me(state).id; find(state.users, userId);
    if (own === String(userId)) throw new DataError('VALIDATION', 'Ընտրեք այլ օգտատեր։');
    if (isBlocked(state, own, String(userId))) throw new DataError('DIRECT_BLOCKED_BY_YOU', 'Դուք արգելափակել եք այս օգտատիրոջը։ Կապ հաստատելու համար ապաարգելափակեք նրան։');
    if (isBlocked(state, String(userId), own)) throw new DataError('DIRECT_UNAVAILABLE', 'Այս օգտատիրոջ հետ հաղորդակցությունն անհասանելի է։');
    let room = state.rooms.find(room => !room.isGroup && room.participants.length === 2 && room.participants.includes(own) && room.participants.includes(String(userId)));
    if (!room) { room = { id: nextId(state, 'room'), isGroup: false, participants: [own, String(userId)], preferences: {} }; state.rooms.push(room); }
    preference(room, own).hidden = false;
    return roomView(state, room);
  },
  'chat.messages': (state,id)=>visibleMessages(state,roomForUser(state,id),me(state).id).map(message=>messageView(state,message)),
  'chat.page': (state,id,params)=>{const page=messagePage(visibleMessages(state,roomForUser(state,id),me(state).id),params);return {...page,items:page.items.map(message=>messageView(state,message))};},
  'chat.send': (state, roomId, data) => {
    upgradeChatState(state); upgradeForumState(state); upgradePostsState(state);const room = roomForUser(state, roomId), own = me(state).id;
    if (!room.isGroup&&room.participants.length < 2) throw new DataError('FORBIDDEN', 'Նամակագրությունն ավարտված է։');
    if (!canSend(state,room)) throw new DataError('FORBIDDEN', 'Հաղորդագրությունը չի կարող ուղարկվել։ Օգտատերը արգելափակված է։');
    const text = String(data.text || '').trim();
    if (!text && !data.file) throw new DataError('VALIDATION', 'Մուտքագրեք հաղորդագրություն։');
    if (text.length > 5000) throw new DataError('VALIDATION', 'Հաղորդագրությունը չափազանց երկար է։');
    let attachment = null;
    if (data.file) { const id = nextId(state, 'media'); state.media.push({ id, userId: own, blob: validateImage(data.file) }); attachment = { url: `media:${id}`, name: data.file.name, type: data.file.type }; }
    const message = { id: nextId(state, 'message'), roomId: room.id, senderId: own, text, attachment, createdAt: now() }; appendMessage(state,room,message);
    return messageView(state, message);
  },
  'chat.read': (state,id,through)=>{const room=roomForUser(state,id);markRead(state,room,me(state).id,String(through));return roomView(state,room);},
  'chat.mute': (state, id, value) => { const room = roomForUser(state, id); preference(room, me(state).id).muted = Boolean(value); return roomView(state, room); },
  'chat.hide': (state,id)=>hideRoom(roomForUser(state,id),me(state).id),
  'chat.block': (state, userId, value) => { const own = me(state).id; find(state.users, userId);if(own===String(userId))throw new DataError('VALIDATION','Choose another user.'); state.blocks = state.blocks.filter(block => block.userId !== own || block.targetId !== String(userId)); if (value) state.blocks.push({ userId: own, targetId: String(userId) }); return null; },
  'settings.get': state => state.settings[me(state).id] || defaults(),
  'settings.update': (state, data) => {
    const settings = state.settings[me(state).id] ||= defaults();
    for(const [key,value]of Object.entries(data)) {
      if(key==='twoFactorEnabled'||!(key in defaults())||(key==='language'? !['hy','en','ru'].includes(value):typeof value!=='boolean'))throw new DataError('VALIDATION','Անվավեր կարգավորում։');
    }
    for (const key of Object.keys(defaults())) if (key in data) {
      if (key === 'language') { if (!['hy', 'en', 'ru'].includes(data.language)) throw new DataError('VALIDATION', 'Անվավեր լեզու։'); settings.language = data.language; }
      else settings[key] = Boolean(data[key]);
    }
    return settings;
  },
  'settings.setEmailFactor': (state,data)=>{
    const user=me(state);if(state.credentials[user.id]!==data.digest)throw new DataError('UNAUTHORIZED','Սխալ գաղտնաբառ։');
    const preferences=state.settings[user.id] ||= defaults();preferences.twoFactorEnabled=data.enabled;
    state.challenges.filter(item=>item.userId===user.id&&item.purpose==='email-change').forEach(item=>item.consumed=true);
    return {twoFactorEnabled:data.enabled};
  },
  'settings.verifyEmailChange':(state,data)=>{
    const user=me(state),item=challenge(state,data.requestId,'email-change');if(item.userId!==user.id)throw new DataError('UNAUTHORIZED','Անհասանելի գործողություն։');
    const failure=checkCode(item,data.code);if(failure)return failure;
    if(item.stage==='OLD'){item.stage='NEW';item.attempts=0;item.expiresAt=Date.now()+600000;return {status:'challenge',requestId:item.id,stage:'NEW'};}
    if(state.users.some(other=>other.id!==user.id&&other.email===item.email))throw new DataError('CONFLICT','Էլ․ փոստն արդեն գրանցված է։');
    user.email=item.email;state.credentials[user.id]=item.newDigest;item.consumed=true;return {status:'completed',email:user.email};
  },
  'settings.resendEmailChange':(state,data)=>{
    const item=challenge(state,data.requestId,'email-change');if(item.userId!==me(state).id)throw new DataError('UNAUTHORIZED','Անհասանելի գործողություն։');
    if(Date.now()-item.sentAt<60000)throw new DataError('RATE_LIMIT','Խնդրում ենք սպասել։');item.sentAt=Date.now();return {status:'challenge',requestId:item.id,stage:item.stage};
  },
  'settings.changeEmail': (state, data) => {
    const user = me(state);
    if (state.credentials[user.id] !== data.oldDigest) throw new DataError('UNAUTHORIZED', 'Սխալ գաղտնաբառ։');
    if (state.users.some(other => other.id !== user.id && other.email === data.email)) throw new DataError('CONFLICT', 'Տվյալ էլ․ փոստն արդեն գրանցված է։');
    state.challenges.filter(item=>item.userId===user.id&&item.purpose==='email-change').forEach(item=>item.consumed=true);
    const created=newChallenge(state,user.id,'email-change'),item=state.challenges.find(item=>item.id===created.challengeId);
    Object.assign(item,{email:data.email,newDigest:data.newDigest,stage:(state.settings[user.id]||defaults()).twoFactorEnabled?'OLD':'NEW'});
    return {status:'challenge',requestId:item.id,stage:item.stage,...created};
  },
  'settings.changePassword': (state, data) => { const user = me(state); if (state.credentials[user.id] !== data.oldDigest) throw new DataError('UNAUTHORIZED', 'Սխալ գաղտնաբառ։'); state.credentials[user.id] = data.newDigest; user.passwordChangedAt = now(); state.challenges.filter(item => item.userId === user.id).forEach(item => { item.consumed = true; }); return null; },
  'settings.deactivate': (state, data) => { const user = me(state); if (state.credentials[user.id] !== data.digest) throw new DataError('UNAUTHORIZED', 'Սխալ գաղտնաբառ։'); user.status = 'deactivated'; state.activity=state.activity.filter(item=>item.userId!==user.id&&item.actorId!==user.id); state.sessionUserId = null; return null; },
  'settings.deleteAccount': (state, data) => {
    const user = me(state), id = user.id;
    if (state.credentials[id] !== data.digest) throw new DataError('UNAUTHORIZED', 'Սխալ գաղտնաբառ։');
    state.activity=state.activity.filter(item=>item.userId!==id&&item.actorId!==id);
    const topicIds = state.topics.filter(item => item.userId === id).map(item => item.id);
    for (const key of ['education', 'certificates', 'media']) state[key] = state[key].filter(item => item.userId !== id);

    state.replies.forEach(item => { item.likes = item.likes.filter(userId => userId !== id); });
    state.messages.forEach(item=>{if(item.senderId===id){item.senderId=null;item.text='Message deleted';item.attachment=null;item.deleted=true;}});
    state.rooms.forEach(room=>{if(!room.participants.includes(id))return;if(room.isGroup){leaveMember(room,id);if(room.ownerId===id){room.ownerId=room.participants.filter(person=>state.users.find(u=>u.id===person)?.status==='active').sort(compareUserIds)[0]||null;if(!room.ownerId)room.closed=true;}}else room.closed=true;delete room.preferences[id];});
    state.rooms = state.rooms.filter(room => room.participants.length);
    state.blocks = state.blocks.filter(item => item.userId !== id && item.targetId !== id);
    state.challenges = state.challenges.filter(item => item.userId !== id);
    delete user.registryClaim; delete user.enrollment;
    Object.assign(user,{status:'deleted',name:'Deleted account',firstName:'Deleted',lastName:'account',email:`deleted-${id}@deleted.invalid`,avatar:'',cover:'',description:''}); delete state.credentials[id]; delete state.settings[id]; state.forumRequests=(state.forumRequests||[]).filter(item=>item.user!==id); state.sessionUserId = null;
    return null;
  },
  'settings.export': (state,data) => {
    const user = me(state), id = user.id;if(state.credentials[id]!==data.digest)throw new DataError('UNAUTHORIZED','Սխալ գաղտնաբառ։');
    return { exportedAt: now(), user: profile(state, user), settings: state.settings[id], posts: state.posts.filter(item => item.userId === id), comments: state.comments.filter(item => item.userId === id), topics: state.topics.filter(item => item.userId === id), replies: state.replies.filter(item => item.userId === id).map(({ likes, ...item }) => item), messages: state.messages.filter(item => item.senderId === id&&state.rooms.some(room=>room.id===item.roomId&&room.participants.includes(id)&&visibleMessages(state,room,id).some(m=>m.id===item.id))) };
  },
};

export function createMockProvider() {
  const listeners = new Set();
  const urls = new Map();
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('polylink-mock-updates') : null;
  const notify = event => listeners.forEach(listener => listener(event));
  if (channel) channel.onmessage = event => notify(event.data);
  window.addEventListener('pagehide', event => { if (event.persisted) return; for (const url of urls.values()) URL.revokeObjectURL(url); channel?.close(); });
  async function hydrate(result) {
    const media = await transaction(state => state.media);
    function walk(value) {
      if (typeof value === 'string' && value.startsWith('media:')) {
        const id = value.slice(6), item = media.find(item => item.id === id);
        if (!item) return '';
        if (!urls.has(id)) urls.set(id, URL.createObjectURL(item.blob));
        return urls.get(id);
      }
      if (Array.isArray(value)) return value.map(walk);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, value]) => [key, walk(value)]));
      return value;
    }
    return walk(result);
  }
  async function call(operation, ...args) {
    if(operation==='chat.release'){for(const url of urls.values())URL.revokeObjectURL(url);urls.clear();return null;}
    if(['auth.logout','chat.hide'].includes(operation)){for(const url of urls.values())URL.revokeObjectURL(url);urls.clear();}
    if (!operations[operation]) throw new DataError('UNSUPPORTED', 'Այս գործողությունը հասանելի չէ։');
    const scenario = await transaction(state => {
      upgradeChatState(state); upgradeForumState(state); upgradePostsState(state);
      const failure = state.scenario.failures[operation];
      delete state.scenario.failures[operation];
      return { latency: state.scenario.latency, failure };
    }, { write: true });
    if (scenario.latency) await new Promise(resolve => setTimeout(resolve, scenario.latency));
    if (scenario.failure) throw new DataError(scenario.failure.code, scenario.failure.message, {}, true);
    // Hashing is outside IndexedDB transactions; no production credentials enter mock fixtures.
    if (['auth.register', 'auth.login'].includes(operation)) {
      const data = { ...args[0], email: email(args[0].email) };
      if (operation === 'auth.register') password(data.password);
      data.digest = await digest(data.email, data.password); delete data.password; args = [data];
    }
    if (operation === 'auth.forgotPassword') args = [email(args[0])];
    if (operation === 'auth.resetPassword') {
      const item = await transaction(state => challenge(state, args[0].recoveryToken, 'recovery'));
      const address = await transaction(state => find(state.users, item.userId).email);
      args = [{ recoveryToken: args[0].recoveryToken, digest: await digest(address, password(args[0].newPassword)) }];
    }
    if (['settings.changeEmail', 'settings.changePassword', 'settings.deactivate', 'settings.deleteAccount','settings.setEmailFactor','settings.export'].includes(operation)) {
      const user = await transaction(state => me(state)), data = args[0];
      if (operation === 'settings.changeEmail') {
        const address = universityEmail(data.email); args = [{ email: address, oldDigest: await digest(user.email, data.password), newDigest: await digest(address, data.password) }];
      } else if (operation === 'settings.changePassword') args = [{ oldDigest: await digest(user.email, data.oldPassword), newDigest: await digest(user.email, password(data.newPassword)) }];
      else args = [{ ...data,digest: await digest(user.email, data.password) }];
    }
    if(operation==='chat.send'&&args[1]?.file){const file=validateImage(args[1].file);await validateImageBytes(new Uint8Array(await file.arrayBuffer()),file.type);}
    const write = !readOperations.has(operation) || ['posts.list','posts.comments.list','notifications.history'].includes(operation);
    const result = await transaction(state => {
      for(const room of state.rooms)if(room.isGroup&&!room.ownerId&&!room.closed){room.ownerId=[...room.participants].sort(compareUserIds)[0];room.membershipVersion||='1';room.metadataVersion||='1';}
      if (!publicOperations.has(operation)) me(state);
      return operations[operation](state, ...args);
    }, { write });
    if (result instanceof DataError) throw result;
    if (write) { const event = { operation, at: now() }; notify(event); channel?.postMessage(event); }
    if (operation === 'settings.export') {
      const media = await transaction(state => state.media.filter(item => item.userId === me(state).id&&(result.messages.some(message=>message.attachment?.url===`media:${item.id}`)||!state.messages.some(message=>message.attachment?.url===`media:${item.id}`))));
      const assets = await Promise.all(media.map(item => new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve({ id: item.id, type: item.blob.type, dataUrl: reader.result }); reader.onerror = () => reject(new DataError('STORAGE', 'Չհաջողվեց արտահանել պատկերները։')); reader.readAsDataURL(item.blob);
      })));
      const {zip}=await import('../../account-export.js');
      const files=assets.map((asset,index)=>[`files/asset-${index+1}`,Uint8Array.from(atob(asset.dataUrl.split(',')[1]),c=>c.charCodeAt(0))]);
      return zip([['data.json',JSON.stringify(result,null,2)],['manifest.json',JSON.stringify({version:1,exportedAt:now(),unavailable:[],files:assets.map((asset,index)=>({id:asset.id,path:`files/asset-${index+1}`,type:asset.type}))},null,2)],...files]);
    }
    return hydrate(result);
  }
  return {
    call,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    controls: {
      async reset() { for (const url of urls.values()) URL.revokeObjectURL(url); urls.clear(); await transaction(() => null, { reset: true }); notify({ operation: 'reset' }); channel?.postMessage({ operation: 'reset' }); },
      async latency(milliseconds) { if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > 30000) throw new DataError('VALIDATION', 'Delay must be between 0 and 30000 ms'); await transaction(state => { state.scenario.latency = milliseconds; }, { write: true }); },
      async failNext(operation, code = 'SERVICE_ERROR', message = 'Ցուցադրական սխալ։ Կրկին փորձեք։') { if (!operations[operation]) throw new DataError('VALIDATION', 'Unknown operation'); await transaction(state => { state.scenario.failures[operation] = { code, message }; }, { write: true }); },
      async clearScenarios() { await transaction(state => { state.scenario = { latency: 0, failures: {} }; }, { write: true }); },
      async incoming(roomId, text) {
        const result = await transaction(state => {
          upgradeChatState(state); upgradeForumState(state); upgradePostsState(state);const room = roomForUser(state, roomId), own = me(state).id;
          const senderId = room.participants.find(id => id !== own);
          if (!senderId) throw new DataError('VALIDATION', 'No other participant');
          if (!room.isGroup&&(isBlocked(state, own, senderId) || isBlocked(state, senderId, own))) throw new DataError('FORBIDDEN', 'Օգտատերը արգելափակված է։');
          const message = { id: nextId(state, 'message'), roomId: room.id, senderId, text: required(text, 'text', 5000), createdAt: now(), attachment: null };
          appendMessage(state,room,message);return messageView(state,message);
        }, { write: true });
        notify({ operation: 'chat.incoming' }); channel?.postMessage({ operation: 'chat.incoming' }); return result;
      },
      operations: Object.keys(operations),
    },
  };
}
