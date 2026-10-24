# PolyLink backend design context

Reviewed 24 October 2026 against current Java controllers/services, migrations V1–V13, frontend provider clients and the settings/messenger handoffs. PolyLink now has an implemented Java 25 / Spring Boot 4.1.1 backend using Microsoft SQL Server, JDBC transactions, SMTP and OpenBao Transit. It is no longer only a design or scaffold.

## Evidence and authority

- `backend/src/main/java/am/polylink/`: executable authentication, recovery, key vault, messaging, groups, lifecycle, settings, notification and export behavior.
- `backend/src/main/resources/db/migration/`: authoritative versioned DDL. The captured legacy inventory under `db/inventory/` supports guarded upgrades.
- [Messenger contracts](messenger/contracts/openapi.yaml), [PLK1 format](messenger/crypto-format.md), payload schemas and fixtures: protocol detail. Check controllers and milestone updates for endpoints added after the original contract.
- [M1](messenger/m1.md), [M2](messenger/m2.md), [M3](messenger/m3.md), [M4](messenger/m4.md), [M5](messenger/m5.md), [M6](messenger/m6.md): implementation, deployment prerequisites and acceptance history.
- [Approved settings decisions](settings_decisions.md) and [settings backend](settings_backend.md): current settings/privacy/export authority, superseding older proposals in `specification_gaps.md`.
- [Frontend context](frontend_context.md): controller ownership, provider boundaries and remaining adapter-only routes.

Ignored local `db/` scripts, report, diagram and backups are historical/reference evidence and may be absent from another clone. Their intended normalized shape must not be substituted for the captured baseline plus applied migrations. The working database's applied version must be checked separately; source availability or a successful test database upgrade does not prove deployment.

## Implemented domain and boundaries

The platform connects graduates and lecturers through discovery, profiles and direct/group messaging. Announcement, education and certificate tables remain from the legacy domain; their full write APIs have not been implemented. The career forum now has its own authenticated API and frontend integration. `events.html` is a job/internship/training feed, with no event calendar, RSVP or attendance entity. Help, policies and tutorials remain static content. WorkExperience has no connected editor/API.

| Area | Current server implementation |
| --- | --- |
| Identity | Invitation admission, email verification, password-derived login proof, optional email login factor, sessions/refresh, logout and versioned key setup. |
| Security continuity | Atomic password changes, other-device session revocation, protected browser restoration, email-based account/history recovery and identity rotation. |
| Profiles/discovery | Owner identity, public member-profile projection and search; visibility/disclosure checks. General profile/education/certificate/media mutations remain absent. |
| Messenger | Encrypted direct/group text and images, key epochs/envelopes, idempotent sends, cursor history, read/mute/hide/block state and protected attachment access. |
| Groups | User-created rooms, owner transfer/rename, add/remove/leave and sequence-bounded membership intervals. |
| Settings | Privacy, language, notification preferences, staged email changes and password-authorized email factor. |
| Forum | Database categories, cursor topics/replies, owner edits/deletion, desired-state likes, optimistic versions and create deduplication; independently enabled after V13. |
| Notifications | Transactional messenger/forum events, cursor browser feed, batched message email and individual forum notices; announcement producers remain deferred. |
| Export/lifecycle | Password-authorized full export, own encrypted messages/files, deactivation, account deletion and deletion ledger. |

The code uses explicit JDBC/SQL service boundaries; domain JPA entity mappings are not implemented. SQL FKs alone do not enforce principal ownership, room membership, role consistency or visibility. Services must maintain these invariants transactionally.

## Schema evolution and deployment

| Migration | Responsibility |
| --- | --- |
| V1 | Captured restored-schema baseline: 27 legacy tables and their actual constraints. |
| V2 | Separate `auth`, `keyvault`, `messaging` foundation. |
| V3 | Identity enrollment, challenges and session rotation. |
| V4 | Independent access credentials and password/session continuity. |
| V5 | Recovery authorizations and atomic recovery support. |
| V6 | Private encrypted attachment bodies. |
| V7 | Dynamic groups, membership intervals and lifecycle. |
| V8 | Remove obsolete dbo chat tables, legacy mapping and group import. |
| V9 | Remove `dbo.Users.PasswordHash` and `TwoFactorEnabled`; active identity state remains in auth/keyvault. Legacy values are discarded, not imported as trusted credentials. |
| V10 | Account settings, staged email changes and notification state/queues. |
| V11 | Armenian language availability and session-bound account-export grants. |
| V12 | Forum categories, versions/UTC projections, review/takedown audits, create deduplication and notification references. |
| V13 | Required topic categories and UTC timestamps after reviewed legacy backfill. |

Use `SchemaCommand inventory`, guarded `upgrade` for restored/existing databases, and `fresh` only for empty databases. Migrations use separate migration credentials and run explicitly. Startup disables Flyway and SQL initialization; Hibernate is configured for validation. Never edit applied migration checksums or bypass baseline drift checks. V8/V9 removal requires a verified backup and stopped application access with matching backend deployment. See [schema workflow](messenger/schema-and-migrations.md).

Legacy education/lecturer data uses normalized university, degree, specialization, institute, department and profession references. Registries do not establish an automatic verified account claim. University/specialization verification flags do not implement an approval workflow. Certificate URL length and profile date precision require reconciliation when those APIs are built. Forum uses a separate seeded category dictionary and flat replies. Historical topics require reviewed category mappings and source timezone through the V12 maintenance workflow; see [forum operations](forum_implementation.md).

Legacy dates include `DATE` and `DATETIME2` defaults without an authoritative source timezone. Current protocol timestamps/version/sequence values follow messenger contracts; do not reinterpret historical timestamps or turn year/month profile inputs into verified graduation days. Legacy INT keys can be serialized as opaque strings at the frontend boundary.

## Identity, key custody and recovery

`auth` owns admission, enrollment, challenges, rate limits, credential/session versions and independent access records. `keyvault` owns backed-up encrypted client key material and Transit integration. `recovery` owns recovery authorizations and prepare/commit transitions. Password changes preserve encrypted history and revoke other device sessions.

The browser derives PLK1 login/wrapping material using local libsodium/Argon2id assets. The entered password is not sent as an ordinary API field. HTTP authentication uses `loginSecret` and derivation metadata, with server-side protected verifiers. Client private identities and message plaintext are not ordinary resource DTOs. Secrets and proof must never enter logs or notification queues.

Recovery is explicitly platform-trusted: OpenBao Transit protects the service recovery copy, enabling the approved email-based recovery process. This is not a claim that the platform cannot recover vault keys. Users do not manage manual recovery keys. Recovery supports protected device and service unlock, resumable authorization, bounded prepare/commit and key rotation; stale versions and lost responses require the protocol's replay/conflict handling.

Registration uses operator-issued email/role invitations and email ownership verification. General alumni/lecturer registry claims, exceptions and university-wide admission policy remain separate decisions. Never grant admission from mock IDs, seeded hashes, arbitrary role flags or matching display names.

Current `application.properties` defaults identity to enabled and messenger to disabled; environment configuration can override both. Identity needs configured HMAC/replay secrets, mail and working Transit prerequisites. Messenger requires explicit enablement and the matching schema. Do not infer operational availability from source flags alone.

## HTTP and authorization boundary

The backend listens on loopback port 3004 by default; the default allowed frontend origin is `http://localhost:8001`. Security configuration permits implemented boundaries and denies other routes. Credentialed cookies and CSRF requirements are part of the protocol. Frontend access tokens live in memory and refresh is coordinated; tokens must not be restored from localStorage.

| Boundary | Implemented endpoints |
| --- | --- |
| Identity | POST `/auth/parameters`, `/auth/register`, `/auth/email/verify`, `/auth/login`, `/auth/login/verify`, `/auth/challenges/resend`, `/auth/refresh`, `/auth/logout`; GET `/auth/me`. |
| Keys/password | GET `/keys/me`; POST `/keys/setup/prepare`, `/keys/setup/commit`, `/auth/password-change/prepare`, `/auth/password-change/commit`. |
| Recovery | `/auth/recovery/request`, `/verify`, `/status`, `/unlock`, `/prepare`, `/commit`, `/login` (status is GET; others POST). |
| Discovery | GET `/users/{userId}`, `/search`. |
| Chat | POST `/chat/direct`; GET `/chat/rooms`, `/chat/export`; room message GET/POST, key read/activate, read/mute PUT, hide POST, block PUT and binary attachment upload/download. |
| Groups | POST `/chat/groups/prepare`, `/chat/groups`; participant read/prepare/add/remove, leave POST, room rename PATCH and owner PUT. |
| Settings | GET/PATCH `/settings`; POST `/account/email-change/start`, `/verify`, `/resend`; PUT `/account/email-factor`; GET `/notifications`. |
| Export/lifecycle | POST `/account/export/authorize`; GET `/account/export/data`, `/messages`, `/files/{id}`; POST `/account/deactivate`, `/account/delete`. |

Frontend adapter mappings for profile update/onboarding/media, education/certificates and posts/comments remain expectations rather than implemented controllers. Forum topics/replies/likes have implemented HTTP contracts and separate page-aware normalizers. HTTP failures remain visible; there is no fallback to fixtures. The historical forgot/verify/reset routes and plain `{email,password}` login contract are obsolete for real identity.

Server ownership comes from the authenticated principal, never body `userId`/author/timestamps. Public projections exclude authentication metadata and undisclosed email; search never exposes email. Closed profiles remain discoverable with `canOpenProfile=false`, while another member's profile read returns 404. Legacy public media URLs cannot become private retroactively; future upload/storage APIs must enforce visibility.

## Messaging consistency and lifecycle

Message bodies and image payloads are encrypted client-side. The server validates protocol structure, membership, epochs, versions and bounded binary payloads, and persists opaque ciphertext. Membership intervals bound historical visibility; key envelopes and activation must match authorized membership. Message retry/idempotency and monotonically ordered room sequences are protocol requirements, not optional frontend conveniences.

Direct contact reuses a pair. Blocking prevents direct communication; mute and hide are per-user state. Group owners manage members and transfer ownership; membership changes invalidate stale sends/key transitions. Read state and history pagination are authoritative server operations. Local search works over loaded/decrypted history, not a server plaintext index.

Deactivation immediately suspends access while retaining data and requires operator readmission. Deletion retains posts/comments/topics/replies with a neutral author, removes structured personal data and own encrypted message bodies/files, preserves necessary neutral references/tombstones, and cancels pending settings/export/activity state. Deletion-ledger replay and restore procedures remain essential; do not promise immediate erasure from backups. See M6 and the settings lifecycle updates.

## Settings, notifications and full export

`GET/PATCH /settings` supports seven mutable preference fields with strict unknown-field/null/type rejection. The email-factor flag is read-only here. New accounts default to public profiles, hidden email, Armenian language and enabled notification preferences; existing visibility/language/preferences are preserved. Theme and browser notification opt-in stay local. Stored `hy/en/ru` does not imply translated interfaces.

Email change requires password-derived proof and a new-address code, plus an old-address stage when email factor is enabled. Requests replace earlier requests; codes expire after ten minutes, allow five failed attempts per stage and use a 60-second resend cooldown plus account rate limits. Successful change preserves sessions and crypto versions and notifies the old address. Email-factor changes require password proof and cancel pending email-change/login challenges. Unavailable old-mailbox recovery is not specified; no password-only bypass is offered.

Only messenger sends currently produce activity events. Announcement/forum categories reserve future integration and must not be advertised as delivering today. Email batches eligible unread messages after a 60-second delay, rechecks mute/block/read/category state, claims work with a two-minute lease, releases SQL locks before SMTP and retries failures. Delivery is at least once; a failure after SMTP success may duplicate mail. Browser cursors establish a baseline and return bounded eligible events. Frontend polling needs explicit permission/local opt-in and stops when all site tabs close; no Web Push exists. Notifications never include message plaintext.

Full export requires password proof and a 15-minute grant passed only through `X-Export-Grant`, bound to the original session and credential version. Paginated export includes own profile/settings/education/certificates/publications/discussion contributions/sent messages/files, excluding credential tables, keys and other participants' message bodies. The browser decrypts own messenger data and builds a ZIP STORE archive with JSON and separate files, rejecting source data above 100 MiB. `manifest.json` records missing/undecryptable content. Live reads are not a transactional cross-table snapshot. Unmapped legacy external URLs are reported unavailable; the server does not fetch arbitrary URLs.

## Verification and remaining gates

The [24 October settings acceptance](settings_backend.md) records nine database-free backend tests, 42 disposable SQL/OpenBao/SMTP integration tests, 41 contract/client tests and M1–M6 browser phases passing. Test helpers await actual handlers and completed HTTP operations. These are historical acceptance results, not a rerun during this documentation update. Acceptance used disposable databases/dependencies and did not migrate or restart the working deployment. OS notification display and native macOS operation were not manually established.

Run backend `./mvnw verify` for formatting/build/database-free tests. Use `bash tools/local/test.sh --full` or the milestone runner options in `tools/m1/verify.py` for isolated SQL/Transit/mail/browser acceptance. Keep schema/config prerequisites and platform limitations visible; [backend setup](../backend/README.md) and [local runbook](../tools/local/README.md) describe configuration.

Remaining gates: M7 production backup retention/restore/deletion-ledger rehearsal; unavailable-old-mailbox recovery; legacy external-file migration/private media storage; production TLS/origins/secret custody; general registry admission policy; full profile/publication/forum APIs and notification producers; reference-data authority/date precision; translation catalogs. Future domain writes need explicit validation, rich-content sanitization, pagination, concurrency and retention contracts rather than copying mock behavior.
