import { config } from '../config.js';
import { DataError } from '../data/errors.js';

// Transient verification context belongs to the service boundary, not page scripts.
const key = `polylink.${config.dataMode}.workflow`;
export function loadWorkflow() {
  try { return JSON.parse(sessionStorage.getItem(key)) || {}; }
  catch { return {}; }
}
export function saveWorkflow(data) {
  try { sessionStorage.setItem(key, JSON.stringify(data)); }
  catch { throw new DataError('STORAGE_UNAVAILABLE', 'Կոդի հաստատումը շարունակելու համար թույլատրեք տվյալների պահպանումն այս դիտարկիչում։'); }
}
export function clearWorkflow() { try { sessionStorage.removeItem(key); } catch {} }
export function requireChallenge(purpose) {
  const data = loadWorkflow();
  if (data.purpose !== purpose || !data.challengeId || (data.expiresAt && (typeof data.expiresAt==='string'?Date.parse(data.expiresAt):data.expiresAt) <= Date.now())) throw new DataError('VALIDATION', 'Նախ պահանջեք նոր վավերացման կոդ։');
  return data;
}
export function rememberChallenge(purpose, result, address) {
  if (!result?.challengeId) throw new DataError('CONTRACT', 'Verification response is missing challengeId.');
  const data = { ...result, purpose, email: address, resendAt: Date.now() + (typeof result.resendAfter==='string'?Math.max(0,(Date.parse(result.resendAfter)-Date.now())/1000):(result.resendAfter ?? 60)) * 1000 };
  saveWorkflow(data);
  return data;
}
