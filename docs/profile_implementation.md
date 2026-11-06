# Profile API and operations

Implemented 6 November 2026 under the [approved decisions](profile_decisions.md) and [implementation plan](profile_implementation_plan.md). Apply V22 explicitly before starting this backend/frontend pair. Identity must be enabled; the profile API has no separate feature flag. Announcements still require `POSTS_ENABLED`; direct contact requires `MESSENGER_ENABLED`.

## Access and editing

All JSON profile endpoints require an admitted bearer session. Writes use the existing allowed-Origin boundary; cookie refresh/logout retain their session-bound CSRF checks. The server derives ownership from the session and serializes owner writes with account lifecycle transitions. Missing or inaccessible records return `404`; validation returns `400`, rate limits `429`. Last successful save wins without versions or conflict warnings. Deletes return `204`, creates `201`, and updates `200`.

`GET /users/{id}` returns headline, biography, avatar, cover, education and certificates. Other members receive `404` for private profiles. The owner retains access. Email is returned only to the owner or when the public profile's show-email setting permits it. Published announcements retain their independent access policy.

`PUT /users/me` replaces `{jobTitle, description}`. Both fields may be empty; limits are 150 and 2,000 characters. Text is rendered literally. Names, email, role and admission state are rejected here. The university-verified name stays read-only; email changes use existing account settings.

## Education and certificates

| Operation | Route |
| --- | --- |
| Reference options | `GET /users/me/education/options` |
| Education list/create | `GET/POST /users/me/education` |
| Education replace/delete | `PUT/DELETE /users/me/education/{id}` |
| Certificate list/create | `GET/POST /users/me/licenses` |
| Certificate replace/delete | `PUT/DELETE /users/me/licenses/{id}` |

Education options contain `universities`, `degrees`, `institutes`, and `specializations`, with string IDs and labels. All existing rows are selectable, regardless of verification flags. The UI filters existing options by search; it cannot create or request reference entries. Lists are independent because the schema does not establish relationships among them.

Education writes contain `universityId`, optional `degreeId/instituteId/specializationId`, optional `startDate/endDate`, and boolean `isOngoing`. University is mandatory. Labels and university logos are read from the database, never written by users. Responses include IDs, labels, dates, precision, ongoing state and logo.

New dates use `YYYY` or `YYYY-MM`, supported years 1900–2200. Empty means unknown. Ongoing is explicit and requires no end date. A range is invalid only when the entire end period precedes the start period. Storage uses the first day of a period plus `YEAR/MONTH` precision. V22 marks historical non-null dates `DAY`, preserving their exact stored values and backfilling missing ends as unknown. An unchanged historical `YYYY-MM-DD` value can pass through an update; new day-level values are rejected. Enrollment records copied from exact registry dates explicitly retain `DAY` precision. Other enrollment dates remain unknown.

Certificate writes contain required `name` and `organization` (255 characters each), optional `issueDate` (`YYYY-MM`) and optional `credentialUrl` (absolute HTTP/HTTPS, at most 2,048 characters). There is no certificate-logo upload. Legacy incomplete records remain readable; editing requires current mandatory fields.

## Managed images, export and lifecycle

`POST /users/me/photo` accepts multipart `photo`; `POST /users/me/banner` accepts multipart `banner`. Both return the saved profile. JPEG/PNG only, at most 5 MiB, 4,096 pixels per side and 16 million pixels. Declared type must match content. Decoding checks dimensions before allocating pixels; normalized JPEG strips source metadata. Avatars are center-cropped to 256×256; covers preserve aspect ratio within 1,920×1,080. Uploads are limited to 20 per owner/hour.

Avatars reuse `auth.ProfileAvatars` and `/auth/avatars/{uuid}`. Covers use V22 `auth.ProfileCovers` and `/users/media/covers/{uuid}`. Replacement changes bytes and URL atomically; old managed URLs return `404`, and failures retain the current image. Public image retrieval requires no login and remains available when the profile is private. Responses use JPEG, `nosniff`, and no-store. Deactivation retains bytes but disables retrieval. Deletion and deletion replay remove both image stores.

The password-authorized export grant also protects `GET /account/export/profile-media` and `/account/export/profile-media/{uuid}`. Only the caller's managed files are downloadable. The browser includes them in the existing ZIP alongside JSON. Legacy remote URLs remain in exported data and are reported as unmapped; the server never fetches arbitrary URLs. Export remains bounded to 100 MiB and is not a cross-table snapshot.

## Verification

Run `bash tools/local/test.sh --profile` for contract/unit checks, isolated SQL/SMTP/Transit integration, and HTTP/mock browser scenarios. Supply disposable-database administrator credentials as described in local testing documentation. No shared database is migrated by this acceptance command. `DatabaseMigrationIT` separately verifies historical upgrades, including preserved legacy dates and repeat V22 validation.

Owner forms preserve input after failed saves, prevent duplicate submissions, confirm discard/deletion, restore focus and expose keyboard controls. Browser scenarios exercise both roles, loading retries, certificate save retries, reload persistence, education precision, credential links, uploads, announcements/comments and owner/member projections. The full profile UI remains Armenian.

Acceptance on 6 November 2026 passed: 22 database-free Java tests; 69 client contract tests; 23 profile/enrollment/identity/search SQL and HTTP integration tests; all 17 historical migration checks; and HTTP/mock Chromium profile scenarios for both graduate and lecturer accounts. Browser checks include explicit mobile overflow assertions, screenshot review, and profile-to-messenger navigation. The standard local tooling/contract checks also passed. All infrastructure and data used for integration were disposable; the working database was not migrated and no release was deployed.
