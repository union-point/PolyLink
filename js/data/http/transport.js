import { config } from '../../config.js';
import { DataError } from '../errors.js';

const tokenKey = 'polylink.http.accessToken';
let axiosPromise;
function loadAxios() {
  if (window.axios) return Promise.resolve(window.axios);
  if (!axiosPromise) axiosPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = config.axiosUrl;
    script.onload = () => window.axios ? resolve(window.axios) : reject(new DataError('NETWORK', 'Axios could not be loaded.'));
    script.onerror = () => { axiosPromise = null; script.remove(); reject(new DataError('NETWORK', 'Չհաջողվեց բեռնել HTTP գործիքները։', {}, true)); };
    document.head.appendChild(script);
  });
  return axiosPromise;
}

// Optional Axios injection makes manual stub verification possible without a server.
export function createTransport(axios) {
  const api = axios.create({ baseURL: config.apiBaseUrl, withCredentials: true, timeout: 15000 });
  let refreshing;
  const noRefresh = /^\/auth\/(login|register|refresh|forgot-password|verify-code|reset-password)(?:$|\?)/;
  api.interceptors.request.use(request => {
    const token = localStorage.getItem(tokenKey);
    if (token) { request.headers ||= {}; request.headers.Authorization = `Bearer ${token}`; }
    return request;
  });
  api.interceptors.response.use(response => response, async error => {
    const request = error.config;
    if (error.response?.status !== 401 || !request || request._retried || noRefresh.test(request.url)) throw error;
    request._retried = true;
    if (!refreshing) refreshing = axios.post(`${config.apiBaseUrl}/auth/refresh`, {}, { withCredentials: true, timeout: 15000 })
      .then(response => {
        const token = response.data?.accessToken;
        if (!token) throw new DataError('CONTRACT', 'Refresh response is missing accessToken.');
        localStorage.setItem(tokenKey, token);
        return token;
      }).catch(error => { localStorage.removeItem(tokenKey); throw error; })
      .finally(() => { refreshing = null; });
    const token = await refreshing;
    request.headers ||= {}; request.headers.Authorization = `Bearer ${token}`;
    return api(request);
  });
  return {
    request: request => api(request).then(response => response.data),
    setToken: token => token ? localStorage.setItem(tokenKey, token) : localStorage.removeItem(tokenKey),
  };
}
export async function loadTransport() { return createTransport(await loadAxios()); }
