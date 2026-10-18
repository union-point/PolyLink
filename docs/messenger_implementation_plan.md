# PolyLink messenger implementation plan

Planning baseline: 18 October 2026. The authority for product behavior is the [agreed messenger specification](messenger_spec.md), including its 18 October recovery and session decisions. This plan translates it into implementation work; proposed names, endpoints, schema details and algorithms below become contracts only when recorded and verified in the corresponding milestone. No messenger functionality is implemented by this document.

M0 handoff, 18 October 2026: [contracts, schema migrations and validation evidence](messenger/README.md) are now present. The handoff records selected engineering formats and remaining M1/M6 gates; later implementation must use those versioned contracts rather than treating the proposals below as existing APIs.

M1 follow-up: [implementation and deployment](messenger/m1.md) uses the approved email-bound invitation admission flow. Authentication and fully backed-up key setup are opt-in; remaining milestones and target-platform release checks are explicit in that handoff.

M2 follow-up: [encrypted direct text implementation and verification](messenger/m2.md) adds opt-in messaging, backed-up participant envelopes, sequenced sends/history, encrypted persistent retries and browser polling. Later milestones retain their stated scope.

## 1. Starting point and delivery strategy

The repository has a Java 25 / Spring Boot 4.1.1 scaffold, Maven verification and optional SQL Server integration tests. Security currently permits health only; Flyway is disabled pending reconciliation of the restored database. There are no domain entities, authentication APIs or messenger APIs.

The vanilla JavaScript frontend already separates controllers, services and data providers. `js/services/index.js` exposes chat operations, but `js/data/http/routes.js` has no chat mappings and the HTTP provider's subscription is empty. `js/chat.js` loads complete histories and redraws/scrolls to the bottom. The mock uses time-based read/hide markers and incorrectly applies direct blocking to groups. `js/data/http/transport.js` persists access tokens in localStorage, which conflicts with the agreed memory-only access-token policy. Existing auth routes also transmit raw passwords and must change with the backend.

Deliver working browser-to-database slices in this order:

1. Freeze the first contracts and establish repeatable schema migrations.
2. Implement minimal real identity/session handling, OpenBao and fully backed-up client key setup together.
3. Deliver encrypted direct text messaging with ordering, retries and history.
4. Prove navigation and new-device access using the password copy, then ordinary password change.
5. Deliver atomic account/history recovery and automatic key rotation.
6. Complete images, personal state, polling UX, existing groups and account lifecycle integration.
7. Verify migration, supported browsers, failures and operational recovery before release.

The first text exchange is an intermediate milestone. Version 1 is complete only after all specification acceptance criteria pass, including recovery. Retain fixed group membership, REST polling and the existing multipage frontend. Group-management UI, WebSockets, presence/read receipts, message editing, TOTP, recovery codes and participant-assisted recovery stay out of scope.

## 2. Component boundaries

Keep one backend application and one Maven module. Proposed capability packages under `backend/src/main/java/am/polylink/`:

| Capability | Responsibility |
| --- | --- |
| `auth` | Admission checks, pre-login parameters, server verifier, email challenges, sessions, password transitions and recovery authorization. |
| `keyvault` | Versioned user key bundles, identity directory, setup/recovery packages and guarded updates. No public profile mutation may update these records. |
| `chat` | Rooms, permissions, personal state, message sequence, send deduplication, history and room-key activation. |
| `attachments` | Private encrypted objects, upload ownership, atomic message binding, authorized download and cleanup. |
| `recovery` | Recovery state machine, preparation, status and atomic activation coordinated with auth/keyvault. |
| `infrastructure` | Narrow OpenBao adapter, mail delivery, private file storage, clock/configuration and redacted operational events. |

Keep HTTP DTOs separate from persistence entities. Put transactions and rules in application services. Use JPA for ordinary persistence and explicit T-SQL/repository methods for critical locking and cursor queries. Do not let a controller orchestrate a partial recovery commit.

On the client, add `js/crypto/` for the pinned libsodium wrapper, binary formats, key vault, device store and encrypted outbox. Add an application-level auth/key coordinator used by all protected pages. Feature services return decrypted view models to renderers; the HTTP adapter receives only prepared ciphertext for chat. Centralize crypto orchestration rather than duplicating it in controllers or placing raw passwords in route DTOs.

## 3. Contracts to freeze before dependent code

Create versioned OpenAPI schemas and a short crypto-format decision record in milestone M0. Include successful transitions, expected-version fields, errors, size bounds, retry semantics and test vectors. Do not reopen the agreed trust model: the platform can recover keys; this is not operator-inaccessible E2EE or a Signal protocol implementation.

| Contract | Proposed direction / required decision | Deadline |
| --- | --- | --- |
| Eligibility | Map actual account roles, active/admitted state and verified email to an authoritative server principal. Resolve missing general-account rules; fixtures and frontend flags cannot grant admission. | Before M1 auth acceptance. |
| Password derivation | Pin a libsodium.js distribution exposing Argon2id; benchmark it on target Linux/macOS browsers. Produce a 32-byte master secret, then use libsodium KDF with distinct registered 8-byte contexts for login and password wrapping. Freeze salt encoding, parameter floors/ceilings and scheme version. | Before M1. |
| Server verifier | Select and benchmark an audited server password-hashing implementation for the derived login secret, with an independent salt and stored parameters. Define client password validation and server bounds on submitted derived secrets; the server cannot inspect the original password. | Before M1. |
| Content and vault format | Proposed XChaCha20-Poly1305 with fresh random nonces and canonical AAD. Freeze field encodings, keys/nonces/tags, text normalization, size formulas and owner/purpose/version binding. Message AAD uses pre-send identifiers; a server sequence assigned later cannot be required for initial encryption. | Before M1/M2 format use. |
| Participant envelopes | Proposed libsodium sealed boxes containing the room key plus room, recipient, identity, membership and room-key versions. Check those bindings after opening: sealed boxes have no separate AAD argument and do not establish sender authorship. | Before M2. |
| Sessions | Proposed opaque random access/refresh credentials with hashed server records, a short access lifetime, immediate server-side revocation checks and explicit family/credential versions. Finalize cookie names/paths, refresh rotation, concurrent-tab handling, CSRF and allowed frontend origin. | Before M1. |
| Email | Real delivery configuration; neutral unknown-account behavior; aggregate account/IP and resend limits in addition to the agreed code lifetime/attempt cap. Include anti-enumeration handling for pre-login salts and parameter responses. | Before M1. |
| OpenBao | Pin image/digest, persistent storage, Transit algorithm/context scheme, service auth/renewal, least-privilege policy, TLS, timeouts and bounded retries. Record how owner/purpose/vault-version binding is checked. | Before M1. |
| Attachments | Choose private storage and freeze binary upload format, encrypted metadata, ciphertext overhead, upload expiry, reuse after a rejected send and cleanup. Derive limits from the agreed 5 MiB plaintext maximum. | Before M5. |
| Legacy/lifecycle | Agree original timestamp zone, treatment of 55 plaintext demo messages, account-deletion/group transition, backup retention and deletion replay after disaster recovery. | Before migrating existing data / M6. |

The KDF and AEAD proposals use documented libsodium operations, not a new cryptographic construction. Validate exposed JS functions and package loading before freezing the format; keep a reviewed local asset/version rather than fetching mutable crypto code at runtime. Official references: [key derivation](https://doc.libsodium.org/key_derivation), [XChaCha20-Poly1305](https://doc.libsodium.org/secret-key_cryptography/aead/chacha20-poly1305/xchacha20-poly1305_construction), [sealed boxes](https://doc.libsodium.org/public-key_cryptography/sealed_boxes), and [libsodium.js](https://github.com/jedisct1/libsodium.js).

Transit stores protective keys; the application stores returned ciphertext in SQL Server. Retain protective key versions required by live copies and supported backups. Review context binding and rewrap against the pinned version's [OpenBao Transit documentation](https://openbao.org/docs/secrets/transit/).

## 4. Persistence and transaction design

These are logical models, not approved DDL. Reconcile actual SQL types, constraints and foreign keys before writing migrations.

| Model | Essential data and constraints |
| --- | --- |
| Account security | Credential version, client salt/KDF parameters/scheme, separately salted server verifier, verified-email and admission state. Reject historical fake password hashes as authentication material. |
| Sessions and challenges | Hashed random session credentials, session family, idle/absolute expiry, revocation and credential version; purpose-bound challenge verification using a server secret outside SQL, attempt/resend/aggregate counters. |
| User key vault | Encrypted vault, password-wrapped vault key, Transit service copy, vault-key version and independent content revision. Store historical private keys only inside encrypted vault data. |
| User identities | Public key and identity version, current identity pointer and guarded activation. Preserve historical references required by envelopes. |
| Setup/recovery operations | Owner, operation ID, state, expiry, base versions, immutable package fingerprint, prepared ciphertext and server verifier, completion result. Never persist raw login secrets or plaintext vault keys. |
| Rooms/direct pairs | Room kind/status, membership revision, last committed sequence; separate canonical `(lowerUserId, higherUserId)` unique pair mapping to one direct room. No self-pair. |
| Participant state | Membership start sequence for the fixed continuous interval, monotonic last-read sequence, personal history cutoff, hidden and mute state; unique room/user. |
| Direct blocks | Unique owner/target relationship; evaluate both directions for direct send without disclosing the other user's block. |
| Messages/send operations | Unique `(roomId, sequence)` and `(roomId, senderId, clientOperationId)`, ciphertext, protocol/key versions, server time, canonical request fingerprint and durable result/tombstone. |
| Room-key epochs/envelopes | Room-key version, membership revision, complete participant identity-version snapshot; one envelope per intended recipient/version, retained for allowed historical messages. |
| Attachments | Private object ID, owner/room, byte size and digest, staged/bound/deletion state and message binding. Filename/MIME/key material needed to render are inside encrypted metadata. |

Index history by `(RoomId, Sequence)` with appropriate projections; participant lookup by user; envelopes by recipient/room/key version; operation uniqueness and cleanup by state/expiry. Serialize SQL `BIGINT` sequences as decimal strings at the JavaScript boundary and compare without unsafe `Number` conversion. Use explicit UTC instants for new records; retain legacy uncertainty until its zone is established.

Define and test one lock order: affected account-security rows by ascending account ID, room rows by ascending room ID, then dependent participant/operation rows. A send locks/revalidates the room's relevant account versions and membership before committing; identity activation takes the same account locks. If membership changed while discovering affected accounts, restart against the new snapshot. Block/deactivation/deletion and room-key activation use the same ordering. Use explicit SQL Server locking for critical sections and bounded whole-transaction retries for deadlocks. Network calls never occur while SQL locks are held.

Critical transactions:

1. **Open direct room:** validate both accounts and self/block rules; insert canonical pair/room/participants atomically. On unique-pair collision, load and return the winner. Reopening only changes the caller's hidden state; its cutoff survives.
2. **Send:** check current authorization to access the operation result; resolve a matching stored operation before testing current key freshness. A matching replay returns the original result subject to history/deletion restrictions. A mismatched fingerprint conflicts. For a new operation, validate send rights and identity/membership/key versions, allocate `lastSequence + 1` under the room lock, bind any staged attachment, write message/dedup result and advance the room counter in one commit. Concurrent requests with the same operation must resolve before returning a definitive “not saved.”
3. **Sequence visibility:** retain the room sequence lock until commit, so sequence N+1 cannot become visible before N. Avoid identity/SQL sequence allocation alone as a history cursor: allocation order does not guarantee commit order. Rollback cannot expose an uncommitted cursor watermark.
4. **Setup/key activation:** verify expected revisions and complete recipient versions; atomically accept a single fully backed-up setup or room-key package. A losing client discards its candidate and opens the accepted package. Recheck identity snapshots at every send; do not trust a cached `ready` flag.
5. **Read/hide:** advance read monotonically to an accessible shown sequence, bounded by committed history. Hide records a server-selected committed cutoff under the room lock and hides only that participant's view. Later incoming messages reveal the room while retaining the cutoff.
6. **Recovery commit:** revalidate recovery authorization, account state, base versions and ready-package fingerprint; activate verifier/KDF metadata, vault/copies and any new identity together; increment credentials, revoke prior sessions and competing recovery operations, and persist the completed result. Other users' room rows need not be rewritten: changed identity snapshots make old room keys stale on the next operation.

Retain send deduplication records or minimal tombstones until account deletion, including after body removal. Specify SQL Server cascade behavior deliberately: existing non-cascading author references prevent naive physical account deletion. Preserve neutral message positions and necessary idempotency results when removing bodies.

## 5. Proposed HTTP and client contracts

Keep the existing base URL convention and use DTO IDs as strings. The following paths are proposals to implement together with `js/data/http/routes.js`; none are existing messenger routes.

| Area | Proposed operations |
| --- | --- |
| Authentication | `POST /auth/parameters`, `/auth/register`, `/auth/login`, `/auth/login/verify`, `/auth/challenges/resend`, `/auth/refresh`, `/auth/logout`; `GET /auth/me`. Registration/password mutations accept derived login material and crypto packages, never a raw password. |
| Password changes | `POST /auth/password-change/prepare`, `/auth/password-change/commit` with current authorization, expected credential/vault revisions and new verifier input/password copy. |
| Recovery | `POST /auth/recovery/request`, `/auth/recovery/verify`; `GET /auth/recovery/status`; `POST /auth/recovery/unlock`, `/auth/recovery/prepare`, `/auth/recovery/commit`. Account and service ciphertext are always selected by the server from the recovery session. |
| User keys | `GET /keys/me`, `POST /keys/setup/prepare`, `/keys/setup/commit`; authorized `GET /keys/users/{userId}`. Keep setup, backup and identity activation distinct from profile writes. |
| Rooms/history | `GET /chat/rooms`, `POST /chat/direct`, `GET /chat/rooms/{roomId}/messages`, `POST /chat/rooms/{roomId}/messages`. |
| Room keys | `GET /chat/rooms/{roomId}/keys` for allowed envelopes/current snapshot; `POST /chat/rooms/{roomId}/keys/activate` with all expected versions. |
| Personal state | `PUT /chat/rooms/{roomId}/read`, `/mute`; `POST /chat/rooms/{roomId}/hide`; `PUT /chat/blocks/{userId}`. |
| Encrypted images | `POST /chat/rooms/{roomId}/attachments`, `GET /chat/attachments/{attachmentId}`; message submission atomically consumes/binds an authorized staged upload. |

Use a consistent error envelope with stable `code`, safe `message`, optional field errors and retry metadata. Define 401/session expiration versus 403/action denial; use a consistent non-enumerating not-found policy for inaccessible chat resources. Version conflicts distinguish `KEY_STALE_NOT_SAVED`, `ROOM_KEY_PENDING`, `REVISION_CONFLICT` and `OPERATION_PAYLOAD_CONFLICT`. A timeout/5xx is not proof that a send was rejected. The outbox retries its exact original operation/bytes until the result is known; only a definitive unsaved rejection permits re-encryption under a new operation. CSRF/session refresh retries must preserve the operation and bytes.

History returns `{items, nextBefore, nextAfter, hasMore}` with stable exclusive sequence cursors, ordered records, default 50 and maximum 100. Old-history and catch-up directions are distinct; each response is filtered by the caller's current membership/cutoff, including attachment access. Deleted message positions remain neutral tombstones. Room DTOs expose separate `blocked`, `closed`, `canSend`, `unreadCount`, versions and encrypted last-message material; plaintext previews are computed locally.

Unread counts include accessible messages from other senders after both the read marker and personal cutoff. A visible open room acknowledges only the last message successfully displayed, never the server's latest timestamp or a newly arrived unseen message. Preserve scroll anchors when prepending history or merging updates, and label search as applying to loaded history.

Encrypt image bytes and metadata before upload. Download ciphertext through an authorized Bearer request, decrypt and validate it locally, then render a `blob:` URL; revoke object URLs when records/accounts are disposed. A bare image URL cannot carry the access header. The server validates ciphertext bounds, ownership and binding rather than claiming to inspect plaintext image type or exact text length.

Poll while the document is visible, approximately every 2–3 seconds, with one request chain per selection, cancellation/generation guards and bounded backoff/jitter. Catch up from the last committed sequence in pages before advancing the local cursor; merge by server identity. Refresh bounded room summaries to obtain incoming/reopened rooms and unread changes. Freeze stable room-list pagination/reconciliation rules in M0 so activity during a scan cannot permanently hide a room. On reconnect/refocus reconcile summaries and active history immediately. Polling failures must not wipe history, compose state or scroll position.

## 6. Client authentication, storage and recovery flows

**Complete login/setup.** Obtain validated KDF parameters, derive secrets in browser memory, authenticate and finish optional email verification inline on the login page. Keep derivations in memory until that step completes. Open the password copy or complete first setup with vault and both copies before publishing identity. Only after full login create a non-extractable AES-256-GCM device key in IndexedDB, save the encrypted local vault-key copy, then navigate. Resolve concurrent first setups by expected versions and a single winner.

**Every protected page.** Restore the session with a Secure/HttpOnly refresh cookie and keep access tokens only in page memory. Validate account/session-family/credential/vault versions before opening the device copy. Bind its AAD to account, local record ID, purpose and vault-key version with a fresh 96-bit IV. A temporary network failure waits; a revoked or mismatched session prevents opening and clears stale secrets. No offline unlock is added. Clear the old localStorage access-token entry during the transition.

**Multiple tabs/logout.** Coordinate refresh rotation and device-record changes across tabs; broadcasts carry events/versions, never open secrets. Enforce the agreed refresh expiry of 7 days idle / 30 days absolute. Logout immediately clears that account's local device key, encrypted local key copy, cached account content/outbox and decrypted memory even when server logout fails. A persistent local logout marker prevents cookie-based automatic login until an explicit login; report whether remote revocation is still pending. Check revocation on polling/refocus and clear all affected tabs after detection. For back/forward-cache restoration, hide sensitive content until renewed session/version validation succeeds.

**Browser limitations.** Verify IndexedDB structured cloning of a non-extractable `CryptoKey` on target browsers. Handle blocked storage/quota/migration errors explicitly. Password-based access remains possible if persistence fails; explain why navigation then requires password re-entry. Never downgrade to open keys in localStorage. Any persisted draft/outbox is encrypted; an ambiguous lost operation must not be automatically replaced with a new send.

**Password change/local recovery.** Prepare new derivation parameters, server verifier input and password copy of the same vault key. Atomically update them with credential versioning; preserve the identity, vault and service copy. Reauthenticate and save the new device record before navigation. Recovery using an already open, current vault key follows the same guarded commit without requiring OpenBao.

**Service recovery.** Enforce the agreed 6-digit email code, 10-minute expiry, five wrong attempts and 60-second resend delay plus aggregate limits. Verification creates a separate 30-minute Secure/HttpOnly recovery cookie with CSRF protection and limited purpose. Unverified requests do not revoke sessions or an already verified recovery; a newly verified operation supersedes prior unfinished recovery. Recovery does not reactivate or readmit accounts.

Model recovery as `VERIFIED -> PREPARING/WAITING_SERVICE -> READY -> COMPLETED`, with terminal `CANCELLED` and `EXPIRED` states. Before SQL commit, the browser opens the existing vault, preserves historical private keys, creates a new identity and vault key for every service-unlock path, validates the new password copy, and prepares an immutable package. The backend hashes the new login secret, creates the new Transit copy and verifies its round-trip before marking ready. Persist only ciphertext/metadata/server verifier. Recheck versions after network work. The local-key path retains the identity and existing service copy.

Commit the ready package atomically as described above. A completed recovery cookie can retrieve its result/status but can no longer unlock keys; it remains status-only until its original expiry. Lost commit responses and repeated commits return that same result. Allow a single purpose-bound email-verification handoff to satisfy the next automatic login's optional second factor. Recreate the device copy before navigation. Reload resumes from the cookie/status; if the new password was lost before readiness, request it again without storing it. OpenBao outages never activate a new password ahead of its usable vault.

After service commit, load history immediately using preserved old private keys/envelopes. Prioritize automatic room-key rotation for the open room, then other sendable rooms. Any current unlocked participant can win activation for the current complete recipient snapshot, without peers online. Losing candidates reload the accepted epoch; changed identities restart preparation. A later client resumes unfinished rotation. Missing published keys block secure sending rather than falling back to plaintext; history need not wait for every room's rotation.

## 7. Milestones and reviewable work packages

Each milestone includes backend, browser integration and its acceptance checks. Split implementation into small PRs within the milestone while keeping incomplete routes unavailable. Do not enable the HTTP messenger globally before its dependencies pass.

| Milestone | Work and concrete deliverables | Exit evidence |
| --- | --- | --- |
| **M0 — Contracts and schema foundation** | Inventory the restored schema read-only; record eligibility/legacy dependencies. Add OpenAPI and crypto-format decisions, logical-to-physical schema mapping and lock-order notes. Create a reviewed Flyway baseline and additive migrations; define explicit fresh-install versus existing-baseline paths, synthetic fixtures and isolated SQL integration provisioning. | Fresh DB and restored-copy upgrade both validate; no automatic baseline of an unknown schema, deletion of existing content or promotion of fake auth hashes. Contract fixtures cover failure transitions and independent versions. |
| **M1 — Real auth and backed-up identity** | Implement admission/email ownership, pre-login parameters, challenge delivery, verifier/session records and minimal auth UI changes. Add OpenBao container/configuration/runbook and narrow adapter. Implement client derivation, vault setup, two copies, guarded identity publication, device store and protected-page bootstrap. | Two eligible users complete setup; ordinary sessions never authorize service unlock. Failed Transit setup publishes no identity. Inline optional 2FA, local logout and memory-only access tokens work. Crypto round-trips/tamper tests and session/CSRF checks pass. |
| **M2 — Encrypted direct text slice** | Add direct-pair uniqueness, participant authorization, room keys/envelopes, message transaction, persistent outbox, sequenced history and actual HTTP mappings. Integrate basic polling and decrypted render models. | Two clients exchange text while a third cannot access rooms/messages/envelopes. Offline configured recipient later reads its first message. Parallel room/key creation yields one winner; retries produce one message; commit-order catch-up misses none. |
| **M3 — Session continuity and password lifecycle** | Complete protected-page integration beyond chat, cross-tab refresh/version handling, new-device login, ordinary password change and storage failure UX. | Login → profile → chat, reload and browser restart require no repeated password during a valid session. A clean browser opens history by password while OpenBao is unavailable. Password change preserves keys/history and revokes old sessions. |
| **M4 — Atomic recovery and rotation** | Implement email recovery states/cookie, local-key and Transit unlock paths, durable prepare/status/commit, post-recovery login and per-room key activation. Add interruption, retry and concurrency tests before exposing recovery. | Loss of all devices/password restores retained allowed direct/group history. Service path rotates identity/vault and future room keys; local path preserves them. Failures, reloads and lost responses never leave new auth with an unusable old copy. Competing recoveries/identity changes cannot overwrite newer state. |
| **M5 — Full messenger UI and images** | Add encrypted staged images/private downloads; sequence-based read/unread/hide, mute/direct blocking and server `canSend`. Implement paginated merge/scroll anchoring, visible-page polling/backoff, loaded-history search and local previews; update mock semantics for the same UI contracts. | Text ≤5,000 UTF-16 units after agreed trim; one allowed image ≤5 MiB; image-only works. Both clients validate decrypted limits/type. Hidden history stays inaccessible; incoming reopens the room. Group send ignores direct blocks. New arrivals do not mark unseen messages read or move a reader off old history. |
| **M6 — Existing groups, legacy and account lifecycle** | Exercise fixed group initialization/missing-key states and recovery. Implement the agreed non-destructive legacy migration path. Integrate deactivation, neutral deleted-message positions, attachment/body deletion, direct closure and safe group departure rotation. Provide own-message/own-attachment export through client decryption and general export integration. | No plaintext legacy record is mislabeled encrypted. Deactivated recipients cannot receive direct sends; deleted users cannot send/recover. Group removal makes old epochs unsendable until rotation. Export excludes others' message bodies and key secrets. Hidden/deleted history is not restored by key recovery. |
| **M7 — Release and recovery rehearsal** | Run the full acceptance matrix, supported-browser checks and SQL/OpenBao restore drill. Document migration rollout/rollback boundaries, health/degraded behavior, secret handling, backup retention, deletion replay, Transit rewrap and operator unseal. | All 27 specification criteria have evidence; clean-clone setup works on Fedora and both Macs. Recovered SQL + OpenBao copies decrypt retained history. Sealed/unavailable Transit delays service recovery while ordinary ready-key messaging works. |

Critical path: **M0 → M1 → M2 → M3 → M4 → M5 → M6 → M7**. Basic group fixtures may be introduced earlier to verify recovery, and image/state/UI work can follow the M2 contracts while M4 is developed. Do not infer calendar dates from this ordering: estimate after M0's schema, browser KDF and recovery-format work resolves the main uncertainties.

For a three-developer team, use ownership by capability: auth/keyvault/recovery; chat/persistence/files; client crypto/auth/chat UI. Review shared DTO/crypto/locking changes across those boundaries. No workstream may substitute mock authorization for an unfinished dependency.

## 8. Verification and specification traceability

Add focused crypto vector/tamper tests, server permission/state tests, real SQL Server race tests with separate connections, and browser scenarios with separate profiles/tabs. H2 is not evidence for sequence/lock/constraint correctness. Test actual browser libsodium and `CryptoKey` persistence; API tests alone do not validate recovery UX or cross-page memory rules.

| Specification §11 acceptance criteria | Milestones and required evidence |
| --- | --- |
| 1, 3, 25, 26 | M2/M4: unique rooms/operations/key epochs; deliberately reversed commit timing; same-operation concurrent requests, lost send response followed by rotation, mismatched fingerprints and stale-version rejection. |
| 2, 13, 14 | M1/M2/M5: inspect request payloads, SQL rows and captured application/proxy/test logs for synthetic canary secrets/content. Verify key-purpose separation and separate server hashing. Permit only the specified transient vault-key service flow. |
| 4, 5, 15, 16 | M3: isolated browser, unavailable Transit, password change, multipage navigation/restart, IndexedDB failure, multi-tab refresh/logout and revocation detection. Ensure message reads/sends invoke neither Argon2id nor Transit. |
| 6, 8, 9, 22, 27 | M4: both recovery paths, both peers offline or independently recovering, historical key preservation, client closed during rotation, service failure before readiness, crash before/after commit, lost response, reload and expired/superseded operations. |
| 7, 18, 19, 23, 24 | M1/M4: unauthorized/foreign/arbitrary service-unlock requests, wrong purpose/owner/versions, missing public keys, backup failure, email challenge limits, changed email/admission and denial after completion. Verify service policy without a root token. |
| 10, 11, 17 | M2/M5/M6: offline-recipient first send, read/incoming/hide races, bilateral direct block, unaffected group send, local search/previews and own-data export. |
| 12, 20, 21 | M7: browser runs on Linux/macOS; persistent OpenBao restart/unseal; joint restore using separately held admin secrets; Transit rotation/rewrap with old-copy compatibility. |

Use `./mvnw verify` for regular backend checks and extend `./mvnw -Pdatabase-tests verify` with isolated migration and concurrency acceptance. Add a documented frontend crypto/browser test command when introducing that harness; the existing frontend currently has no package/build toolchain. CI must explicitly fail on missing required SQL/OpenBao dependencies rather than silently skipping acceptance. Keep external mail tests deterministic with a local capture service and separately verify the configured delivery path before release.

Release also requires a private-storage cleanup rehearsal, bounded polling/upload behavior under failure, tested redaction/no-store headers for sensitive endpoints, and consistent TLS/cookie/origin configuration. These checks implement the specification's selected threat model; they do not imply forward secrecy, protection from a compromised host/browser or operator-inaccessible history.

## 9. First implementation change

Start with M0: commit the API/crypto transition schemas, schema inventory and Flyway migration/test strategy. Then implement M1 as the smallest real path from two admitted, verified accounts to fully backed-up identities and working protected-page bootstrap. Do not start by replacing the mock `chat.send` with a plaintext POST: that would bypass the key-backup and identity invariants on which every later scenario depends.
