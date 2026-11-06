import { createAdminClient } from './client.js';
const client = createAdminClient();
const mode = document.body.dataset.adminMode;
const purpose = mode === 'register' ? 'registration' : 'login';
const credentials = document.getElementById('credentials'), verification = document.getElementById('verification'), success = document.getElementById('success');
const message = document.getElementById('message'), resend = document.getElementById('resend');
const key = `polylink.admin.${purpose}.challenge`;
let token = new URLSearchParams(location.hash.slice(1)).get('invite') || '';
// The invitation never enters a query string, persistent storage or a member client.
history.replaceState(null, '', location.pathname);
let pending, busy = false;
function notice(text, error = false) { message.textContent = text; message.className = error ? 'error' : ''; }
function savePending(value) { pending = value; try { value ? sessionStorage.setItem(key, JSON.stringify(value)) : sessionStorage.removeItem(key); } catch {} }
function showPending(value) { savePending(value); credentials.hidden = true; verification.hidden = false; success.hidden = true; document.getElementById('code').focus(); }
function signedIn(admin) { savePending(null); credentials.reset(); verification.reset(); credentials.hidden = verification.hidden = true; success.hidden = false; document.getElementById('account').textContent = `${admin.firstName} ${admin.lastName} · ${admin.email}`; document.getElementById('logout').hidden = false; notice('Մուտքը հաստատված է։'); }
async function work(action) {
  if (busy) return;
  busy = true; document.querySelectorAll('button').forEach(button => button.disabled = true); notice('');
  try { await action(); } catch (error) { notice(error.message || 'Չհաջողվեց կատարել գործողությունը։', true); }
  finally { busy = false; document.querySelectorAll('button').forEach(button => button.disabled = false); }
}
credentials.addEventListener('submit', event => { event.preventDefault(); work(async () => {
  const data = new FormData(credentials);
  const result = mode === 'register'
    ? await client.register({ token, firstName: data.get('firstName'), lastName: data.get('lastName'), password: data.get('password'), confirmation: data.get('confirmation') })
    : await client.login(data.get('email'), data.get('password'));
  credentials.querySelectorAll('input[type=password]').forEach(input => input.value = ''); token = ''; showPending(result);
}); });
verification.addEventListener('submit', event => { event.preventDefault(); work(async () => {
  const result = await client.verify(purpose, pending.challengeId, document.getElementById('code').value.trim());
  if (mode === 'register') { savePending(null); verification.hidden = true; verification.reset(); success.hidden = false; notice('Գրանցումն ավարտված է։ Շարունակեք ադմինիստրատորի մուտքով։'); }
  else signedIn(result);
}); });
resend.addEventListener('click', () => work(async () => {
  const wait = Math.ceil((Date.parse(pending.resendAfter) - Date.now()) / 1000);
  if (wait > 0) throw new Error(`Կրկին փորձեք ${wait} վայրկյանից։`);
  savePending(await client.resend(purpose, pending.challengeId)); notice('Կոդը կրկին ուղարկված է։');
}));
document.getElementById('logout').addEventListener('click', () => work(async () => {
  try { await client.logout(); } catch (error) { if (error.code !== 'UNAUTHORIZED') throw error; }
  savePending(null); document.getElementById('account').textContent = ''; success.hidden = true; credentials.hidden = false; notice('Դուք դուրս եք եկել։');
}));
work(async () => {
  try { const saved = JSON.parse(sessionStorage.getItem(key)); if (saved?.challengeId && Date.parse(saved.expiresAt) > Date.now()) pending = saved; } catch {}
  if (mode === 'register' && token) { savePending(null); const invitation = await client.invitation(token); document.getElementById('email').value = invitation.email; credentials.hidden = false; return; }
  if (pending) { showPending(pending); return; }
  if (mode === 'register') throw new Error('Բացեք ադմինիստրատորի հրավերի հղումը։');
  try { signedIn(await client.session()); } catch (error) { if (error.code !== 'UNAUTHORIZED') throw error; }
});
