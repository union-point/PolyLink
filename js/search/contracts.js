import { DataError } from '../data/errors.js';
const invalid = () => { throw new DataError('CONTRACT', 'Որոնման պատասխանը անվավեր է։'); };
const id = value => (typeof value === 'string' || Number.isInteger(value)) && String(value) ? String(value) : invalid();
const text = value => value == null ? '' : typeof value === 'string' ? value : invalid();
export function normalizeSearchPerson(value) {
  if (!value || !['graduate', 'lecturer'].includes(value.role) || typeof value.canOpenProfile !== 'boolean' || !Array.isArray(value.matchedEducation)) invalid();
  const firstName = text(value.firstName), lastName = text(value.lastName);
  return { id: id(value.id), firstName, lastName, name: `${firstName} ${lastName}`.trim(), role: value.role,
    onboardingComplete: value.onboardingComplete === true, canOpenProfile: value.canOpenProfile, jobTitle: text(value.jobTitle),
    matchedEducation: value.matchedEducation.map(entry => ({ id: id(entry.id), institution: text(entry.institution), degree: text(entry.degree), institute: text(entry.institute), specialization: text(entry.specialization), startDate: text(entry.startDate), endDate: text(entry.endDate) })) };
}
export function normalizeSearchPage(value) {
  if (!value || !Array.isArray(value.items) || typeof value.hasMore !== 'boolean' || (value.hasMore ? typeof value.nextCursor !== 'string' || !value.nextCursor : value.nextCursor !== null)) invalid();
  return { items: value.items.map(normalizeSearchPerson), hasMore: value.hasMore, nextCursor: value.nextCursor };
}
export function normalizeSearchFilters(value) {
  if (!value || !Array.isArray(value.specializations) || !Array.isArray(value.institutes) || !Array.isArray(value.years) || value.years.some(year => !Number.isInteger(year) || year < 1 || year > 9999)) invalid();
  const options = entries => entries.map(entry => ({ id: id(entry.id), label: text(entry.label) }));
  return { specializations: options(value.specializations), institutes: options(value.institutes), years: value.years };
}
