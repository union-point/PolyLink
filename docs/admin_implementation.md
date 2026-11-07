# Admin access implementation and operations

Status: phases 1–6 implemented, 7 November 2026. Product authority: [admin decisions](admin_panel_decisions.md). Contracts and locking: [reference services](admin_references.md), [registry services](admin_registry.md). Remaining delivery: [implementation plan](admin_panel_implementation_plan.md).

## Implemented boundary

V23 adds a separate `admin` schema for admin identities, invitations, registration/login challenges, sessions and stable system reference identities. No member, education, registry claim or key vault is created when an admin registers. There is one admin authority and no public role selection or super-admin.

The local command creates email-bound invitations valid for exactly 24 hours, storing only token hashes. Owners send links manually. Registration collects names and matching passwords, verifies the invited mailbox and consumes the invitation atomically. GET/link previews do not consume it. Repeating a completed proof from the same browser is safe; a second browser cannot redeem an already-used invitation.

`admin-register.html` and `admin-login.html` use a separate native-fetch client and the existing PLK1 password derivation without messenger key setup. Invitation tokens arrive in URL fragments, are removed from the browser URL immediately and are never stored persistently. Only challenge identifiers/times are retained in session storage for reload; passwords and derived keys are not retained between steps. The screens support the connected HTTP server and an isolated mock provider. Mock access requires an explicitly provisioned invitation and full registration/login with 2FA; it has no seeded admin credentials.

Every login requires a password and a browser-bound email code. Codes expire after ten minutes (or at invitation expiry if sooner), allow five incorrect attempts and have a 60-second resend cooldown. Resending preserves the original expiry and failed-attempt budget and replaces the code. Account/IP issuance limits and verification limits use the existing rate-limit store under separate admin purposes. Registration completion directs the user to login; it does not issue an authenticated session.

Admin sessions use independent Secure, HttpOnly, SameSite=Lax cookies and a session-bound CSRF header for mutations. They have a 30-minute idle deadline and a 12-hour absolute deadline. `/refresh` rotates the opaque session and CSRF token, extends the idle deadline and preserves the absolute deadline; old tokens immediately stop working. Protected reads check current enabled state and session version. Member bearer/enrollment credentials do not authorize admin access; admin cookies do not authorize member APIs. Session expiry and local disabling are enforced server-side. An enabled cleanup task removes expired security records in bounded batches.

## Management interface and remaining rollout

`admin-academic.html`, `admin-content.html` and `admin-registry.html` provide the three approved management pages. They share navigation, bounded search/paging, detail, add/edit/delete forms and isolated admin session handling. Lecturer/alumni search, detail and CRUD APIs now enforce normalized uniqueness, current versions and linked-record immutability. Reference CRUD now enforces V23's system identities, all incoming dependency paths, stale-write versions and disable/write serialization; V24 supplies database-maintained versions. Enrollment uses the protected stable Polytechnic identity. Phase 5 enables custom post-type CRUD: live and mock publication consumers support dynamic codes, generic labels and refreshed choices. Built-in types remain protected and used types remain immutable. V25 adds Java-normalized binary identity keys, source binding and registry versions; enrollment and local claim correction share the registry/claim lock order. Mock management uses the same response contracts, versions and lock explanations. No admin password-recovery or re-enable operation is currently exposed. Mandatory 2FA cannot be disabled. No invitation cancellation, Excel import or separate admin action audit log is implemented.

After successful login, the access page offers a link to management. The three pages show why records are locked, preserve failed-save drafts, offer explicit refresh on stale versions and confirm deletion. Registry fields are manually maintained; no import or member moderation UI is exposed. Full regression and restored-copy rollout rehearsal remain phase 7 work; keep normal rollout disabled until those gates pass.

## Explicit rollout and local commands

Admin HTTP routes default to disabled (`ADMIN_ENABLED=false`). Apply migrations through V25 explicitly using the existing [schema workflow](messenger/schema-and-migrations.md) before testing with `ADMIN_ENABLED=true`; startup does not migrate. Use a reviewed backup and a restored rehearsal database for rollout. These changes do not apply migrations to the working database automatically.

From the repository root, privately load the intended database's migration credentials as described in the backend runbook. Set the registration URL to the deployed frontend page, using HTTPS except for loopback development. Then issue an invitation:

```sh
export ADMIN_REGISTRATION_URL=https://your-frontend.example/admin-register.html
./backend/mvnw -f backend/pom.xml compile exec:java \
  -Dexec.mainClass=am.polylink.admin.AdminCommand \
  -Dexec.args='invite owner@example.org'
```

The command prints a secret one-use link and UTC expiry. Send the link manually to that address and keep command output out of shared logs. Code emails use the configured SMTP delivery. Admin emails may use non-university domains; ordinary member registration retains its Polytechnic domain and registry checks.

To locate the admin ID, use the authenticated `/admin/auth/session` response or the identity shown by the access client. Disable that ID locally:

```sh
./backend/mvnw -f backend/pom.xml compile exec:java \
  -Dexec.mainClass=am.polylink.admin.AdminCommand \
  -Dexec.args='disable 123'
```

Disabling is idempotent, advances the session version once, revokes active sessions and invalidates pending login challenges. It does not change a member account with the same email. An existing admin email, including a disabled identity, cannot be overwritten through a new invitation. There is no web invitation/access-management endpoint and no re-enable command.

## API surface

All routes below are under `/admin/auth`. Mutations require an allowed frontend origin. Verification/resend mutations require the challenge CSRF token; refresh/logout require the admin session CSRF token. Cookie names are `__Host-plk-admin`, `__Host-plk-admin-csrf`, `__Host-plk-admin-challenge` and `__Host-plk-admin-challenge-csrf`.

| Route | Input/result |
| --- | --- |
| `POST /parameters` | Email; PLK1 derivation parameters, with deterministic neutral parameters for unknown addresses. |
| `POST /registration/invitation` | Invitation token; fixed invited email and expiry. No consumption. |
| `POST /registration/start` | Token, names, login secret and derivation metadata; challenge ID/expiry/resend time. No email/role override. |
| `POST /registration/verify` | Challenge ID and code; `registered`. |
| `POST /registration/resend` | Challenge ID; updated resend time with unchanged expiry. |
| `POST /login` | Email, PLK1 scheme and login secret; challenge only. |
| `POST /login/verify` | Challenge ID and code; authenticated admin metadata and session cookies. |
| `POST /login/resend` | Challenge ID; updated resend time. |
| `GET /session` | Current admin ID, email, names and fixed `admin` role. |
| `POST /refresh` | Empty object; rotated session/CSRF cookies and metadata. |
| `POST /logout` | Empty object; revoke session and clear its cookies. |

## Validation

Run `npm test --prefix tools/contracts` for provider/credential/CSRF contracts and `./backend/mvnw -f backend/pom.xml verify` for the normal backend build/unit checks. With disposable SQL administrator credentials configured privately, run:

```sh
bash tools/local/test.sh --admin
```

The focused runner provisions uniquely named disposable SQL/OpenBao/mail resources, runs admin access/reference/registry HTTP/SQL, enrollment and migration integration checks, then exercises the registration/login screens in Chromium. Browser checks invoke the real invite/disable commands only against the disposable database. They cover invitation URL removal, password clearing, verification reload, password-only denial, mandatory 2FA, session reload, disabling and mobile overflow. Migration tests cover fresh/upgraded layouts, repeat validation, member preservation, exact invitation duration, schema-drift rejection and rollback on an unresolved Polytechnic identity. SQL/HTTP tests cover concurrent redemption/retries, wrong/replayed/foreign-browser/cross-purpose codes, CSRF, invitation expiry, resend budgets, session rotation/expiry, cleanup and disabled-session/challenge rejection.


## Phase 6 interface behavior

The shared controller and shell in `js/admin/` use `css/style.css` theme values and
`css/admin.css` components. Admin pages never call member bootstrap or use member
session transport. Search is bounded, supports Enter and IME-safe debounce, and
ignores superseded responses. Queries stay in memory because registry searches
can contain private identifiers; only the selected list is represented in the URL.

Native styled selects and date controls preserve platform keyboard behavior.
Dialogs associate field errors with labels, keep actions visible on narrow screens,
retain drafts after failures, and require explicit discard before refresh or close.
Reference codes remain immutable. Linked registry records and protected/in-use
references expose read-only details with textual lock reasons.

The shell checks enabled session state periodically and on return to the page.
Resume checks hide sensitive content until identity is confirmed. Offline checks
suspend native dialogs while preserving drafts and expose a reachable retry;
successful checks restore focus and selection. Expiry, logout and account changes
clear records, drafts, dialogs and pending confirmations. Background checks do not
interrupt typing. No browser guard replaces backend authorization.

For local mock development, select `dataMode: 'mock'` in the existing configuration.
Use the explicit mock-only operator helpers from a local development console:

```js
const mock = await import('/js/admin/mock.js');
const invite = await mock.provisionMockInvitation('owner@example.org');
// Open /admin-register.html#invite=<invite.token>, then complete registration.
// The mock mailbox provides the current verification code after each send:
await mock.takeMockCode('owner@example.org');
```

These helpers reject in HTTP mode and create no default admin or fixed password.
Mock state lives in the existing local IndexedDB dataset; its admin session/browser
keys are separate from member state. Academic/content edits refresh mock member
options, and registry admission uses current mock registry rows. Mock mode remains
a local simulation and is not evidence that a server deployment is enabled.

`bash tools/local/test.sh --admin` now includes real and mock management browser
journeys covering CRUD across all three pages, protections, stale drafts, delete
confirmation, keyboard/mobile behavior and disabled-session cleanup. The mock
journey also covers bounded pagination, correction states and logout. Contract
checks include `admin-mock.test.mjs` with an injected clock/storage for expiry,
one-use invitations, 2FA isolation, versions, normalization and record protection.
