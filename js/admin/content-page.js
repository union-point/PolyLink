import { startAdminPage } from './management.js';

startAdminPage({
  page: 'content',
  title: 'Հրապարակումների և ֆորումի տվյալներ',
  description: 'Կառավարեք հայտարարությունների տեսակները, ուղղությունները և ֆորումի բաժինները։',
  area: 'references',
  kinds: ['post-types', 'post-spheres', 'forum-categories'],
});
