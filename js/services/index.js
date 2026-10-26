import { call, subscribe } from '../data/client.js';

// Feature services are provider-independent. Controllers only import this facade.
const operation = name => (...args) => call(name, ...args);
export const auth = {
  uploadEnrollmentAvatar:operation('auth.uploadEnrollmentAvatar'),removeEnrollmentAvatar:operation('auth.removeEnrollmentAvatar'),
  enrollment:operation('auth.enrollment'),enrollmentOptions:operation('auth.enrollmentOptions'),saveEnrollment:operation('auth.saveEnrollment'),submitEnrollment:operation('auth.submitEnrollment'),logoutEnrollment:operation('auth.logoutEnrollment'),
  me: operation('auth.me'), verifyEmail: operation('auth.verifyEmail'), login: operation('auth.login'), register: operation('auth.register'), logout: operation('auth.logout'),
  verifySecondFactor: operation('auth.verifySecondFactor'), resendChallenge: operation('auth.resendChallenge'),
  recoveryStatus: operation('auth.recoveryStatus'), forgotPassword: operation('auth.forgotPassword'), verifyRecovery: operation('auth.verifyRecovery'), resetPassword: operation('auth.resetPassword'),
  subscribeSession: listener => subscribe(event => {
    if (['auth.logout', 'auth.login', 'auth.version', 'auth.revoked', 'auth.verifySecondFactor', 'auth.resetPassword', 'settings.deactivate', 'settings.deleteAccount', 'reset'].includes(event.operation)) {
      call('auth.me').then(user => listener(user, null, event)).catch(error => listener(null, error, event));
    }
  }),
};
export const profiles = {
  get: operation('profiles.get'), update: operation('profiles.update'), onboard: operation('profiles.onboard'), upload: operation('profiles.upload'),
  education: { list: operation('profiles.education.list'), create: operation('profiles.education.create'), update: operation('profiles.education.update'), delete: operation('profiles.education.delete') },
  certificates: { list: operation('profiles.certificates.list'), create: operation('profiles.certificates.create'), update: operation('profiles.certificates.update'), delete: operation('profiles.certificates.delete') },
};
export const posts = {
  list: operation('posts.list'), create: operation('posts.create'), update: operation('posts.update'), delete: operation('posts.delete'),
  comments: { list: operation('posts.comments.list'), create: operation('posts.comments.create'), update: operation('posts.comments.update'), delete: operation('posts.comments.delete') },
};
export const forum = {
  categories: operation('forum.categories'),
  list: operation('forum.list'), get: operation('forum.get'), create: operation('forum.create'), update: operation('forum.update'), delete: operation('forum.delete'),
  replies: { get: operation('forum.replies.get'), update: operation('forum.replies.update'), delete: operation('forum.replies.delete'), list: operation('forum.replies.list'), create: operation('forum.replies.create'), like: operation('forum.replies.like') },
};
export const search = { people: operation('search.people'), page: operation('search.page'), filters: operation('search.filters') };
export const chat = {
  saveDraft:operation('chat.saveDraft'),loadDraft:operation('chat.loadDraft'),
  createGroup:operation('chat.createGroup'), participants:operation('chat.participants'), addParticipant:operation('chat.addParticipant'), removeParticipant:operation('chat.removeParticipant'), leaveGroup:operation('chat.leaveGroup'), renameGroup:operation('chat.renameGroup'), transferOwner:operation('chat.transferOwner'),
  page: operation('chat.page'), release: operation('chat.release'), list: operation('chat.list'), openDirect: operation('chat.openDirect'), messages: operation('chat.messages'), send: operation('chat.send'),
  read: operation('chat.read'), mute: operation('chat.mute'), hide: operation('chat.hide'), block: operation('chat.block'), subscribe,
};
export const settings = {
  verifyEmailChange:operation('settings.verifyEmailChange'),resendEmailChange:operation('settings.resendEmailChange'),setEmailFactor:operation('settings.setEmailFactor'),
  get: operation('settings.get'), update: operation('settings.update'), changeEmail: operation('settings.changeEmail'), changePassword: operation('settings.changePassword'),
  deactivate: operation('settings.deactivate'), deleteAccount: operation('settings.deleteAccount'), export: operation('settings.export'),
};

export const notifications = { list:operation('notifications.list') };
