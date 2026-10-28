# Posts and announcement implementation

Implemented 29 October 2026 against [approved decisions](posts_decisions.md) and the [implementation plan](posts_implementation_plan.md). This implementation supersedes earlier publication proposals in settings/specification-gap documents. New-announcement delivery remains deferred; `POST_COMMENT` is a separate event.

## Availability and behavior

Apply the matching schema through V19 and complete historical timestamp review before setting `POSTS_ENABLED=true`. The default is false. Posts require identity, independently of `FORUM_ENABLED` and `MESSENGER_ENABLED`. Startup never applies migrations. This work does not migrate the working database or deploy the application.

Admitted members read the shared feed regardless of author profile privacy; graduates and lecturers publish and comment. Capabilities and author-only mutations come from the server. Announcement ownership grants no rights over another author's comment. Deletion removes activity, comments and the announcement in one transaction. Account locks are acquired in numeric order before parent/child locks; admission, ownership and target existence are rechecked under those locks.

New records and every edit require all four fields. Titles contain 1–255 UTF-16 units, bodies 1–20,000 units of sanitized visible text, and plain comments 1–2,000 units. These units match JavaScript string length and native text-input limits: an emoji commonly counts as two. Paragraph endings and `<br>` count as newlines; outside whitespace is trimmed. Raw body HTML is capped separately at 100,000 units. The server and the posts-specific browser sanitizer retain paragraphs, line breaks, bold, italic and absolute HTTP/HTTPS/mailto links with safe link relations. Scripts, styles, handlers, unsafe schemes and embedded media are removed, including on legacy reads. Forum formatting keeps its existing broader policy.

Edits replace title/body/type/direction atomically. They set `updatedAt` only for a persisted change and keep `createdAt` immutable. Concurrent saves serialize; the last successful committed save wins. There is no version precondition or stale-edit warning. A form cannot recreate a deleted target.

Legacy null/blank titles serialize as null and render no heading or placeholder. Missing or unsupported types and missing directions remain unspecified. Unmapped historical foreign keys remain stored. Editing a legacy row requires completing its missing mandatory fields. Deleted accounts retain public discussion content with neutral attribution and no profile navigation.

## HTTP contract

All endpoints require an authenticated admitted session. Mutations use the existing Origin/CSRF boundary and a per-account write budget (120/minute). Unknown mutation fields and unknown or repeated feed/comment query fields fail validation. IDs are positive SQL integers serialized as strings.

| Operation | Request | Result |
| --- | --- | --- |
| Options | `GET /posts/options` | `{types:[{code,name}],spheres:[{id,name,isOther}]}` |
| Feed | `GET /posts?category=job&sphereId=1&userId=7&cursor=...` | `{items,nextCursor}` |
| Detail | `GET /posts/{id}` | Announcement |
| Create | `POST /posts` | 201 + announcement |
| Replace | `PUT /posts/{id}` | 200 + announcement |
| Delete | `DELETE /posts/{id}` | 204 |
| Comments | `GET /posts/{id}/comments?cursor=...` | `{items,nextCursor}` |
| Add comment | `POST /posts/{id}/comments` | 201 + comment |
| Replace comment | `PUT /posts/{id}/comments/{commentId}` | 200 + comment |
| Delete comment | `DELETE /posts/{id}/comments/{commentId}` | 204 |

Create and replacement payload:

```json
{"title":"Աշխատանքային հնարավորություն","content":"<p><strong>Բարև</strong></p>","category":"job","sphereId":"1"}
```

Use the actual ID returned by options; `1` above is only an example. Types are `job`, `internship`, `training`. Direction selection is independent of feed filters; labels and mock slugs are not API identifiers. Comment payload: `{"text":"Plain text\nAnother line"}`. No author, capability, expectedVersion or revision fields are accepted.

Announcements contain `id`, nullable `title`, sanitized `content`, nullable `category/categoryName`, nullable `sphereId/sphereName`, canonical `createdAt`, nullable `updatedAt`, `author`, `commentCount`, `canEdit`, `canDelete`. They never embed comment bodies. Comments contain `id`, `postId`, plain `text`, timestamps, author and capabilities. Authors expose only `id` (null after deletion), `name`, `avatar`, `canOpenProfile`.

Filters combine with AND before pagination. Feed order is `(CreatedAtUtc DESC, PostId DESC)`; comment order is `(CreatedAtUtc ASC, CommentId ASC)`. Each request reads 21 rows and returns at most 20. HMAC-protected cursors retain full SQL timestamp precision and bind to the normalized filter combination or parent post. Do not decode/rebuild them in clients. Editing never changes the sort key.

Errors follow `{code,message,fieldErrors}`: 400 for malformed IDs/cursors, unsupported choices, missing/over-limit fields or unknown input; 401 for unavailable authentication/admission; 403 for an admitted non-owner or disallowed publishing role; 404 for missing targets or a comment-parent mismatch; 429 for the existing rate limiter. Temporary failures retain input and offer retry. A deleted parent makes all comment operations unavailable.

## Notifications and settings

Comment creation atomically records one `POST_COMMENT` event for an admitted announcement author when another member comments. Self-comments, publication and edits produce no event. The unique `(UserId,CommentId)` filtered index and event identity prevent duplicates. Deleting a comment/post clears its activity; account deactivate/delete clears recipient and actor activity using the established lifecycle policy.

`postCommentNotifications` is a strict, default-on preference added by V18. It controls in-app, optional browser and email delivery. `emailEnabled` additionally gates email only. `newListingNotifications` stays stored with a deferred-status explanation; it has no producer. Existing chat/forum categories keep their meaning.

`GET /notifications/history?cursor=...` returns retained eligible post-comment events newest first in pages of 20. Its signed cursor binds to the account and chronological timestamp/ID position. This is separate from `/notifications?cursor=initial`, whose live baseline still skips history. The shared signed-in activity dropdown loads history after establishing that baseline, polls the same live source every 15 seconds with backoff, and deduplicates history/live overlaps by event ID. It holds at most 200 items and clears state on logout/account switches and page teardown. Reopening the panel refreshes eligibility; no read/unread workflow is introduced.

In-app history and polling require neither Notification permission nor Web Locks. Optional browser presentation consumes that stream with local opt-in, permission and cross-tab locks. Explicit kind routing sends chat to `message.html`, forum replies to `topic.html`, and post comments to `post.html?id=...`; unknown kinds are ignored. There is no background Web Push.

Mail workers claim two-minute leases, release SQL locks before SMTP, and recheck recipient/actor admission, category, email switch and target existence. Messages contain a generic action and the announcement link, never rich body/comment text. Failed SMTP retries after the lease. Delivery is at least once: a successful send followed by a crash before marking completion can cause a duplicate. Already displayed links can lead to the unavailable state after target deletion.

## Schema and reference mapping

V1–V17 remain immutable. V18 extends existing Posts/PostComments with nullable canonical UTC publication/creation and edited timestamps, adds reference codes, the new setting, activity targets/indexes and `auth.PostsLegacyReview`. It replaces the system-named notification kind check after locating its existing definition and keeps all prior kinds. The legacy PostComments→Posts FK originally cascaded; V18 replaces it with a non-cascading FK for explicit service deletion.

The explicit type-label mapping is `Աշխատանք → job`, `Պրակտիկա → internship`, `Դասընթաց → training`. Missing supported canonical options are inserted; unknown historical types keep their IDs, names and null codes. No existing post FK is reassigned. The sphere named `Այլ` receives stable code `other`, or it is created when absent. Other sphere IDs/names remain intact. Operators manage reference data offline; there is no direction creation or administration endpoint. Inspect actual reference rows on the disposable restore before approving this mapping for rollout.

V19 refuses any post/comment without a reviewed canonical timestamp, then makes only those new timestamp columns NOT NULL. Original CreatedAt values and nullable Title/PostTypeId/SphereId remain unchanged. Indexes cover publication time/ID, combined type/sphere/time/ID, and parent/comment time/ID. Rich bodies are not index keys. SchemaCommand checks versioned dbo inventories plus the posts activity targets, audit layout, named kind check and target/history/unique indexes. The review audit table is permanent and remains part of guarded inventory.

### Fresh installation

Provision an empty database separately. With migration credentials and the reviewed matching release, from the repository root:

```sh
source tools/local/env.sh
./backend/mvnw -f backend/pom.xml compile exec:java -Dexec.mainClass=am.polylink.database.SchemaCommand -Dexec.args=fresh
```

An empty installation proceeds through V19 without inventing historical data. It does not seed admitted users. Only after the complete schema and application checks succeed, explicitly enable `POSTS_ENABLED=true` for the matching backend.

### Existing database upgrade and historical review

Stop incompatible application access, take a verified backup, and rehearse on a uniquely named disposable restore. Use separate `MIGRATION_DB_USERNAME`/`MIGRATION_DB_PASSWORD`; the commands require an explicit DB_NAME and never infer an execution-host timezone. If forum history predates V13, complete its independent [V12 review](forum_implementation.md#existing-database-upgrade) first.

```sh
./backend/mvnw -f backend/pom.xml compile exec:java -Dexec.mainClass=am.polylink.database.SchemaCommand -Dexec.args=inventory
./backend/mvnw -f backend/pom.xml compile exec:java -Dexec.mainClass=am.polylink.database.SchemaCommand '-Dexec.args=upgrade --target=18'
./backend/mvnw -f backend/pom.xml exec:java -Dexec.mainClass=am.polylink.posts.PostsMaintenanceCommand -Dexec.args=inspect
```

Review every unresolved row against its timestamp source. Prepare a JSON file outside Git containing the operator and exactly the unresolved IDs in each collection. Each row must repeat the original local timestamp and specify its reviewed IANA timezone or explicit UTC offset. Example only:

```json
{
  "operator":"reviewer identity",
  "posts":{"12":{"originalCreatedAt":"2020-01-01T12:00:00.1234567","timezone":"Asia/Yerevan"}},
  "comments":{"31":{"originalCreatedAt":"2020-01-01T13:00:00.7654321","timezone":"+04:00"}}
}
```

Use empty objects when there are no unresolved rows. Mixed historical sources may use different zones/offsets per row. Ambiguous/nonexistent local times fail and require an explicitly reviewed offset. Changed original timestamps, missing IDs, extra IDs or malformed review metadata fail atomically. No conversion uses migration time or silently assumes UTC.

```sh
./backend/mvnw -f backend/pom.xml exec:java -Dexec.mainClass=am.polylink.posts.PostsMaintenanceCommand '-Dexec.args=dry-run /absolute/path/review.json'
./backend/mvnw -f backend/pom.xml exec:java -Dexec.mainClass=am.polylink.posts.PostsMaintenanceCommand '-Dexec.args=apply /absolute/path/review.json'
./backend/mvnw -f backend/pom.xml compile exec:java -Dexec.mainClass=am.polylink.database.SchemaCommand -Dexec.args=upgrade
```

Dry-run rolls back both conversions and audit inserts. Apply commits all reviewed rows and audit metadata together. Original timestamps, null metadata, content and FKs are retained. Reinspect before repeating a review: the file must cover exactly the remaining unresolved rows. Repeat final upgrade validates an already upgraded database without rewriting it. Failed migration steps roll back; never use clean, manual baselining or edit accepted migrations to bypass the gate.

Validate row counts, original date/FK samples, neutral authors and activity cleanup on the restore, then run focused/full acceptance. Repeat the reviewed procedure explicitly against the intended target only after rehearsal approval. Once schema changes are applied, recover by verified backup or a reviewed forward fix with a matching application version; an older binary is not a safe rollback strategy.

## Client integration and validation

`js/posts/contracts.js` validates strict option/post/comment/page DTOs. HTTP forwards filters/cursors, preserving envelopes; no local filtering or `/users/{id}/posts` route remains. The mock dataset upgrade maps the known programming/engineering/data-science/marketing/other direction slugs to stable numeric mock IDs while retaining missing metadata, records and saved state. Post/comment ownership, pagination, last-save-wins and comment activity run through the same provider facade.

Feed, detail and profile surfaces use shared forms/cards. Forms load choices independently, retain all input/formatting after failure, prevent duplicate submissions, confirm dirty close/cancel/Escape/backdrop paths and register browser unsaved-navigation warnings. Comments load on expansion. Creating a comment across an unloaded older-first gap refreshes its server count and explains that more pages remain; it does not append across the gap. Next-page errors keep existing cards and drafts. Generation checks ignore superseded filter responses. Drafts and activity state are scoped to the signed-in account.

Run focused acceptance with `bash tools/local/test.sh --posts`, or after loading test-admin credentials use `python3 tools/m1/verify.py --posts`. Full acceptance is `bash tools/local/test.sh --full`; it includes the posts SQL/live/mock browsers alongside existing suites. Tests use uniquely named disposable databases, TLS OpenBao and mail capture, never migrate the working database, and clean up their resources.

Acceptance evidence (29 October 2026):

| Check | Recorded result |
| --- | --- |
| `npm test --prefix tools/contracts` | 65 passing client/contract checks, including strict posts envelopes, filter forwarding, explicit kind routing, browser permission and zero-cursor coordination. |
| `python3 tools/m1/verify.py --posts` (with the documented test environment) | Focused SQL/migration, real HTTP/live Chromium/SMTP and mock Chromium acceptance pass. |
| `bash tools/local/test.sh --full` | Complete final run passes: 12 local-tool tests, 7 runner tests, 65 client/contract checks, 20 backend tests and 71 SQL/integration tests (including 14 migration and 9 posts tests), with zero test failures/skips. All existing M1–M6, forum, enrollment and posts live/mock browser phases pass. |
| `node tools/m1/posts-ui.mjs` (local static server on port 8138) | Mock feed/forms/comments/profiles/deep links, mixed date precision, offline activity/account switches and mobile layout pass. |

The combined-filter SQL test captures an actual execution plan for its covering projection and verifies use of `IX_Posts_TypeSphereDate` on disposable fixtures. This supports the index path; it is not a production-volume latency benchmark. Production selectivity/load tuning remains part of rollout rehearsal.

Browser diagnostics can use `python3 tools/m1/verify.py --groups --browser-only`: this still packages the application and provisions/migrates fresh disposable infrastructure, then runs all selected browser phases while explicitly skipping SQL test reruns. This command also passes with the final code. The full workflow above subsequently passes uninterrupted, including dependency installation, schema validation, SMTP and all browser phases.

Mobile mock screenshots were inspected. Tests ran on Linux with headless Chromium; Playwright uses its Ubuntu fallback on this host. Native macOS execution and actual OS notification presentation are not established. Local restricted execution blocked test server sockets and stalled the independent ZIP-reader subprocess; verification ran with the required local process/network permissions. Production reference mapping/timezone review, operator restore rehearsal and deployment remain separate actions.
