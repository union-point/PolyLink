import { InlineEditor } from './profile-editor.js';
import { showAddEducationModal, addEducationEntry, showAddLicenseModal, showAddAnnouncementModal, attachLicenseHandlers, attachAnnouncementHandlers, handleBannerUpload, handleProfilePhotoUpload } from './profile-sections.js';
import { initializeKeyboardNavigation } from './profile-keyboard.js';
import { profiles } from '../services/index.js';
import { start, bootstrap } from '../shared/ui.js';
import { safeUrl } from '../shared/content.js';

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
  const editor = new InlineEditor(); editor.onAdd = showAddEducationModal;
  // Certificates/announcements keep their existing UI until the next focused migration.
  document.querySelectorAll('.licenses-section').forEach(section => {
    section.querySelector('.fa-plus').onclick = showAddLicenseModal;
    section.querySelectorAll('.item-entry').forEach(entry => attachLicenseHandlers(entry, {
      name: entry.querySelector('.item-title').textContent, organization: entry.querySelector('.item-subtitle').textContent, issueDate: '', credentialUrl: '',
    }));
  });
  const announcements = document.querySelector('.announcements-section');
  announcements.querySelector('.fa-plus').onclick = showAddAnnouncementModal;
  announcements.querySelectorAll('.item-entry').forEach(attachAnnouncementHandlers);
  document.querySelector('.banner-edit-icon').onclick = handleBannerUpload;
  document.querySelector('.profile-photo-area > .profile-photo').onclick = handleProfilePhotoUpload;
  initializeKeyboardNavigation(editor);
});
