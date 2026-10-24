# Authorization implementation plan

Reviewed 24 October 2026 against the current implementation and migrations V1–V11. This document plans registry-based admission; the target flow below is **not implemented yet**. It does not authorize changing the working database during documentation maintenance.

Target registration flow: **Register → profile_info → registry match → email code → admission → login/key setup**.

## Current implementation and dependencies

- `EnrollmentService` currently requires an unexpired, unconsumed email/role invitation. Registration stores a pending enrollment and returns an email challenge; successful email verification admits the account and consumes an invitation. Missing admission produces a non-admitting challenge response rather than granting access.
- `AdmissionCommand invite` supplies seven-day operator approvals. The current backend does not require the exact `polytechnic.am` domain or match official registries. This plan changes admission policy rather than documenting existing checks.
- `auth.PendingEnrollments` currently requires `InvitationId` and stores credential version, names and role. It has no persisted academic profile/revision or verified registry claim. `password()` rejects non-admitted accounts; pending-user login resumption is new work.
- `register.js` currently verifies email, logs in and completes automatic key setup through `auth/identity-client.js`. `profile-info.js` uses an application-session bootstrap, hard-coded academic options and adapter-only profile-write routes. It cannot serve restricted enrollment unchanged.
- Real sessions, password changes, account/history recovery, groups, lifecycle and settings already exist. Preserve their PLK1 versions, vault copies, session revocation, export grants and encrypted history. See [backend context](backend_design_context.md), [M1](messenger/m1.md), [M4](messenger/m4.md), [M6](messenger/m6.md) and [settings API](settings_backend.md).
- V10 and V11 already implement account settings and export grants. Allocate the next unused migration version, currently **V12**, and any subsequent versions after checking the branch at implementation time. Never rewrite historical migrations.

## Rules

- For new registry-based enrollment, accept valid addresses only at the exact normalized domain `polytechnic.am`; reject subdomains and suffix lookalikes on the backend and in the form. Define normalization once and share its contract with validation tests. Existing login/recovery must remain usable until the explicit transition policy is selected.
- Verify exactly one selected role (`graduate` or `lecturer`). Domain membership alone never grants admission.
- Use first and last names only, without patronymic. Keep failed submissions editable and rate-limit retries.
- Require email confirmation, mandatory profile completion, and a unique verified registry link before application access.

## Implementation sequence

| Step | Changes | Acceptance criteria |
| --- | --- | --- |
| 1. Schema | Add the next unused migration (currently V12) with lecturer first/last names, persisted enrollment state/revision, restricted enrollment sessions, and registry claims. Replace the mandatory invitation dependency in pending enrollment. Enforce one claim per user and one user per registry record using foreign keys, checks, and unique filtered indexes. Make invitation linkage compatible with registry enrollment while preserving the current transition path; inspect the captured registry schema before adding fields. | Fresh install through the new version and V11 upgrade succeed without modifying historical migrations or losing existing accounts/key material. |
| 2. Enrollment access | Update `EnrollmentService`, DTOs, `IdentityController`, and route permissions. Registration issues only a short-lived enrollment cookie; pending-user login resumes enrollment. Add `GET /auth/enrollment`, `GET /auth/enrollment/options`, `PUT /auth/enrollment/profile`, and `POST /auth/enrollment/submit`. Use a separate, expiring, browser-bound enrollment credential that ordinary session authentication never accepts. Apply origin/CSRF checks, revision checks, logout/revocation and rate limits. Expose only bounded reference options, never raw registry records or a registry-search oracle. | Pending credentials cannot access application sessions, users, search, messaging, recovery-based admission, or key setup. |
| 3. Registry verification | Alumni match diploma number, first/last name, specialization ID, and start/end years against registry dates. Faculty match registration email, department ID, and first/last name. Specify Unicode normalization, whitespace, case and database-collation handling explicitly and avoid fuzzy matching. Reject ambiguous matches; use lookup IDs rather than localized labels. Keep diploma details out of URLs, logs and challenge payloads. Keep role provisional until admission. | A mismatch preserves fields for correction; only the selected role is evaluated. Missing registry data blocks automatic admission. |
| 4. Email and admission | Reuse existing code expiry, attempt limits, MAC storage, browser binding, and resend limits. Bind enrollment codes to credential and profile revisions. Invalidate codes on edits. Within one admission transaction, lock/revalidate the current credential/profile revision and registry claim, consume the code, claim the registry row, persist verified profile data, and set `ADMITTED`; make successful retries safe. The existing challenge verification is a separate call today: adapt its consumption boundary rather than assuming it is already atomic with admission. | Expired, reused, or stale codes fail; concurrent claims admit at most one account. Email verification alone cannot admit a user. |
| 5. Frontend | Update registration, `profile_info`, identity client, provider/routes, and bootstrap. Load database-backed selections; add diploma/name fields; use `lecturer` consistently. Add explicit enrollment service/client operations and response variants. Derive onboarding state from the server and avoid application refresh or vault setup for enrollment responses. Preserve the entered password only transiently, or require it again before login; never persist it or derived proof in workflow storage. Make photo/biography optional for verification. | Registration immediately opens the mandatory form; reload/login resumes progress; errors allow editing; only admitted users reach application/key setup. |
| 6. Transition and rollout | Retire invitation-only admission only after the transition policy is chosen; update CLI/docs, fixtures, mock provider, and browser flows. Keep admitted-user crypto fixtures separate from new enrollment fixtures. If development lecturer fixtures need names, add synthetic first/last names only through an explicit development-only data update, never the production migration. Synthetic names cannot establish real eligibility; import verified university data before production admission. Rehearse on a restored copy before a backed-up deployment. | Run backend checks, migration/integration tests, and browser authentication/messaging/recovery regressions. No working database changes occur during planning. |

Implement each step as small compiling commits with relevant checks. Preserve existing password derivation, vault encryption, session rotation, and admitted-user recovery.

## Test coverage

- Exact email-domain enforcement; student-domain users without a matching registry record remain pending.
- Both roles, missing fields, normalization, study-year comparison, edited retries, and duplicate claims.
- Expired/resend/stale codes, concurrent verification, interrupted enrollment, logout, and cross-account enrollment access.
- Direct API denial for pending users across profile/search, keys, settings, notifications, full export, chat/groups and ordinary refresh. Reject enrollment credentials at application boundaries and application credentials used for another account's enrollment.
- Recovery, repeated registration, alternate verification routes and operator tools cannot bypass the chosen admission policy. Preserve existing admitted-user password changes, recovery, email-factor settings and encrypted data.
- Role changes after admission denied; profile edits invalidate pending codes and concurrent claims admit at most one account. Exact successful retry semantics survive a lost response.
- Migration preserves V10 preferences, staged email changes and V11 export grants; fresh/upgrade checks use isolated databases, not the working database.
- Browser registration → mandatory form → verification → key setup, reload/login resume, stale tabs, expired enrollment credential, both roles and existing HTTP/mock messenger/settings regressions.

## Integration decisions before implementation

- **Email change:** [approved settings behavior](settings_decisions.md) preserves sessions and verifies mailbox ownership, but does not define registry revalidation. Decide whether the exact university-domain rule also applies to subsequent email changes. For lecturers matched by email, define how an address change preserves or replaces the verified claim. Do not silently impose a new policy on existing admitted users.
- **Registry corrections:** define what happens when official names, department, specialization, dates or diploma records change after a claim. Persist provenance and define operator correction/audit access; do not expose registry data through public profiles or exports by default.
- **Pending enrollment lifecycle:** specify expiry/cleanup, replacement registration, role/profile edits, enrollment logout, response shapes and safe retry behavior. A role chosen during registration is provisional until admission. Lookup options must be independently specified because the old hard-coded form is not an authoritative hierarchy.
- **Restricted existing users:** if re-verification is chosen, define a state and credential path that preserves vaults/history but blocks ordinary application access. Recovery and readmission must not accidentally bypass it; do not reuse deactivation without an explicit policy, since current deactivation requires operator readmission.

## Decisions before launch

- **Existing admitted accounts:** recommended to require registry verification before launch, revoke their application sessions, and preserve credentials/vaults. Choose whether any development accounts are exempt.
- **Deleted accounts:** recommended to retain registry claims until operator review rather than automatically allow another claim. Reconcile this with the implemented deletion ledger, neutral discussion authors, erased personal data and backup replay. Define the minimum retained identifier and operator release policy; do not retain names/diploma details implicitly.
- **Faculty changes:** recommended to defer periodic eligibility rechecks; define the later revocation policy separately.

The chosen alumni check confirms knowledge of registry details and control of an official mailbox. The current alumni registry does not bind that mailbox to the diploma holder.


## Verification and documentation handoff

Run `./mvnw verify` from `backend/`, relevant isolated SQL migration/admission concurrency tests, and the complete identity/recovery/settings/messenger browser regression before calling this plan implemented. Extend `tools/m1/verify.py` and contract fixtures as needed; existing M1–M6/settings acceptance does not test the proposed registry flow.

Update [frontend context](frontend_context.md), [backend context](backend_design_context.md), root/backend setup, admission CLI guidance and authentication test instructions with the final deployed flow and migration number. Keep existing invitation behavior documented until it is actually retired. No registry-enrollment endpoints, migration or acceptance results are claimed by this planning update.
