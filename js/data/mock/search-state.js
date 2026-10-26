import { DataError } from '../errors.js';
const invalid = () => { throw new DataError('VALIDATION', 'Անվավեր որոնման պարամետրեր։'); };
const eligible = user => user.status === 'active' && user.onboardingComplete === true && ['graduate', 'lecturer'].includes(user.role);
function catalog(state, key) {
  return [...new Set(state.education.map(record => record[key]).filter(Boolean))].sort().map((label, index) => ({ id: index + 1, label }));
}
const compareId = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true });
const compare = (a, b) => a.firstName.localeCompare(b.firstName, 'en', { sensitivity: 'accent' }) || a.lastName.localeCompare(b.lastName, 'en', { sensitivity: 'accent' }) || compareId(a.id, b.id);
function parameters(input) {
  const result = { q: input.q ?? '', limit: input.limit ?? 50 };
  if (typeof result.q !== 'string' || result.q.length > 100) invalid();
  result.q = result.q.trim();
  for (const key of ['limit', 'specializationId', 'instituteId', 'year']) {
    const value = input[key] ?? (key === 'limit' ? 50 : undefined);
    if (value === undefined) continue;
    if (!/^[1-9][0-9]*$/.test(String(value))) invalid();
    result[key] = Number(value);
    if (!Number.isSafeInteger(result[key]) || result[key] > (key === 'limit' ? 100 : key === 'year' ? 9999 : 2147483647)) invalid();
  }
  return result;
}
function page(state, input = {}) {
  const f = parameters(input), scope = JSON.stringify(f), own = String(state.sessionUserId);
  const specializations = catalog(state, 'specialization'), institutes = catalog(state, 'institute');
  const matches = entry => (!f.specializationId || specializations.find(item => item.id === f.specializationId)?.label === entry.specialization) && (!f.instituteId || institutes.find(item => item.id === f.instituteId)?.label === entry.institute) && (!f.year || entry.endDate && Number(entry.endDate.slice(0, 4)) === f.year);
  let after;
  if (input.cursor != null) {
    try {
      if (typeof input.cursor !== 'string' || input.cursor.length > 3000) invalid();
      const cursor = JSON.parse(decodeURIComponent(atob(input.cursor)));
      if (cursor.scope !== scope || cursor.own !== own || typeof cursor.last?.firstName !== 'string' || typeof cursor.last?.lastName !== 'string' || typeof cursor.last?.id !== 'string' || !cursor.last.id) invalid();
      after = cursor.last;
    } catch { invalid(); }
  }
  const educationFilter = f.specializationId || f.instituteId || f.year;
  const candidates = state.users.filter(eligible).filter(user => `${user.firstName} ${user.lastName}`.toLowerCase().includes(f.q.toLowerCase()))
    .map(user => ({ user, education: state.education.filter(entry => entry.userId === user.id && matches(entry)) }))
    .filter(item => !educationFilter || item.education.length).sort((a, b) => compare(a.user, b.user)).filter(item => !after || compare(item.user, after) > 0);
  const visible = candidates.slice(0, f.limit), hasMore = candidates.length > f.limit;
  const items = visible.map(({ user, education }) => ({ id: user.id, firstName: user.firstName, lastName: user.lastName, name: `${user.firstName} ${user.lastName}`, role: user.role, onboardingComplete: true, jobTitle: user.jobTitle || '', canOpenProfile: own === user.id || (state.settings[user.id]?.isProfilePublic ?? true), matchedEducation: education.sort((a, b) => (b.endDate || '').localeCompare(a.endDate || '') || compareId(a.id, b.id)).map(entry => Object.fromEntries(['id', 'institution', 'degree', 'institute', 'specialization', 'startDate', 'endDate'].map(key => [key, entry[key] ?? null]))) }));
  const last = visible.at(-1)?.user;
  return { items, hasMore, nextCursor: hasMore ? btoa(encodeURIComponent(JSON.stringify({ scope, own, last: { id: last.id, firstName: last.firstName, lastName: last.lastName } }))) : null };
}
export const searchOperations = {
  'search.page': page,
  'search.people': (state, { q = '' } = {}) => page(state, { q, limit: 100 }).items,
  'search.filters': state => ({ specializations: catalog(state, 'specialization'), institutes: catalog(state, 'institute'), years: [...new Set(state.education.filter(entry => state.users.some(user => user.id === entry.userId && eligible(user))).map(entry => Number(entry.endDate?.slice(0, 4))).filter(year => year >= 1 && year <= 9999))].sort((a, b) => b - a) }),
};
