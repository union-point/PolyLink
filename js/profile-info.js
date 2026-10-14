import { profiles } from './services/index.js';
import { start, bootstrap, pending, showError } from './shared/ui.js';
import { validateImage } from './data/validation.js';

const faculties = ['ՏՀՏԷ', 'ՄՄՏՀԴ', 'ԷԷ', 'ԼՔՏ', 'ԿՄ', 'ԻՔՏ'];
const departments = ['Ծրագրային ապահովման ամբիոն', 'Համակարգչային համակարգերի ամբիոն', 'Տեղեկատվական տեխնոլոգիաների ամբիոն', 'Արհեստական բանականության ամբիոն', 'Մաթեմատիկայի ամբիոն', 'Ֆիզիկայի ամբիոն'];
start(async () => {
  const user = await bootstrap({ requireOnboarding: false }); if (!user) return;
  const form = document.getElementById('profile-info-form');
  const role = document.getElementById('role');
  const select = document.getElementById('faculty');
  let preview;
  let image;
  function setRole(value) {
    role.value = value;
    const teacher = value === 'teacher';
    document.querySelectorAll('.role-btn').forEach(button => button.classList.toggle('active', button.dataset.role === value));
    document.getElementById('years-label').style.display = teacher ? 'none' : 'block';
    document.querySelector('.year-range-box').style.display = teacher ? 'none' : 'flex';
    document.getElementById('faculty-label').textContent = teacher ? 'Ամբիոն' : 'Ֆակուլտետ/Ինստիտուտ';
    ['year-start', 'year-end'].forEach(id => { document.getElementById(id).required = !teacher; });
    select.replaceChildren(...(teacher ? departments : faculties).map(value => new Option(value, value)));
  }
  document.querySelectorAll('.role-btn').forEach(button => {
    button.setAttribute('role', 'button'); button.tabIndex = 0;
    button.onclick = () => setRole(button.dataset.role);
    button.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); button.click(); } };
  });
  setRole(user.role === 'lecturer' ? 'teacher' : 'graduate');
  document.querySelector('.back-btn').onclick = () => { location.href = 'register.html'; };
  document.querySelector('.forward-btn').type = 'submit';
  const photo = document.getElementById('photo'), box = document.querySelector('.upload-box');
  box.setAttribute('role', 'button'); box.tabIndex = 0; box.setAttribute('aria-label', 'Ընտրել լուսանկար');
  box.onclick = () => photo.click();
  box.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); photo.click(); } };
  function previewPhoto(file) {
    try {
      validateImage(file); image = file;
      if (preview) URL.revokeObjectURL(preview); preview = URL.createObjectURL(file);
      const picture = document.createElement('img'); picture.className = 'preview-photo'; picture.src = preview; picture.alt = 'Լուսանկարի նախադիտում'; box.replaceChildren(picture);
    } catch (error) { showError(form, error); }
  }
  photo.onchange = () => { if (photo.files[0]) previewPhoto(photo.files[0]); };
  box.ondragover = event => event.preventDefault(); box.ondrop = event => { event.preventDefault(); if (event.dataTransfer.files[0]) previewPhoto(event.dataTransfer.files[0]); };
  window.addEventListener('pagehide', () => { if (preview) URL.revokeObjectURL(preview); }, { once: true });
  form.onsubmit = event => {
    event.preventDefault();
    pending(document.querySelector('.forward-btn'), form, async () => {
      // Upload first: a failed upload must not falsely complete onboarding.
      if (image) await profiles.upload('avatar', image);
      await profiles.onboard({ role: role.value, institute: role.value === 'graduate' ? select.value : '', department: role.value === 'teacher' ? select.value : '', specialization: document.getElementById('specialization').value.trim(), description: document.getElementById('bio').value, startYear: document.getElementById('year-start').value, endYear: document.getElementById('year-end').value });
      location.href = 'profile.html';
    });
  };
});
