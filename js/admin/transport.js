import { config } from '../config.js';
import { DataError } from '../data/errors.js';
const cookie = name => globalThis.document?.cookie.split('; ').find(value => value.startsWith(name + '='))?.slice(name.length + 1) || '';
export async function adminTransport(path, { method = 'GET', data } = {}) {
  if (config.dataMode === 'mock') return (await import('./mock.js')).mockAdminRequest(path, { method, data });
  const challenge = /^\/auth\/(registration|login)\//.test(path);
  const csrf = cookie(challenge ? '__Host-plk-admin-challenge-csrf' : '__Host-plk-admin-csrf');
  let response;
  try {
    response = await fetch(`${config.apiBaseUrl}/admin${path}`, {
      method, credentials: 'include', cache: 'no-store',
      headers: { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
      body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(15000),
    });
  } catch { throw new DataError('NETWORK', 'Սերվերը հասանելի չէ։ Կրկին փորձեք։'); }
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new DataError(body?.code || 'SERVICE_ERROR', body?.message || 'Չհաջողվեց կատարել գործողությունը։', body?.fieldErrors || {});
  return body;
}
