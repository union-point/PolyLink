# People search implementation

Implemented 26 October 2026 from [the agreed plan](search_implementation_plan.md). The defaults in its section 3 are adopted. Search is available when identity is enabled, independently of the messenger flag; all three endpoints require a regular admitted session, never an enrollment session.

## API

`GET /search/people?q=&specializationId=1&instituteId=2&year=2024&limit=50&cursor=...` returns `{items, hasMore, nextCursor}`. Optional absent filters mean “all”; invalid types or bounds return 400. `q` has at most 100 UTF-16 code units before trimming. Name substring search treats `%`, `_`, `[`, `!` literally and binds parameters. Positive SQL int IDs are used for institute and specialization; year is 1–9999 (SQL Server date bounds). Unknown positive IDs return no matches. `limit` is 1–100, default 50.

Each item is explicitly projected:

```json
{
  "id": "123",
  "firstName": "Name",
  "lastName": "Surname",
  "role": "graduate",
  "onboardingComplete": true,
  "jobTitle": "Position",
  "canOpenProfile": false,
  "matchedEducation": [{
    "id": "15", "institution": "University", "degree": "Degree",
    "institute": "Institute", "specialization": "Specialization",
    "startDate": "2016-09-01", "endDate": "2020-06-01"
  }]
}
```

Education strings/dates may be null. Items never contain email, avatars, covers, biography, credentials, certificates or work history, for either public or private profiles. `jobTitle` comes from `Users.Specialization`, independently of the education specialization. The owner can open their own private profile. Other private profiles retain `canOpenProfile=false`, a disabled button and a guarded click handler. Direct `GET /users/{id}` continues to check current privacy and returns 404 for another person's private profile.

`GET /search/filters` returns `{specializations:[{id,label}], institutes:[{id,label}], years:[2026,...]}`. IDs/labels come from the corresponding DB dictionaries, independent of the current query. Years come from non-null `Education.EndDate` of eligible users. Options have no cascading dependency. UI failures offer retry without substituting static options.

`GET /search?q=...` and `search.people({q})` still return an array of up to 100 items with role and onboarding fields. The participant picker continues using that operation; it does not require education. The catalog uses `search.page` and `search.filters`. HTTP passes filters to the server and never filters a truncated result locally. Mock uses the same matching, DTO and pagination semantics; its in-memory dictionaries derive numeric option IDs from sorted distinct education labels and its locale ordering approximates the server collation. Database ID identity and SQL collation remain authoritative in HTTP mode.

## Query and pagination rules

Only verified ADMITTED graduates/lecturers qualify; role resolution matches the account service (`PendingEnrollments.RoleCode`, falling back to `Roles.Name`). DEACTIVATED, DELETED and pending accounts cannot qualify. Private accounts are included. No education filter means people without Education remain discoverable.

All selected education predicates are ANDed inside one correlated EXISTS before TOP. The service fetches limit+1 unique users, then all matching education records for the visible user IDs in one batch. A nonempty page uses two SQL reads regardless of the number of people/education records; an empty page uses one. Role lookup is joined, with no per-user account reads. Year filtering uses a half-open EndDate range; the maximum SQL date year 9999 uses an inclusive final-day boundary. Education is sorted by EndDate DESC (null last), EducationId ASC; the UI shows the first record and a disclosure for every remaining record.

People sort by FirstName, LastName with explicit `SQL_Latin1_General_CP1_CI_AS`, then numeric UserId. The HMAC-authenticated cursor stores that key and is bound to the caller, trimmed query, filters, page size and sort version. Tampering, reuse by a different caller or reuse with another query returns 400. Pagination is a live view, not a cross-request snapshot. UI resets results/cursors immediately when inputs change and ignores responses from previous generations; it also deduplicates appended IDs. A failed append preserves cards and offers retry. Double clicks cannot issue concurrent page loads.

Chat opening still calls `openDirectWithUnblock`: own-account contact is disabled, removing one's own block requires confirmation, and the peer's block and server eligibility rules remain authoritative. Search does not disclose reasons why contact is unavailable.

## Data and performance boundaries

Schema and enrollment code were checked: `Education` has the documented FK/date fields, but registry enrollment does not insert Education. No registry or flat user fields are substituted for missing education. Existing accounts without education appear in the unfiltered catalog; selecting an education filter excludes them. Populating verified education and delivering profile education mutation endpoints remain separate work. No production data or schema migration is changed here.

The baseline has a clustered EducationId primary key and no search-specific Education index. The SQL integration fixture captures the SQL Server estimated plan of the same query with escaped synthetic fixture literals to `backend/target/search-query-plan.xml` and reports elapsed time and SQL-read count. It checks a match after the first 200 catalog entries and a complete 211-user traversal. The final local fixture measured about 55 ms for the matching page, with exactly two reads. Its estimated plan uses a clustered scan for Education, nested loops and a sort; this is a regression fixture, not a production load benchmark. Before large-scale rollout, evaluate Education indexes starting with UserId plus filter FKs/EndDate against representative data and write costs through the existing migration workflow. `%q%` is deliberately not advertised as an index seek.

## Verification

- `npm ci --prefix tools/contracts --ignore-scripts` followed by `npm test --prefix tools/contracts`: 57 passing contracts, including matching, minimal DTO, HTTP forwarding, cursor validation, legacy arrays and existing direct/group chat contracts.
- With the normal private local environment loaded, set `DB_TEST_ADMIN_PASSWORD` / `DB_TEST_ADMIN_USERNAME` and run `python3 tools/m1/verify.py --search`. It creates a disposable `polylink_m1_*` database and temporary TLS OpenBao/Mailpit containers, runs SearchIT, ChatIT and GroupIT, then cleans up. Normal Maven unit tests and formatting checks run as part of verify.
- SearchIT checks same-record predicates, multiple matched education records, null fields/dates, literal Unicode/LIKE characters, no-education users, closed-profile projection and direct 404, owner access flag, disabled accounts, signed query/caller-bound cursors, 100-item limits, deterministic 211-user pagination and legacy arrays. It asserts exactly two SQL reads for a nonempty filtered page and captures its plan.
- Serve the repository (`python3 -m http.server 8012 --bind 127.0.0.1`) and run `node tools/m1/search-browser.mjs`. This uses an isolated service fixture without changing application config. It checks filter failure/retry, cards/disclosure/escaping/privacy controls, append error/retry, duplicate clicks, stale responses, query/filter resets, empty results and desktop/mobile layout. Screenshots go to `/tmp/polylink-search-{desktop,mobile}.png`.

The first full database run passed search and chat/group checks but hit two email-delivery failures in existing EnrollmentIT/RecoveryIT. The focused rerun passed those suites along with SearchIT, ChatIT and GroupIT. An additional verification run reproduced a mail-related 503 in a different existing EnrollmentIT case. The dedicated `--search` runner covers search/chat/group regression; full database runs continue to include the mail suites. These failures were not hidden or converted into test skips.
