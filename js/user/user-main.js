import { profiles, posts, chat } from '../services/index.js';
import { selectedUserId } from '../services/navigation.js';
import { educationEntry, certificateEntry, announcementEntry } from '../profile/profile-render.js';
import { bootstrap, start, stateMessage, pending } from '../shared/ui.js';
import { safeUrl } from '../shared/content.js';

start(async () => {
  const currentUser = await bootstrap(); if (!currentUser) return;
  const main = document.querySelector('.main-content');
  const id = selectedUserId();
  if (!id) { stateMessage(main, 'Ընտրեք օգտատիրոջը որոնման էջից։'); return; }
  let user;
  try { user = await profiles.get(id); }
  catch (error) { stateMessage(main, error.message, { retry: () => location.reload() }); return; }
  document.title = `${user.name} | PolyLink`;
  main.querySelector('.fullname').textContent = user.name;
  main.querySelector('.job-title').textContent = user.jobTitle;
  main.querySelector('.desc p').textContent = user.description;
  if (user.email) {
    const address = document.createElement('a');
    address.href = `mailto:${encodeURIComponent(user.email)}`;
    address.textContent = user.email;
    main.querySelector('.desc').appendChild(address);
  }
  const avatar = document.createElement('img'); avatar.className = 'profile-photo'; avatar.src = safeUrl(user.avatar || 'image/logo.png', { image: true }); avatar.alt = user.name;
  document.querySelector('.profile-photo-area > .profile-photo').replaceChildren(avatar);
  document.querySelector('.banner-photo').style.backgroundImage = `url("${safeUrl(user.cover, { image: true })}")`;
  main.querySelector('.education-list').replaceChildren(...user.education.map(record => educationEntry(record)));
  main.querySelector('.licenses-list').replaceChildren(...user.licenses.map(record => certificateEntry(record)));
  const list = main.querySelector('.announcements-list');
  async function load() {
    stateMessage(list, 'Բեռնվում է...');
    try { const records = await posts.list({ userId: id }); list.replaceChildren(...records.map(record => announcementEntry(record))); if (!records.length) stateMessage(list, 'Հայտարարություններ չկան'); }
    catch (error) { stateMessage(list, error.message, { retry: load }); }
  }
  const contact = main.querySelector('.primary-btn');
  contact.disabled = user.id === currentUser.id;
  contact.onclick = () => pending(contact, main.querySelector('.intro-card'), async () => { const room = await chat.openDirect(user.id); location.href = `message.html?room=${encodeURIComponent(room.id)}`; });
  await load();
});
