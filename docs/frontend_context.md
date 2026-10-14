# PolyLink frontend context

Reviewed 14 October 2026. This describes the **current refactored source**, not the original disconnected demo. PolyLink is a static, Armenian-language, multi-page university networking frontend. The backend does not exist; its target database is Microsoft SQL Server. No framework, bundler, package installation or build step is required. Existing HTML/CSS remains the visual baseline.

## Architecture and boundaries

```text
HTML page → ES-module controller → js/services/index.js
                                   ↓
                              js/data/client.js
                              ↙             ↘
               mock/provider.js          http/provider.js
                    ↓                    routes + normalize
              IndexedDB store                  ↓
                                        Axios transport
```

- `js/config.js`: one provider switch (`dataMode: 'mock'` by default), HTTP base URL `http://localhost:3004`, pinned Axios 1.13.2 CDN, mock database name/schema version.
- `js/services/index.js`: named async facades for auth, profiles/education/certificates, posts/comments, forum/replies, search, chat and settings. Methods resolve application DTOs, never Axios response objects. Services expose operations beyond those currently surfaced as buttons.
- `js/data/client.js`: lazily imports exactly one provider, normalizes failures and exposes subscription/mock-control boundaries. There is no HTTP-to-mock fallback.
- `js/data/mock/store.js`: one IndexedDB `state` store containing `dataset`; serialized read/write transactions avoid stale cross-tab overwrites. Actions inside transactions are synchronous. IDs come from a persisted sequence, not array lengths.
- `js/data/mock/seed.js`: one coherent fixture graph: six people, three posts, six topics, direct rooms and a group room. Fictional demo credentials are separate from user DTOs.
- `js/data/mock/provider.js`: domain validation, ownership, privacy, membership, challenge state, media hydration and operation dispatch. Blob records persist; object URLs are page-local. Notifications use local listeners and BroadcastChannel, including incoming-message injection.
- `js/data/http/transport.js`: lazily loads Axios only in HTTP mode, attaches namespaced bearer token, includes cookies, uses a 15-second timeout and one shared refresh request for concurrent 401s. A retried 401 or failed refresh clears the token. Auth requests do not enter refresh loops.
- `js/data/http/routes.js`: central route/payload mapping. Writes allowlist mutable fields and encode path IDs. Browser FormData supplies multipart boundaries.
- `js/data/http/normalize.js`: unwraps bare/enveloped bodies, maps selected SQL-style names to DTO fields and converts numeric IDs to strings. Missing record identities, invalid role/onboarding state and non-array lists fail as `CONTRACT` errors.
- `js/data/errors.js`: `DataError {code,message,fieldErrors,retryable}`; Axios status mapping: 400 validation, 401 unauthorized, 403 forbidden, 404 not found, 409 conflict; network/5xx failures may be retried.
- `js/shared/ui.js`: initial loading/disabled shell, retry on initialization failure, session guard, navigation/logout, themes, pending/error states, toasts, confirmation overlays and dates. Controls become available after initial reads. Pending mutations retain forms on failure.
- `js/shared/content.js`: escaped plain text, URL scheme checks and a narrow HTML allowlist. Titles, names and comments remain text; post/topic/reply rich bodies are sanitized. These browser checks do not replace server enforcement.

Removed legacy `js/api/`, `js/core/`, duplicate profile theme/utilities and public render fixtures remain recoverable in Git history. They are not live integration points. Product controllers must not import Axios or access IndexedDB directly.

## Pages, flows and component ownership

| Page | Controller and behavior |
| --- | --- |
| `login.html` | `login.js`: async credentials; authenticated result navigates to owner profile or unfinished onboarding; second-factor result navigates to `2fa-verify.html`. Failed login stays on the form. |
| `register.html` | `register.js`: name/email/password and confirmation; registers, then signs in. No mock university eligibility verification is claimed. |
| `profile_info.html` | `profile-info.js`: graduate institute/study years or lecturer department, specialization, biography and optional image. UI `teacher` maps to domain `lecturer`. Upload must succeed before onboarding is completed. |
| `forgot.html` → `verify-code.html` → `reset-password.html` | Recovery challenge → six-digit verification → proof-bound reset → login. `services/workflow.js` keeps namespaced transient challenge state in sessionStorage; password values are not persisted there. |
| `2fa-verify.html` | Six digits, paste/backspace, resend timer and challenge verification; expired/consumed flows cannot sign in. |
| `profile.html` | `profile/profile-main.js`: owner profile reads; `profile-editor.js` intro save/cancel; `profile-sections.js` education/certificate/post CRUD and media; `profile-modal.js` asynchronous modal save; `profile-keyboard.js` shortcuts/focus. |
| `user.html?id=...` | `user/user-main.js`: public projection, education/certificates/posts, optional disclosed email; contact opens/reuses a direct room and navigates to `message.html?room=...`. Self-contact disabled. No persisted selected-user ID. |
| `events.html` | `posts.js`, `shared/posts.js`: announcements, category/sphere filters, rich editor and plain comments. This is not an event calendar or RSVP flow. |
| `forum.html` | `forum/list-page.js` via `forum.js`: topic list and professional classification filter; ID-based links. |
| `new-topic.html` | `forum/create-page.js`: validated publication, then forum list. |
| `topic.html?id=...` | `forum/topic-page.js`: actual topic, flat replies, helpful likes, reply totals, newest/oldest/popular sorting and inline link formatting. A legacy link without ID selects topic 1. |
| `search.html` | `search.js`: debounced query plus institute/specialization/graduation-year filters; profile/contact actions use durable IDs. |
| `message.html?room=...` | `chat.js`, `chat/render.js`: distinct direct/group histories, text/image sends, contact/history search, emoji, clipboard, unread counts and menu mute/block/hide/profile actions. Drafts/selected attachments are per-room in-memory; committed messages persist. |
| `settings.html` | `settings.js`: privacy/email disclosure, 2FA, notification/language preferences, local theme, current-password email/password changes, JSON export, deactivate/delete confirmation. Failed preference saves roll back the control. |
| `help.html`, `terms.html`, `privacy.html` | `help.js`: shared public-page initialization, keyboard FAQ, policy/resource navigation. Support form explicitly says submission is unavailable and retains the draft. |
| `tutorials.html` | `tutorials.js`: category filters and keyboard cards; unavailable video feedback, not pretend playback. |
| `dev-tools.html` | Developer-only mock reset/logout, latency, next-operation failures, 2FA preference and incoming-message injection. Not a product navigation destination. |

Profile/public cards share `profile/profile-render.js` for education, certificates, announcements and lazy comments. Feed rendering shares DTO/content helpers but has its own card layout. Forum controllers are split by page; chat has separate rendering. Large profile form templates and page-specific DOM selectors remain; this is incremental extraction, not a full component-system rewrite.

Member pages require a session and completed onboarding; onboarding itself permits an unfinished profile. Auth/help/policy/tutorial pages are public. Cross-tab mock logout/reset and browser cached-page restoration revalidate member access. Theme changes propagate between tabs. A fresh/reset dataset automatically signs in owner 1; logout suppresses auto sign-in until reset.

## Application DTOs and validation

All identities are opaque strings. Profile dates use `YYYY-MM`, years are strings, timestamps are ISO UTC strings. DTOs omit credential hashes, recovery secrets and registry records.

| DTO | Required shape / significant fields |
| --- | --- |
| User | `id,firstName,lastName,name,jobTitle,description,avatar,cover,role,onboardingComplete,institute,specialization,graduationYear,education[],licenses[]`; `email` is owner/disclosure-only; optional `passwordChangedAt`, lecturer `department`. |
| Education | `id,institution,degree,institute,specialization,startDate,endDate|null,logo`; provider-owned owner association. |
| Certificate | `id,name,organization,issueDate|null,credentialUrl,logo`. Canonical fields replace original public `title/issuer/date/credential`. |
| Author | `id,name,avatar`; every post/comment/topic/reply author and message sender needs stable identity. |
| Post / Comment | Post: `id,title,content,category,sphere,createdAt,author,comments[]`; Comment: `id,postId,text,createdAt,author`. |
| Topic / Reply | Topic: `id,title,content,major,createdAt,author,replyCount`; Reply: `id,topicId,content,createdAt,author,likeCount,liked`. |
| Conversation | `id,isGroup,closed,name,participants[],muted,blocked,unreadCount,lastMessage|null`. |
| Message | `id,roomId,sender,text,createdAt,attachment|null`; attachment `{url,name,type}`. |
| Settings | Booleans `isProfilePublic,showEmail,twoFactorEnabled,emailEnabled,newListingNotifications,forumReplyNotifications,directMessageNotifications`; `language: hy/en/ru`. |
| Auth results | Login `{status:'authenticated',user}` or `{status:'challenge',challengeId,expiresAt?,resendAfter?}`; challenge `{challengeId,expiresAt?,resendAfter?}`; recovery verification `{recoveryToken}`. |

Mutation inputs exclude generated IDs/authors/owner IDs/timestamps. Profile intro uses first/last name, headline and biography. Onboarding uses `role,institute,department,specialization,description,startYear,endYear`; images are separate uploads. Education/certificate inputs are the mutable DTO fields above. Post inputs are `title,content,category,sphere`; comments `{text}`; topics `{title,content,major}`; replies `{content}`; chat send `{text,file?}`; preference updates are partial Settings.

Mock validation: names ≤100 characters, titles ≤255, nonempty rich text ≤20,000 visible characters, plain comments/messages ≤5,000. Passwords retain whitespace and require 8–128 characters, ASCII uppercase, digit and special character. Education end must not precede start; null end is ongoing. Onboarding validates integer study years 1900–2200 and chronological order. PNG/JPEG/WebP/GIF images must be nonempty and ≤5 MiB. Certificate links require HTTP(S). Server validation/precision policies remain specifications to agree.

Category codes: `job`, `internship`, `training`. Feed spheres: `programming`, `engineering`, `data-science`, `marketing`. Forum major codes: `informatics`, `mechanics`, `electronics`, `civil`, `energy`, `management`. Display labels are Armenian; stable codes must not be replaced with localized SQL lookup names.

## HTTP route inventory and response contracts

These are client expectations, **not a tested server API**. Routes below are implemented only by the HTTP adapter. Base URL is configured centrally, with no implicit `/api` prefix. JSON requests unless noted; successful resource reads/writes may return a bare DTO or `{data: DTO}` / `{success:true,data:DTO}`. `{success:false,message,fieldErrors}` is an error. Deletes resolve null; lists require arrays, including empty arrays. Current adapter filters full returned lists locally and has no pagination envelope support.

| Method/path | Input | Body consumed |
| --- | --- | --- |
| POST `/auth/login` | `{email,password}` | `{accessToken,user?}`; if absent user, adapter reads `/auth/me`; or challenge result. |
| POST `/auth/register` | `{email,password,firstName,lastName}` | Body unused; page then logs in. |
| POST `/auth/logout` | No body | Body unused; clear access token after successful request. |
| POST `/auth/refresh` | `{}`, credentialed cookie | `{accessToken}` or `{data:{accessToken}}`; bypasses shared response interceptor. |
| GET `/auth/me` | None | User or null/terminal 401; role and boolean `onboardingComplete` required. |
| POST `/auth/forgot-password` | `{email}` | Challenge with `challengeId`; legacy empty response is insufficient for current flow. |
| POST `/auth/verify-code` | `{email,code}` | `{recoveryToken}`; the legacy path does not currently transmit challengeId. |
| POST `/auth/reset-password` | `{email,code,newPassword}` | Body unused; current legacy route omits recoveryToken. Proof-bound server contract must be reconciled. |
| GET `/users/{id}` | Encoded ID; no ID uses `/auth/me` | User with child arrays. |
| PUT `/users/me` | First/last name, jobTitle, description | Updated User. |
| PUT `/users/profile` | FormData onboarding fields | Updated User. |
| POST `/users/me/photo`, `/users/me/banner` | FormData `photo` / `banner`: File | Updated User, or `{url}` followed by `/auth/me`; no invented field name fallback. |
| GET/POST `/users/me/education` | None / mutable Education fields | Education[] / created Education with ID. |
| PUT/DELETE `/users/me/education/{id}` | Mutable fields / none | Updated Education / ignored body. |
| GET/POST `/users/me/licenses` | None / mutable Certificate fields | Certificate[] / created Certificate with ID. |
| PUT/DELETE `/users/me/licenses/{id}` | Mutable fields / none | Updated Certificate / ignored body. |
| GET `/posts`, `/users/{id}/posts` | No query; selected user in path | Post[]; category/sphere filtering local. Original unused `/users/me/posts` intent is replaced by the identified-user read. |
| POST `/posts`; PUT/DELETE `/posts/{id}` | Post fields / none for delete | Created/updated Post / ignored body. |
| GET/POST `/posts/{postId}/comments` | None / `{text}` | Comment[] / created Comment. |
| PUT/DELETE `/posts/{postId}/comments/{id}` | `{text}` / none | Updated Comment / ignored body; not currently surfaced as edit/delete controls. |
| GET/POST `/forum/topics` | None / Topic fields | Topic[] / created Topic; major filtering local. |
| GET/PUT/DELETE `/forum/topics/{id}` | ID, Topic fields for update | Topic / updated Topic / ignored body. Edit/delete service exists without product controls. |
| GET `/search` | Axios `params:{q}` | User[]; institute/specialization/year filtering local. |

**Unmapped operations fail `UNSUPPORTED` before requesting:** second-factor verification/resend, recovery resend, all forum reply/like operations, all chat operations, all settings/security/account lifecycle/export operations. Original source declared DELETE `/users/me`, but its confirmation/retention contract was undefined; settings deletion is deliberately not mapped to it. Backend reference/eligibility APIs are also undefined. Add agreed mappings and DTO normalization in the data layer; page controllers should not change for equivalent service semantics.

## Mock rules, persistence and scenarios

- Owner writes check actual session identity; comments validate their parent post; forum likes are per-user; chat reads/sends require membership. Closed/inactive public profiles are not returned by people search. Email disclosure is independent of login identity. Closing a profile currently hides its profile/search entry, not all published discussion content.
- Direct contact reuses a room for the same pair. Hiding a conversation is per-user, with a visibility timestamp cutoff; it does not erase everyone’s messages. Reopening/incoming can reveal the room again. Blocking prevents direct sends in either direction; group blocking controls are unavailable. Room mute is stored separately.
- Six-digit mock code is `123456`; challenge expires after ten minutes, permits five attempts and has a 60-second resend interval. Reset/credential changes consume applicable challenges. These are demo rules, not production OTP/security implementation.
- Mock deactivation ends the session and valid login reactivates. Account deletion removes owned resources/replies/comments/likes/messages/media/challenges and membership, retaining other users’ records. A direct room with one survivor becomes read-only. Production retention policy must be separately approved.
- Export includes own profile/settings/posts/comments/topics/replies/sent messages and own media data URLs with stable references; no password hashes, tokens, challenges or other participants’ message bodies.
- Images persist as IndexedDB blobs. Session/dataset are origin-specific: `localhost` and `127.0.0.1`, or different ports, are separate demos. Reset changes only mock dataset/URLs, not unrelated browser storage or HTTP credentials; local theme and transient workflow are separate.
- Demo accounts: `demo.alumni@polytechnic.am`, `demo.lecturer@polytechnic.am`, `demo.user5@polytechnic.am` through `demo.user8@polytechnic.am`; password `DemoPass123!`.
- Run `python3 server.py --port 8001`, open `http://127.0.0.1:8001/profile.html`; `dev-tools.html` provides reset, latency and named one-shot failures. No API server is needed. Offline means backend-free; CDN fonts can still require internet.

## Pain points and remaining constraints

| Area | Current state / implication |
| --- | --- |
| Original mixed globals, commented imports, duplicate auth initialization and DOM-only saves | Removed/replaced with modules, coherent service DTOs and durable mock operations. Do not revive legacy wrappers. |
| Original duplicate biography/certificate blocks and fixture-only public/feed records | Deduplicated and rendered from the shared fixture graph. Record counts are derived. |
| Large profile form templates and page selectors | Still tightly coupled to existing HTML; preserve selector contracts when changing markup. Shared renderers reduce duplication but there is no general component framework. |
| Rich editing | Uses legacy browser `document.execCommand`; constrained HTML sanitization remains essential. No image-rich editor or general arbitrary HTML contract. |
| Lookup/search controls | Fixed frontend labels/options, no reference-data API; exact text matching and limited year options can exclude other values. Resolve reference IDs and pagination before HTTP scale-up. |
| Onboarding academic dates | Mock uses September/June as demo conventions for year input; do not treat these as authoritative graduation days. Registry eligibility and lecturer verification are not mocked as official checks. |
| Language and notifications | Saved preferences only; no translation catalogs, email/push delivery, reliable presence or encryption. |
| HTTP integration | Only route adapter scaffolding verified with injected responses; no live backend, chat realtime contract or production session policy. Unknown capabilities fail visibly. |
| Styling/accessibility | Original desktop layout retained with added focus/pending/error behavior. Actual 390px mobile viewport verification could not be confirmed by the available browser override; do not report mobile acceptance as passed. |
| Concurrency | IndexedDB writes serialize; page controllers guard several stale reads. There is no production optimistic concurrency/version/ETag contract or message idempotency protocol. |
| Documentation | This file and `backend_design_context.md` are current references. `docs/REFACTOR.md` records incremental acceptance evidence and limitations. Historical Git versions show the original defects. |

Desktop flows, persistence, failures/retry, auth/recovery/2FA, profile CRUD/media, feed/forum/search/chat/settings and cached-session navigation were checked incrementally. Temporary adapter checks used actual pinned Axios for refresh/error/contract behavior and disposable mock business logic for lifecycle invariants; no Node project test/build toolchain was added. See `docs/REFACTOR.md` for precise scope and unverified boundaries.
