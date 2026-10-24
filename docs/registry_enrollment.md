# Registry enrollment (V14)

V14 replaces invitation admission with **register → saved academic profile → registry match → email code → admission → password login and automatic key setup**. Apply V14 explicitly with the matching backend after backing up and stopping application access. Startup does not migrate. No production registry identities or synthetic lecturer names are seeded by the migration.

Existing admitted accounts retain their credentials, sessions, vaults and access without a claim. The migration records `GrandfatheredAdmission` for admitted accounts and previously admitted deactivated accounts. Never-admitted accounts, including old invitation enrollments, must complete the registry flow. Old invitations and `AdmissionCommand invite` cannot grant admission.

## API and browser contract

Registration and pending password login return `{status:"enrollment",next:"profile_info.html"}`. They issue a separate Secure, HttpOnly, SameSite=Lax enrollment cookie and a readable CSRF cookie. These opaque credentials cannot authenticate application, key, search, chat, settings, export or forum routes. Registration against an occupied address has the same response shape and does not overwrite credentials or profiles; its neutral cookie cannot resolve an account. The profile page provides a link to login/recovery.

| Route | Contract |
| --- | --- |
| GET `/auth/enrollment` | Pending email, numeric revision, saved profile, retention expiry and this browser's current challenge; after successful admission, only status `admitted` and email. |
| GET `/auth/enrollment/options` | At most 1,000 `{id,name}` reference options each for specializations, departments and professions, ordered by ID. No identity registry records are returned. The captured schema has independent reference lists, with no faculty hierarchy to invent. |
| PUT `/auth/enrollment/profile` | Revision, exactly one role (`graduate`/`lecturer`), names and role-specific verification fields; optional biography. Valid saves increment revision and invalidate email codes. Reference IDs must exist. Eligibility mismatches remain editable. |
| POST `/auth/enrollment/submit` | Current revision. Match only the selected registry, then send a code. Returns challenge ID, expiry and resend time. |
| POST `/auth/email/verify` | Challenge ID and six-digit code; enrollment cookie plus CSRF required. Recheck eligibility and claim uniqueness, consume code and admit in one transaction. |
| POST `/auth/challenges/resend` | Enrollment requests must reference this browser's unconsumed current challenge. Rechecks eligibility and revision; observes the original cooldown and aggregate limits. Ordinary login/recovery challenges retain their existing browser binding. |
| PUT `/auth/enrollment/password` | New PLK1 derivation metadata and login proof under restricted enrollment authority. Rotates pending credentials, revokes other enrollment sessions and invalidates codes. Cannot create a vault or grant admission. |
| POST `/auth/enrollment/logout` | Revoke this restricted session, preserving its saved profile. |

Every mutation requires the configured frontend origin. Restricted mutations additionally require `X-CSRF-Token` matching the enrollment CSRF cookie and stored hash. Ordinary bearer/refresh credentials do not resolve an enrollment session. Revision conflicts return `REVISION_CONFLICT` (409); reload the saved state before retrying. Registry failures return `REGISTRY_MISMATCH` without disclosing which identity field matched. Other authentication and rate-limit errors use the existing identity envelope.

An enrollment session expires after 30 idle minutes or 24 absolute hours. Password login can resume an unexpired saved enrollment with a new restricted session. Unfinished enrollment expires seven days after registration or its last successful profile save; code issuance, failed edits and recovery do not extend retention. Access rejects expired enrollment immediately. Scheduled cleanup removes pending security credentials, sessions, codes and profile data, and anonymizes the residual user row so the address can register afresh. Cleanup refuses to remove cryptographic state or admitted accounts.

Mailbox recovery for a pending account issues only restricted enrollment access. The reset page can replace its pending password and return to the saved profile. Existing admitted-account recovery retains the PLK1 vault/history flow. Passwords and pending enrollment login derivatives are never stored across page navigation; the applicant enters the password again after admission.

A successful verify retry with the same proof and original enrollment session returns the same `admitted` status, including after a lost response. It cannot mint an application session. Other-browser proofs, stale revisions, expired/unconsumed codes and consumed codes without that session's completed result fail. Verification attempt counters commit even when the submitted code fails; five wrong attempts exhaust a challenge. Admission locks account/session state and registry ownership before committing. SQL unique filtered indexes enforce one claim per registry row; the user primary key enforces one claim per account.

## Matching and profile data

New enrollment and every proposed email change require the exact normalized domain `polytechnic.am`. Normalize email with trim and locale-independent lowercase; subdomains, suffix lookalikes and Unicode domain substitutions fail. Existing admitted accounts can still log in and recover with their existing addresses. A staged pre-rollout email change to an invalid domain cannot be completed after rollout.

Names and diploma numbers use Unicode NFKC normalization, collapse Unicode whitespace, trim and lowercase with `Locale.ROOT`, with no accent removal, transliteration or fuzzy matching. Do final comparisons in Java to avoid accepting database-collation near matches. Alumni candidates are bounded to 1,000 in the selected specialization/study-year cohort; oversized or ambiguous cohorts fail closed and need an operator import review. Lecturer email lookup is bounded and then checked against normalized email in Java.

Graduates must match diploma number, first/last names, specialization ID and the years of the registry study dates. Lecturers must match registration email, first/last names and department ID. Profession is a required reference selection, not registry evidence. Missing official lecturer names/department blocks admission. Patronymics are not collected. Biography is optional; profile photos are optional and can be added when profile-media editing is available.

The admitted profile persists names, role, description and specialization/profession label. Lecturer department and profession IDs persist in `dbo.Lecturers`; graduate study dates and specialization remain linked through the verified alumni claim. Diploma details are absent from URLs, code payloads, public profile projections and ordinary exports. Claims retain registry provenance, verification time and profile revision, with a separate audit trail for admission, correction and release.

Official registry corrections do not revoke admitted-user access or silently retarget claims. Foreign keys block removal of occupied registry rows until an operator resolves the link. Email changes preserve claims and role, even if the new lecturer email differs from its original registry email.

## Offline maintenance and rollout

Use migration credentials and the Maven exec entry point for these audited commands:

```sh
./backend/mvnw -f backend/pom.xml compile exec:java -Dexec.mainClass=am.polylink.auth.AdmissionCommand -Dexec.args='readmit USER_ID OPERATOR'
./backend/mvnw -f backend/pom.xml compile exec:java -Dexec.mainClass=am.polylink.auth.AdmissionCommand -Dexec.args='correct USER_ID graduate REGISTRY_ID OPERATOR'
```

Quote an operator identity containing spaces as a single argument. `readmit` only restores previously admitted deactivated accounts with verified email and grandfathered admission or an existing claim. `correct` requires an existing claim, the same role, and a valid unoccupied target registry row; it records old/new links in one transaction. Use `lecturer` for lecturer corrections. These commands preserve session and vault versions and cannot initially admit a pending account.

Successful account deletion audits and releases the claim in the same transaction as deletion. A rollback retains the claim. Deletion-ledger replay also releases claims. Re-registration must pass the entire current flow, and does not restore deleted keys or history.

Before enabling real lecturer enrollment, import verified university names and departments. Synthetic fixtures are confined to explicitly disposable acceptance databases and cannot establish production eligibility. Rehearse a V13 upgrade on a restored copy before deploying V14 with a backup. Preserve the existing V12/V13 historical-forum review requirements.

Run `./backend/mvnw -f backend/pom.xml verify`, `npm test --prefix tools/contracts`, and `bash tools/local/test.sh --full`. For focused enrollment SQL and both HTTP/mock browser flows, run `python3 tools/m1/verify.py --enrollment` with the same test environment. The latter uses disposable SQL/OpenBao/mail services and covers identity, recovery, settings, groups, messenger and forum browser regressions. `EnrollmentIT` tests restricted boundaries, both roles, occupied-address protection, revision invalidation, code attempts, atomic duplicate claims, pending recovery, expiry and claim release. The working database is never migrated by these checks.

The v1 graduate policy verifies knowledge of official diploma details plus control of a university mailbox. The alumni registry does not link that mailbox to the diploma holder. Existing claims/access survive later registry corrections; periodic eligibility rechecks remain deferred.
