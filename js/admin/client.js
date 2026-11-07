import { adminTransport } from './transport.js';
import { derive, sodium, parameters } from '../crypto/sodium.js';
import { validatePassword } from '../auth/password-policy.js';
import { DataError } from '../data/errors.js';

export function adminRequest(path, data) {
  return adminTransport(`/auth${path}`, { method: data === undefined ? 'GET' : 'POST', data });
}
const invalid = () => new DataError('CONTRACT', 'The admin server returned an invalid response.');
function challenge(value) {
  if (value?.status !== 'challenge' || !/^[0-9a-f-]{36}$/i.test(value.challengeId) || !Number.isFinite(Date.parse(value.expiresAt)) || !Number.isFinite(Date.parse(value.resendAfter))) throw invalid();
  return { challengeId: value.challengeId, expiresAt: value.expiresAt, resendAfter: value.resendAfter };
}
function admin(value) {
  if (value?.role !== 'admin' || typeof value.id !== 'string' || !/^[1-9][0-9]*$/.test(value.id) || !['email', 'firstName', 'lastName'].every(key => typeof value[key] === 'string')) throw invalid();
  return Object.fromEntries(['id', 'email', 'firstName', 'lastName', 'role'].map(key => [key, value[key]]));
}
async function credential(password, settings) {
  parameters(settings);
  const derived = await derive(password, settings);
  try {
    const s = await sodium();
    return s.to_base64(derived.login, s.base64_variants.URLSAFE_NO_PADDING);
  } finally { derived.login.fill(0); derived.wrapping.fill(0); }
}
export function createAdminClient(request = adminRequest, deriveCredential = credential) {
  return {
    async invitation(token) {
      const result = await request('/registration/invitation', { token });
      if (typeof result?.email !== 'string' || !Number.isFinite(Date.parse(result.expiresAt))) throw invalid();
      return result;
    },
    async register({ token, firstName, lastName, password, confirmation }) {
      validatePassword(password);
      if (password !== confirmation) throw new DataError('VALIDATION', 'Գաղտնաբառերը չեն համընկնում։');
      if (![firstName, lastName].every(value => typeof value === 'string' && value.trim() && value.trim().length <= 100)) throw new DataError('VALIDATION', 'Մուտքագրեք անունը և ազգանունը։');
      const s = await sodium();
      const settings = { scheme: 'PLK1', salt: s.to_base64(s.randombytes_buf(16), s.base64_variants.URLSAFE_NO_PADDING), opsLimit: 3, memoryBytes: 67108864 };
      return challenge(await request('/registration/start', { token, firstName: firstName.trim(), lastName: lastName.trim(), loginSecret: await deriveCredential(password, settings), derivation: settings }));
    },
    async login(email, password) {
      if (typeof password !== 'string' || !password || password.length > 128) throw new DataError('VALIDATION', 'Մուտքագրեք գաղտնաբառը։');
      const address = email.trim().toLowerCase();
      const settings = parameters(await request('/parameters', { email: address }));
      return challenge(await request('/login', { scheme: 'PLK1', email: address, loginSecret: await deriveCredential(password, settings) }));
    },
    async verify(purpose, id, code) {
      if (!['registration', 'login'].includes(purpose) || !/^[0-9]{6}$/.test(code)) throw new DataError('VALIDATION', 'Մուտքագրեք վեցանիշ կոդը։');
      const result = await request(`/${purpose}/verify`, { challengeId: id, code });
      if (purpose === 'registration') { if (result?.status !== 'registered') throw invalid(); return result; }
      if (result?.status !== 'authenticated') throw invalid();
      return admin(result.admin);
    },
    async resend(purpose, id) {
      if (!['registration', 'login'].includes(purpose)) throw invalid();
      return challenge(await request(`/${purpose}/resend`, { challengeId: id }));
    },
    async session() { return admin(await request('/session')); },
    async refresh() { return admin(await request('/refresh', {})); },
    async logout() { await request('/logout', {}); },
  };
}
