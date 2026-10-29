# Forum contract and operations

The career forum follows `forum_decisions.md`. Access requires authoritative admission and verified email for either member role. V14 admits new accounts only after completed registry enrollment; existing admitted accounts are grandfathered. See [registry enrollment](registry_enrollment.md).

## API

Enable `FORUM_ENABLED=true` after explicitly applying the matching schema through V21 and completing the V13 historical review where needed. Forum access does not depend on the messenger flag. Every route requires the existing bearer session and admission; mutation origins follow the shared identity boundary.

| Method | Route | Input |
| --- | --- | --- |
| GET | `/forum/categories` | none |
| GET | `/forum/topics` | `categoryCode`, `cursor`, `limit` |
| POST | `/forum/topics` | `title`, `content`, `categoryCode`, `requestId` |
| GET | `/forum/topics/{id}` | none |
| PATCH | `/forum/topics/{id}` | supplied mutable fields and `expectedVersion` |
| DELETE | `/forum/topics/{id}` | `expectedVersion` query |
| GET | `/forum/topics/{id}/replies` | `sort`, `cursor`, `limit` |
| POST | `/forum/topics/{id}/replies` | `content`, `requestId` |
| GET | `/forum/replies/{id}` | latest reply for conflict review or a notification link |
| PATCH | `/forum/replies/{id}` | `content`, `expectedVersion` |
| DELETE | `/forum/replies/{id}` | `expectedVersion` query |
| PUT | `/forum/replies/{id}/like` | `liked` boolean |

IDs and versions are strings. Collections use `{items,nextCursor}` (null at end), resource responses are bare DTOs. Create returns 201, delete returns 204. A category has `id/code/name`. Topics carry `categoryCode/categoryName`, sanitized `content`, plain `excerpt`, author, counts, `createdAt/updatedAt`, `version`, and `canEdit/canDelete`. Replies add `topicId/likeCount/liked/isTopicAuthor`. Deleted authors have null ID, a neutral name/avatar and `canOpenProfile:false`; other authors expose no email. Private-profile authors have no profile link.

Page size defaults to 20, maximum 100. Filtering precedes pagination. Topic order is creation time/ID descending; replies support `newest` (same), `oldest` (both ascending), `popular` (likes/time/ID descending). Cursors are authenticated and bound to filter/sort (and topic for replies). Rankings may move as likes change: the client deduplicates IDs and Refresh restarts pagination. Counts are server-derived, not the loaded page length.

Titles: 1–255 trimmed UTF-16 units. HTML: at most 100,000 UTF-16 units before sanitization; 1–20,000 visible units after sanitization. Preserve p/br/b/strong/i/em/u/ul/ol/li/a/div/h2/h3/blockquote. Only href on links with HTTP/HTTPS/mailto protocols is accepted; no media, style, handlers or executable HTML. Both server writes and legacy reads sanitize. Client sanitization is additional protection.

Edits/deletes require `expectedVersion`; stale writes return 409 `EDIT_CONFLICT`, preserving the browser draft. Likes and reply counts do not modify content versions. Create `requestId` is a UUID, scoped to user/operation for 24 hours; reuse with another canonical payload returns 409 `REQUEST_CONFLICT`. Replays return the existing resource, never resurrect deleted content. Unknown fields/types/nulls fail 400 with fieldErrors. Ownership fails 403; absent resources fail 404. No nested replies, attachments, subscriptions, search, live thread polling or moderator UI.

## Existing database upgrade

Stop application access and verify a backup. Use the existing explicit migration credentials; these commands never run at application startup. No machine-specific mapping belongs in Git.

1. `SchemaCommand upgrade --target=12` expands the schema while preserving legacy CreatedAt values and leaving new category/UTC columns unfilled for historical rows.
2. `ForumMaintenanceCommand inspect` prints the topics and reply dates requiring human review. Review output privately; it contains user content.
3. Prepare a JSON file outside the checkout: `{"operator":"responsible operator","timezone":"Asia/Yerevan","topics":{"123":"informatics"}}`. The timezone is an example, not an inferred historical timezone. Supply exactly the topic IDs requiring review. Confirm every category and the actual source timezone. Ambiguous/nonexistent DST timestamps are rejected and require explicit data correction/review.
4. `ForumMaintenanceCommand dry-run /absolute/review.json` validates the complete input transactionally and rolls it back.
5. `ForumMaintenanceCommand apply /absolute/review.json` fills category and UTC projections atomically while preserving original `CreatedAt` values. Keep the reviewed JSON and command output externally if an operational record is required; V16 removes the historical review log.
6. `SchemaCommand upgrade` passes V13 enforcement and proceeds to V20; historical posts/comments also require the separate V18 review described in [posts operations](posts_implementation.md#existing-database-upgrade-and-historical-review). A missing review blocks migration. V20 removes the old `CreatedAt` columns from forum topics/replies and posts/comments, retaining canonical UTC dates, and removes the posts review journal. Preserve any required original dates privately before completing the upgrade. Fresh empty databases can apply all migrations without review.

Invoke commands through the existing Maven exec entry point, e.g. `./backend/mvnw -f backend/pom.xml compile exec:java -Dexec.mainClass=am.polylink.database.SchemaCommand -Dexec.args='upgrade --target=12'`; use `am.polylink.forum.ForumMaintenanceCommand` for maintenance. Schema inventories validate the versioned dbo shapes without modifying earlier baselines. After V20, legacy inspect/dry-run/apply commands refuse further timestamp review; `takedown-topic` remains available.

## Notifications and lifecycle

Reply creation emits one deduplicated FORUM_REPLY event for the topic author, excluding self-replies. Both email and browser eligibility recheck admission, category preference and surviving content; email additionally requires EmailEnabled. Browser permission/device opt-in remain independent. No delivery after all site tabs close. Forum emails are generic notices with a discussion link; no user HTML. SMTP is at-least-once and can duplicate after a crash between sending and acknowledgement. Existing direct-message grouping/read/block/mute rules remain in effect.

Deleting a topic explicitly removes all replies/likes/notification events. Deleting an individual reply removes its likes/events. Account deletion retains discussion content with anonymous authors, removes the account's likes and pending create-request records, and preserves own-contribution export until account deletion revokes access.

## Reporting and takedown

Public launch requires a named responsible operator and confirmation that the existing support@polylink.am channel is operational. No report is silently submitted by the unavailable help form. Do not claim that the mailbox has been verified by implementing the forum.

An authorized database operator can run `ForumMaintenanceCommand takedown-topic TOPIC_ID 'operator name' 'case reference and reason'` with migration credentials. It verifies existence, locks the topic, removes replies/likes/events transactionally, and records the operator/reason/time/reply count in `forum.Takedowns`. This operation has no HTTP equivalent or login bypass. Review the topic and backup first. Keep case details in the controlled reporting system; do not put unnecessary personal content in audit reasons. Backup retention/deletion replay remain the existing lifecycle runbook's responsibility.


## Verification record — 24 October 2026

`bash tools/local/test.sh --full` passed on Linux with JDK 25, disposable SQL Server/OpenBao/Mailpit services and headless Chromium: 12 local-tool tests, 48 client/contract tests, 11 backend unit tests and 48 SQL integration tests, followed by the existing M1–M6 browser phases and both forum browser suites. Focused forum acceptance also passed with messenger endpoints disabled. The live browser suite verifies both roles, manual refresh, forum event delivery to the browser API, notification navigation, real stale-edit/validation responses and a committed create whose response is deliberately lost before retry. Mock browser coverage includes formatting, cursor pagination/counts, conflict comparison, drafts, deletion confirmation and mobile/themes. Browser notification presentation is substituted in automation; these results do not establish native OS notification appearance or macOS execution.

The working application database was not migrated by these checks. Production enablement still requires the explicit V12/V13 workflow where applicable, `FORUM_ENABLED=true`, and the reporting/operator prerequisites above.
