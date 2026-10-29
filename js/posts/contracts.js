import { DataError } from '../data/errors.js';
const bad = () => new DataError('CONTRACT','Հայտարարությունների API պատասխանի ձևաչափը սխալ է։');
const object = value => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw bad(); return value; };
const text = value => { if (typeof value !== 'string') throw bad(); return value; };
const id = value => { if (!text(value) || value.length > 128) throw bad(); return value; };
const referenceCode = value => { if (text(value).length > 32 || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value)) throw bad(); return value; };
const flag = value => { if (typeof value !== 'boolean') throw bad(); return value; };
const nullable = (value, normalize = text) => value === null ? null : normalize(value);
const date = value => { if (!text(value) || !Number.isFinite(Date.parse(value)) || !/(Z|[+-]\d\d:\d\d)$/.test(value)) throw bad(); return value; };
const type = value => { if (!['job','internship','training'].includes(value)) throw bad(); return value; };
function author(value) { object(value); return {id:nullable(value.id,id),name:text(value.name),avatar:text(value.avatar),canOpenProfile:flag(value.canOpenProfile)}; }
function common(value) { object(value); return {id:id(value.id),author:author(value.author),createdAt:date(value.createdAt),updatedAt:nullable(value.updatedAt,date),canEdit:flag(value.canEdit),canDelete:flag(value.canDelete)}; }
export function normalizePost(value) {
  const base=common(value);
  if (!Number.isSafeInteger(value.commentCount) || value.commentCount<0) throw bad();
  return {...base,title:nullable(value.title),content:text(value.content),category:nullable(value.category,type),categoryName:nullable(value.categoryName),sphereCode:nullable(value.sphereCode,referenceCode),sphereName:nullable(value.sphereName),commentCount:value.commentCount};
}
export function normalizeComment(value) { return {...common(value),postId:id(value.postId),text:text(value.text)}; }
export function normalizePostPage(value, normalize=normalizePost) {
  object(value); if (!Array.isArray(value.items) || value.items.length>20) throw bad();
  return {items:value.items.map(normalize),nextCursor:nullable(value.nextCursor,idCursor)};
}
function idCursor(value) { if (!text(value) || value.length>1000) throw bad(); return value; }
export function normalizePostOptions(value) {
  object(value);if (!Array.isArray(value.types)||!Array.isArray(value.spheres))throw bad();
  const types=value.types.map(item=>({code:type(item.code),name:text(item.name)}));
  const spheres=value.spheres.map(item=>({code:referenceCode(item.code),name:text(item.name)}));
  if (new Set(types.map(t=>t.code)).size!==3 || types.length!==3 || new Set(spheres.map(s=>s.code)).size!==spheres.length || spheres.filter(s=>s.code==='other').length!==1)throw bad();
  return {types,spheres};
}
