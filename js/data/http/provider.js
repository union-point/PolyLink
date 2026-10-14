import { loadTransport } from './transport.js';
import { routes } from './routes.js';
import { DataError } from '../errors.js';
import { unwrap, list, normalizeUser, normalizePost, normalizeComment, normalizeEducation, normalizeCertificate, normalizeTopic } from './normalize.js';

export function createHttpProvider(transportPromise = loadTransport()) {
  // Prevent an unhandled rejection when a CDN fails before the first operation.
  const transport = Promise.resolve(transportPromise); transport.catch(() => {});
  return {
    async call(operation, ...args) {
      if (!routes[operation]) throw new DataError('UNSUPPORTED', 'Այս գործառույթի backend պայմանագիրը դեռ սահմանված չէ։');
      const api = await transport;
      let body;
      try { body = unwrap(await api.request(routes[operation](...args))); }
      catch (error) { if (operation === 'auth.me' && error?.response?.status === 401) return null; throw error; }
      if (operation === 'auth.logout') { api.setToken(null); return null; }
      if (operation === 'auth.login') {
        if (body?.challengeId) return { status: 'challenge', challengeId: body.challengeId, expiresAt: body.expiresAt, resendAfter: body.resendAfter };
        if (!body?.accessToken) throw new DataError('CONTRACT', 'Login response is missing accessToken.');
        api.setToken(body.accessToken);
        return { status: 'authenticated', user: normalizeUser(body.user || unwrap(await api.request(routes['auth.me']()))) };
      }
      if (operation === 'profiles.upload' && !(body?.id ?? body?.UserId)) {
        if (typeof body?.url !== 'string' || !body.url) throw new DataError('CONTRACT', 'API պատասխանը չի պարունակում լուսանկարի հասցեն։');
        const user = normalizeUser(unwrap(await api.request(routes['auth.me']())));
        if (!user) throw new DataError('UNAUTHORIZED', 'Նախ մուտք գործեք։');
        return { ...user, [args[0] === 'avatar' ? 'avatar' : 'cover']: body.url };
      }
      if (operation === 'auth.me' || operation.startsWith('profiles.') && ['get', 'update', 'onboard', 'upload'].includes(operation.split('.')[1])) {
        if (body == null && operation !== 'auth.me') throw new DataError('CONTRACT', 'API պատասխանը չի պարունակում պրոֆիլը։');
        return normalizeUser(body);
      }
      if (operation === 'auth.register') return body;
      if (operation.endsWith('.delete')) return null;
      if (operation === 'posts.list') return list(body, normalizePost).filter(post => (!args[0]?.category || post.category === args[0].category) && (!args[0]?.sphere || post.sphere === args[0].sphere));
      if (operation === 'posts.create' || operation === 'posts.update') return normalizePost(body);
      if (operation === 'posts.comments.list') return list(body, normalizeComment);
      if (operation.startsWith('posts.comments.')) return normalizeComment(body);
      if (operation.startsWith('profiles.education.')) return operation.endsWith('.list') ? list(body, normalizeEducation) : normalizeEducation(body);
      if (operation.startsWith('profiles.certificates.')) return operation.endsWith('.list') ? list(body, normalizeCertificate) : normalizeCertificate(body);
      if (operation === 'forum.list') return list(body, normalizeTopic).filter(topic => !args[0]?.major || topic.major === args[0].major);
      if (operation.startsWith('forum.')) return normalizeTopic(body);
      if (operation === 'search.people') return list(body, normalizeUser).filter(user => (!args[0]?.institute || user.institute === args[0].institute) && (!args[0]?.specialization || user.specialization === args[0].specialization) && (!args[0]?.year || user.graduationYear === String(args[0].year)));
      return body;
    },
    subscribe() { return () => {}; }, // Real-time protocol awaits a backend contract.
  };
}
