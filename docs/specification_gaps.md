# PolyLink specification gaps

Reviewed 15 October 2026. This lists behavior that is still undecided in `frontend_context.md` and `backend_design_context.md`. Each item is something an implementer would otherwise have to invent.

The documents already name most of these gaps. What is missing is one answer per item, specific enough to implement without copying the mock. Mock rules are demo behavior, not production policy. Every recommendation below is a proposal for review, not an approved product decision or an implemented backend contract. Applying a recommendation may require coordinated schema, API, mock, and page changes.

Settled facts that this list does not reopen: member pages require a session and completed onboarding; announcements are posts, not a calendar; forum replies are flat; ids at the API boundary are opaque strings; timestamps are ISO UTC; the server, not the client, is the authority for ownership, membership, and visibility.

## Evidence and criticality

Checked against [frontend context](frontend_context.md), [backend design context](backend_design_context.md), and the current [mock provider](../js/data/mock/provider.js), [validators](../js/data/validation.js), [HTTP routes](../js/data/http/routes.js), [normalizers](../js/data/http/normalize.js), [transport](../js/data/http/transport.js), and page controllers. The `DB/` SQL, report, diagram and import script are absent from this checkout: database claims below are attributed to the backend context and have not been independently reverified against those original assets. Recover and verify those assets before implementing migrations.

Criticality describes the consequence of leaving a decision unresolved for a production release that includes the affected feature; it does not claim that a production vulnerability has been observed.

| Level | Meaning |
| --- | --- |
| **Critical** | Can permit account compromise, unauthorized access, disclosure of private data, or irreversible unintended data loss. Resolve before exposing the affected feature. |
| **High** | Blocks a core flow or requires substantial schema/API coordination. Resolve before backend implementation of that flow. |
| **Medium** | Causes inconsistent behavior, invalid data, or scaling problems. Resolve before releasing the affected feature. |
| **Low** | Limited scope, presentation, or optional-feature decision. Document before enabling it. |

Each item states the gap/current evidence and then a recommended solution. Recommendations that narrow scope are deliberate proposals, not claims that the broader feature was never requested.

## Eligibility and roles

- **Who may register.** **Criticality: High.** The database report allows only `@polytechnic.am`. The client accepts any syntactically valid address, and fixtures use other domains. Decide the exact allowlist, including letter case, plus-tags, and subdomains, and whether alumni who no longer have a university mailbox are an exception.

  **Recommended solution:** Start with verified mailboxes on the exact `polytechnic.am` domain, compared case-insensitively; reject subdomains unless explicitly listed. Preserve the local part, including plus-tags, without provider-specific rewriting. Require the same registry claim regardless of aliases. Defer alumni without a university mailbox to a separately approved institution-assisted verification process.

- **How a graduate is matched.** **Criticality: Critical.** `AlumniRegistry` has no email. Its unique key is `DiplomaNumber`, and no screen collects a diploma number. Matching on name alone is not proof. Decide the evidence (diploma number, a registry email, or another field), what the user sees when zero rows match and when several match, and whether one diploma can be claimed by only one account.

  **Recommended solution:** Add a private registry-claim workflow using diploma number plus institution-issued proof or an institution-confirmed invitation; possession of a diploma number or a matching name alone is insufficient. Enforce one claimant per registry row transactionally, allow one account to link multiple diplomas, and return a generic unresolved-match result without exposing registry candidates. Keep failed claims pending until an authorized offline process resolves them.

- **How a lecturer is matched.** **Criticality: High.** `LecturerRegistry` stores email and an optional department. `Lecturers.ProfessionId` is required, and onboarding never collects a profession. Decide where profession comes from, and what happens when the registry row has no department.

  **Recommended solution:** Match a verified mailbox to LecturerRegistry; require the institution to supply both department and profession before activation. Keep missing-data cases pending rather than inventing a profession or allowing users to self-verify. Create the lecturer row and claim atomically.

- **One role per user.** **Criticality: High.** The schema allows a single `RoleId`. The UI label `teacher` maps to canonical `lecturer`. Decide whether a person who is both an alumnus and a lecturer can have one account, whether the role chosen at onboarding can change later, and what happens to the education row or the `Lecturers` row if it does.

  **Recommended solution:** Keep one account and one active role in v1, with lecturer as the active role for verified dual-status people. Preserve education independently of active role. Disallow self-service role changes after activation; require a verified, transactional role-change process that archives obsolete lecturer affiliation.

- **When the check runs.** **Criticality: Critical.** Registration sends only email, password, and name. Role is chosen later, on onboarding. Decide whether an account may exist before a registry claim, and which states exist (unverified, pending, rejected, active). For each state, decide whether that person can log in, appear in search, post, or message, and who approves a failed or missing match. No administrator role is defined; do not invent one silently.

  **Recommended solution:** Create a restricted account after registration, verify email, then validate the role-specific claim during onboarding. Persist explicit email-unverified, eligibility-pending, rejected and active states. Only active, onboarded users may use member APIs or appear publicly. Permit restricted sessions only for verification, onboarding and logout; unresolved claims use the documented offline operator process, with no implicit administrator role.

- **Incomplete profiles are publicly reachable.** **Criticality: High.** New users default to a public profile before onboarding finishes. Decide whether they are excluded from search and from `GET /users/{id}` until `onboardingComplete` is true.

  **Recommended solution:** Exclude unfinished and non-active accounts from all other viewers’ profile/search reads and author discovery. Return 404 for direct reads; allow the owner to read and finish their own restricted profile. Enforce completion on server member operations as well as page navigation.

## Authentication, recovery, and sessions

- **Second factor.** **Criticality: Critical.** Settings expose a toggle, while the report calls for 2FA. Decide whether it is mandatory or optional, the method (app TOTP, email code, or other), how enrollment works, how a lost device is recovered, and whether turning it off requires the current password. Login must not issue a fully authenticated session before a required second factor succeeds.

  **Recommended solution:** Propose mandatory TOTP before member access, subject to confirming the report’s requirement. Enroll through a restricted session, confirm a first valid code, and issue one-use recovery codes stored as protected verifiers. Require current password plus a factor/recovery code to replace or disable enrollment; disabling leaves the account restricted until re-enrollment. Never use a settings boolean as proof of enrollment.

- **Challenge rules.** **Criticality: Critical.** The mock uses a fixed code, a 10-minute lifetime, 5 attempts, and a 60-second resend wait. Those are demo rules. Decide code length and entropy, expiry, attempt lockout, whether resend invalidates the previous code, and whether a new forgot-password request cancels the previous challenge. Routes for second-factor verify/resend and recovery resend are not mapped.

  **Recommended solution:** For emailed ownership/recovery codes, propose six cryptographically random digits, ten-minute expiry, five failed attempts and a 60-second resend interval, with account/IP throttles and explicit 429 handling. Resend generates a new code and invalidates the old proof; a new recovery request invalidates prior recovery challenges. Store protected verifiers and consume proof atomically. TOTP uses its own short time-step and replay checks, not these email-code timers.

- **Account enumeration.** **Criticality: High.** Decide whether an unknown email, a wrong password, a duplicate registration, and a deactivated account return the same HTTP status and the same user-visible message.

  **Recommended solution:** Make wrong-password and unknown-account login failures indistinguishable, and return the same acknowledgement for known/unknown recovery requests. Use the same HTTP status, generic acknowledgement, response shape and comparable processing time for new/duplicate registrations, without an automatic authenticated session to avoid duplicate-email disclosure; update the registration controller accordingly. Reveal deactivation/reactivation choices only after credential verification. Keep normal validation errors distinct from credential failures.

- **Recovery request body.** **Criticality: Critical.** The pages require `challengeId`, then `recoveryToken`, then a reset bound to that proof. The HTTP adapter still posts `{email, code}` and `{email, code, newPassword}` and does not send `challengeId` or `recoveryToken`. Choose one contract. A reset must not succeed from the email address alone, and verifying a code must not authorize a later reset that only repeats the email.

  **Recommended solution:** Adopt the controller contract: forgot returns an opaque challengeId; verify sends {challengeId, code} and returns a five-minute one-use recoveryToken; reset sends {recoveryToken, newPassword}. Bind proof to account and purpose server-side, consume it atomically, revoke sessions and outstanding recovery proofs, and update the route adapter together with the API.

- **Password policy.** **Criticality: High.** The mock requires 8–128 characters, an ASCII uppercase letter, a digit, and a special character, and it keeps leading and trailing spaces. Production policy is open. Decide those rules, including whether the new password must differ from the current one. Password hashes, recovery secrets, and challenge material never appear in user DTOs.

  **Recommended solution:** Propose 15–128 characters with spaces and Unicode preserved, no mandatory character classes, and rejection of known-compromised/common passwords. Reject the current password as the replacement. Use a maintained password-hashing implementation with per-password salt and reviewed cost settings; replace the mock policy consistently in UI/API documentation and never expose verifiers in DTOs.

- **Email change.** **Criticality: Critical.** Decide whether the new address must pass the university allowlist and a fresh registry match, whether it needs its own verification code before it becomes the login address, and what happens to existing sessions, recovery challenges, and 2FA enrollment. The current password is required.

  **Recommended solution:** Require recent password and second-factor verification, validate the replacement allowlist, and verify ownership before switching addresses. Preserve the existing graduate claim; for lecturers, require an institution-confirmed registry update. Notify the old address, revoke all sessions/recovery challenges after success, retain verified TOTP enrollment, and require a fresh login.

- **Session lifetime.** **Criticality: Critical.** Access-token format and lifetime, refresh-cookie name, and `SameSite`, `Secure`, and `HttpOnly` flags are unspecified, as are rotation and reuse detection. Decide whether logout, password change, password reset, email change, deactivation, and deletion revoke only the current device or every session.

  **Recommended solution:** Propose short-lived opaque bearer access tokens (15 minutes) and rotating refresh sessions with seven-day idle and 30-day absolute expiry. Use a host-only Secure, HttpOnly refresh cookie named `__Host-polylink_refresh`, with Path=/ and SameSite=Lax in the proposed same-origin deployment. Detect refresh reuse and revoke its session family. Logout revokes the current device; credential changes, reset, deactivation and deletion revoke every device. Specify concurrent-refresh handling and use an in-memory access token rather than persistent localStorage in production.

- **Cross-origin cookies.** **Criticality: Critical.** The static site and the API are different origins (`python3 server.py` versus port 3004). Decide the allowed origin and CSRF protection for cookie calls (`/auth/refresh`, `/auth/logout`). There is no `/api` prefix unless one is added to both sides together.

  **Recommended solution:** Prefer a same-origin production reverse proxy while retaining the existing route paths. Allow only the explicit development frontend origin for credentialed CORS. Validate Origin and require CSRF protection for cookie-authenticated writes. Use Secure/HttpOnly/SameSite=Lax in the same-site production setup; if deployment becomes cross-site, explicitly review SameSite=None and CSRF handling together.

- **Logged-out `/auth/me`.** **Criticality: Medium.** The client accepts either a `null` body or a terminal 401. Return one of them, not both.

  **Recommended solution:** Standardize on 401 with the normal error body after refresh is unavailable or rejected. Keep the provider conversion of terminal 401 to null; distinguish this expected logged-out state from network/server failures.

## Profiles, education, and media

- **Headline versus specialization versus institute.** **Criticality: High.** The user DTO has `jobTitle` and a separate academic `specialization`. SQL has `Users.Specialization` plus a different specialization on each education row. Search matches the denormalized user fields, while graduation year is supposed to come from one chosen education or registry record. After the user edits education, those copies can diverge. Pick the canonical source for profile cards, search, and the professional headline.

  **Recommended solution:** Store jobTitle as a separate professional headline. Add an owner-selected primary education id and derive academic institute, specialization and graduationYear from that row; derive lecturer department from verified lecturer affiliation. Preserve registry evidence separately. Recompute public/search projections transactionally whenever the primary row changes or is removed.

- **Onboarding must not invent a degree.** **Criticality: High.** Study years are year-only. The mock turns them into September–June dates and fills in a university and a bachelor degree the user never entered. Decide the stored value, how a master's or PhD alumnus is represented, and the rule that year-only input must not become a fabricated calendar day. Registry dates stay official full dates and stay distinguishable from profile dates.

  **Recommended solution:** Store year values with explicit year precision and ask graduates to select the actual university and degree, including master/PhD. Add nullable degree/pending education support until selected rather than defaulting to bachelor. Keep official registry dates in separate fields and never infer a month/day from onboarding years.

- **Repeating onboarding.** **Criticality: High.** Completed users can revisit `profile_info.html` and submit again; neither the page nor the mock rejects this. The mock replaces the education row marked `onboarding` with a newly generated id, and changing to lecturer leaves the earlier education intact. Decide whether a second call updates the original education row or inserts another, and whether the lecturer row is created in the same transaction as the profile update. A chosen photo must be stored successfully before onboarding is marked complete; skipping the photo is allowed.

  **Recommended solution:** Make completion an idempotent operation keyed by user, preserving education identity on retries. Once completed, reject changed onboarding payloads with 409 and direct edits to the normal profile/education flows. Commit profile, claim and lecturer subtype changes together; verify uploaded media ownership/existence before completion and clean up abandoned uploads separately.

- **Free text versus lookup ids.** **Criticality: High.** Education and onboarding submit display names. SQL expects `UniversityId`, `DegreeId`, `InstituteId`, and `SpecializationId`. Decide who may create a lookup row, how near-duplicate Armenian names are merged, what `IsVerified` changes in the product, and whether a user can rename a shared row.

  **Recommended solution:** Provide lookup selection by stable ids. Restrict shared-row creation/renaming/merging to an explicit offline institution operator process in v1; users may submit suggestions without editing shared rows. Normalize Unicode/whitespace for duplicate review, keep display spelling, and expose IsVerified as reference provenance rather than a user-verification badge.

- **Reference lists.** **Criticality: High.** Institute, department, sphere, post type, and forum major options are fixed labels in the client. There is no reference API, and forum majors have no table. Persist stable codes (`job`, `internship`, `training`, `informatics`, and the other listed codes). Do not use a localized `Name` as the code.

  **Recommended solution:** Add read-only versioned reference data with stable code/id and localized display name, then have forms consume it. Seed the existing category, sphere and major codes; give institute/department stable ids. Never infer a code from a translated label, and reject unknown write values.

- **Date precision.** **Criticality: High.** Profile dates are `YYYY-MM`, onboarding sends a year, SQL stores `DATE`, and `DATETIME2` defaults to server local time via `SYSDATETIME()`. The API contract requires UTC timestamps. Define the conversion both ways. A null end date means ongoing; decide whether several ongoing education rows are allowed. Reject an end that precedes the start.

  **Recommended solution:** Represent profile dates as a value plus year/month precision (with nullable end); retain full DATE values for official registry records. Compare ranges at their declared precision and permit multiple ongoing education rows. Use SYSUTCDATETIME() for new timestamps and ISO 8601 Z responses; document the source timezone before converting existing local timestamps.

- **Certificates.** **Criticality: Medium.** The URL column is `NVARCHAR(255)` in the creation script and `NVARCHAR(MAX)` on the diagram. The client expects `logo`; the table has no logo column. Decide whether the URL is optional, its maximum length, the allowed schemes (`http` and `https` only, as the client checks), and whether the logo is an upload, a default, or dropped from the DTO.

  **Recommended solution:** Make credentialUrl optional, parse absolute HTTP(S) URLs, and propose a 2,048-character limit with a matching schema migration. Use a server-selected default logo in v1, retaining the logo field as read-only. Keep issue dates at month precision and reject unsupported schemes.

- **Biography.** **Criticality: Medium.** Length is not in the written limits. Mock onboarding requires it and implicitly caps it at 1,000 characters through `required()`; later profile saves can clear it and impose no maximum. Decide the maximum (SQL `About` is `NVARCHAR(MAX)`) and treat biography as plain text, not HTML.

  **Recommended solution:** Adopt a 1,000-character plain-text limit for both onboarding and later edits; require nonblank text only at onboarding. Enforce the same trimming/counting rule in both providers and the backend, and allow a later explicit empty string to clear it.

- **Uploads.** **Criticality: Critical.** Allowed types are PNG, JPEG, WebP, and GIF, nonempty and at most 5 MiB. The client checks the browser-reported type only. Decide magic-byte validation, replacement and deletion of the previous object, whether the file URL remains fetchable after the profile is closed, and which placeholder is used when avatar or cover is empty. Browser preview URLs are not server assets.

  **Recommended solution:** Validate size, signature and successful image decoding server-side; re-encode images to remove active/embedded content and metadata under bounded dimensions. Store randomized object keys and serve through authorization checks. Revoke old-object access on replacement/deletion and apply current visibility on fetch; use explicit default avatar/cover assets. Do not publish permanent bearer URLs for private images.

- **Work experience.** **Criticality: Low.** `WorkExperience` exists in SQL and has no page, editor, or route. Confirm whether collection/editing is out of this version; separately decide how any already-stored personal work data is exported or deleted.

  **Recommended solution:** Exclude work-experience CRUD from v1. If production already stores a caller’s WorkExperience rows, include them in export/deletion handling even without an editor; otherwise document that v1 collects none.

## Privacy

- **Closed profile.** **Criticality: High.** For other viewers, the mock hides the person from search and from the profile page (the owner still sees their own profile/search result), but leaves their posts, topics, replies, and comments visible with an author. Decide whether that author's name is still shown, whether it still links to the profile, and whether a direct `GET /users/{id}` for a closed profile is 404 or 403. 404 avoids confirming that the account exists.

  **Recommended solution:** Keep published discussion content and its minimal author name/avatar visible to members, explicitly explain this in privacy settings, and omit profile links when the target is unavailable. Return 404 for other viewers’ closed-profile reads and keep owner access. Recheck media visibility independently.

- **Email disclosure.** **Criticality: Critical.** `showEmail` has no column. It is independent of the login identifier. Define the four cases: public profile with email hidden, public profile with email shown, closed profile, and the owner viewing themselves. Search results and public profile reads need explicit projections that consistently enforce the chosen disclosure policy. `passwordChangedAt` is on the user DTO; keep it on the owner projection only unless a public display is an explicit decision.

  **Recommended solution:** Use separate owner, public-profile and search-card DTOs. Owner reads include email/passwordChangedAt; public profiles include email only when public and showEmail=true; closed profiles return 404 to others. Search cards omit email and passwordChangedAt even if public disclosure is enabled. Make this narrower search policy explicit in the contract.

- **Blocks outside chat.** **Criticality: High.** Blocking is specified for direct messages. It is not specified for search results, profile views, or forum replies. Decide each one.

  **Recommended solution:** In v1, block prevents direct contact and hides each user from the other’s search/profile reads in both directions, using 404 for inaccessible profiles. Retain shared forum content with minimal author attribution to avoid broken threads; explain that blocking does not erase shared discussions. Apply the rule server-side.

## Posts and forum

- **Which fields are required.** **Criticality: Medium.** The UI requires a title; SQL allows a null title. Sphere may be empty in the client and is not checked against `programming`, `engineering`, `data-science`, and `marketing`. Category must be `job`, `internship`, or `training`. Confirm that sphere is optional, reject unknown category and sphere codes, and reject a blank title.

  **Recommended solution:** Require trimmed nonblank title and sanitized nonblank content; require a known category and allow sphere to be null/empty or one known code. Make SQL title non-null and enforce application-level blank checks, with the same validation on create and update.

- **Comments embedded in a post.** **Criticality: High.** `GET /posts` is specified with a `comments` array, and `GET /posts/{id}/comments` also exists. Decide whether a feed post contains the full thread, a short preview, or only a count, and define sort order and page size. Do not build durable ids from array positions.

  **Recommended solution:** Adopt commentCount plus at most three newest comment previews in feed DTOs; keep comments as that preview array for compatibility. Page the full comment endpoint oldest-first by (createdAt, id), 20 per page. Update the UI to show preview versus full thread explicitly before shipping this bounded response.

- **Writes the UI does not show.** **Criticality: Medium.** Comment edit/delete and topic edit/delete exist as client services and have no buttons. Decide whether those operations are in this version. Deleting a post removes its comments; deleting a topic cascades to replies and likes, including other people's replies. Confirm that consequence, or define a different retention rule.

  **Recommended solution:** Keep owner comment/topic edit/delete in the contract and add discoverable controls before advertising them. Confirm that deleting a post/topic removes its entire child thread, including other authors’ content, and show that consequence before deletion. Keep standalone reply edit/delete out of v1 unless added explicitly.

- **Rich-text allowlist.** **Criticality: Critical.** Both docs require a narrow allowlist and do not list it. Freeze the set the client already uses: `p`, `br`, `b`, `strong`, `i`, `em`, `u`, `ul`, `ol`, `li`, `a`, `div`, `h2`, `h3`, `blockquote`. Links may be `http`, `https`, or `mailto`. The current sanitizer removes input attributes, then restores a safe `href` and adds `rel="noopener noreferrer"` on links. Other attributes, including `style`, `class`, and event handlers, are removed. Relative links currently resolve against the page URL. The server must sanitize; the browser check is not enough. The current 20,000-character limit counts trimmed DOM `textContent` in JavaScript UTF-16 code units, not raw markup or a precise rendered-text count; block boundaries and `<br>` do not necessarily count as whitespace. Reject whitespace-only markup such as `<p><br></p>`. Titles, names, and comments stay plain text even when rendered next to HTML.

  **Recommended solution:** Adopt the listed tag set with safe absolute href and generated rel as the only link attributes; normalize permitted relative links against a configured public base URL. Sanitize server-side and again on display. Specify the current trimmed textContent/UTF-16 counting rule for the 20,000 limit, add a 128 KiB UTF-8 raw-markup request cap, reject empty text, and keep titles/names/comments escaped plain text.

- **Forum classification.** **Criticality: High.** Major codes (`informatics`, `mechanics`, `electronics`, `civil`, `energy`, `management`) have no foreign key. Decide whether they are their own lookup, or are actually specializations or spheres. Topic create requires one of these codes.

  **Recommended solution:** Create an independent forum-major lookup using the six current stable codes; require one valid major per topic. Keep it separate from education specialization and post sphere until an explicit institutional mapping is supplied.

- **Sort and likes.** **Criticality: Medium.** Newest, oldest, and popular need a stable tie-break. The mock orders popular by like count, then timestamp, then id. Popular applies to replies, not to the topic list. One user likes a reply at most once, and unliking removes that row. Decide whether liking your own reply is allowed. The per-reply “Պատասխանել” control only moves focus to the composer; it must not create a parent reply.

  **Recommended solution:** Order replies by createdAt DESC/id ASC for newest, createdAt ASC/id ASC for oldest, and likeCount DESC/createdAt DESC/id ASC for popular. Give topic lists a stable timestamp/id order. Enforce unique (userId, replyId), allow self-likes for compatibility, and make setting liked=true/false idempotent. Keep the reply control as composer focus only.

- **Missing topic id.** **Criticality: Medium.** A topic URL without an id currently selects topic 1. With real ids, that request should be an error, not a default record.

  **Recommended solution:** Remove the fallback to 1; show a missing-topic error and a forum-list link without making a record request. Treat ids as opaque URL-encoded strings and use 404 for unknown ids.

- **Moderation.** **Criticality: High.** There is no moderator role, report action, or hidden-content state. Post/topic owner deletion exists; no standalone forum reply edit/delete service exists. Decide whether reply deletion is required and whether any non-owner removal is permitted. The report describes discussions more broadly than the career forum shown in the UI; resolve that scope before adding moderation rules.

  **Recommended solution:** Keep the career-forum scope and owner post/topic deletion in v1; do not imply reply-delete or moderator controls exist. Before public production launch, define a named institution-operated abuse/takedown process, permissions and audit trail; a moderator UI can remain deferred. Do not expose unrestricted publication without an accountable removal process.

## Search

- **Filters have to be server parameters.** **Criticality: High.** The client sends only `q` and then filters institute, specialization, and graduation year on the returned array. That is wrong as soon as the server returns a page instead of every user. Define the parameter names, whether filters combine with AND, the sort, the page size, and the result of an empty query (no rows, or the first page).

  **Recommended solution:** Propose q, instituteId, specializationId, graduationYear, cursor and limit (default 20, max 100), combined with AND. Return the first eligible page for an empty q, ordered by normalized name then id. Move filtering before pagination on the server and migrate the HTTP adapter/UI to the agreed paginated card DTO together.

- **Match rules.** **Criticality: Medium.** The mock uses a case-insensitive substring over name, headline, and specialization. Armenian collation, punctuation, and partial tokens are undefined. Graduation year must come from one identified education or registry record when the person has several educations. Define how a lecturer with no graduation year behaves when a year filter is set.

  **Recommended solution:** Normalize Unicode to NFC, collapse whitespace and compare case-insensitively over name, headline and primary specialization using a documented Armenian-capable collation. Keep substring behavior for v1, including punctuation literally, and test Armenian/Latin examples. Derive year from primary education; exclude missing years when graduationYear is set.

- **Who is returned.** **Criticality: Critical.** Joins must not emit the same person twice. Decide whether the caller, incomplete profiles, deactivated users, and blocked users are included. Return a public card (durable id, name, avatar, academic fields, profile link), not a full user object that may contain email or `passwordChangedAt`. Official registry rows are not a directory.

  **Recommended solution:** Return each active, onboarded, public, non-blocked member once; exclude the caller. Use a dedicated minimal search-card projection with academic fields and id, with profile links derived by the client. Never join registry rows into directory results. Update search normalization so it no longer requires the full User DTO.

## Chat

- **Encryption, before the message table is final.** **Criticality: High.** `EncryptedContent` implies ciphertext. The UI searches message text, shows previews, and export includes sent message bodies as plaintext. Current in-room search runs in the browser. End-to-end encryption (E2EE) can support client-side search, previews, and plaintext export after authorized client-side decryption; it prevents the server from directly generating those plaintext results without access to decryption keys. Server-managed encryption at rest permits server-side processing. A column name and the commented-out key tables are not a protocol. If end-to-end encryption is chosen, algorithm, version, nonce, authentication tag, key distribution, rotation, recovery, multi-device access, and attachment encryption all have to be specified, and the location of decryption, search, preview generation, and export must be specified.

  **Recommended solution:** For v1, propose TLS plus server-managed encryption at rest, with clear disclosure that messages are not E2EE. Restrict decryption to authorized member reads and own-data export. If E2EE is a product requirement, treat protocol/key management as a prerequisite and implement search, previews and export in the decrypting client instead of dropping those features automatically.

- **Direct rooms.** **Criticality: High.** Decide that a pair of users shares one room, that self-chat is rejected, and what happens to that room after block, unblock, hide, and account deletion. The mock reuses the pair and makes a room with one remaining participant read-only (`closed`).

  **Recommended solution:** Enforce one direct room per canonical unordered user pair using a unique database key and transactional creation; reject self-chat. Hide/unblock reuses the room; blocks stop sends in either direction. On account deletion remove membership and close the surviving room to new sends while applying the chosen message-retention policy.

- **Groups.** **Criticality: Medium.** Group rooms render, and the seed data contains one. There is no create, invite, leave, rename, or role control. Either groups are not creatable in this version, or specify the member limit, the owner, and a single transaction for membership changes and message writes.

  **Recommended solution:** Do not offer group creation or membership changes in v1. Migrate only institution-provisioned groups with explicit membership, and apply member authorization to every read/write. If group management is later enabled, specify owner/member roles, limits and atomic membership/send authorization first.

- **`closed` and `blocked` are different.** **Criticality: High.** `closed` means the room has fewer than two participants; it is not a stored flag. The conversation `blocked` flag means “I blocked this person,” not “they blocked me.” Sends are rejected if a block exists in either direction. Define all four cases (I blocked them, they blocked me, both, neither): whether the composer is disabled, whether the other person's block is revealed, and the error text. In a group, decide whether a block against one member rejects every send or only directs. Group block controls are not in the UI.

  **Recommended solution:** Return closed and viewer-owned blocked separately, plus a server-derived canSend without revealing who blocked whom. Disable sending whenever either direction blocks in a direct room and return a generic unavailable error. Keep group blocks outside v1; for provisioned groups, blocks affect direct contact only, requiring a coordinated change to the mock’s current all-member send check.

- **Hide versus delete.** **Criticality: High.** The menu label is “delete conversation.” The behavior is a per-user hide plus a timestamp cutoff. A later incoming message shows the room again, without the hidden history. It does not delete the other participant's copy. Confirm this, or define a true delete.

  **Recommended solution:** Rename the action to hide conversation and explicitly describe its per-user history cutoff. Persist hiddenAt/historyVisibleAfter per member; unhide on a new incoming message without restoring earlier history. Treat permanent message erasure as a separate account-retention operation.

- **History window.** **Criticality: Critical.** Decide whether a participant sees messages from before they joined and after they left. `JoinedAt` does not answer that.

  **Recommended solution:** Require current room membership for every history/file read. For provisioned groups, show only messages sent during the current uninterrupted membership interval; leaving revokes reads and sends. For direct rooms, show the member’s history subject to their hide cutoff. Store membership intervals before supporting leave/rejoin.

- **Read state.** **Criticality: Medium.** Unread count is messages from other people after this viewer's last read time. Opening the room clears it. There is no delivered, read-receipt, or presence model. Show only the unread badge unless those states are actually stored. Do not claim online or delivered.

  **Recommended solution:** Persist a per-member lastReadMessageId or room sequence, advanced monotonically after successful loading/display. Derive unread counts from other senders after that point and after the hide cutoff, avoiding timestamp races. Expose unread badges only; defer receipts and presence.

- **Mute.** **Criticality: Low.** Per-room mute is separate from the account-level direct-message preference. Decide whether mute suppresses email only, the unread badge, or both.

  **Recommended solution:** Mute suppresses room notification delivery, including email, while preserving unread badges. Account emailEnabled disables email globally; directMessageNotifications controls message notifications independently. Blocking suppresses direct-message delivery and notifications.

- **Attachments and message shape.** **Criticality: Critical.** One optional image per message, using the same PNG, JPEG, WebP, GIF, and 5 MiB rules. Empty text is allowed only when a file is present. Text is limited to 5,000 characters. Decide storage, who can fetch the file URL, and how the original filename is displayed. There is no message edit or unsend.

  **Recommended solution:** Allow one authorized uploaded image plus up to 5,000 UTF-16 code units of trimmed text; require at least one. Apply the shared image validation and private storage rules, attach only assets owned by the sender, and authorize each fetch against room/history visibility. Display an escaped basename with a length cap, never a storage path; keep edit/unsend deferred.

- **Delivery.** **Criticality: High.** No websocket, SSE, or polling contract exists. Local mock events are not a server protocol. Define event types, ordering, how a reconnect fills the gap, and an idempotency key so a retried send is not stored twice. In-room text search currently loads the visible thread and filters it in the browser; define a bound before history can grow without a limit.

  **Recommended solution:** Start with authenticated cursor-based polling rather than claiming realtime support: page history by monotonic room sequence (50 default, 100 maximum), poll for later sequences, and reconcile after reconnect. Give sends a client-generated idempotency key and return the stored message on retry. Limit local search to loaded history and label that scope; add a separate authorized server-search contract only if full-history search is required.

## Settings, notifications, and account lifecycle

- **Russian.** **Criticality: Low.** The UI offers `hy`, `en`, and `ru`. The SQL seed has `hy` and `en` only. Storing `ru` does not translate the interface or user content. Decide whether `ru` is a legal `Language` code. User-written posts and messages stay in the language they were written in.

  **Recommended solution:** Accept hy/en/ru as preference codes and seed all three consistently. Keep Armenian as the effective interface language until translations ship; label other choices as saved preferences with Armenian fallback. Never translate user content automatically.

- **Notification defaults.** **Criticality: High.** `UserNotificationSettings` is optional, and its bits are nullable. Decide the meaning of a missing row and of NULL (the mock default is all four enabled, profile public, email hidden, 2FA off, language `hy`). “New listing” does not say which posts qualify: every post, or only a matching sphere or major. Forum notifications are replies to topics the user authored, not a subscription list. Decide whether `emailEnabled: false` stops email only, whether room mute and block suppress delivery, and whether users are notified about their own posts, comments, and replies. No delivery table, template, or scheduler exists; preferences alone do not send anything.

  **Recommended solution:** Create a non-null settings row transactionally for each account and backfill existing rows. Preserve the current four enabled defaults; keep new-account profiles undiscoverable until activation. Propose listings to all opted-in active members and forum replies to topic authors only; suppress self, blocked-direct and muted-room notifications. Define emailEnabled as the email master switch. Add a transactional outbox, deduplication, templates and worker before claiming delivery, or explicitly mark notification delivery unavailable.

- **Deactivation.** **Criticality: High.** The mock requires the current password, ends the session, hides the profile, leaves published posts in place, and reactivates the account on the next successful login. Confirm that login-to-reactivate is intentional, and what the other person sees in an existing chat while the account is deactivated.

  **Recommended solution:** Require current password/recent second factor, revoke all sessions, and hide profile/search while retaining publications and history. After verified login, require explicit confirmation to reactivate before issuing a member session. Show a generic unavailable contact in existing direct chats and reject sends to a deactivated account; do not erase prior messages.

- **Deletion.** **Criticality: Critical.** “Delete the account and all data” is not what the foreign keys do. Comments, topics, replies, likes, and sent messages reference the user without cascade, so a physical delete can fail; cascading them would remove other people's replies under that user's topics. For each of these, decide delete, anonymize as a deleted user, or retain: posts, comments on other people's posts, topics, replies, likes, sent messages, direct rooms, group membership, media files, education, certificates, and the registry claim. Also decide whether the email address and diploma can be registered again, whether deletion has a grace period, and that export-before-delete is or is not required. Password confirmation is required. The mock's surviving direct room becomes read-only; confirm or replace that rule.

  **Recommended solution:** Adopt an explicit retention matrix: erase profile/email, education, certificates, work history, media, claims, blocks, likes and memberships; retain posts/topics/comments/replies with a non-identifying deleted-author tombstone so other people’s contributions survive. Erase sent message bodies/attachments, retaining only non-identifying conversation placeholders; close direct rooms. Revoke credentials/sessions immediately and perform durable, retryable cleanup with completion tracking, including storage/backups under a documented retention schedule. Require password/recent factor, use no grace period, offer export first without requiring it, and allow email/diploma reuse only through fresh eligibility verification. Update the deletion promise and foreign keys to match this proposal before release.

- **Export.** **Criticality: High.** Include the caller's profile, settings, posts, comments, topics, replies, sent messages, and own media. Exclude passwords, tokens, challenges, and other participants' message bodies. Decide whether the response is synchronous JSON or a generated file, and the size limit. With E2EE, a server-only export contains ciphertext; a client-generated export may include messages the client can decrypt. Clearing local browser data is not a server route.

  **Recommended solution:** Generate an authenticated asynchronous JSON/asset archive of caller-owned data, excluding secrets and others’ message bodies, with a 24-hour owner-authorized download, one active job per account and a proposed 100 MiB archive cap. Return an actionable size-limit error rather than silently truncating larger exports; specify a chunked export before admitting accounts above that limit. Include any existing work history despite deferred editing. For E2EE, export ciphertext server-side and offer a separate explicit client-decrypted export; do not assert plaintext export is impossible.

## API contract

The client will not infer the items below. Paths that are not mapped fail visibly as `UNSUPPORTED` and must not be guessed.

- **One success shape.** **Criticality: High.** The client accepts a bare DTO, `{data: DTO}`, and `{success: true, data: DTO}`. Emit one. Lists are JSON arrays, including an empty list. There is no pagination envelope. Deletes: the client ignores the body, so return an empty success.

  **Recommended solution:** Standardize unpaginated resources as {data: DTO} and collections as {data: []}, both already unwrapped by the client; use 204 for deletes. For pagination, explicitly adopt {data: [], page: {nextCursor}} only alongside client changes that preserve page metadata rather than discarding it in unwrap().

- **Errors.** **Criticality: High.** Use 400 for validation, 401 for unauthenticated, 403 for forbidden, 404 for not found, and 409 for conflict. The client displays `message` as-is, so that string must be Armenian user text, or the client must grow a code-to-text map. Define `fieldErrors` as either a field-to-string map or a field-to-string-array map, and use it consistently. 413, 422, and 429 are undefined; add them only together with client handling. A retried 401 after refresh, or a failed refresh, clears the access token. The current transport excludes login, registration, refresh, forgot-password, verify-code and reset-password from refresh retries; `/auth/me` and `/auth/logout` can trigger one bounded retry.

  **Recommended solution:** Use stable machine codes plus Armenian message and fieldErrors as field-to-string, with 400/401/403/404/409 as documented. Add explicit 413 upload-size and 429 rate-limit behavior (including Retry-After); keep 422 unused. Preserve one refresh retry for me, exclude credential/challenge endpoints, and make logout revoke/clear locally without depending on successful refresh. Document generic handling for remaining HTTP failures.

- **Partial update versus replacement.** **Criticality: High.** Profile intro and settings sends are partial. Education and certificate updates replace the mutable fields. Decide, for each write, whether an omitted field is left unchanged or cleared. Reject unknown fields. The authenticated user is taken from the session, never from `userId`, `author`, or a timestamp in the body.

  **Recommended solution:** Document profile/settings as merge updates: omitted means unchanged, and explicit empty string clears optional text. Education/certificate PUT replaces all mutable fields and requires required values; optional omissions reset to documented defaults/null. Specify post/topic updates as merge updates matching the mock. Reject unknown/read-only input fields at the server and derive all ownership/timestamps there.

- **Routes still missing.** **Criticality: High.** Second-factor verification and resend; recovery resend; forum reply list, create and like; every chat operation; settings read/update; email change; password change; deactivation; deletion; export; eligibility; reference data. Most operations have service semantics, but HTTP methods, paths and payloads remain undefined; eligibility and reference APIs do not yet have service operations either. Do not attach account deletion to `DELETE /users/me` until the retention rules in this document are decided. `GET /users/{id}/posts` is the identified-user post read. `PUT /users/profile` is onboarding multipart; `PUT /users/me` is the profile intro. Do not merge them.

  **Recommended solution:** Publish an operation-by-operation contract with method, path, body, response, permission and error cases before adding mappings. Include reply listing as well as writes, TOTP enrollment/recovery, account lifecycle and notification limitations. Define new service operations for eligibility/reference data and keep unsupported capabilities visibly disabled until implemented; do not infer a deletion route from a historical comment.

- **Pagination and client-side filters.** **Criticality: High.** Category, sphere, forum major, and search filters run on the full array the server returned. A pagination object that remains an object after `unwrap()` (for example, `{items: [], nextCursor: ...}`) fails visibly with `CONTRACT` because `list()` requires an array. An envelope with an array in `data` is accepted, but its pagination metadata is discarded. A partial array can silently omit matching records. Update the client, query parameters and response shape together.

  **Recommended solution:** Apply category, sphere, major and people filters server-side before ordering/paging; use stable cursor pagination. Update routes, normalizers, services and page load-more controls as one compatible change. Add adapter checks for malformed envelopes, page metadata and matching records outside the first page; never label an incomplete array as the complete result.

- **Ids, retries, and concurrency.** **Criticality: High.** Ids are opaque to consumers and serialized as strings; SQL integer ids serialized as strings satisfy this contract. Unguessability is a separate choice and never replaces authorization. There is no ETag, version, or idempotency key. A retried create can duplicate a post, comment, education row, certificate, or message. Specify create idempotency independently from update concurrency: last-write-wins does not prevent duplicate creates.

  **Recommended solution:** Keep string-serialized ids and enforce authorization independently. Accept a client-generated idempotency key scoped to principal/operation for creates, atomically store request fingerprint/result for a documented retry window (proposed 24 hours), and reject key reuse with different payloads. Use row versions/ETags and If-Match on mutable records, returning 412 on stale updates with coordinated client handling. Treat duplicate prevention and stale-update prevention as separate guarantees.

- **Limits to reconcile with SQL.** **Criticality: High.** Names 100 characters. Titles 255. Rich text 20,000 visible characters. Messages 5,000. The written spec gives comments the same 5,000 limit; the mock enforces 2,000 on create and update. Pick one. Certificate URL and biography limits are unresolved. Mock degree input allows 255 characters, while normalized `Degrees.Name` is documented as 100; `Users.Specialization` is 150, `Professions.Name` is 150, and most other education reference names are 255. Certificate URL is documented as 255 or MAX. Blank `NVARCHAR` values are not rejected by `NOT NULL`.

  **Recommended solution:** Adopt a shared field-limit table: names 100, titles 255, rich text 20,000, comments/messages 5,000, biography 1,000, certificate URL 2,048, degree names 100, profession/user specialization 150, and other reference names per verified schema (generally 255). Count JavaScript-facing limits in UTF-16 code units and test SQL collation/storage behavior. Update the mock comment limit and degree validator, validate optional strings too, reject blanks where required, and verify all widths against recovered SQL before migration.

## Confirm these are out of scope

Do not implement these unless a later decision adds them:

- **Criticality: Low.** University events, venues, RSVP, and attendance. `events.html` is the announcement feed.

  **Recommended solution:** Keep scheduling out of v1 and label the existing page as announcements. Add a separate event entity/contract only after scope approval.

- **Criticality: Low.** Work-experience editing or API.

  **Recommended solution:** Defer collection/editing, but include any existing personal work data in export/deletion as described above.

- **Criticality: Low.** Help-form submission and any ticket store. The form tells the user that submission is unavailable.

  **Recommended solution:** Keep the unavailable message explicit and do not collect unsent form data; define an actual support channel separately.

- **Criticality: Low.** Tutorial upload, playback, or a video catalog. The page reports that video is unavailable.

  **Recommended solution:** Keep tutorial media unavailable until content ownership, hosting and playback scope are defined.

- **Criticality: High.** An administrator, moderator, or import UI. Alumni import stays the offline `import_alumni.py` script until provenance, correction, and revocation are specified, including what happens when a registry row disappears after an account has claimed it.

  **Recommended solution:** Defer management UIs, but define accountable offline registry and takedown operators before launch. Verify the missing import source, retain import provenance and audit corrections; flag removed registry claims for review rather than silently deleting accounts or automatically retaining eligibility forever.

- **Criticality: Low.** Nested forum replies, topic subscriptions, and bookmarks.

  **Recommended solution:** Keep flat replies and topic-author notifications; introduce parent/subscription/bookmark storage only with approved new scope.

- **Criticality: Medium.** Delivered, read, and online indicators in chat.

  **Recommended solution:** Expose unread badges only; add public receipts/presence after authoritative events and privacy rules exist.

- **Criticality: Low.** Translated UI catalogs. A saved language code is not a translation.

  **Recommended solution:** Keep an explicit Armenian fallback and defer translated catalogs until all interface strings and fallback behavior are covered.
