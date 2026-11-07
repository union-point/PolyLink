import { startAdminPage } from './management.js';

startAdminPage({
  page: 'academic',
  title: 'Ակադեմիական տվյալներ',
  description: 'Կառավարեք համալսարանները, ինստիտուտները, ամբիոնները, մասնագիտությունները, որակավորումները և աստիճանները։',
  area: 'references',
  kinds: ['universities', 'institutes', 'departments', 'specializations', 'professions', 'degrees'],
});
