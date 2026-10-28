import { sanitizeHtml } from '../shared/content.js';
import { DataError } from '../data/errors.js';
const elements = new Set(['P','BR','B','STRONG','I','EM','A']);
export function sanitizePostHtml(value) {
  const doc = new DOMParser().parseFromString(String(value ?? ''), 'text/html');
  for (const node of doc.querySelectorAll('div')) { const p = doc.createElement('p'); p.append(...node.childNodes); node.replaceWith(p); }
  for (const link of doc.querySelectorAll('a')) if (!/^(https?:\/\/|mailto:)/i.test(link.getAttribute('href') || '')) link.removeAttribute('href');
  return sanitizeHtml(doc.body.innerHTML, { elements });
}
// Exactly the server's sanitized paragraph/br counting: UTF-16 units, one newline per paragraph.
export function postPlainText(html) {
  const doc = new DOMParser().parseFromString(sanitizePostHtml(html), 'text/html');
  for (const br of doc.querySelectorAll('br')) br.replaceWith('\n');
  for (const p of doc.querySelectorAll('p')) p.append('\n');
  return doc.body.textContent.replace(/\u00a0/g, ' ').trim();
}
export function validatePostInput(value) {
  const errors = {};
  const title = typeof value.title === 'string' ? value.title.trim() : '';
  if (!title || title.length > 255) errors.title = 'Վերնագիրը պետք է պարունակի 1–255 նիշ։';
  const raw = typeof value.content === 'string' ? value.content : '';
  const content = sanitizePostHtml(raw), text = postPlainText(content);
  if (raw.length > 100000 || !text || text.length > 20000) errors.content = 'Բովանդակությունը պետք է պարունակի 1–20000 նիշ։';
  if (!['job','internship','training'].includes(value.category)) errors.category = 'Ընտրեք տեսակը։';
  if (typeof value.sphereId !== 'string' || !/^[1-9][0-9]{0,9}$/.test(value.sphereId)) errors.sphereId = 'Ընտրեք ուղղությունը։';
  if (Object.keys(errors).length) throw new DataError('VALIDATION','Ստուգեք լրացված դաշտերը։',errors);
  return { title, content, category: value.category, sphereId: value.sphereId };
}
export function validateComment(value) {
  if (typeof value !== 'string' || !value.replace(/\u00a0/g,' ').trim() || value.trim().length > 2000) throw new DataError('VALIDATION','Մեկնաբանությունը պետք է պարունակի 1–2000 նիշ։',{text:'Առավելագույնը 2000 նիշ։'});
  return value.trim();
}
