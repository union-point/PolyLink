import { auth } from '../services/index.js';
import { authMessage } from './auth-messages.js';

// Only a normalized thumbnail crosses the service boundary; originals stay in the browser.
export function initializeAvatarUpload() {
  const input = document.getElementById('avatar-file');
  const zone = document.getElementById('avatar-dropzone');
  const preview = document.getElementById('avatar-preview');
  const remove = document.getElementById('remove-avatar');
  const status = document.getElementById('avatar-status');
  let busy = false;
  function render(url) {
    preview.src = url || './image/logo.png';
    remove.hidden = !url || url === 'image/logo.png';
    zone.querySelector('strong').textContent = remove.hidden ? 'Ավելացրեք Ձեր լուսանկարը' : 'Փոխել լուսանկարը';
  }
  function lock(value) {
    busy = value; input.disabled = value; remove.disabled = value;
    zone.setAttribute('aria-busy', String(value));
    document.querySelectorAll('#save-profile,#submit-profile').forEach(button => { button.disabled = value; });
  }
  async function upload(file) {
    if (busy || input.matches(':disabled') || !file) return;
    status.setAttribute('role', 'status');
    if (!['image/jpeg', 'image/png'].includes(file.type) || !file.size || file.size > 5 * 1024 * 1024) {
      status.setAttribute('role', 'alert'); status.textContent = 'Ընտրեք JPG կամ PNG պատկեր՝ առավելագույնը 5 ՄԲ չափով։'; input.value = ''; return;
    }
    lock(true); status.textContent = 'Լուսանկարը բեռնվում է…';
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
      if (bitmap.width > 8192 || bitmap.height > 8192) throw new Error('Image dimensions');
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff'; context.fillRect(0, 0, 256, 256);
      const side = Math.min(bitmap.width, bitmap.height);
      context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 256, 256);
      const content = canvas.toDataURL('image/jpeg', .85).split(',')[1];
      const result = await auth.uploadEnrollmentAvatar(content);
      render(result.url); status.textContent = 'Լուսանկարը պահպանված է։';
    } catch (error) {
      status.setAttribute('role', 'alert');
      status.textContent = error.code ? authMessage(error.message, error.code) : 'Չհաջողվեց բացել պատկերը։ Ընտրեք մեկ այլ JPG կամ PNG ֆայլ։';
    } finally { bitmap?.close(); input.value = ''; lock(false); }
  }
  input.onchange = () => upload(input.files[0]);
  for (const eventName of ['dragenter', 'dragover']) zone.addEventListener(eventName, event => {
    event.preventDefault(); if (!input.matches(':disabled')) zone.classList.add('drag-over');
  });
  zone.addEventListener('dragleave', event => { if (!zone.contains(event.relatedTarget)) zone.classList.remove('drag-over'); });
  zone.addEventListener('drop', event => {
    event.preventDefault(); zone.classList.remove('drag-over');
    if (event.dataTransfer.files.length !== 1) { status.textContent = 'Ընտրեք մեկ լուսանկար։'; return; }
    upload(event.dataTransfer.files[0]);
  });
  remove.onclick = async () => {
    if (busy) return;
    lock(true);
    try { await auth.removeEnrollmentAvatar(); render(''); status.textContent = 'Լուսանկարը հեռացված է։'; }
    catch (error) { status.setAttribute('role', 'alert'); status.textContent = authMessage(error.message, error.code); }
    finally { lock(false); }
  };
  return { render, get busy() { return busy; } };
}
