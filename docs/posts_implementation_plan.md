# Posts and announcements — implementation plan

Date: 29 October 2026. Status: planned; no application implementation or database migration has been performed for this plan.

The product authority is [posts decisions](posts_decisions.md). This plan translates those decisions into repository changes and acceptance criteria. Technical contracts below are implementation choices, not additional approved product requirements. The newer posts decisions take precedence over older publication proposals in the settings and specification-gap documents, particularly the proposal to notify users about newly published announcements.

## 1. Scope and completion criteria

Deliver real HTTP and database operations for announcements and comments, the shared feed, publication/edit forms, individual announcement pages, and comment notifications. Both admitted graduates and lecturers can publish and comment; all signed-in admitted users can read. Authors control only their own records. Private profiles do not hide published announcements.

The completed implementation must provide:

- Required title, body, type and an explicit database-backed direction selection, including “Other.” Types remain `job`, `internship`, and `training`.
- Limits of 255 title characters, 20,000 body characters and 2,000 plain-text comment characters, with safe paragraphs, bold, italic and links in bodies.
- Author editing of every announcement field at any time, an edited indicator, unchanged publication order after edits, and last-successful-save-wins behavior.
- Confirmed announcement deletion that atomically removes its comments; owning an announcement grants no right to edit/delete someone else's comment.
- A newest-first feed with combined type/direction filters and batches of 20; comments loaded on demand, oldest first, also in batches of 20.
- A durable announcement URL, notification navigation to it, and an unavailable state after deletion.
- In-app notifications for another user's comment on one's announcement, and email only when enabled by the recipient's settings. Self-comments produce no notification.
- Legacy records retained with missing fields; no missing-title placeholder; missing type/direction may show “Not specified.” Editing a legacy record requires all mandatory fields.
- Discard confirmation for unsaved forms and preservation of entered content after failed submissions.

Closing/reopening, expiration, status filters, photos/files, new-announcement notifications and edit-conflict warnings stay outside this version.

## 2. Verified starting point

Inspection is of repository source, not the contents or schema of the working database.

| Area | Current implementation and required change |
| --- | --- |
| `events.html`, `js/posts.js` | Feed and publication modal exist. Directions are hard-coded in the feed; create takes its direction from that filter. No pagination, individual page, feed owner actions or discard confirmation. |
| `js/shared/posts.js` | Feed rendering expects every post to contain its entire comment list. It needs summaries/counts, lazy comments, ownership actions, edited state and legacy field handling. |
| Profile callers | `js/profile/profile-main.js`, `profile-sections.js`, `profile-render.js` and `js/user/user-main.js` separately load/render posts. Own-profile forms omit required type/direction choices. They must move with the new contracts. |
| Service/provider boundary | `js/services/index.js` exposes CRUD and comment CRUD. HTTP routes exist only as adapter expectations; no posts controller/service exists. HTTP feed filters run locally, query parameters are omitted, and list normalizers expect arrays. |
| Mock mode | `js/data/mock/provider.js` implements ownership and basic CRUD, returns all posts/comments, and lacks the complete approved behavior. Existing seed directions use string slugs. |
| Stored data | Baseline tables `dbo.Posts`, `dbo.PostComments`, `dbo.PostTypes` and `dbo.Spheres` exist. Title/type/direction can be null. Dates use timezone-less `datetime2` defaults. No edited timestamp exists. Comment FKs do not cascade on deletion. |
| Migrations | Repository migrations currently end at V17. `SchemaCommand` validates schema inventories and applies migrations explicitly; startup does not migrate. Older setup prose mentioning V15 is stale. |
| Formatting | `ForumContent` already uses the installed OWASP sanitizer; its allowlist is broader than posts need. The client sanitizer is also shared with the forum. Reuse the underlying mechanisms with a posts-specific policy. |
| Notifications | `NotificationService` and `auth.ActivityNotifications` support chat/forum events. Reserved `ANNOUNCEMENT` is not a comment event producer. The browser consumer treats every non-forum event as a chat event and polls only with browser opt-in/permission. There is no general in-app activity inbox. |
| Settings/lifecycle/export | Settings have email/category switches, but no post-comment switch. `ExportController` already exports Posts/PostComments. Account lifecycle retains authored discussion records, neutralizes deleted identities and clears recipient/actor notifications; preserve that behavior. |

## 3. Data and migration work

Use the next available migration number, provisionally V18; never modify accepted migrations V1–V17. Extend the existing tables rather than introducing a parallel post store.

1. **Reference identity.** Add stable codes to the three supported PostTypes and an operator-managed stable marker/code for the “Other” sphere. Expose sphere IDs as string IDs; labels must not become identifiers. Reconcile known existing type rows through an explicit reviewed mapping, create missing supported options without changing existing post FKs, and retain unmapped historical rows. New writes accept only the three supported type codes and an existing selectable sphere. Unsupported historical types serialize as unspecified while their original database values remain intact. Include “Other” in the normal database-backed direction response. No public direction-creation endpoint or administration UI is needed.
2. **Legacy nulls.** Keep Title, SphereId and PostTypeId nullable so existing records survive. Enforce mandatory fields in the new create/update boundary rather than making historical rows invalid with blanket NOT NULL constraints. Do not fill missing titles or classify existing records as “Other” automatically.
3. **Dates.** Add canonical UTC publication and nullable edited timestamps to posts, and canonical UTC creation timestamps to comments; use the injected clock for new writes. Retain original historical CreatedAt values. Before backfilling timezone-less history, inventory it and record a reviewed source timezone or offset mapping using the established forum migration approach. A staged migration/backfill may be necessary: adding columns must preserve records; completing the date backfill is a release gate before exposing a uniformly ordered feed. Never assume the execution host's timezone, silently treat old values as UTC, or replace publication dates with migration time. Document fresh-install and existing-database paths separately.
4. **Notifications.** Extend ActivityNotifications with nullable PostId/CommentId fields, a distinct `POST_COMMENT` kind, target indexes and a unique event identity per recipient/comment. Update the existing kind check constraint without breaking chat/forum kinds. Do not use `ANNOUNCEMENT` for comment events or enable its deferred producer. Add a default-on PostCommentNotifications preference and wire it through the strict settings allowlist, DTO, mock settings and UI, leaving existing category meanings intact. This is the proposed technical mapping for the new notification category; email additionally requires EmailEnabled.
5. **Indexes.** Add feed indexes on canonical publication time/PostId and a combined type/sphere/time path supported by measured query plans; add `(PostId, CreatedAtUtc, CommentId)` for comment paging. Use explicit null-safe ordering only during staged maintenance; the released API must have a canonical timestamp for every visible record. Avoid large rich bodies in index keys or an unnecessary index for every filter permutation.
6. **Guard and compatibility.** Extend `SchemaCommand` inventory expectations and `DatabaseMigrationIT` for the new layout and all supported older upgrade paths. Inspect dependencies when replacing a check constraint. Test repeat upgrade/validation and rollback of failed migration steps. If a temporary legacy-review table is used, include its lifecycle in inventory checks. Keep runtime and migration credentials separate.

Announcement deletion uses explicit transactional child deletion, following the project's non-cascading FK convention. Remove affected activity events before comments/posts, so inbox and mail workers cannot deliver obsolete targets.

## 4. HTTP and service contracts

Keep the existing vocabulary `category` for announcement type and use `sphereId` for a database direction identity. A feed filter and a form field are separate state. The publication form must never derive or silently substitute sphereId from the feed filter.

| Operation | Proposed HTTP boundary | Result |
| --- | --- | --- |
| `posts.options` | `GET /posts/options` | Supported types `{code,name}` and spheres `{id,name,isOther}` from database reference data. |
| `posts.list` | `GET /posts?category=&sphereId=&userId=&cursor=` | First or subsequent page, always at most 20 records. All supplied filters combine with AND before pagination. |
| `posts.get` | `GET /posts/{postId}` | One announcement, without eagerly loading its comments. |
| `posts.create` | `POST /posts` | Required `{title,content,category,sphereId}`; 201 with saved announcement. |
| `posts.update` | `PUT /posts/{postId}` | Full replacement of the four editable fields; 200 with saved announcement. |
| `posts.delete` | `DELETE /posts/{postId}` | 204 after transactional deletion of the announcement, comments and related activity. |
| `posts.comments.list` | `GET /posts/{postId}/comments?cursor=` | Oldest-first page of at most 20 comments. |
| `posts.comments.create` | `POST /posts/{postId}/comments` | `{text}`; 201 with saved comment. |
| `posts.comments.update` | `PUT /posts/{postId}/comments/{commentId}` | `{text}`; 200 with saved comment. |
| `posts.comments.delete` | `DELETE /posts/{postId}/comments/{commentId}` | 204; author only. |

Use one feed endpoint with optional userId and migrate all current callers away from the unimplemented `/users/{id}/posts` adapter expectation. This is a coordinated repository change; no existing server publication contract needs to be kept alive. Filtering by author through this endpoint does not require access to that author's private profile.

**Response models**

- Announcement: string `id`, `title` nullable for missing/blank legacy titles, sanitized HTML `content`, nullable supported `category` and category label, nullable `sphereId` and sphere label, `createdAt`, nullable `updatedAt`, safe `author`, `commentCount`, `canEdit`, `canDelete`. No embedded comments array and no required content-version field.
- Comment: string `id`, `postId`, plain `text`, `createdAt`, nullable `updatedAt`, safe `author`, `canEdit`, `canDelete`.
- Author: minimal public attribution, stable string ID where applicable, name/avatar and `canOpenProfile`; neutral attribution for deleted accounts following existing lifecycle behavior. Do not leak email/private profile fields. Private-profile navigation remains subject to the existing profile access check.
- Page: `{items, nextCursor: string|null}`; request 21 rows to decide whether another batch exists, return at most 20. Counts come from server queries, never the number of comments currently rendered.

**Pagination and errors**

- Feed order is `(CreatedAtUtc DESC, PostId DESC)`; comments use `(CreatedAtUtc ASC, CommentId ASC)`. Encode full database timestamp precision plus the ID in opaque validated cursors, following the forum cursor mechanism. Bind feed cursors to normalized type/sphere/user filters and comment cursors to their parent post. Editing changes neither sort key.
- Reject malformed IDs, invalid option values, malformed cursors and unknown input fields; do not silently drop filters. Proposed error convention: 401 for missing/expired authentication, existing admission failures for inadmissible sessions, 403 for an authenticated non-owner mutation, 404 for missing posts/comments or a parent mismatch, and field-level 400 validation errors. Match the established transport error envelope and 429 handling.
- A deleted parent makes comment listing and all comment mutations unavailable. No operation may recreate a post deleted while its form was open. No expectedVersion, ETag precondition, optimistic conflict screen or time limit applies to post/comment editing.

## 5. Backend behavior and validation

Add a focused `am.polylink.posts` package with controller, service, content validation and failure/DTO definitions. Follow existing JdbcTemplate/TransactionTemplate, session, Origin/CSRF, rate-limiter and parameter-binding patterns.

1. Require an admitted session for every read and write, including options. Restrict publication/comment creation to graduate/lecturer roles. Never accept userId/author/canEdit from mutation input. Recheck admission and ownership in mutation transactions; a lecturer has no special moderation powers.
2. Implement filtered feed and detail queries with minimal author projections, counts and viewer-specific capabilities. Use LEFT JOINs for optional reference data and neutral historical authors so missing metadata does not drop legacy posts. Do not filter the feed by profile privacy, recipient directions, direct-message blocks, open/closed state or editor role. Avoid per-post author/count queries.
3. Validate a stripped nonempty title up to 255 characters. For body length, use sanitized visible text up to 20,000 characters, preserving paragraph breaks; align frontend/server character-count semantics, including Unicode, and apply a separate bounded HTML input cap as an implementation safeguard. Reject content that becomes blank after sanitization. Require all four fields on every update, including legacy updates.
4. Use a posts-specific safe HTML policy allowing paragraphs/line breaks, bold/italic and HTTP/HTTPS/mailto links, with safe link rel attributes. Normalize browser-generated block wrappers. Remove scripts, handlers, styles, unsafe schemes and embedded media. Apply it on writes and on every legacy-body read; never rely only on browser sanitization. Keep the forum's broader formatting behavior intact. Render comments exclusively as text, preserving line breaks and enforcing the 2,000-character limit independently of the body validator.
5. Update all editable announcement fields in one statement/transaction without a revision precondition. Set updatedAt after an actual persisted field change; a no-op save need not mark the post edited. Keep publication time immutable. Concurrent updates serialize naturally; the last committed successful save is the stored result. Use the same conflict-free ownership behavior for comment edits.
6. Create each comment and its author-notification event atomically. Discover involved accounts, lock them in numeric order, then lock/recheck the post and dependent records, consistent with existing lifecycle locking. Recheck ownership/recipient and parent existence under locks; creation racing with deletion must either commit before deletion and be removed with it, or fail as unavailable. Never call SMTP inside this transaction.
7. Delete with server-side ownership checks even if the client hid the action. A post author cannot delete another person's comment via any route. Comment edit creates no new-comment notification; comment deletion removes related pending activity. Handle races between update/delete and account deactivation/deletion without stale-author disclosure or orphaned events.

## 6. Frontend integration

Use the existing static ES-module architecture and Armenian interface. Extract reusable post UI into `js/posts/` as needed; `js/posts.js` can remain the feed entry point.

**Contracts and providers**

- Add strict post/options/comment/page normalizers, preferably `js/posts/contracts.js`, rather than expanding permissive legacy SQL aliases. Route page envelopes around generic array unwrapping. Forward every filter/cursor to the server and remove local post filtering.
- Extend `js/services/index.js`, HTTP routes/provider and the mock provider together. Replace sphere slugs with stable database-style mock IDs through a mock dataset upgrade, preserving saved records and drafts where possible; retain missing legacy metadata.
- Change every array-based caller to consume page.items/nextCursor. Stop rendering `post.comments` and stop inferring counts from loaded comments. Verify profile and user-page callers along with the main feed.

**Feed and single announcement**

- Load type/direction options and render initial loading/error/empty states with retry. Apply both filters together, reset the cursor when either changes and ignore stale responses with the existing generation pattern. Append “Show more” batches without duplicates; keep already loaded cards and drafts on a next-page failure.
- Add a shareable `post.html?id=...` and a detail controller that bootstraps authentication, validates the URL, loads the post, then offers its comments. Link feed/profile cards to this URL. A deleted/missing target shows an unavailable state; a transient request failure offers retry rather than claiming deletion.
- Omit the entire title element for a missing legacy title. Display unspecified metadata consistently, show server comment counts and edited indication, and respect canOpenProfile/canEdit/canDelete.
- Comments are requested only when expanded, in batches of 20 with separate per-post cursor/loading/error state. Keep ordering stable after create/edit/delete. In particular, if earlier comment pages remain unloaded, refresh the count and indicate newer comments rather than appending a new comment across a gap in the oldest-first list. Preserve comment drafts while loading or filtering.

**Shared create/edit form and author actions**

- Reuse one form from feed, detail and own profile, with independent required title, rich body, type and direction controls. Load all options from posts.options; include the stored “Other” option. Editing preloads all four fields; a legacy missing field remains an explicit required choice.
- Reuse/refactor the forum editor's accessible selection/link mechanics with the posts formatting policy, avoiding a global sanitizer regression. Provide keyboard labels, focus management, inline validation, character feedback, safe paste, and disabled duplicate-submit controls.
- Track changes against the initial form state. Cancel, close button, Escape and backdrop-close paths all ask whether to discard dirty input; navigation/reload uses the browser's supported unsaved-change warning. Failed validation/network/server submissions keep every field, rich formatting and selected option. Successful saves close/reset only after receiving the saved result.
- Add post edit/delete and comment edit/delete on feed/detail/profile surfaces using server capabilities. Confirm announcement deletion before the request. Preserve input on failures, update cards/counts only after success, and keep edits in their original feed position. If an edited post stops matching the active filter, remove it from that filtered view after save.
- Update `profile-sections.js` to invoke the shared post form rather than its incomplete custom create/edit forms; update `profile-render.js`, `profile-main.js` and `user-main.js` for links, pagination and lazy comments. This does not require implementing unrelated profile editing APIs or bypassing private-profile access.

## 7. Notifications and settings

Implement in-app delivery independently of the browser Notification permission. Existing browser polling alone does not meet the approved in-app requirement.

1. Produce `POST_COMMENT` only when comment author and announcement author differ. Store recipient, actor and target IDs transactionally, with a unique key derived from the committed comment. No event is produced for post creation or comment edits.
2. Extend NotificationService eligibility queries and email delivery for this kind, rechecking recipient admission, the new category preference, current target existence and email master switch at delivery. Use a generic actor/action label and `post.html?id=...` link; do not include unsafe/raw announcement HTML or comment bodies in notification text. Preserve existing mail retry leases and documented at-least-once SMTP semantics.
3. Add a bounded in-app activity list/dropdown in the shared signed-in UI that can load retained post-comment events on reload, including comments received while the site was closed. Provide chronological paging and loading/error/empty states. The existing `/notifications?cursor=initial` deliberately skips history, so add a separate history read mode/endpoint with its own cursor contract rather than silently changing chat/browser baseline semantics. A read/unread workflow is not required for this version.
4. Use one shared activity polling source for the in-app view and optional browser presentation. In-app delivery must work with Notification absent, permission denied, browser opt-in disabled or Web Locks unavailable. Browser presentation retains its permission and cross-tab coordination. Keep notification histories scoped to the current account and clear state on logout/account switches. Deduplicate history/live overlaps by event ID.
5. Dispatch browser navigation by explicit kind for DIRECT_MESSAGE, FORUM_REPLY and POST_COMMENT; never treat an unknown kind as chat. The POST_COMMENT target is the individual announcement page. Suppress unavailable targets from new delivery; an already displayed link still resolves to the unavailable page after deletion.
6. Add the post-comment category to settings UI/server/mock, default enabled; apply that category to in-app, optional browser and email delivery, with EmailEnabled controlling only email. Keep the new-listing category stored but explain its deferred status where needed; do not repurpose it. Extend the mock notifications path to exercise comment production, self-suppression and navigation.

Preserve account export coverage for posts/comments and include the added timestamps/settings fields. Preserve retained content and neutral author attribution after account deletion; remove recipient/actor activity according to the existing lifecycle policy. Recheck new notification references and race behavior in both deactivate/delete and deletion replay tests.

## 8. Delivery sequence and acceptance gates

| Phase | Deliverables | Gate before moving on |
| --- | --- | --- |
| 1 — Contracts and schema | DTOs/error conventions, explicit field mappings, reference reconciliation, migration/backfill procedure, indexes and inventory changes. | Fresh/upgrade/rollback tests preserve legacy rows, NULLs, original dates and unrelated auth/chat/forum data. Reviewed historical timestamps are ready for canonical ordering. |
| 2 — Server operations | Posts package, options, filtered cursor feed, detail and owner CRUD, lazy comment APIs, sanitization and atomic delete/event creation. | Real SQL/HTTP tests prove access, validation, pagination, last-save-wins and race behavior. |
| 3 — Providers and UI | Strict HTTP/mock parity, shared forms/rendering, feed/detail page and all profile callers. | Mock and real browser flows pass for graduate/lecturer users and legacy posts, including paging, dirty forms and submission failures. |
| 4 — Notifications | Category setting, retained in-app activity, optional browser routing and email worker. | Non-self comments reach the author; denied browser permission does not prevent in-app delivery; disabled email prevents mail; stale/deleted targets and account switches are handled. |
| 5 — Integration and documentation | Export/lifecycle regressions, test-runner integration, implementation/runbook updates and rollout rehearsal. | Focused checks plus existing full acceptance pass on disposable infrastructure; documented rollout is ready for separate execution. |

Phases can share implementation commits, but the feature is not complete until all gates pass. Keep any rollout flag disabled until the complete schema, date review, frontend and notification paths are ready; do not tie posts availability to FORUM_ENABLED.

## 9. Validation matrix

Add focused content/unit tests, `PostsIT` SQL/HTTP tests, extensions to `DatabaseMigrationIT`, `tools/contracts/posts.test.mjs`, and mock/live browser acceptance following the existing forum runner structure. Integrate them with `tools/m1/verify.py` and `tools/local/test.sh`; a focused posts mode may mirror the existing forum mode. Use disposable test databases/mail capture, never the working database, for automated migration and end-to-end validation.

| Concern | Required evidence |
| --- | --- |
| Access/ownership | Unauthenticated and inadmissible requests fail; both publishing roles work; admitted read access is preserved; forged authors are rejected; private-profile posts remain in the shared feed; post ownership never grants rights over another user's comments. |
| Validation/formatting | Missing fields and unknown references fail on create and legacy edit; exact limits and over-limit values; empty sanitized content; Unicode counting parity; allowed paragraphs/bold/italic/links survive; scripts, event handlers, unsafe URLs and embedded media are removed on both new and historical bodies; comment markup displays as text. |
| Legacy preservation | Null/blank title renders no heading or placeholder; missing/unmapped type/direction displays unspecified; rows and FKs survive migration; no fabricated titles, categories, timezone or publication dates; author tombstones remain readable. |
| Feed/comments | At least 45 posts and 45 comments, timestamp ties, every filter combination and author filter; filtering before pagination; deterministic 20/20/5 batches; no duplicate/skipped records; cursors reject tampering/wrong scope; edits do not reorder publication; no eager comment bodies. |
| Mutations/races | Two editor sessions both save successfully and the later commit wins; old forms cannot resurrect deleted data; deletion is atomic with comments/activity; non-owner denial; comment creation versus parent deletion/account lifecycle; no event after transaction rollback. |
| Forms/navigation | Explicit direction independent of feed filter; all fields editable; legacy missing choices required; dirty cancel/Escape/backdrop/navigation paths; failed saves retain text/formatting/choices; keyboard/focus and mobile layout; deep-link reload and deleted-target state; profile callers still function. |
| Notifications | Only the announcement author receives another user's comment event; no self/new-post/edit event; saved events survive offline intervals/reload; history/live deduplication; correct deep link; category/email switches; disabled browser permission and unsupported browser APIs; worker retry and deletion checks; no cross-account inbox state. |
| Regressions | Existing forum conflicts/editor behavior, chat notifications, settings strict-field validation, account export, deactivation/deletion/replay and schema guards continue to pass. |

Suggested implementation verification order: focused client and backend content tests; focused SQL/migration and mock/live posts acceptance; then `bash tools/local/test.sh --full` after wiring the new checks into the runner. Record actual commands/results and platform limits in the implementation report; this plan does not claim any of those tests have run.

## 10. Documentation and rollout handoff

At implementation completion, add `docs/posts_implementation.md` covering API examples, errors, settings, migration/backfill commands, data mapping, lifecycle and acceptance evidence. Update root/backend READMEs, `docs/frontend_context.md`, `docs/specification_gaps.md`, `docs/settings_backend.md`, the schema workflow and `LIVE_TESTING.md` so publication availability, migration version and notification rules match reality. Preserve older approved documents as historical authority with a clear link to the newer posts decisions where their publication policy was superseded.

For rollout, stop incompatible application versions, take a backup, rehearse the guarded migration and reference/timezone backfill on a disposable restore, validate retained records and notification cleanup, then apply the reviewed procedure explicitly with the matching application release. Once schema changes are applied, recover through the documented backup/forward-fix procedure; do not assume an older binary is a safe rollback. This planning task authorizes documentation only; it does not execute migrations, modify working data or deploy the feature.
