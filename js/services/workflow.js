import { config } from '../config.js';
import { DataError } from '../data/errors.js';

// Transient verification context belongs to the service boundary, not page scripts.
const key = `polylink.${config.dataMode}.workflow`;
export function loadWorkflow() {
  try { return JSON.parse(sessionStorage.getItem(key)) || {}; }
  catch { return {}; }
}
export function saveWorkflow(data) { sessionStorage.setItem(key, JSON.stringify(data)); }
export function clearWorkflow() { sessionStorage.removeItem(key); }
export function requireChallenge(purpose) {
  const data = loadWorkflow();
  if (data.purpose !== purpose || !data.challengeId || (data.expiresAt && data.expiresAt <= Date.now())) throw new DataError('VALIDATION', 'Նախ պահանջեք նոր վավերացման կոդ։');
  return data;
}
