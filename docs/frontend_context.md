# PolyLink frontend context

Reviewed 25 October 2026 against the current source. PolyLink is an Armenian-language, static multi-page frontend using native ES modules. No frontend framework or build step is required for manual use. A real Java/Spring Boot backend now implements identity, encrypted messaging, account settings and the career forum; profile editing and publications remain primarily mock features.

## Architecture and provider boundary

```text
HTML → page controller → js/services/index.js → js/data/client.js
                                                ├─ mock/provider.js → IndexedDB
                                                └─ http/provider.js
                                                    ├─ auth/identity-client.js
                                                    ├─ auth/recovery-client.js
                                                    ├─ chat/encrypted-client.js
                                                    └─ http/routes.js → transport.js → backend
```

- `js/config.js` selects one provider and configures the API URL, pinned Axios 1.13.2 CDN and mock database. The current working copy selects `http`; check this file before following real-app instructions. The API URL is `http://localhost:3004`. Do not silently change a user's provider selection.
- `js/services/index.js` exposes asynchronous auth, profile, publication, forum, search, chat, settings and notification facades. Controllers must use these boundaries rather than Axios or IndexedDB directly.
- `js/data/client.js` lazily loads one provider. HTTP errors never trigger a mock fallback. An adapter route alone does not establish server support.
- `js/data/http/provider.js` dispatches auth/security to the identity client, chat to the encrypted client and full export to `account-export.js`; ordinary resource routes use DTO normalization.
- `js/data/http/transport.js` loads Axios only in HTTP mode. Access tokens stay in memory; old localStorage access tokens are removed. Refresh uses credentialed cookies, CSRF proof, shared in-tab refresh and Web Locks when available. Generation checks reject responses from a superseded session. Requests normally time out after 15 seconds.
- `js/data/errors.js` supplies `DataError`; transport errors preserve server codes and map status/network failures. Unsupported operations fail visibly.
- `js/shared/ui.js` owns themes, session guards, loading/retry, pending controls and error feedback. `shared/content.js` escapes plain text, validates URL schemes and sanitizes allowed rich HTML. Server validation remains necessary.

## Implemented flows and page ownership

| Page / modules | Current behavior |
| --- | --- |
| `login.html`, `register.html`, `2fa-verify.html`; `login.js`, `register.js`, `2fa-verify.js` | HTTP registry registration, verified email, optional email login factor and automatic backed-up key setup. Browser password derivation precedes HTTP authentication. Mock accounts and fixed codes are separate. |
| `forgot.html`, `verify-code.html`, `reset-password.html`; `auth/recovery-client.js` | HTTP account/history recovery with local or platform-assisted vault unlock, resumable recovery authorization, atomic commit and identity rotation. No recovery key is shown to the user. |
| `profile_info.html`; `profile-info.js` | Restricted graduate/lecturer enrollment form, saved revisions, database reference selections, optional V15 avatar upload, email verification and password re-entry after admission. Uses explicit `/auth/enrollment` operations without application bootstrap or vault access. See [enrollment contract](registry_enrollment.md). |
| `profile.html`; `profile/profile-main.js`, editor/sections/modal/render modules | Owner profile, education/certificate/publication editing and media work in mock mode. Full initialization can fail in HTTP mode when it requests unimplemented publication/child-resource APIs. |
| `user.html?id=...`; `user/user-main.js` | Profile projection and direct contact. HTTP public-profile read exists, but child publication reads remain unavailable. Closed profiles cannot be opened by another member. |
| `search.html`; `search.js`, `chat/direct-contact.js` | Server-paginated graduate/lecturer catalog with DB filter options, matching education disclosures and Search → Connect → encrypted direct room. Closed profiles expose only names, education, job title and technical fields; see [search contract](search_implementation.md). |
| `message.html?room=...`; `chat.js`, `chat/render.js`, `chat/history.js`, `chat/groups.js` | HTTP/mock direct/group histories, text/images, paginated history, local search, drafts, emoji, unread state, mute/block/hide, group creation and owner/member controls. |
| `settings.html`; `settings.js`, `settings-security.js`, `account-export.js` | Persisted privacy/language/notification preferences, staged email change, password-authorized email factor, password change, full ZIP export, deactivate/delete. Browser notifications and theme are local preferences. |
| `events.html`; `posts.js`, `shared/posts.js` | Announcement CRUD, category/sphere filters, rich content and plain comments in mock mode; server publication API is not implemented. This is not an event calendar. |
| `forum.html`, `new-topic.html`, `topic.html`; `forum/*` | HTTP/mock categories, cursor topics and flat replies, likes, owner edits/deletion, manual refresh and stale-edit review. Enable the backend forum only after V13. |
| Help/policies/tutorials | Public static content and UI filters. Support submission and unavailable video playback show explicit feedback. |
| `dev-tools.html` | Mock-only reset, latency/failure injection and incoming-message controls; not a production administration page. |

## Identity and encryption

`js/auth/identity-client.js` owns session restoration, email challenges, key setup, password changes and security transitions. `auth/password-policy.js` enforces 8–128 characters with uppercase, digit and special character. Passwords retain whitespace. HTTP sends a derived `loginSecret`, not the entered password. `auth/recovery-client.js` uses the implemented `/auth/recovery/*` protocol, replacing historical email/code/reset routes.

`js/crypto/sodium.js`, `derive-worker.js` and pinned local vendor assets implement PLK1 primitives and browser derivation. `device-store.js` stores protected browser key material; `outbox-store.js` persists an encrypted outbox. `chat/encrypted-client.js` handles room keys, local encryption/decryption, replay-safe sends, recovery rotation and subscriptions. `crypto/images.js` prepares encrypted images. Never send decrypted message bodies or private keys as ordinary chat DTOs.

The model is platform-trusted recovery backed by OpenBao Transit. Do not describe it as excluding the platform from recovery access. Key publication, credential changes and recovery use explicit versions and prepare/commit transitions. Ordinary reload can restore a session and unlock history with usable secure browser storage; storage failure and crypto-locked states must remain visible. Cross-tab identity events invalidate stale state.

## HTTP capability map

The source of truth is the implemented controllers plus the identity/encrypted clients, not only `routes.js`. There is no implicit `/api` prefix.

| Capability | Implemented HTTP boundary |
| --- | --- |
| Identity | `/auth/parameters`, register, email/verify, login, login/verify, challenges/resend, refresh, logout, me; `/keys/me`, `/keys/setup/prepare`, `/keys/setup/commit`. |
| Password and recovery | `/auth/password-change/prepare`, `/commit`; `/auth/recovery/request`, `/verify`, `/status`, `/unlock`, `/prepare`, `/commit`, `/login`. |
| Discovery/profile | `GET /search` (legacy array), `GET /search/people` (cursor page), `GET /search/filters`, `GET /users/{id}`, owner identity through `/auth/me`. Profile visibility and email disclosure are enforced by the server. |
| Messaging | `/chat/direct`, `/chat/rooms`, room messages/keys/activation/read/mute/hide, blocks, binary attachment upload/download and own-message export. Cursor pages are processed by the encrypted client. |
| Groups | Prepare/create, participant list/prepare/add/remove, leave, rename and owner transfer. Membership intervals bound accessible message sequences. |
| Settings | `GET/PATCH /settings`; email-change start/verify/resend and email-factor under `/account`; `/notifications` cursor polling. |
| Export/lifecycle | `/account/export/authorize`, `/data`, `/messages`, `/files/{id}`; `/account/deactivate`, `/account/delete`. |
| Forum | `/forum/categories`, paginated `/forum/topics`, topic/reply CRUD and desired-state likes; content versions and 24-hour create deduplication. |
| Adapter-only expectations | Profile update/media, education/certificate CRUD and post/comment CRUD require future server implementation. |

Ordinary DTO normalization accepts bare/data envelopes, requires list arrays and stable string identities, and validates role/onboarding fields. Legacy SQL display projections need explicit mappings. Posts use `job/internship/training`; spheres use `programming/engineering/data-science/marketing`; forum categories use database-backed stable codes. Rich body fields are sanitized; comments/messages are plain text. Profile month dates use `YYYY-MM`, nullable end dates mean ongoing. Auth and encrypted chat have separate versioned contracts: do not force their pages into the legacy full-array normalizer.

## Settings, privacy and lifecycle

[Approved decisions](settings_decisions.md) and [settings API](settings_backend.md) supersede the older mock assumptions.

- Seven preference fields are patched strictly; `twoFactorEnabled` is changed through a password-authorized security action. Email disclosure defaults off; notification preferences default on. Language stores `hy/en/ru`, while the effective interface remains Armenian with an explicit fallback explanation. Theme stays browser-local.
- Email changes require the password and a new-address code; when email factor is enabled, an old-address code precedes it. The address changes only after verification; sessions remain valid. Replacement requests invalidate previous codes. No old-mailbox bypass is offered.
- Browser notifications require an explicit local opt-in, browser permission and Web Locks. Polling runs every 15 seconds with backoff and coordinates tabs. It stops when site tabs close; there is no background Web Push. Message notifications contain a sender name and generic label, not plaintext. Direct messages and forum replies produce live notification events; announcement delivery remains deferred.
- Full export requires the password and a short-lived session-bound header grant. The browser builds a ZIP with JSON and separate files, decrypting own messages/images locally. The source limit is 100 MiB; missing or undecryptable items are recorded in `manifest.json`. Reads are paginated live reads, not a point-in-time snapshot. Legacy external file URLs remain references with explicit unavailability reporting.
- HTTP deactivation retains data and requires operator readmission. Deletion removes personal data and own encrypted message bodies/files while retaining discussion content with a neutral author and required tombstones. Backup retention remains a separate release concern.

## Mock persistence and limits

The mock provider uses one IndexedDB dataset with serialized synchronous transaction actions, persisted ID sequences, blob media and page-local object URLs. BroadcastChannel distributes changes. A fresh/reset dataset auto-signs in the demo owner; logout suppresses this until reset. This is demo behavior only.

Demo credentials: `demo.alumni@polytechnic.am`, `demo.lecturer@polytechnic.am`, and `demo.user5@polytechnic.am` through `demo.user8@polytechnic.am`, password `DemoPass123!`. Mock code: `123456`, ten-minute expiry, five attempts and a 60-second resend interval. Mock data is origin-specific. Neither mock reset nor switching providers provisions real accounts or keys.

Mock validation includes names ≤100, titles ≤255, rich text ≤20,000 visible characters, comments/messages ≤5,000 and nonempty PNG/JPEG/WebP/GIF ≤5 MiB. These are not a substitute for PLK1 packet/upload limits or server validation. Mock study-year conversion uses September/June conventions, not verified academic dates. Mock lifecycle and fixture eligibility must not define production security.

## Running and verification

Follow the [root setup](../README.md) and [backend setup](../backend/README.md), apply migrations explicitly through V15, and select `http` to use real services. Serve with `python3 server.py --port 8001`; use `localhost` consistently for frontend, cookies and API configuration. Use separate browser profiles for different accounts. Frontend-only mock use needs no API server.

[Settings acceptance recorded on 24 October](settings_backend.md) reports nine database-free backend tests, 42 integration tests, 41 contract/client tests and M1–M6 browser phases passing. These are recorded results, not checks rerun for this documentation update. Messenger checks cover HTTP/mock controls and mobile layouts; OS notification presentation and native macOS execution are not established by those results.

Remaining work includes server profile/publication editing, reference-data governance for future editing APIs, translation catalogs, background notification delivery, old-mailbox recovery and M7 production restore/retention gates. Keep selectors stable in the existing HTML, retain sanitization around legacy `document.execCommand`, and use milestone documents for detailed crypto/transport contracts.


## Implemented forum

`js/forum/` uses backend categories, server filtering and cursor pagination, manual refresh, an accessible shared rich-text editor, author actions and draft-preserving edit-conflict review. Topics/replies have separate strict normalizers; page envelopes bypass generic unwrapping. `major` survives only as an upgrade input for old mock records. Mock mode implements the same version, pagination, desired-state like and create-retry contracts. Real reply notifications route to the linked discussion. See `forum_implementation.md` for API/access/deployment rules and `tools/m1/forum-live.mjs` / `forum-ui.mjs` for live and mock acceptance.

The forum implementation was additionally verified on 24 October 2026 with the full suite: 12 local-tool tests, 48 client/contract tests, 11 backend unit tests, 48 SQL integration tests, existing M1–M6 browser phases and live/mock forum browsers. See the forum verification record for the exact scope and platform limits.
