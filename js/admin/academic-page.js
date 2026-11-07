import { startAdminPage } from './management.js';

startAdminPage({
  page: 'academic',
  title: 'Ակադեմիական տվյալներ',
  description: 'Կառավարեք համալսարանները, ինստիտուտները, ամբիոնները, մասնագիտությունները, մասնագիտական ուղղությունները և կրթական աստիճանները։',
  area: 'references',
  kinds: ['universities', 'institutes', 'departments', 'specializations', 'professions', 'degrees'],
});
