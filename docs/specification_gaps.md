# Remaining specification and release gaps

Reviewed against repository source on 25 October 2026. This list covers unresolved work; it does not reopen implemented identity, messenger, settings or forum decisions. The earlier proposal catalogue mixed pending features with decisions that have since shipped and is available in Git history.

Use [authorization decisions](authorization_plan.md), [registry enrollment](registry_enrollment.md), [settings decisions](settings_decisions.md), [forum decisions](forum_decisions.md) and the [messenger specification](messenger_spec.md) for approved behavior. Mock behavior and adapter-only routes do not establish a production contract.

## Profile and publication APIs

General profile editing, education/certificate CRUD, profile cover uploads and post/comment APIs remain unimplemented on the server. Resolve these contracts before exposing them:

- Reference-data ownership: stable IDs/codes, creation/merge authority and verification provenance for universities, degrees, institutes and publication spheres. Enrollment reference options and forum categories already have implemented APIs.
- Profile dates: preserve year/month precision, nullable ongoing ranges and range validation without inventing official dates or historical timezones.
- Certificates: reconcile URL length and optionality with the captured schema, allowed schemes, logo source and issue-date precision.
- Profile edits: define editable fields, limits, patch/replacement semantics, optimistic conflicts and role-change restrictions. Enrollment biography is already optional; do not impose the old proposed mandatory-biography rule.
- Media: specify authenticated storage, visibility, replacement/deletion and export behavior for future profile media. V15 enrollment avatars are implemented separately and use publicly retrievable randomized URLs; legacy public URLs also remain public.
- Publications: define required category/sphere/title/content fields, sanitization, bounded feed/comment pagination, ordering and edit/delete conflicts. `events.html` represents job/internship/training announcements.
- Discovery: agree pagination, matching and filter semantics as the directory grows. Decide whether direct-message blocking should affect search/profile access; do not infer broader restrictions from chat blocks.
- Work experience has stored legacy data but no connected editor/API; confirm future collection scope and preserve lifecycle/export handling of existing data.

## Delivery, recovery and release

- Announcement notifications need publication transactions and recipient rules before enabling delivery. Direct-message and forum-reply producers already exist.
- Language preferences store `hy/en/ru`; translation catalogues and a fully translated interface remain future work. Current UI falls back to Armenian.
- Recovery when an email-factor user loses the old mailbox needs a separately approved procedure. The email-change flow does not bypass old-address verification.
- Real lecturer enrollment requires verified university names and departments. Synthetic acceptance fixtures are not production eligibility evidence. Periodic eligibility rechecks remain deferred under the approved v1 policy.
- M7 requires supported-browser/platform checks, a joint SQL/OpenBao restore rehearsal, deletion-ledger replay, backup retention/expiry and Transit rotation/rewrap evidence. Historical Linux acceptance does not establish macOS or native OS notification presentation.
- Public forum launch requires a named responsible operator and a working reporting channel; implementation does not verify the support mailbox. See [forum operations](forum_implementation.md#reporting-and-takedown).

Public groups/join links, advanced moderation UI, WebSockets, presence/read receipts, message editing, TOTP and participant-assisted recovery remain outside the current messenger scope. Any expansion needs an explicit contract rather than adoption of an old recommendation.
