import { DataError } from '../data/errors.js';
const bad = () => new DataError('CONTRACT', 'Սերվերի պատասխանի ձևաչափը սխալ է։');
const object = v => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw bad(); return v; };
const text = v => { if (typeof v !== 'string') throw bad(); return v; };
const id = v => { if (!/^[1-9][0-9]*$/.test(text(v))) throw bad(); return v; };
const bool = v => { if (typeof v !== 'boolean') throw bad(); return v; };
const nullable = (v, normalize = text) => v === null ? null : normalize(v);
const version = v => { if (!text(v) || v.length > 128) throw bad(); return v; };
export const referenceKinds = Object.freeze(['universities','institutes','departments','specializations','professions','degrees','post-types','post-spheres','forum-categories']);
export function normalizeReference(v) {
  object(v);
  if (!Array.isArray(v.protectionReasons) || v.protectionReasons.some(r=>!['SYSTEM_VALUE','REFERENCE_IN_USE'].includes(r))) throw bad();
  const result = {id:id(v.id),name:text(v.name),version:version(v.version),protectionReasons:[...v.protectionReasons]};
  if ('code' in v) { if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(text(v.code)) || v.code.length>32) throw bad(); result.code=v.code; }
  return result;
}
export function normalizeRegistry(v, kind) {
  object(v); const result={id:id(v.id),version:version(v.version),linked:bool(v.linked),needsCorrection:bool(v.needsCorrection),firstName:nullable(v.firstName),lastName:nullable(v.lastName)};
  if (kind==='lecturers') Object.assign(result,{email:text(v.email),departmentId:nullable(v.departmentId,id)});
  else if (kind==='alumni') Object.assign(result,{diplomaNumber:text(v.diplomaNumber),specializationId:nullable(v.specializationId,id),studyStartDate:nullable(v.studyStartDate,date),studyEndDate:nullable(v.studyEndDate,date)});
  else throw bad();
  return result;
}
function date(v) { if (!/^\d{4}-\d{2}-\d{2}$/.test(text(v)) || !Number.isFinite(Date.parse(v))) throw bad(); return v; }
export function normalizeAdminPage(v, normalize) {
  object(v); if (!Array.isArray(v.items) || v.items.length>50) throw bad();
  const nextCursor=nullable(v.nextCursor,text);if(nextCursor!==null&&(!nextCursor||nextCursor.length>2000))throw bad();
  return {items:v.items.map(normalize),nextCursor};
}
