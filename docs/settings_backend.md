# Settings backend

Product authority: [approved decisions](settings_decisions.md).

## Deployment

Apply V10 and V11 explicitly through SchemaCommand using the existing migration workflow and a verified backup. Application startup never migrates the database. Use the matching backend after migration. Settings and export require `IDENTITY_ENABLED=true`; messenger event production requires `MESSENGER_ENABLED=true`. SMTP is required for verification, security notices and activity emails. No Web Push credentials are needed.

V10 preserves visibility/language and existing notification values, fills missing preferences, adds email disclosure (off), Russian, staged email changes and notification queues. V11 adds Armenian on fresh installations and session-bound export grants. New accounts use Armenian.

## API

- `GET /settings`, `PATCH /settings`: seven mutable preference fields; `twoFactorEnabled` is read-only here. Unknown fields, nulls and boolean coercion are rejected. Theme and browser opt-in remain local.
- `POST /account/email-change/start`: `email`, `loginSecret`, `expectedCredential`. Return `status: challenge`, `requestId`, `stage: OLD|NEW`, `expiresAt`, `resendAfter`.
- `POST /account/email-change/verify`: `requestId`, `code`. OLD verification advances to NEW; NEW verification completes with the new email. New requests supersede old requests; email changes preserve sessions and crypto versions.
- `POST /account/email-change/resend`: `requestId`; 60-second cooldown, 10-minute code expiry, five failed attempts per stage. Account rate limits additionally bound issuance and verification.
- `PUT /account/email-factor`: `enabled`, `loginSecret`, `expectedCredential`; password proof only. Pending email-change requests and login challenges are cancelled.
- `GET /notifications`: `cursor=initial` establishes a baseline without displaying history; subsequent opaque decimal cursors return up to 100 eligible events (50 default). Poll every 15 seconds with network backoff.
- `POST /account/export/authorize`: password-derived proof, return 15-minute `grant`. Send it exclusively in `X-Export-Grant` to `/account/export/data?category=...&offset=...`, `/account/export/messages` and `/account/export/files/{id}`. Grants also require the original authenticated session and credential version.

Passwords remain in the browser; the existing PLK1 derivation produces loginSecret. Export DTOs exclude credential/key tables. Archive creation is client-side, uses ZIP STORE, and rejects source data above 100 MiB. Exports are paginated live reads, not a cross-table point-in-time snapshot. Missing/decryption-failed elements are recorded in manifest.json. Legacy external file URLs have no authenticated storage mapping: they remain references and are explicitly reported unavailable; the server never fetches arbitrary URLs. Messenger attachments are decrypted client-side and included as separate files.

## Notifications and deferred integrations

The event schema reserves DIRECT_MESSAGE, ANNOUNCEMENT and FORUM_REPLY. Only messenger sends produce live events. Publication/forum backends must create events in their own transaction and implement recipient/category-specific delivery before enabling those sources. Announcements target active members except the author; forum replies target the topic author except self-replies. Do not claim those categories deliver today.

Activity emails aggregate eligible unread chat events after a 60-second delay. Workers claim rows with a two-minute retry lease, release SQL locks before SMTP, and retry failures. Delivery is at least once: SMTP success followed by a process failure before recording completion can produce a duplicate. Browser notifications share category settings, use browser-specific opt-in/permission and coordinate tabs with Web Locks. Unsupported browsers show an actionable error. No notifications are delivered by this client after all site tabs close.

Closed profiles remain in search with canOpenProfile=false; other members receive 404 for profile reads. Search never returns email. Public profile DTOs omit authentication metadata. There is no new profile-media upload or private storage subsystem in this change; legacy public URLs cannot become private retroactively. New profile-media endpoints must enforce visibility rather than exposing private storage URLs.

Deactivation retains data and requires operator readmission. Deletion retains content with a neutral author, removes structured personal data and own encrypted message bodies/files, and cancels pending settings/export/activity state. Existing M6 deletion-ledger/restore rules still apply. Production backup retention and old-mailbox recovery remain separate release tasks.

## Verification — 24 October 2026

- `./mvnw verify`: compilation, formatting, executable JAR and all nine database-free tests pass.
- The complete disposable SQL/OpenBao TLS/SMTP backend profile passes: 42 integration tests plus the nine ordinary tests, zero failures and zero skips. This includes fresh and V9 upgrades, preference preservation, strict patches, public/closed profile reads, staged email proofs, request replacement/attempt limits, preserved secondary sessions, factor changes, export grants/expiry, event deduplication and mute/read filtering.
- `node --test tools/contracts/*.test.mjs`: 41 tests pass, zero skips. ZIP output is read independently with Python zipfile; Unicode/binary data, archive limits, header grants, browser permission handling and async acceptance polling are covered.
- All M1–M6 browser phases pass with the final code: setup/resume/email factor, encrypted messaging, continuity, settings persistence/privacy, password-confirmed ZIP download, password change, local/service recovery, M5 HTTP/mock interactions and M6 HTTP/mock membership/export/lifecycle scenarios. The final browser-only rerun follows the successful complete backend profile; it skips rerunning that unchanged SQL phase after test-helper-only fixes.
- Browser checks now wait for actual settings event handlers and HTTP completion; the shared async polling helper waits for resolved predicates and survives expected security-flow navigation. M5/M6 selectors match the current Armenian interface, and M6 assertions inspect the new ZIP export rather than assuming the former message-only JSON result.

Only uniquely named disposable databases and test dependencies were created/migrated by acceptance. The working database and running backend were not migrated/restarted. Production backup expiry, external legacy-file storage migration and old-mailbox recovery are not claimed by these checks. Native notification permission behavior is covered by a controlled test; OS notification presentation itself was not manually verified.
