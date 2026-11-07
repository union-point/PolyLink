import { startAdminPage } from './management.js';

startAdminPage({
  page: 'content',
  title: 'Հրապարակումների և ֆորումի տվյալներ',
  description: 'Կառավարեք հրապարակումների տեսակները, ոլորտները և ֆորումի բաժինները։',
  area: 'references',
  kinds: ['post-types', 'post-spheres', 'forum-categories'],
});
