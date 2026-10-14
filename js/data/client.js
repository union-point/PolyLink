import { config } from '../config.js';
import { normalizeError, DataError } from './errors.js';

let providerPromise;
async function provider() {
  if (!providerPromise) {
    providerPromise = (async () => {
      if (config.dataMode === 'mock') return (await import('./mock/provider.js')).createMockProvider();
      if (config.dataMode === 'http') return (await import('./http/provider.js')).createHttpProvider();
      throw new DataError('CONFIGURATION', 'Invalid dataMode; choose mock or http.');
    })().catch(error => { providerPromise = null; throw error; });
  }
  return providerPromise;
}

export async function call(operation, ...args) {
  try { return await (await provider()).call(operation, ...args); }
  catch (error) { throw normalizeError(error); }
}
export async function subscribe(listener) { return (await provider()).subscribe(listener); }
export async function mockControls() {
  const controls = (await provider()).controls;
  if (!controls) throw new DataError('UNSUPPORTED', 'Demo controls are available only in mock mode.');
  return controls;
}
