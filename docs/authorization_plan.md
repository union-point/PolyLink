# Authorization implementation plan

Reviewed 24 October 2026 against the current implementation and migrations V1–V13. This document plans registry-based admission; the target flow below is **not implemented yet**. It does not authorize changing the working database during documentation maintenance.

Target registration flow: **Register → profile_info → registry match → email code → admission → login/key setup**.

## Current implementation and dependencies

- `EnrollmentService` currently requires an unexpired, unconsumed email/role invitation. Registration stores a pending enrollment and returns an email challenge; successful email verification admits the account and consumes an invitation. Missing admission produces a non-admitting challenge response rather than granting access.
- `AdmissionCommand invite` supplies seven-day operator approvals. The current backend does not require the exact `polytechnic.am` domain or match official registries. This plan changes admission policy rather than documenting existing checks.
- `auth.PendingEnrollments` currently requires `InvitationId` and stores credential version, names and role. It has no persisted academic profile/revision or verified registry claim. `password()` rejects non-admitted accounts; pending-user login resumption is new work.
- `register.js` currently verifies email, logs in and completes automatic key setup through `auth/identity-client.js`. `profile-info.js` uses an application-session bootstrap, hard-coded academic options and adapter-only profile-write routes. It cannot serve restricted enrollment unchanged.
- Real sessions, password changes, account/history recovery, groups, lifecycle and settings already exist. Preserve their PLK1 versions, vault copies, session revocation, export grants and encrypted history. See [backend context](backend_design_context.md), [M1](messenger/m1.md), [M4](messenger/m4.md), [M6](messenger/m6.md) and [settings API](settings_backend.md).
- V10 and V11 already implement account settings and export grants. Allocate the next unused migration version, currently **V14**, and any subsequent versions after checking the branch at implementation time. Never rewrite historical migrations.

## Rules

- For new registry-based enrollment, accept valid addresses only at the exact normalized domain `polytechnic.am`; reject subdomains and suffix lookalikes on the backend and in the form. Define normalization once and share its contract with validation tests. Existing admitted accounts retain access, including login/recovery with their current addresses; any subsequent email change must use the exact allowed domain.
- Verify exactly one selected role (`graduate` or `lecturer`). Domain membership alone never grants admission.
- Use first and last names only, without patronymic. Keep failed submissions editable and rate-limit retries.
- For new registry-based enrollments, require email confirmation, mandatory profile completion, and a unique verified registry link before application access. Existing admitted accounts are grandfathered as approved below.

## Implementation sequence

| Step | Changes | Acceptance criteria |
| --- | --- | --- |
| 1. Schema | Add the next unused migration (currently V14) with lecturer first/last names, persisted enrollment state/revision, restricted enrollment sessions, and registry claims. Replace the mandatory invitation dependency in pending enrollment. Enforce one claim per user and one user per registry record using foreign keys, checks, and unique filtered indexes. Remove invitation linkage as an admission prerequisite; preserve grandfathered admission explicitly and inspect the captured registry schema before adding fields. | Fresh install through the new version and V13 upgrade succeed without modifying historical migrations or losing existing accounts/key material. |
| 2. Enrollment access | Update `EnrollmentService`, DTOs, `IdentityController`, and route permissions. Registration issues only a short-lived enrollment cookie; pending-user login resumes enrollment. Add `GET /auth/enrollment`, `GET /auth/enrollment/options`, `PUT /auth/enrollment/profile`, and `POST /auth/enrollment/submit`. Use a separate, expiring, browser-bound enrollment credential that ordinary session authentication never accepts. Apply origin/CSRF checks, revision checks, logout/revocation and rate limits. Expose only bounded reference options, never raw registry records or a registry-search oracle. | Pending credentials cannot access application sessions, users, search, messaging, recovery-based admission, or key setup. |
| 3. Registry verification | Alumni match diploma number, first/last name, specialization ID, and start/end years against registry dates. Faculty match registration email, department ID, and first/last name. Specify Unicode normalization, whitespace, case and database-collation handling explicitly and avoid fuzzy matching. Reject ambiguous matches; use lookup IDs rather than localized labels. Keep diploma details out of URLs, logs and challenge payloads. Keep role provisional until admission. | A mismatch preserves fields for correction; only the selected role is evaluated. Missing registry data blocks automatic admission. |
| 4. Email and admission | Reuse existing code expiry, attempt limits, MAC storage, browser binding, and resend limits. Bind enrollment codes to credential and profile revisions. Invalidate codes on edits. Within one admission transaction, lock/revalidate the current credential/profile revision and registry claim, consume the code, claim the registry row, persist verified profile data, and set `ADMITTED`; make successful retries safe. The existing challenge verification is a separate call today: adapt its consumption boundary rather than assuming it is already atomic with admission. | Expired, reused, or stale codes fail; concurrent claims admit at most one account. Email verification alone cannot admit a user. |
| 5. Frontend | Update registration, `profile_info`, identity client, provider/routes, and bootstrap. Load database-backed selections; add diploma/name fields; use `lecturer` consistently. Add explicit enrollment service/client operations and response variants. Derive onboarding state from the server and avoid application refresh or vault setup for enrollment responses. Preserve the entered password only transiently, or require it again before login; never persist it or derived proof in workflow storage. Make photo/biography optional for verification. | Registration immediately opens the mandatory form; reload/login resumes progress; errors allow editing; only admitted users reach application/key setup. |
| 6. Transition and rollout | Retire invitation-based initial admission at rollout under the approved transition policy; update CLI/docs, fixtures, mock provider, and browser flows. Keep admitted-user crypto fixtures separate from new enrollment fixtures. If development lecturer fixtures need names, add synthetic first/last names only through an explicit development-only data update, never the production migration. Synthetic names cannot establish real eligibility; import verified university data before production admission. Rehearse on a restored copy before a backed-up deployment. | Run backend checks, migration/integration tests, and browser authentication/messaging/recovery regressions. No working database changes occur during planning. |

Implement each step as small compiling commits with relevant checks. Preserve existing password derivation, vault encryption, session rotation, and admitted-user recovery.

## Test coverage

- Exact email-domain enforcement; student-domain users without a matching registry record remain pending.
- Both roles, missing fields, normalization, study-year comparison, edited retries, and duplicate claims.
- Expired/resend/stale codes, concurrent verification, interrupted enrollment, logout, and cross-account enrollment access.
- Direct API denial for pending users across profile/search, keys, settings, notifications, full export, chat/groups and ordinary refresh. Reject enrollment credentials at application boundaries and application credentials used for another account's enrollment.
- Recovery, repeated registration, alternate verification routes and operator tools cannot bypass the chosen admission policy. Preserve existing admitted-user password changes, recovery, email-factor settings and encrypted data.
- Role changes after admission denied; profile edits invalidate pending codes and concurrent claims admit at most one account. Exact successful retry semantics survive a lost response.
- Grandfathered accounts retain access without registry claims; new invitation-based bypasses and temporary forum onboarding bypasses are rejected.
- Pending enrollment expires after seven days; sessions enforce idle and absolute expiry, logout and safe resumption. Repeated registration cannot overwrite credentials; pending recovery cannot admit.
- Email changes enforce the exact domain while preserving claims and sessions; deleted-account claims are released atomically and correctly on deletion-ledger replay.
- Lecturer profession is a valid reference ID but not registry evidence; absent official names/department blocks new admission.
- Migration preserves V10 preferences, staged email changes and V11 export grants; fresh/upgrade checks use isolated databases, not the working database.
- Browser registration → mandatory form → verification → key setup, reload/login resume, stale tabs, expired enrollment credential, both roles and existing HTTP/mock messenger/settings regressions.

## Approved product decisions — 24 October 2026

These decisions are explicitly approved by the user and supersede conflicting proposals in this plan and `specification_gaps.md`. They describe target behavior, not completed implementation.

- **Email change:** proposed new addresses must use the exact normalized `polytechnic.am` domain, including for grandfathered accounts. Preserve the existing verified registry claim and role; a lecturer's new address need not match the original registry email. Changing email does not release or replace a claim. All other approved settings verification requirements and session-preservation behavior remain in force.
- **Existing admitted accounts:** preserve their admission without mandatory registry re-verification, forced session revocation, or a new registry claim. Preserve credentials, vaults, history and ordinary login/recovery. This exception applies to accounts already admitted at rollout, not pending or future registrations. It does not override existing deactivation/deletion restrictions.
- **Graduate verification for v1:** university mailbox ownership plus exact matching diploma number, first/last name, specialization and study years is sufficient for automatic admission. No additional institution-assisted identity confirmation is required in v1. The accepted limitation is that the alumni registry does not bind that mailbox to the diploma holder. Continue enforcing one claim per registry record and all other enrollment checks.
- **Deletion and re-registration:** successful account deletion automatically releases its registry claim. Release the claim atomically with deletion; failed or rolled-back deletion must not release it. A later registration must pass the complete current enrollment verification again; deleted credentials, sessions and vaults are not restored. Include claim release in deletion-ledger replay so restoring a backup does not resurrect an occupied claim for a deleted account.
- **Registry corrections and faculty changes:** retain admitted-user access when official registry fields change. Corrections to an existing verified link are performed by an offline operator with an audit trail; do not silently retarget claims or delete admitted users when registry rows change or disappear. New enrollments use current official records. Periodic eligibility rechecks and automatic eligibility revocation are deferred beyond v1.
- **Development lecturer fixtures:** the user confirms that the current lecturer registry contains synthetic data and authorizes synthetic first names, last names and professions for these development fixtures. This is permission for a later explicit development-only data update, not a production migration or a claim of real university eligibility. No working database update is performed during this planning conversation. Production lecturer profession follows the approved user-selection rule below.

- **Lecturer profession:** the applicant selects a required profession ID from the database-backed `Professions` reference list. It is profile information, not identity evidence, and is not matched against the registry. Admission still requires official registry first/last names, department and registration email; missing official names or department blocks automatic admission until corrected.
- **Pending enrollment retention:** expire the unfinished registration seven days after its last successful profile save (initial registration starts the retention clock). Remove its enrollment data and pending credentials/challenges so the address can register afresh; cleanup must never remove an admitted account or its cryptographic material. Failed attempts do not extend retention. Enforce expiry on access as well as through scheduled cleanup.
- **Enrollment session:** expire after 30 minutes of inactivity and at an absolute maximum of 24 hours. Password login may issue a new restricted session and resume an unexpired enrollment. Logout revokes the restricted session; it does not delete the saved enrollment. A provisional role or verification-field edit invalidates outstanding codes and requires a new registry check.
- **Repeated registration and recovery:** registration against an occupied address never overwrites its password or saved profile; direct the applicant to login or recovery using non-disclosing responses. Recovery for an unadmitted account can restore only restricted enrollment access, never admission or application/key access. Preserve normal admitted-account recovery.
- **Invitation retirement:** old invitations and `AdmissionCommand invite` must no longer grant initial admission after rollout, including previously issued unconsumed invitations. Pending invitation enrollments must pass the new registry flow. Preserve existing admitted accounts and the separate operator readmission procedure for deactivated accounts; readmission cannot be used to admit a never-admitted account.

## Implementation contracts to specify

- **Registry correction implementation:** persist provenance and specify audited offline operator commands that preserve claim uniqueness. Do not expose private registry data through public profiles or exports by default. Follow the approved access-preservation policy above.
- **Enrollment contracts:** document bounded response variants, safe retries after lost responses, revision conflicts and database-backed lookup options/hierarchy. Apply the approved expiry, login, recovery, role-edit and logout rules above. These are implementation contracts rather than outstanding product-policy choices.
- **Forum integration:** replace the temporary pre-onboarding exception in `ForumService.requireAccess` and the constant identity onboarding flag with authoritative admission/onboarding state. Preserve access for grandfathered admitted users; incomplete new enrollments must remain excluded from the forum and all member APIs.

## Launch prerequisites

- **Deletion rollout:** verify the approved automatic claim release against account deletion, concurrent re-registration and deletion-ledger replay on restored backups; do not retain a claim solely to block re-registration.
- **Production lecturer data:** import verified university names and departments before enabling real lecturer enrollment; synthetic fixtures are development-only. Profession uses the approved reference-list selection.

The chosen alumni check confirms knowledge of registry details and control of an official mailbox. The current alumni registry does not bind that mailbox to the diploma holder.


## Verification and documentation handoff

Run `./mvnw verify` from `backend/`, relevant isolated SQL migration/admission concurrency tests, and the complete identity/recovery/settings/messenger browser regression before calling this plan implemented. Extend `tools/m1/verify.py` and contract fixtures as needed; existing M1–M6/settings acceptance does not test the proposed registry flow.

Update [frontend context](frontend_context.md), [backend context](backend_design_context.md), root/backend setup, admission CLI guidance and authentication test instructions with the final deployed flow and migration number. Keep existing invitation behavior documented until it is actually retired. No registry-enrollment endpoints, migration or acceptance results are claimed by this planning update.
