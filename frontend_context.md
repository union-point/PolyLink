# PolyLink frontend context

## Scope and evidence

Repository review: 14 October 2026. This document describes the checked-out code, including locally present, Git-ignored database assets. It is a navigation and integration reference, not a claim that the prototype is production-ready.

Evidence priority: executable JavaScript and HTML wiring for current behavior; SQL for declared storage; database report and diagram for additional intent; existing README files for background only. No backend, live database, or end-to-end API behavior was verified. `README.md`, `JS_DOCS.md`, and `js/profile/README.md` overstate modularity, persistence, secure authentication, and real-time messaging.

**Status vocabulary:** *declared* = an HTTP call exists in source, but may be unreachable; *mock* = a local object replaces HTTP; *UI-only* = browser/DOM behavior without persistence; *unspecified* = no consumer establishes the contract. Axios's `response.data` is the HTTP JSON body; an additional `.data` inside that body is a separate envelope.

## Architecture and runtime

- Static multi-page site: 20 root HTML files, `css/`, `image/`, and vanilla JavaScript under `js/`. Navigation reloads pages through ordinary links or `window.location.href`; there is no SPA router, component framework, bundler, package manifest, or repository test suite.
- `server.py` is only a Python static-file server on port 8000. It is not the backend. There is no root `index.html`; start with a named page such as `login.html`.
- Axios comes from an unpinned jsDelivr CDN on selected pages. Font Awesome and numerous external image hosts are also used. Local CSS consists of `css/style.css` plus page-specific styles; profile and JavaScript-generated modals contain substantial inline styles and markup.
- Most page scripts are classic scripts sharing global scope. API authentication/forum/search files contain actual ES-module imports/exports; most profile imports/exports are commented out. The resulting architecture is a partially abandoned module migration, not a consistent module system.
- State lives in HTML fixtures, DOM nodes, global variables, and localStorage. No central store or canonical authenticated-user model is connected to pages. Owner profile data is mostly hardcoded HTML, whereas public profile data is a JavaScript fixture.
- Repeated navigation, theme setup, post/comment rendering, form validation, and modal markup are maintained separately across pages. CSS class names and Armenian button text often determine behavior.

### File and responsibility map

| Location | Responsibilities and limitations |
| --- | --- |
| `js/api/axios.js` | Axios instance, bearer header, cookie credentials, refresh interceptor; default export disabled. |
| `js/api/auth-api.js` | Declared auth and onboarding HTTP functions; not wired to auth page scripts. |
| `js/api/posts-api.js` | Feed fixtures, mock creation and commenting; classic globals. |
| `js/api/profile-api.js` | Mixed real-call declarations and mocks for owner resources/comments; import/export disabled. |
| `js/api/user-api.js` | Public-profile fixtures selected from localStorage; shared post fixture ignoring user identity. |
| `js/api/forum-api.js`, `search-api.js` | Declared module wrappers, unused by the corresponding page scripts. |
| `js/core/auth.js` | Declared `/auth/me` loader and in-memory `currentUser`; disconnected. |
| `js/core/guard.js` | Unused guard; its import is accidentally part of a comment and redirect path is wrong. |
| `js/core/storage.js` | JSON localStorage helper; page scripts generally use localStorage directly. |
| `js/profile/profile-main.js` | Creates `InlineEditor`; initializes existing HTML education, licenses, announcements, photo actions, theme, keyboard controls. No owner-profile fetch. |
| `profile-sections.js` | About 935 lines of forms, CRUD-like DOM changes, comments, and file previews. Main concentration of duplicated markup and business/UI coupling. |
| `profile-modal.js` | `Modal`, footer actions, form collection, rich-text toolbar; closes immediately after invoking save callbacks. |
| `profile-editor.js` | `InlineEditor` save/cancel for name, title, description; saves DOM only. |
| `profile-utils.js` | Armenian date formatting/parsing, relative times, toasts, custom confirmation. |
| `profile-validation.js` | Shared profile validation; restrictive text regex and inconsistent form coverage. |
| `profile-keyboard.js` | Focus navigation, modal focus trap, skip links, Ctrl/Cmd+S/E/N, Escape and arrow keys. |
| `profile-theme.js` | Theme initialization reused by profile/public profile. |
| `js/user/user-main.js`, `user-render.js` | Public-profile fixture rendering, posts/comments, message navigation; separate rendering implementation. |
| `js/posts.js` | Feed rendering, category filtering, post modal, HTML editor, delegated comment creation. |
| `js/forum.js` | Static forum filtering and topic-page visual interactions; shared across incompatible DOM layouts. |
| `js/chat.js` | Local message rendering, images, emoji, contact filtering and menu actions; no transport. |
| `js/settings.js` | About 509 lines of UI preferences and simulated account actions; no API. |
| Auth scripts, `search.js`, `help.js`, `tutorials.js` | Individual page event handling; search does not actually search. |

### Important script order

`profile.html` loads user-api → utils → theme → profile-api → modal → sections → editor → keyboard → validation → main. Globals supplied earlier are consumed later; `response` is the user-api fixture. It never loads `axios.js`, so declarations that reference `api` fail if invoked.

`user.html` loads Axios CDN → axios.js → user-render → user-main → user-api → utils → profile-api → theme. Its DOMContentLoaded initialization runs after those scripts, so later-defined globals are available. Its public-profile helpers coexist with the same global function names in profile-api.

`events.html` loads Axios CDN → posts-api → posts.js. It works with local fixtures, not HTTP. `login.html` and `register.html` each load their page script twice, once as a classic script and once as a module, which duplicates initialization/listeners. They do not import auth-api in either execution.

## Pages and user flows

| Page | Current behavior | Intended feature / missing wiring |
| --- | --- | --- |
| `register.html` | Collects first/last name, email, password/confirmation; tries undefined auth functions and redirects even after errors. | Register → login → `profile_info.html`; no verified enrollment or email ownership flow. |
| `profile_info.html` | Switches `graduate`/`teacher`, institute or department options, specialization, years, photo preview, bio. Next button navigates directly to profile. | Persist onboarding; no diploma field, data assembly, or successful save. Submit sends `{}` and references undefined login/email/password. |
| `login.html` | Email/nonempty-password checks; both success and failure redirect to profile or 2FA depending on localStorage. | Authenticate and enforce server-controlled second factor. |
| `2fa-verify.html` | Six numeric inputs, paste/backspace support, simulated resend timer; any six digits redirect to profile. | No verification/resend endpoint defined. |
| `forgot.html` | Attempts undefined forgotPassword; success stores resetEmail, failure still opens verification. | Request password recovery email. |
| `verify-code.html` | Six-digit UI; calls undefined verification/resend functions. Verification error redirects to reset page; success has no next-page navigation. | Verify recovery challenge; code is not retained for reset. |
| `reset-password.html` | Strength/match UI; submit redirects to profile without an API call. | Persist new password; helper exists but is unused. |
| `profile.html` | Hardcoded owner identity, education, certificates, announcements; editing, adding, deleting and photo preview largely update DOM only. Comments use mocks. | Owner profile read/write, durable IDs, education/certificate/post management. |
| `events.html` | Mock announcements and embedded comments; modal creates transient posts; category filter hides DOM cards. | Job/internship/training announcement feed, not an implemented event calendar. |
| `forum.html` | Static topic cards; filter by data-major; all links lead to the same `topic.html`. | Fetch topics and navigate using topic identity. |
| `topic.html` | One static discussion; likes toggle CSS, reply form alerts and clears; sorting is unwired. | Topic detail, replies, helpful likes, sorting and counts. |
| `new-topic.html` | Required title/major/content; ordinary form GET to `forum.html`, no creation request. | Persist a new forum topic. |
| `search.html` | Static people cards and filters; view buttons store user_id and navigate to user page. | Search/filter by person, specialization, institute, graduation year. Text/search/filter controls have no query logic. |
| `user.html` | Fixture lookup for selected IDs 5–8, nested education/licenses and shared posts; message button stores display name. | Public profile with privacy enforcement; missing IDs cause a caught render error. |
| `message.html` | Static contact list/history; sending appends DOM text, image attachments use FileReader; changing contacts changes header without separate histories. | Persistent direct/group messaging and membership. |
| `settings.html` | Theme and is2FAEnabled persist locally; other settings change display/logs. Email/password, export, deletion and deactivation are simulated. | Account/security/privacy/notification preference persistence. |
| `help.html` | Static FAQ accordion, theme and support links. | No support-ticket API. |
| `tutorials.html` | Static category filtering; tutorial clicks are placeholders. | No video-content API. |
| `privacy.html`, `terms.html` | Static policy copy with theme helper. | Copy is not proof of implemented security, retention or legal commitments. |

All common “logout” links simply open `login.html`: they neither clear tokens nor invoke logout. No page includes the core guard.

## HTTP transport and complete endpoint inventory

Configured origin: `http://localhost:3004`, without `/api` prefix. Shared Axios uses `withCredentials: true` and attaches `Authorization: Bearer <accessToken>` from localStorage. JSON is used unless multipart is explicitly declared. This implies a cookie-backed refresh session, but cookie name, lifetime, flags and actual JWT format are not specified by code.

The inventory includes executable declarations **and commented-out HTTP intents**; it does not imply those calls currently run. There are no other Axios/fetch endpoints in the examined frontend.

### Authentication and onboarding

Source: `js/api/auth-api.js`, `js/api/axios.js`, `js/core/auth.js`.

| Method and path | Request | Response consumed / status |
| --- | --- | --- |
| POST `/auth/login` | `{email, password}` | Body must contain `accessToken`; helper stores it and returns the body, not the Axios response. No user or challenge contract. Declared, page import disabled. |
| POST `/auth/register` | Page intends `{email, password, firstName, lastName}` | Axios response returned; body unused. Conflict 409 is intended, but page condition `1 || ...` labels every failure as duplicate email. |
| POST `/auth/logout` | No body supplied | Body unused. Token removed before request, so shared interceptor cannot attach it; cookie remains usable for identification. Not invoked by navigation. |
| POST `/auth/refresh` | `{}`; direct global Axios with credentials | `{accessToken}` required; bypasses shared instance for refresh request. |
| GET `/auth/me` | No body | Body itself becomes currentUser; shape unspecified; loader returns null on failure. |
| POST `/auth/forgot-password` | `{email}` | Body unused; intended recovery email/resend. |
| POST `/auth/verify-code` | `{email, code}`; six-digit string in UI | Body unused; no proof token specified. |
| POST `/auth/reset-password` | `{email, code, newPassword}` | Body unused; helper never called by reset page. |
| PUT `/users/profile` | `data` with multipart header; current onboarding sends `{}` | Body unused; actual multipart fields and response unspecified. Competes with `/users/me`. |

### Profiles and child resources

Source: `js/api/profile-api.js`; public reads also appear as comments/mocks in `js/api/user-api.js`.

| Method and path | Request | Response / wiring |
| --- | --- | --- |
| GET `/users/{userId}` | Path ID | `getProfile(userId)` declared; no connected consumer. Public `getUserProfile()` currently returns a bare fixture object, not Axios response. |
| PUT `/users/me` | Arbitrary profile `data` | Unspecified response; inline editor does not call it. |
| DELETE `/users/me` | No body | Unspecified confirmation; settings deletion does not call it. |
| POST `/users/me/photo` | FormData field `photo`: File | Comment promises URL response but field name/envelope unspecified; actual photo handler previews locally. |
| POST `/users/me/banner` | FormData field `banner`: File | Same unspecified URL contract; UI previews locally. |
| GET `/users/me/education` | No body | Intended education array; no consuming fetch. |
| POST `/users/me/education` | `{institution, degree, startDate, endDate}` from modal | Mock returns body `{success:true, data:null}`. UI checks success and renders submitted data, discarding durable identity. |
| PUT `/users/me/education/{id}` | Education `data`, not assembled by current edit handler | Unspecified body; current editing is DOM-only. |
| DELETE `/users/me/education/{id}` | No body | Unspecified body; global name is overwritten by DOM deleteEducation(entry). |
| GET `/users/me/licenses` | No body | Intended certificate array; unused. |
| POST `/users/me/licenses` | Intended `{name, organization, issueDate, credentialUrl}` | Unspecified body; current add handler never calls it. |
| PUT `/users/me/licenses/{id}` | Certificate `data` | Unspecified body; current edit handler never calls it. |
| DELETE `/users/me/licenses/{id}` | No body | Unspecified body; DOM deleteLicense(entry) overrides wrapper. |
| GET `/users/me/posts` | No body | Intended owner announcements array; current profile uses HTML. |
| GET `/users/{id}/posts` | Path ID | Commented intent; mock ignores ID and returns `{data:[Post,...]}`. Public page calls it without ID. |

### Announcements and comments

Source: `posts-api.js`, `profile-api.js`, `posts.js`, `user/user-render.js`, `profile/profile-sections.js`.

| Method and path | Request | Response / wiring |
| --- | --- | --- |
| GET `/posts` | No params | Commented intent; mock Axios-shaped object with `data: Post[]`. Feed consumes the body array. |
| POST `/posts` | Feed: `{title, content, category}` | Feed mock returns `data: Post`; declared createAnnouncement also targets this path. Profile add is DOM-only and currently collects category under `category-selector`. |
| PUT `/posts/{id}` | Generic post data; UI edits title/content locally | Response unspecified; global delete/update contracts are not connected. |
| DELETE `/posts/{id}` | No body | Response unspecified; DOM deleteAnnouncement overrides HTTP wrapper on owner page. |
| GET `/posts/{postId}/comments` | Path ID | Mock body array `Comment[]`; no filtering by post in mock. |
| POST `/posts/{postId}/comments` | `{text}` | Feed mock body = Comment; profile/public mock body = `{success:true,data:Comment}`. Consumers are incompatible. |
| PUT `/posts/{postId}/comments/{commentId}` | Generic data; likely text, but no actual UI payload | Response unspecified, declared only. |
| DELETE `/posts/{postId}/comments/{commentId}` | No body | Response unspecified, declared only. |

### Forum and search

Source: `forum-api.js` and `search-api.js`, neither loaded by their feature pages.

| Method and path | Request | Response / wiring |
| --- | --- | --- |
| GET `/forum/topics` | No query params | Unspecified body; static HTML implies list metadata below. |
| GET `/forum/topics/{id}` | Path ID | Unspecified body; static topic/reply HTML. |
| POST `/forum/topics` | Generic topicData; form implies `{title, major, content}` | Unspecified body; new-topic form never calls wrapper. |
| PUT `/forum/topics/{id}` | Generic topicData | Unspecified body; no connected edit UI. |
| DELETE `/forum/topics/{id}` | No body | Unspecified body; no connected delete UI. |
| GET `/search?q={encodedQuery}` | q escaped using encodeURIComponent | Unspecified body; no result rendering or filter params in wrapper. |

No endpoint is declared for forum replies/likes, chat, 2FA verification/settings, notification preferences, email/password changes, deactivation, data export, registry verification, lookup lists or work experience. These are feature requirements, not existing route contracts.

## Observed data contracts and schema mismatches

### Objects consumed by rendering

These are structural examples, not a finalized backend schema:

```json
{
  "id": 5,
  "name": "Display name",
  "jobTitle": "Professional headline",
  "description": "Biography",
  "avatar": "https://host/photo.jpg",
  "cover": "https://host/cover.jpg",
  "education": [{"logo": "https://host/logo.jpg", "institution": "University", "degree": "Degree and specialization", "startDate": "2021-09", "endDate": null}],
  "licenses": [{"title": "Certificate", "issuer": "Organization", "date": "2024-04", "logo": null, "credential": "https://host/credential"}]
}
```

Public fixtures contain unpadded dates such as `2021-9`; modal controls emit `YYYY-MM`. Child IDs are absent from fixtures, but durable CRUD requires them.

```json
{
  "id": 1,
  "title": "Announcement title",
  "content": "<p>Rich HTML content</p>",
  "category": "job",
  "createdAt": "2025-10-26T11:20:00Z",
  "author": {"name": "Display name", "avatar": "https://host/photo.jpg"},
  "comments": [{"id": 2, "text": "Plain comment", "createdAt": "2025-10-26T11:45:00Z", "author": {"name": "Display name", "avatar": "https://host/photo.jpg"}}]
}
```

Feed categories: `job`, `internship`, `training`. IDs on old fixture comments may be missing. Public-profile post fixture has only id/title/content/comments. Profile/public comment creation reads `response.data.success` and `response.data.data`, whereas feed creation reads `response.data` directly.

| Frontend concept | SQL counterpart / unresolved mapping |
| --- | --- |
| name / jobTitle / description | FirstName + LastName / possibly Users.Specialization / About; `jobTitle` meaning is not settled. Inline editor uses yet another key, `title`. |
| avatar / cover | ProfilePhotoUrl / CoverPhotoUrl. |
| education.institution / degree | Normalized UniversityId and DegreeId; UI combines degree and specialization in one string, while SQL stores separate SpecializationId and InstituteId. |
| licenses.title/issuer/date/credential | Certificates.CertificateName/Organization/IssueDate/Url; owner forms instead emit name/organization/issueDate/credentialUrl. |
| category | Posts.PostTypeId via lookup; SphereId is a separate field absent from feed payload. |
| comment.text | PostComments.Content. |
| teacher / graduate | Onboarding uses teacher; database seed uses lecturer / graduate. Alumni is a domain synonym for graduate, not an additional established role. |
| major | Forum specialization codes: informatics, mechanics, electronics, civil, energy, management; SQL ForumTopics has no classification field. |
| forum author/counts/date | SQL joins and aggregates; static UI displays author names, dates, classifications and reply totals. |
| chat text/image | SQL EncryptedContent; no encryption metadata or attachment schema exists. |
| open/closed, show email | IsProfilePublic supports visibility; show-email flag missing. |
| hy/en/ru | Migration seeds only hy and en. |

There is no authoritative response envelope, error schema, pagination, sorting, filtering, date-zone or partial-update convention. Never infer these from wrapper comments alone.

## Local state and persistence boundaries

| localStorage key | Meaning and risks |
| --- | --- |
| accessToken | Intended auth bearer token; not populated through working auth-page wiring. |
| resetEmail | Recovery email, only stored on successful forgot-password call; often absent during fallback navigation. |
| is2FAEnabled | Browser-only preference controlling redirects; cannot establish account security. |
| theme | light/dark/auto, reused across many independently implemented theme helpers. |
| user_id | Selected public-profile fixture ID; stale tabs and direct links lack reliable identity. |
| name | Display-name handoff from public profile to chat; consumed and removed on chat load, not a recipient identifier. |

All education/license/profile/post edits and message sending should be considered transient unless a connected HTTP call is explicitly identified. Mock creation does not append to source arrays; refresh loses edits.

## Confirmed flaws and navigation hazards

### Authentication and API wiring

1. `axios.js` has `//export default api;`, breaking actual default imports in auth/forum/search/core modules. Auth page imports are separately commented out, so functions such as login/registerUser/forgotPassword/verifyCode are undefined.
2. Login redirects even after authentication errors. Registration redirects after every error and has `nameInput` undefined near the end of initialization. `validatePasswordStrength()` assigns undeclared `password`, which fails in module execution. Classic and module copies attach duplicate handlers.
3. Registration submit validation omits confirmation/strength checks; strength and matching handlers independently enable the submit button. Reset submit enforces neither strength nor equality. Settings password checks deliberately omit early returns for short or mismatched passwords.
4. Recovery verification proceeds on error and not on success; reset never submits credentials/code. 2FA accepts any six digits. LocalStorage flags and page navigation provide no authorization.
5. Core guard is not included anywhere; its loadUser import is swallowed by a `//` comment and `/pages/login.html` does not exist.
6. Refresh interceptor dereferences `error.response.status` on network errors, has no retry marker or concurrent-refresh coordination, and can refresh login/authorization failures or loop on repeated 401s. Failed refresh redirects, clears token and still reaches the final throw. Logout removes its bearer token before sending.

### Feature logic and shared globals

7. `forum.js` unconditionally calls `.addEventListener` on `.reply-form`; this is null on forum/new-topic pages and causes an exception. Earlier theme/filter declarations remain, but later execution is aborted. Creation is native navigation, not publication. Topic sorting and like counts do not update persisted data.
8. Owner `profile.html` loads user-api solely as a global provider/fixture, not an authenticated owner loader. Existing entries have no reliable durable ID model. API functions deleteEducation/deleteLicense/deleteAnnouncement are overwritten by DOM functions in sections.
9. `Modal.createFooter()` invokes onSave without awaiting its promise or checking its return and immediately closes; failed validation or an API error cannot reliably keep the form open. Edit closures retain original data, so reopening can restore stale values.
10. Profile add-announcement select has id `category-selector` and no name: generic collection emits that key, unlike feed `category`. New DOM cards default to post ID 0. Public `renderPost()` hardcodes post ID 2 and count 0 for every card.
11. Profile/public comment loaders render fetched comments only if the displayed count is already positive, hiding valid responses when stale counts say zero. Profile and public pages duplicate comment-rendering code, and globally supplied getComments/createComment functions define their envelopes; do not assume each page owns its helper names.
12. Feed post/comment mocks calculate IDs from a fixed post-array length, yielding repeated IDs. Profile mock comment ID equals postId. Public getUserPosts ignores target identity. The separate profile-api createPost also depends on a global `response` fixture defined elsewhere.
13. Public profile message navigation uses an implicitly assigned global name, not a user/room ID; contact changes retain the same message DOM. Chat delete only clears displayed history, block only alerts, mute is in-memory, and attachments never upload.
14. `parseDate` duplicates the Armenian January/June abbreviation as an object key, so January parses as June; range parsing of “Present” returns null and missing separators can pass undefined to parsing. Month formatting and unpadded fixture dates are unreliable round trips.
15. Generic text regex accepts only Latin/Armenian letters and a small punctuation set, rejecting legitimate course titles, digits, commas, C++, etc. Date validation checks shape, not chronology. Several forms never invoke shared validation.
16. Numerous values are interpolated into innerHTML, attributes, CSS URL strings and inline onclick code (including credential URLs). There is no sanitizer. Feed rich HTML is intentional, but names/titles/comments also need safe rendering. Chat text uses text nodes, which is safer.
17. Keyboard handling maintains a separate isEditMode flag that ordinary InlineEditor clicks do not synchronize. Ctrl+S targets the first primary button, which can trigger “add section” outside editing instead of saving a modal.
18. Themes and CSS variables are duplicated; auto-theme listeners depend on initial saved preferences, and settings can register repeated listeners. Repeated `.innerHTML +=` reconstructs descendants and can discard handlers/state. Toast functions/styles and selector-based button handling are duplicated.

## Working guidance for future agents

Use the page's actual script tags first, then follow the functions those scripts invoke. Do not enable imports wholesale: export names, global collisions, envelopes and target IDs must first be reconciled. `profile-api.js`'s commented export list even names getUserProfile despite declaring getProfile. Treat static author names, departments and passwords in fixtures/seeds as samples, not trusted identity or valid credentials.

Backend work must explicitly resolve the incompatible contracts above. Adding a server alone will not make auth, profile persistence, forums, search or chat functional. The companion backend context captures domain/storage requirements independently, without an implementation plan.
