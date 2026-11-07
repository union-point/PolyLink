import { startAdminPage } from './management.js';

startAdminPage({
  page: 'registry',
  title: 'Ռեեստրի գրառումներ',
  description: 'Դասախոսների և շրջանավարտների տվյալների ձեռքով կառավարում։',
  area: 'registries',
  kinds: ['lecturers', 'alumni'],
});
