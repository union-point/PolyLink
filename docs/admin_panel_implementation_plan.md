# Admin panel implementation plan

Date: 7 November 2026. Status: delivery in progress. This document records the target plan; see [admin access implementation](admin_implementation.md) for access/operations and [reference services](admin_references.md) for V24, implemented reference CRUD and the dependency-lock protocol. V25 normalization and registry CRUD are implemented; see [registry services](admin_registry.md) for contracts, locking and verification. Phase 5 post-type compatibility is implemented: publication consumers accept database-driven types and custom post-type mutations are enabled under the existing protection rules. Phase 6 delivers the three management pages, isolated HTTP/mock providers and shared session/error handling. Full rollout rehearsal and the final regression gate remain phase 7 work.

The product authority is [admin panel decisions](admin_panel_decisions.md). The architecture, endpoint names and delivery sequence below are proposed implementation choices. Preserve the approved scope: one admin role, three management pages, local invitation/access commands, mandatory two-factor authentication, manual registry maintenance and no separate admin action audit log. Excel import is future work.

## 1. Verified repository starting point

Inspection covers repository source, not the working database.

| Area | Existing code and implication |
| --- | --- |
| Member identity | `auth/IdentityController`, `EnrollmentService`, `Accounts` and `Sessions` implement registry admission, member sessions and optional email-based 2FA. `AuthDtos.Registration` accepts only graduate/lecturer roles. Do not route admins through member admission or widen public role input. |
| Credential and vault lifecycle | `AuthDtos`, `js/auth/identity-client.js`, password/recovery controllers and key-vault services use PLK1 credentials and member key setup. Admin access needs an explicit boundary; it must not accidentally require education, a registry claim or a messenger vault. |
| Historical invitations | `AdmissionCommand invite` explicitly rejects invitations; V14 revoked unused historical invitations. Do not reactivate this member admission mechanism for admins. |
| Registry | `dbo.LecturerRegistry` and `dbo.AlumniRegistry` already have unique constraints on email and diploma number. V14 adds lecturer names and `auth.RegistryClaims`, whose foreign keys protect deletion but do not prevent editing claimed rows. Enrollment matching uses `EnrollmentRules`. |
| Academic references | Existing `dbo.Universities`, `Institutes`, `Departments`, `Specializations`, `Professions`, `Degrees` and their consumers cover the approved academic lists. They are independent lists; do not invent a university/faculty/department hierarchy. Some tables have verification/logo fields that require deliberate write allowlists. |
| Publication references | `dbo.PostTypes`, `Spheres` and `ForumCategories` already exist. V21 makes post type/sphere codes required and unique. `js/posts/contracts.js`, `js/posts/content.js` and mock post state hard-code `job`, `internship`, `training`. |
| Polytechnic identity | Enrollment currently resolves the main university by its Armenian name. A protected stable identity is needed before exposing university management. Other universities remain profile education choices and cannot establish admission eligibility. |
| Migration/testing | Migrations currently end at V22. `SchemaCommand`, inventory files and `DatabaseMigrationIT` guard explicit schema changes; application startup does not migrate. SQL/HTTP ITs, provider contract tests and Playwright acceptance runners already exist. |

## 2. Proposed admin identity boundary

Implement a dedicated `am.polylink.admin` package and separate admin identity/session tables. This represents the single admin role without adding public role selection or a super-admin hierarchy. Keep admin credentials and authorization separate from member credentials even when the same person uses both. Email uniqueness applies within the admin identity store; an existing member address must never be silently converted or promoted.

Reuse reviewed primitives for token generation/hashing, password policy and credential verification, origin checks, CSRF, rate limits, mail delivery and injected time where they fit. Extract reusable logic where necessary rather than weakening member checks. Keep member PLK1/key-vault contracts intact. For the proposed admin password protocol, reuse the existing client derivation and server verifier primitives without creating a member vault; pin the protocol in contract tests before implementing the browser client. Collect password confirmation in the browser and never store or log either password or password-derived secrets.

Use the existing email-code mechanism as the proposed mandatory second factor. The approved requirement is mandatory 2FA; using email rather than a new authenticator system is a technical proposal. Every fresh login must require password proof followed by a browser-bound, purpose-bound code. Issue an admin session only after both succeed. Email verification during registration proves mailbox ownership; it does not allow subsequent password-only login. Provide no admin option to disable 2FA. Password recovery, if exposed, must use a dedicated restricted flow and return to full login/2FA, never issue a password-only admin session or reuse a member recovery credential.

Admin sessions use separate cookie names and token scope. Apply Secure, HttpOnly and SameSite protection, session-bound CSRF for cookie mutations, configured-origin checks, no-store responses, expiry, rotation and revocation. Copy the existing reviewed timeout/attempt/resend policy unless an explicit admin-specific policy is documented during implementation. Authorization must read current enabled state/session version on every protected request, including list/search requests. Browser route guards are only presentation controls.

Neither member sessions nor enrollment/recovery credentials authorize admin APIs. Admin sessions do not automatically authorize member profile, messenger, key-vault or other member APIs. Do not put admin tokens into member session storage, URLs or shared member transport state.

## 3. Invitation and access commands

Introduce a dedicated local `AdminCommand`, using the repository's offline connection/credential pattern. Proposed operations are `invite EMAIL` and `disable ADMIN_ID`; these are design names, not commands available today. Do not expose them as panel endpoints or add invitation cancellation, admin promotion or an admin-management page.

Invitation flow:

1. Validate and normalize the supplied email with the shared trim/lowercase rules, allowing any valid domain. Reject an existing admin identity rather than overwriting credentials or re-enabling a disabled identity.
2. Generate a cryptographically random token, store only its hash, invited email, creation time, expiry exactly 24 hours later and completion state. Output the link only to the local operator; send no automatic invitation email. The owner distributes the link manually.
3. On the separate registration page, exchange the token for restricted browser-bound registration state. Prefer a fragment token removed from browser history immediately after exchange, with no third-party resources or referrer leakage. GET/link previews must not consume the invitation.
4. Display the fixed invited email and collect first name, last name, password and confirmation. Send a verification code only to the stored invited address. The request cannot substitute an email or role. Bind codes to this invitation, browser and credential draft; replacement drafts invalidate earlier codes.
5. Recheck invitation expiry, email uniqueness and code proof at final completion. Atomically create the enabled, verified admin identity and consume the invitation. Persist no admin session until the complete authentication policy is satisfied; the proposed flow then sends the user to admin login.
6. Permit safe completion retries from the same browser without creating duplicate identities. Concurrent redemptions may create at most one admin. Invalid/expired/used links show an actionable unavailable state without disclosing identity information. Expiry also applies if a draft/code was created before the 24-hour boundary.

Keep raw tokens, codes and credential drafts out of logs. Use restricted state expiry and cleanup without adding a cancellation feature. A new invitation must not implicitly cancel an existing invitation; uniqueness and atomic completion must still prevent duplicate accounts.

`disable` atomically marks the chosen admin disabled, advances its session version, revokes its sessions and invalidates pending login/recovery challenges. It is idempotent and must not alter an unrelated member account. Concurrent login/refresh cannot restore access. Existing in-flight writes must serialize with disable through the same account lock: a write already committed before disable remains committed, and writes authorized after disable commits fail. No re-enable behavior is assumed in this version. CLI output confirms success/failure without exposing stored credentials.

## 4. Schema, normalization and migration safety

Use the next available migration number at implementation time (currently provisionally V23). Do not edit applied migrations. Proposed additions are admin identities, hashed invitations, restricted registration state, purpose-bound challenges and revocable sessions, plus stable reference protection metadata and record versions where needed. Add appropriate unique indexes, foreign keys, expiry indexes and check constraints. Keep security state distinct from an admin action audit log; preserve existing admission/registry claim auditing.

Before migrating, inventory existing reference identities, all incoming foreign keys, pending enrollment references and normalized registry keys on a restored disposable copy. Preserve existing IDs, claims, users, education and historical content. Do not silently merge, delete, reassign or rename existing records to make the migration pass. Ambiguous Polytechnic identity, duplicate normalized keys or incompatible system mappings require an operator report and explicit resolution before rollout.

- **Registry uniqueness:** preserve email/diploma uniqueness and enforce matching-consistent keys. Review existing raw-value constraints alongside the normalized indexes; adjust their collation or replace redundant constraints only after proving the resulting uniqueness behavior. Lecturer email uses the existing email normalization; diploma number uses `EnrollmentRules.text` (NFKC, whitespace normalization, case folding). Add persisted normalized key columns maintained by all registry writers with binary/exact unique indexes, or an equivalently proven mechanism. Backfill with the same Java rules, not an approximate SQL collation transformation. Preserve display values. Detect collisions before adding constraints; update seed/maintenance writers and enrollment lookups together. SQL collation must not admit or reject different identities accidentally.
- **System protection:** introduce stable, migration-owned identities/protection flags for the main Polytechnic university and required system reference values, including supported built-in post types and the `other` sphere. Enumerate the exact protected set in migration fixtures after inspecting consumers; do not mark every historical row protected merely because it was seeded. Admin payloads cannot set/unset protection, eligibility or verification authority. Immutable internal codes are separate from editable display labels.
- **Eligibility:** use the protected Polytechnic identity in enrollment resolution while retaining the existing exact `polytechnic.am` and registry checks for ordinary members. An added university, its label or its `IsVerified` value can never broaden admission. Admin university writes must not grant eligibility through any alternate route.
- **Inventory:** extend `SchemaCommand`, schema inventories and migration tests for the chosen layout. Preserve separate migration/runtime credentials. Add no machine-specific database infrastructure and do not migrate the working database as part of implementation tests.

## 5. Management services and API contracts

Expose protected `/admin/**` controllers backed by narrowly scoped services. Use an explicit server allowlist to map reference resource keys to tables, IDs, writable fields, code rules, protection rules and dependency queries. Never interpolate client-supplied SQL identifiers. Reject unknown fields, resource kinds and forged security flags.

Proposed contracts:

| Operation | Boundary | Contract |
| --- | --- | --- |
| Admin authentication | `/admin/auth/registration/*`, `/admin/auth/login/*`, `/admin/auth/session`, `/admin/auth/refresh`, `/admin/auth/logout` | Separate restricted and authenticated states; registration email comes from the invitation; password login always challenges for 2FA. Freeze request schemas during the auth phase. |
| List reference values | `GET /admin/references/{kind}?q=&cursor=` | Bounded, deterministic pages of IDs, names, codes where applicable, versions and read-only protection reasons. |
| Create/edit/delete reference | `POST /admin/references/{kind}`, `PUT` or `DELETE /admin/references/{kind}/{id}` | Allowlisted fields; version precondition on edit/delete; backend recomputes protection and usage in the transaction. |
| Registry search/detail | `GET /admin/registries/{lecturers|alumni}?q=&cursor=`, `GET .../{id}` | Bounded search by names and email/diploma as appropriate; detail exposes only fields needed for maintenance, version and linked status. No public registry search. |
| Registry create/edit/delete | `POST /admin/registries/{kind}`, `PUT` or `DELETE /admin/registries/{kind}/{id}` | Unique keys, strict reference/date validation, transactional linked-record protection and version preconditions. |

Propose pages of 50 with stable ID tie-breaking and query-bound cursors. Parameterize search, cap input sizes, escape wildcard semantics and index exact identity lookups. Use 400 for validation, 401 for absent/expired admin authentication, 403 for denied authority, 404 for missing records and 409 for duplicate keys, stale versions or protected/linked/in-use conflicts. Return stable codes such as `DUPLICATE_EMAIL`, `DUPLICATE_DIPLOMA`, `RECORD_LINKED`, `REFERENCE_IN_USE`, `SYSTEM_VALUE` and `VERSION_CONFLICT`, with field errors where useful. Do not leak SQL errors or linked users' private information. A disabled admin must fail authentication consistently.

Registry fields map to existing schema: lecturer first/last name, email and department; alumni first/last name, diploma number, full study start/end dates and specialization. Require valid references and ordered dates for new/edited records. Existing incomplete lecturer rows remain visible with a correction state; do not fabricate missing data. Preserve record IDs and provenance fields. Additional profile fields, education creation and role changes are outside these writes.

## 6. Enforce protection under concurrency

Read-only UI badges cannot enforce these rules. Implement each write in a transaction and test with real SQL Server concurrency.

- **Linked registry rows:** check all current user-link paths, starting with `auth.RegistryClaims`, including deactivated users' retained claims. Lock the registry row and relevant claim key range before checking and editing/deleting. Enrollment final matching/claim creation and offline claim correction must follow a compatible locking order and recheck current registry data. If admission wins, mutation fails; if an unlinked edit wins, admission must match the edited record. Never release, move or cascade-delete a claim from the panel.
- **Used reference values:** enumerate every reference consumer, including education, lecturer profiles, registries, posts, forum topics and pending enrollment. Block every update and deletion of an in-use value, even a rename. Use serializable/key-range checks or a shared parent-lock protocol with all reference-consuming writers, backed by foreign keys for deletion safety. A foreign key alone does not prevent a racing rename. Prove the chosen lock behavior rather than relying on a preflight count.
- **System values:** reject every update/delete of a protected value even when unused; the main Polytechnic university is always protected. Do not allow code/protection changes through generic payloads or deletion/recreation tricks. The panel may create ordinary unused values and edit/delete them only while unprotected and unused.
- **Concurrent editors:** use row versions/preconditions so stale forms fail with a reload action rather than silently replacing another admin's work. Check protection again after acquiring locks. Convert duplicate/FK/version failures to stable conflict responses and use bounded transaction retry only where safe.

Document the final dependency and lock-order matrix next to the services. Include compatibility with `AdmissionCommand`, account deletion/claim release, pending enrollment expiry and existing seed/maintenance writers. Do not remove the existing registry claim audit trail; it is distinct from the excluded general admin action log.

## 7. Frontend and post-type compatibility

Add separate registration/login entry pages and exactly three management pages, with a shared admin shell for navigation, session expiry and logout. Proposed files are `admin-register.html`, `admin-login.html`, `admin-academic.html`, `admin-content.html`, `admin-registry.html` and focused `js/admin/` modules. Authentication screens do not add management pages.

The academic page groups the six approved lists. The content page groups post types, spheres and forum categories. The registry page switches between lecturers and alumni with manual search, detail and add/edit forms. Show why a row is locked, disable unavailable actions, confirm deletion, retain inputs after failed saves, offer reload on version conflicts and support keyboard navigation, accessible labels and mobile layouts. Render all stored names as text. Clear cached registry data and drafts on logout, expiry or account switches.

Follow the existing service/provider boundary: add admin operations, strict response normalization and isolated HTTP/mock admin session handling. Mock mode must enforce 2FA states, one-use/expiry behavior, uniqueness and linked/in-use protections; it must not imply the server is implemented. Do not leave production demo credentials or a browser-only admin bypass.

Before enabling arbitrary post-type additions, update `js/posts/contracts.js`, `js/posts/content.js`, the post options/form/feed/card consumers, profile publication callers, mock state and any other type-specific presentation/validation found by a full code search. Derive selectable types from database-backed options, preserve immutable stable codes and use a generic presentation for new codes. Recheck backend code length/format limits and existing historical mappings. Cover the same flows when an unused custom type is deleted. Keep required built-in system types protected. A CRUD endpoint alone does not complete post-type management; until compatibility passes, reject unsupported mutations explicitly and keep that portion unreleased.

Refresh member-facing options after reference changes without substituting a missing selection. Existing open forms may receive a conflict/validation error if an unused value was removed; retain the form and reload choices. Do not add languages, roles, Excel upload, invitation cancellation, user moderation or an admin activity-log screen.

## 8. Delivery sequence and local commits

Complete each logical change with passing relevant checks and a local Conventional Commit. Keep all commits local unless the user explicitly requests a push. The examples below describe milestones; split a milestone further whenever it cannot stay reviewable and buildable as one commit.

| Phase | Deliverable | Acceptance gate / suggested commit |
| --- | --- | --- |
| 1. Contracts and schema | Freeze auth state machine, credential reuse, dependency/protection matrix, normalized keys, migration and inventory changes. | Fresh install and V22 upgrade on disposable SQL preserve IDs/claims/history and fail safely on collisions or ambiguous Polytechnic mapping. `feat: add admin identity and reference protection schema` |
| 2. Invitation and authentication | Local invite/disable commands, restricted registration, verification, mandatory login 2FA, isolated sessions and immediate access checks. | Concurrent invitation redemption creates one identity; arbitrary email domains work; expired/forged/cross-purpose proofs fail; member tokens cannot access admin APIs; disable wins over subsequent writes/refresh. `feat: add invited admin authentication` |
| 3. Reference services | Allowlisted academic/content CRUD, system protections, dependency checks and compatible locking in consuming writers. | Used and system rows reject edit/delete, including races; non-Polytechnic universities remain additional education only. `feat: add protected admin reference operations` |
| 4. Registry services | Search/detail/manual CRUD, normalization, unique keys, versions and shared admission/claim lock protocol. | Linked rows remain immutable; duplicate normalized keys fail; concurrent claim/write and delete/claim tests prove atomic protection. `feat: add manual admin registry maintenance` |
| 5. Post compatibility | Database-driven post types throughout live/mock frontend and contracts. | A custom type can be created, used and filtered across feed/detail/profile forms; used deletion fails; unused deletion leaves consumers functional. `refactor: derive post types from reference options` |
| 6. Admin interface | Registration/login plus three management pages, providers, accessible forms and error states. | Mock and real browser journeys cover all pages, 2FA, expiry, conflicts, deletion confirmation and form preservation. `feat: add admin management pages` |
| 7. Integration and runbook | Full regression, rollout rehearsal, documented exact commands and implementation status. | Disposable full suite passes; operational invitation delivery/disable steps are verified; no private data or generated artifacts enter Git. `docs: document admin rollout and maintenance` |

## 9. Verification and rollout

Add focused `AdminIdentityIT`, `AdminReferencesIT` and `AdminRegistryIT` coverage, extend `DatabaseMigrationIT` and enrollment concurrency tests, and add `tools/contracts/admin.test.mjs` plus mock/live Playwright acceptance. Names are proposed. Test behavior at the API and database boundary, not only hidden buttons.

Required evidence includes:

- Invitation use at just before/at/after expiry with an injected clock; scanner GETs; wrong email substitution; same-browser retry; concurrent browsers; multiple invitations for one address; resend/attempt limits; no plaintext token persistence or log leakage.
- Mandatory 2FA for every login, no session before verification, wrong/expired/replayed/browser-swapped codes, cross-purpose misuse, member/admin credential isolation, CSRF/origin checks, logout/refresh and disabling with active sessions or pending proofs.
- Every approved reference resource, invalid/forged fields, duplicate names/codes, immutable system identities, all dependency paths and races with profile/enrollment/post/forum writes. Adding another university never permits ordinary registration through it or changes Polytechnic default resolution.
- Lecturer/alumni search pagination and validation, Unicode normalization/collision cases, unchanged record IDs, deactivated users' retained links, update/delete versus admission/correction/release, version conflicts and rollback without partial changes.
- New post types through every consumer, built-in protections, safe generic rendering, unused custom deletion and removal while another form is open. Registry/name input cannot inject markup into the admin or member pages.
- Existing enrollment, profile, search, posts, forum, settings, recovery and messenger regressions; historical member invitations stay retired and ordinary domain/registry restrictions remain enforced.

During implementation run the existing `./backend/mvnw -f backend/pom.xml verify`, `npm test --prefix tools/contracts` and appropriate disposable browser checks. Integrate admin acceptance into `tools/m1/verify.py` and `tools/local/test.sh` before claiming completion; any new `--admin` mode must be implemented before documenting it as executable. Use `bash tools/local/test.sh --full` as the final integration gate. This documentation-only plan requires diff/link review, not application tests.

Roll out only after backing up and rehearsing the explicit migration on a restored copy with matching backend/frontend. Keep the admin feature unavailable until the full authentication, protections and post-type compatibility gates pass. Document exact local command invocation and private credential handling in the implementation runbook, keeping the root README concise and free of database setup. Verify one invitation and disabled-session rejection with test identities and captured mail before using real administrators. If rollout fails, disable the feature and restore a compatible deployment using the established backup procedure; do not improvise destructive Git or database rollback commands.

## 10. Deferred scope

Excel import remains a later, separately planned feature. It may skip exact matches and present replace/skip choices when lecturer email or alumni diploma number matches. Any future import must use the same normalization, uniqueness, transaction/version checks and linked-record protections; replacing a linked record remains forbidden. Do not restore the retired import staging table or implement upload infrastructure in this delivery.

Invitation cancellation, super-admins, role/language administration and a separate admin action audit log remain excluded from the first version. A future change in 2FA method or account recovery capability must preserve mandatory two-factor login and disabled-account enforcement.
