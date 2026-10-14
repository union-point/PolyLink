import { Modal } from './profile-modal.js';
import { InlineEditor } from './profile-editor.js';
import { showAddEducationModal, addEducationEntry, showAddLicenseModal, showAddAnnouncementModal, addLicenseEntry, addAnnouncementEntry, handleBannerUpload, handleProfilePhotoUpload } from './profile-sections.js';
import { initializeKeyboardNavigation } from './profile-keyboard.js';
import { profiles, posts } from '../services/index.js';
import { start, bootstrap, stateMessage } from '../shared/ui.js';
import { safeUrl } from '../shared/content.js';

const chooser = new Modal();
start(async () => {
  const session = await bootstrap(); if (!session) return;
  const user = await profiles.get(session.id);
  document.querySelector('.name-title-section h1').textContent = user.name;
  document.querySelector('.job-title').textContent = user.jobTitle;
  document.querySelector('.desc p').textContent = user.description;
  document.querySelector('.profile-photo img').src = safeUrl(user.avatar || 'image/logo.png', { image: true });
  document.querySelector('.banner-photo').style.backgroundImage = `url("${safeUrl(user.cover, { image: true })}")`;
  const educationSection = document.querySelector('.education-section');
  educationSection.querySelectorAll('.item-entry').forEach(entry => entry.remove());
  user.education.forEach(addEducationEntry);
  educationSection.querySelector('.fa-plus').onclick = showAddEducationModal;
  const editor = new InlineEditor(); editor.onAdd = () => {
    const picker = document.createElement('div');
    const choices = [ ['Կրթություն', showAddEducationModal], ['Հավաստագիր', showAddLicenseModal], ['Հայտարարություն', showAddAnnouncementModal] ];
    choices.forEach(([name, action]) => { const button = document.createElement('button'); button.className = 'primary-btn'; button.textContent = name; button.style.margin = '8px'; button.onclick = () => { chooser.close(); action(); }; picker.appendChild(button); });
    chooser.create('Ավելացնել բաժին', picker, null);
  };
  const licenses = document.querySelector('.licenses-section');
  licenses.querySelectorAll('.item-entry').forEach(entry => entry.remove());
  user.licenses.forEach(addLicenseEntry);
  licenses.querySelector('.fa-plus').onclick = showAddLicenseModal;
  const announcements = document.querySelector('.announcements-section');
  announcements.querySelector('.fa-plus').onclick = showAddAnnouncementModal;
  async function loadAnnouncements() {
    announcements.querySelectorAll('.item-entry,[data-announcement-state]').forEach(entry => entry.remove());
    const status = document.createElement('div'); status.dataset.announcementState = ''; announcements.appendChild(status);
    stateMessage(status, 'Բեռնվում է...');
    try {
      const personalPosts = await posts.list({ userId: user.id });
      if (personalPosts.length) status.remove(); else stateMessage(status, 'Հայտարարություններ չկան');
      personalPosts.forEach(addAnnouncementEntry);
    } catch (error) { stateMessage(status, error.message, { retry: loadAnnouncements }); }
  }
  document.querySelector('.banner-edit-icon').onclick = handleBannerUpload;
  document.querySelector('.profile-photo-area > .profile-photo').onclick = handleProfilePhotoUpload;
  initializeKeyboardNavigation(editor);
  await loadAnnouncements();
});
