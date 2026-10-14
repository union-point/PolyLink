import { DataError } from './errors.js';
import { categories, majors } from './models.js';
import { plainText, sanitizeHtml } from '../shared/content.js';

export function required(value, field, max = 1000) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max) throw new DataError('VALIDATION', 'Խնդրում ենք ստուգել լրացված դաշտերը։', { [field]: `Պարտադիր դաշտ (առավելագույնը ${max} նիշ)` });
  return text;
}
export function email(value) {
  const text = required(value, 'email', 255).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) throw new DataError('VALIDATION', 'Անվավեր էլ․ հասցե։', { email: 'Անվավեր էլ․ հասցե' });
  return text;
}
export function password(value) {
  const text = String(value ?? '');
  if (!text || text.length > 128) throw new DataError('VALIDATION', 'Խնդրում ենք ստուգել գաղտնաբառը։', { password: 'Պարտադիր դաշտ (առավելագույնը 128 նիշ)' });
  if (text.length < 8 || !/[A-Z]/.test(text) || !/\d/.test(text) || !/[^\w\s]/.test(text)) throw new DataError('VALIDATION', 'Գաղտնաբառը պետք է պարունակի առնվազն 8 նիշ, մեծատառ, թիվ և հատուկ նիշ։', { password: 'Թույլ գաղտնաբառ' });
  return text;
}
export function month(value, field, optional = false) {
  if (optional && !value) return null;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(value))) throw new DataError('VALIDATION', 'Անվավեր ամսաթիվ։', { [field]: 'Օգտագործեք ՏՏՏՏ-ԱԱ ձևաչափը' });
  return value;
}
export function validateEducation(data) {
  const record = { institution: required(data.institution, 'institution', 255), degree: required(data.degree, 'degree', 255),
    startDate: month(data.startDate, 'startDate'), endDate: month(data.endDate, 'endDate', true),
    institute: String(data.institute || ''), specialization: String(data.specialization || ''), logo: data.logo || '' };
  if (record.endDate && record.startDate > record.endDate) throw new DataError('VALIDATION', 'Ավարտը չի կարող լինել սկզբից առաջ։', { endDate: 'Ստուգեք ժամանակահատվածը' });
  return record;
}
export function validateCertificate(data) {
  const url = String(data.credentialUrl || '').trim();
  if (url && !/^https?:\/\//i.test(url)) throw new DataError('VALIDATION', 'Անվավեր հավաստագրի հղում։', { credentialUrl: 'Հղումը պետք է սկսվի https:// կամ http://' });
  return { name: required(data.name, 'name', 255), organization: String(data.organization || ''), issueDate: month(data.issueDate, 'issueDate', true), credentialUrl: url, logo: data.logo || '' };
}
export function richContent(value) {
  const content = sanitizeHtml(value);
  required(plainText(content), 'content', 20000);
  return content;
}
export function validatePost(data) {
  if (!Object.hasOwn(categories, data.category)) throw new DataError('VALIDATION', 'Ընտրեք կատեգորիան։', { category: 'Անվավեր կատեգորիա' });
  return { title: required(data.title, 'title', 255), content: richContent(data.content), category: data.category, sphere: String(data.sphere || '') };
}
export function validateTopic(data) {
  if (!Object.hasOwn(majors, data.major)) throw new DataError('VALIDATION', 'Ընտրեք մասնագիտությունը։', { major: 'Անվավեր մասնագիտություն' });
  return { title: required(data.title, 'title', 255), content: richContent(data.content), major: data.major };
}
export function validateImage(file) {
  if (!(file instanceof Blob) || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || !file.size || file.size > 5 * 1024 * 1024) {
    throw new DataError('VALIDATION', 'Ընտրեք PNG, JPEG, WebP կամ GIF պատկեր (առավելագույնը 5 ՄԲ)։');
  }
  return file;
}
