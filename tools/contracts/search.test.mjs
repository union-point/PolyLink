import test from 'node:test';
import assert from 'node:assert/strict';
import { searchOperations as operations } from '../../js/data/mock/search-state.js';
import { normalizeSearchPage } from '../../js/search/contracts.js';
import { createHttpProvider } from '../../js/data/http/provider.js';
const user = id => ({ id: String(id), firstName: 'Անի', lastName: 'Same', role: id % 2 ? 'graduate' : 'lecturer', status: 'active', onboardingComplete: true, email: 'private', avatar: 'private', jobTitle: 'Position' });
function fixture() {
  return { sessionUserId: '1', users: Array.from({ length: 211 }, (_, i) => user(i + 1)), settings: { '211': { isProfilePublic: false } }, education: [
    { id: '1', userId: '211', specialization: 'X', institute: 'I', endDate: '2020-06-01' },
    { id: '2', userId: '211', specialization: 'Y', institute: 'J', endDate: '2024-06-01' },
    { id: '3', userId: '211', specialization: 'X', institute: 'I', endDate: '2020-07-01' },
  ] };
}
test('mock filters one education and retains all matched records with a minimal private DTO', () => {
  const state = fixture(), filters = operations['search.filters'](state);
  const specializationId = filters.specializations.find(item => item.label === 'X').id;
  const instituteId = filters.institutes.find(item => item.label === 'J').id;
  assert.equal(operations['search.page'](state, { specializationId, instituteId }).items.length, 0);
  assert.equal(operations['search.page'](state, { specializationId, year: 2024 }).items.length, 0);
  const page = normalizeSearchPage(operations['search.page'](state, { specializationId, year: 2020 }));
  assert.equal(page.items.length, 1); assert.equal(page.items[0].id, '211');
  assert.equal(page.items[0].matchedEducation.length, 2); assert.equal(page.items[0].canOpenProfile, false);
  assert(!JSON.stringify(page).includes('private'));
});
test('mock pages through identical names, includes people without education and preserves legacy arrays', () => {
  const state = fixture(), ids = []; let cursor;
  do { const page = operations['search.page'](state, { limit: 100, ...(cursor ? { cursor } : {}) }); ids.push(...page.items.map(item => item.id)); cursor = page.nextCursor; } while (cursor);
  assert.equal(ids.length, 211); assert.equal(new Set(ids).size, 211);
  const legacy = operations['search.people'](state, { q: 'Անի' });
  assert(Array.isArray(legacy)); assert.equal(legacy.length, 100); assert(legacy.some(item => item.role === 'lecturer'));
  state.users[0].status = 'deactivated'; assert.equal(operations['search.page'](state).items[0].id, '2');
});
test('mock validates params and binds cursors to normalized filters', () => {
  const state = fixture(), cursor = operations['search.page'](state).nextCursor;
  for (const input of [{ limit: 101 }, { year: 'bad' }, { instituteId: 0 }, { q: 'x'.repeat(101) }, { cursor, q: 'changed' }, { cursor: 'bad' }]) assert.throws(() => operations['search.page'](state, input), error => error.code === 'VALIDATION');
  assert.equal(operations['search.people'](state, { q: 'Position' }).length, 0);
});
test('HTTP forwards filters and cursor, returns page DTO and preserves legacy array', async () => {
  const state = fixture(), requests = [];
  const provider = createHttpProvider({ request: async request => { requests.push(request); return { data: request.url === '/search' ? operations['search.people'](state) : operations['search.page'](state) }; } });
  const params = { q: 'Անի', instituteId: 1, specializationId: 2, year: 2020, limit: 50, cursor: 'opaque' };
  const page = await provider.call('search.page', params); assert.equal(page.items.length, 50);
  assert.deepEqual(requests[0].params, params); assert.equal(requests[0].url, '/search/people');
  assert(Array.isArray(await provider.call('search.people', { q: '' })));
  assert.throws(() => normalizeSearchPage({ items: [], hasMore: true, nextCursor: null }));
});
