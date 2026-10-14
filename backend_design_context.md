# PolyLink backend design context

## Purpose, evidence and limits

Technical specification context for a backend that does not yet exist. Reviewed 14 October 2026. The target datastore is **Microsoft SQL Server**, using T-SQL and relational integrity. No backend language, framework, ORM, deployment environment, queue or real-time transport has been selected by this repository.

This file is standalone: it summarizes domain requirements, storage, existing HTTP expectations and unresolved decisions. It contains no implementation sequence or backend code.

Evidence:

- Root HTML and `js/`: feature scope, user interactions, DTO fields and declared Axios routes; many behaviors are fixtures or UI-only.
- `DB/polylink_table_creation.sql`: original tables, constraints, defaults and later registry additions.
- `DB/migrate_to_references.sql`: intended normalized education, lecturer, post, role and language design.
- `DB/diagram_new.png`: normalized ER diagram, with a certificate URL-length discrepancy.
- `DB/Сևակ_ՏԲ.pdf`: Armenian database report; pages 4–5 state access, communication and search requirements; pages 24–25 describe eligibility registries.
- `DB/import_alumni.py`: operational alumni import expectations, not an HTTP backend.
- `DB/fill-syntetic-data.sql`, `fill_posts.sql`, `fill_forum.sql`: sample data and relationship examples; fake hashes and fixed IDs are not production requirements.
- `DB/queries.sql`: intended joins/aggregates; contains exploratory queries and a trailing incomplete SELECT.

`DB/` is excluded by `.gitignore`; a fresh repository clone may not contain these assets. The `.bak` file was inventoried but not restored or inspected as a live database. Neither the diagram nor the report proves the actual backup schema. Existing READMEs are secondary and overstate implemented capabilities.

**Labels:** *evidenced* = directly in source or report; *derived constraint* = needed to make an evidenced feature consistent/safe; *open decision* = insufficient or conflicting evidence. Proposed missing data is clearly distinguished from existing columns.

## Domain and scope

PolyLink is a university alumni and lecturer networking platform. Core features are eligibility-based registration and authentication, personal/public profiles, education and certificates, professional announcements, career-oriented forum discussions, user discovery, and private direct/group communication. Settings expose privacy, notifications, language, security and account lifecycle preferences.

The frontend calls its announcement feed `events.html`, but it currently models job, internship and training posts. There is no event entity, event start/end time, venue, RSVP or attendance model. University events appear in the report's broader feature description; dedicated event scheduling is an open extension, not an established contract.

Help, tutorials, terms and privacy are static content. No ticket, tutorial-management or policy API is implied by an actual call. WorkExperience exists in SQL but has no connected frontend resource/editor.

## Identities, eligibility and permissions

### Roles

| Identity | Evidence and constraints |
| --- | --- |
| Graduate / alumnus | UI and SQL seed use `graduate`; must be eligible via official AlumniRegistry according to report. Education, profile, posts, replies, comments and messaging are implied. |
| Lecturer | SQL seed uses `lecturer`; onboarding UI uses `teacher`. A verified lecturer must have an appropriate Lecturers row with department/profession. Report requires matching LecturerRegistry. |
| Unauthenticated visitor | Registration/login/recovery pages exist. Whether public profiles/feed/forum are accessible without login is unspecified; an intended guard suggests member access. |
| Administrator/moderator/import operator | Operational authority is needed for registries/reference verification, but no such role, permission set or admin UI is defined. Do not invent it as an established product role. |

The database gives each user **one RoleId**, not multiple roles. Neither role is shown to have exclusive publication privileges. Department names used as announcement authors are fixtures; SQL ties each post to an individual Users row, with no organization/service-account entity.

Derived permission constraints: authentication must be server-enforced; owner resources are writable only by their owner; post/topic/comment/reply edits must verify ownership and parent association; messages/history require room membership; users cannot assign themselves a verified lecturer role or alter official registry records. Any moderator override needs a separately specified policy.

### Registration and verification

Evidenced report requirements:

- Access is restricted to university email addresses at **`@polytechnic.am`** (report page 4). Frontend accepts arbitrary syntactically valid addresses; fixtures also use `polytech.am`, `university.am`, and example domains. The allowlist and any alumni exceptions require explicit resolution.
- AlumniRegistry is official reference data for validating graduates during registration; LecturerRegistry contains university-provided eligible lecturers and their official emails.
- The report calls for 2FA; Users also stores TwoFactorEnabled. Whether it is mandatory for all users or opt-in is unresolved because settings expose a toggle.

Current registration sends only email/password/firstName/lastName. Role is collected later. Graduate onboarding adds institute, specialization and study years; lecturer mode replaces institute options with department and hides years. Bio/photo are also collected. No diploma number is collected anywhere, although the alumni registry's unique identifier is DiplomaNumber.

Required specification gaps: verification evidence for alumni, canonical role codes (`teacher` versus `lecturer`), email ownership, role-selection timing, pending/rejected/verified account state, proof of registry matching, prevention of repeated claims, multiple diplomas, handling missing registry data and operator authority. Current Users has no registry FK, claim/verification state or onboarding completion field. Matching names alone is insufficient proof of identity. A uniqueness-protected linkage/claim record is a derived data requirement if one registry identity must be claimed only once; its cardinality is an open decision.

Official registries and diploma numbers must not be exposed through public profile/search responses. Self-edited education must not silently rewrite official eligibility evidence.

## Relational data specification

### Common SQL semantics

Existing entity PKs are `INT IDENTITY`; join PKs are composite. Strings use NVARCHAR for Armenian/English text; nullability is described below. `DATETIME2 DEFAULT SYSDATETIME()` is used for server timestamps and `DATE` for education/work/certificate/registry dates. These defaults have no explicit UTC/time-zone contract. Foreign keys preserve references but do not generally enforce ownership, role consistency, membership, visibility or chronological validity.

The following is the **intended post-normalization shape**, reconstructed from both SQL files. It is not a fresh runnable schema. Unless stated otherwise, fields are nullable. `!` means NOT NULL; generated IDs are primary keys.

### Users and account preferences

| Table | Fields and declared constraints |
| --- | --- |
| Users | UserId; FirstName NVARCHAR(100)!; LastName NVARCHAR(100)!; Specialization NVARCHAR(150); About NVARCHAR(MAX); Email NVARCHAR(255)! UNIQUE; PasswordHash NVARCHAR(500)!; ProfilePhotoUrl and CoverPhotoUrl NVARCHAR(500); IsProfilePublic BIT! default 1; TwoFactorEnabled BIT! default 0; CreatedAt DATETIME2! default SYSDATETIME(); RoleId INT! FK Roles; LanguageId INT! FK Languages. Original Role/Language text columns removed by migration. |
| Roles | RoleId; Name NVARCHAR(50)! UNIQUE. Migration derives values from pre-existing Users. |
| Languages | Id; Code NVARCHAR(5)! UNIQUE; Name NVARCHAR(50)!; migration seeds `en` and `hy`. |
| UserNotificationSettings | UserId PK/FK Users with delete cascade; NewListingNotifications, ForumReplyNotifications, DirectMessageNotifications, EmailEnabled BIT default 1, but not declared NOT NULL. A user can have zero or one row; automatic row creation is not specified. |

Additional data implied by UI but absent: email-display preference, account active/deactivated/deleted state, verified email/onboarding status, last password-change time, second-factor enrollment/challenges, refresh sessions, recovery challenges, data-export state. Theme is currently browser-local; cross-device theme persistence is optional, not a database requirement established by code.

### Education, certificates and professional history

| Table | Fields and declared constraints |
| --- | --- |
| Education | EducationId; UserId INT! FK Users with cascade; StartDate DATE; EndDate DATE; UniversityId INT! FK Universities; DegreeId INT! FK Degrees; SpecializationId INT nullable FK Specializations; InstituteId INT nullable FK Institutes. Migration removes UniversityName/Institute/Specialization/Degree text fields. |
| Universities | UniversityId; Name NVARCHAR(255)! UNIQUE; IsVerified BIT! default 0; LogoUrl NVARCHAR(500). |
| Specializations | SpecializationId; Name NVARCHAR(255)! UNIQUE; IsVerified BIT! default 0. |
| Degrees | DegreeId; Name NVARCHAR(100)! UNIQUE. |
| Institutes | InstituteId; Name NVARCHAR(255)! UNIQUE. |
| Certificates | CertificateId; UserId INT! FK Users cascade; CertificateName NVARCHAR(255)!; Organization NVARCHAR(255); IssueDate DATE; Url NVARCHAR(255) in creation SQL, but NVARCHAR(MAX) in ER diagram. No certificate logo field. |
| WorkExperience | WorkExperienceId; UserId INT! FK Users cascade; CompanyName NVARCHAR(255)!; Position NVARCHAR(255); StartDate/EndDate DATE; Description NVARCHAR(MAX). No existing route or wired editor. |

There is no University→Institute→Department→Specialization hierarchy in SQL, although UI selects imply related academic concepts. University and specialization verification flags suggest controlled/unverified references but no verification workflow is defined.

### Lecturer data and official registries

| Table | Fields and declared constraints |
| --- | --- |
| Lecturers | LecturerId; UserId INT! UNIQUE FK Users cascade; DepartmentId INT! FK Departments; ProfessionId INT! FK Professions. Migration replaces Department/Profession text fields. |
| Departments | DepartmentId; Name NVARCHAR(255)! UNIQUE. |
| Professions | ProfessionId; Name NVARCHAR(150)! UNIQUE. |
| AlumniRegistry | AlumniRegistryId; FirstName/LastName NVARCHAR(100)!; DiplomaNumber NVARCHAR(100)! UNIQUE; StudyStartDate/StudyEndDate DATE!; CHECK start ≤ end; SpecializationId nullable FK Specializations; ImportedAt DATETIME2! default SYSDATETIME(). No UserId or email. |
| LecturerRegistry | LecturerRegistryId; Email NVARCHAR(255)! UNIQUE; DepartmentId nullable FK Departments; ImportedAt DATETIME2! default SYSDATETIME(). No UserId, profession or verification/claim history. |

Users↔Lecturers is zero-or-one lecturer row per user. A FK does not force a lecturer role to have a row or prevent a graduate from having one. These role/subtype rules need transactional enforcement. Lecturer department from official registry and mutable profile department need a clearly defined authority relationship.

### Announcements

| Table | Fields and declared constraints |
| --- | --- |
| Posts | PostId; UserId INT! FK Users cascade; Title NVARCHAR(255) nullable; Content NVARCHAR(MAX)!; CreatedAt DATETIME2! default SYSDATETIME(); SphereId nullable FK Spheres; PostTypeId nullable FK PostTypes. Migration drops text Sphere/PostType. |
| Spheres | SphereId; Name NVARCHAR(150)! UNIQUE. |
| PostTypes | PostTypeId; Name NVARCHAR(100)! UNIQUE. |
| PostComments | CommentId; PostId INT! FK Posts cascade; UserId INT! FK Users without cascade; Content NVARCHAR(MAX)!; CreatedAt DATETIME2! default SYSDATETIME(). |

Post author is a user, not a department or organization. There is no job-application, CV, employer, salary, deadline or structured vacancy table; applications and deadlines appear inside HTML/free text. Category codes `job`, `internship`, `training` require mapping to PostTypes.Name/ID. Sphere is a separate classification; it is not equivalent to category.

### Forum

| Table | Fields and declared constraints |
| --- | --- |
| ForumTopics | TopicId; UserId INT! FK Users without cascade; Title NVARCHAR(255)!; Content NVARCHAR(MAX)!; CreatedAt DATETIME2! default SYSDATETIME(). |
| ForumReplies | ReplyId; TopicId INT! FK ForumTopics cascade; UserId INT! FK Users without cascade; Content NVARCHAR(MAX)!; CreatedAt DATETIME2! default SYSDATETIME(). |
| ForumReplyLikes | Composite PK (UserId, ReplyId); UserId FK Users without cascade; ReplyId FK ForumReplies cascade; CreatedAt DATETIME2 default SYSDATETIME(), nullable. |

UI implies professional classification (`major`), reply totals, author names/dates, and newest/oldest/most-helpful sorting. Reply and like counts can be derived; no major FK exists. There is no ParentReplyId or topic-follow/subscription table: discussions are **flat**, despite README claims of threading. Reply buttons currently focus the composer without parent identity. Topic likes, bookmarks, moderation status and edit timestamps are not established schema features.

### Chat

| Table | Fields and declared constraints |
| --- | --- |
| ChatRooms | RoomId; IsGroup BIT! default 0; CreatedAt DATETIME2 default SYSDATETIME(), nullable. No title, creator or owner. |
| ChatParticipants | Composite PK (RoomId, UserId); both FKs have cascade; JoinedAt DATETIME2 default SYSDATETIME(), nullable. |
| ChatMessages | MessageId; RoomId INT! FK ChatRooms cascade; SenderId INT! FK Users without cascade; EncryptedContent NVARCHAR(MAX)!; SentAt DATETIME2 default SYSDATETIME(), nullable. |

No FK requires SenderId to be a participant in RoomId. No direct-pair uniqueness, room roles, attachment storage, mute/block state, read receipts, presence, per-user deletion or message edit/delete metadata exists.

Commented-out **inactive** schema proposals:

- EncryptedRoomKeys: composite (RoomId, UserId), EncryptedKey VARBINARY(MAX)!, cascading room/user FKs.
- UserPrivateKeyBackups: UserId PK/FK cascade, EncryptedPrivateKey VARBINARY(MAX)!, CreatedAt default timestamp.

These tables are neither created nor present in the normalized diagram. Even if enabled, they do not specify an encryption protocol.

## Business rules and feature requirements

### Authentication and account lifecycle

Evidenced HTTP client behavior expects bearer accessToken and credentialed refresh requests. A refresh cookie is implied, but its name/security flags/expiration and token format are unspecified. Successful login must not issue fully authenticated access before any required second factor is satisfied. `/auth/me` must return the authenticated principal from server state, not a selected localStorage ID.

Derived data constraints:

- Passwords are verified against secure password hashes; synthetic `hash1`, `hash2`, etc. are invalid credentials. PasswordHash and challenge/session secrets never enter user DTOs.
- Recovery and second-factor challenges need subject, purpose, expiration, attempt/resend controls and consumed/revoked state. Browser six-digit inputs and a 60-second resend timer are UI hints, not server policy.
- A password reset needs server-verifiable authorization bound to the account and recovery challenge. The current `{email,code,newPassword}` helper lacks any defined challenge/proof lifecycle; `/verify-code` success must not make email alone sufficient for reset.
- Refresh sessions need expiry/revocation and defined invalidation after logout, password reset, deactivation or deletion. Exact rotation/multi-device policy is open.
- Email changes require current credential verification and verified ownership of the replacement address, with university eligibility rules reapplied as appropriate.
- Password changes require current password verification and server-side new-password validation. UI strength rules are inconsistent: minimum eight characters plus uppercase/digit/special in strength display, weaker submit logic elsewhere. Final policy is open.
- Settings promises reversible deactivation and irreversible deletion. There is no account-state field or deletion policy. Define login/reactivation behavior, data retention and dependent-record handling rather than reporting fake success.

### Profiles and education

Users need identity fields, professional headline/specialization, biography, avatar/banner, education, certificates, role-specific academic affiliation and personal post history. Owner writes and public reads must have separate visibility projections. Whether a closed profile hides all fields or only details is open. Display-email preference is separate from login email.

Education needs distinct institution, institute, degree and specialization references even though UI combines degree/specialization into one string. Free-text creation versus selecting managed IDs is unresolved. If free text can introduce lookup values, verification flags, duplicate normalization and edit authority must be specified.

Education start/end order must be valid; null end means ongoing where allowed. Frontend uses year inputs on onboarding and month inputs on profile, SQL stores dates. Define precision and conversion explicitly; do not fabricate a real graduation day from year/month input. Registry dates are official full dates and should remain distinguishable from user-entered profile dates.

Certificate names must be nonempty despite optional UI inputs. Certificate URLs must be validated and safely exposed. Images require real upload/storage/URL contracts and file type/size constraints; FileReader previews are not uploaded assets. Certificate logos shown by fixtures have no table column; default/derived logo versus stored custom logo is open.

### Announcement feed

- Persist title, rich HTML body, author, type, optional sphere and server timestamp. UI requires title/body even though SQL allows null title. Treat author ID as authenticated identity, never a trusted request field.
- Types shown are job/internship/training. Required code↔lookup mapping is currently undefined; lookup IDs must not be confused with frontend fixture IDs.
- Owner publication history and general feed share Posts. Users need create/read/update/delete and comments; no role-exclusive posting restriction is evidenced.
- Comments are plain text in current forms and stored as Content; identify comment and post separately. Ownership and parent-post association are required on mutations.
- Feed includes author projection and nested comments. Ordering, limit/pagination and whether full comments or count/preview are returned need a bounded contract. API must not derive durable IDs from array lengths.
- Rich content requires a defined allowlist/format; arbitrary script/handlers/unsafe URL schemes cannot be accepted as trusted HTML. Plain titles, names and comments must remain plain text even when rendered near rich HTML.

### Forum

UI frames the forum as work, careers, professional development and collaboration; the report speaks more broadly about discussions. Resolve scope before introducing content moderation rules.

Persist topics/replies, authenticated authors, timestamps and helpful reply likes. One user can like a reply once, enforced by composite PK; unliking reverses that relation. Newest/oldest/popular sorting must define stable tie-breaking. Topic counts, role display and likes are derived from joins, not stored author copies.

Major codes are `informatics`, `mechanics`, `electronics`, `civil`, `energy`, `management`; select whether these map to specialization, sphere or their own classification. No current schema or API response commits to one. Topic subscriptions and nested replies would require additional defined data if adopted; they are not established frontend contracts.

### User discovery and visibility

Search is for graduates/lecturers by personal data, institute, specialization and graduation year (report pages 4–5, `search.html`). Result cards need durable user ID, name, avatar, academic details and profile navigation. q is the only declared query parameter; filter names, combinations, pagination and sorting are unspecified.

Graduation-year filtering must derive from an identified education/registry graduation record, not indiscriminately match any EndDate. People can have several education entries, so the authoritative university record is an open decision. Results must avoid duplicate users from joins and respect profile visibility, inactive/deleted state and email-display policy. Official registry records must not become a public directory.

### Direct and group messaging

Both direct and group communication are evidenced by the report and ChatRooms.IsGroup, although the UI only simulates contacts. Persist rooms, participants and messages. Each read/send/list operation must authorize membership; access to one room must not reveal another room's history.

Derived/open invariants:

- Direct rooms normally have two distinct participants; define self-chat, uniqueness of user pairs and duplicate-room behavior. Group naming, membership administration, invitations and participant limits are unspecified.
- Participant changes and message writes require consistent transactions. Define access to messages before joining/after leaving; JoinedAt alone does not establish this policy.
- UI shows text, image attachments, timestamps, contact snippets, unread badges and status labels. Attachment metadata, read state and presence have no schema or contract. Do not claim delivered/read/online behavior without authoritative state.
- Menu exposes delete conversation, block user and mute notifications. Specify per-user hiding/deletion versus deleting room history for everyone; blocking direction/scope; per-room versus global muting. All are currently UI-only.
- Real-time delivery is intended by product descriptions but no socket/SSE/polling mechanism or event protocol is implemented. Ordering, reconnection, duplicate sends and delivery acknowledgements need contracts independent of transport choice.

**Encryption decision is mandatory and unresolved.** EncryptedContent suggests ciphertext storage, but chat UI handles plaintext and has no key generation, cryptographic calls or encrypted envelope. Define whether the goal is server-managed encryption or end-to-end encryption. If E2EE is chosen, algorithm/version, nonce/authentication tag, participant public keys, room-key distribution, key rotation, recovery/backups, multi-device access and attachment encryption must be specified; plaintext search/previews/exports may conflict with it. A column name and commented key tables are not proof of encryption.

### Settings and notifications

Persist IsProfilePublic, LanguageId, TwoFactorEnabled and four notification preferences where enabled. UI language options are hy/en/ru; SQL migration seeds hy/en only. Adding ru versus removing the option is unresolved. Preferred language does not imply translated content exists.

Notifications target new announcements, replies to the user's topics and direct messages, with a separate email switch. Preferences exist, but notification events, subscriptions, delivery records, read state and scheduling do not. Define recipient scope for new posts, whether email-off suppresses only email or all notifications, and interaction with room mute/block and inactive users. SQL nullable preference bits need an explicit null/missing-row default policy.

Data export and account deletion must include a defined data scope and authorization; export must exclude passwords, token/challenge material and other users' private data. Local cache clearing is a browser feature and has no established backend route.

## Existing HTTP expectations and DTO boundaries

All declared routes are relative to `http://localhost:3004`; no `/api` prefix. Requests use JSON unless multipart is named. None have a tested backend contract. Below is the full route surface implied by source, including mocked/commented calls.

| Route family | Existing method/path expectations | Data and response constraints |
| --- | --- | --- |
| Auth | POST /auth/register, /auth/login, /auth/logout, /auth/refresh, /auth/forgot-password, /auth/verify-code, /auth/reset-password; GET /auth/me | Register: email/password/firstName/lastName. Login: email/password → accessToken. Refresh: {} + cookie → accessToken. Forgot: email. Verify: email/code. Reset: email/code/newPassword. Me body shape unspecified. Logout sends no body. |
| Onboarding | PUT /users/profile | Declared multipart; current caller sends {}. Field/response contract missing. |
| Profile | GET /users/{userId}; PUT and DELETE /users/me | Mutable profile DTO unspecified; public fixture is described below. /users/profile and /users/me overlap. |
| Profile media | POST /users/me/photo; POST /users/me/banner | FormData file fields photo/banner respectively; URL response field unspecified. |
| Education | GET and POST /users/me/education; PUT and DELETE /users/me/education/{id} | UI writes institution/degree/startDate/endDate strings; create consumer checks body.success. Needs normalized reference/ID/date resolution. |
| Certificates | GET and POST /users/me/licenses; PUT and DELETE /users/me/licenses/{id} | Owner forms: name/organization/issueDate/credentialUrl; no enforced response shape. |
| Announcements | GET /posts, /users/me/posts, /users/{id}/posts; POST /posts; PUT and DELETE /posts/{id} | Feed write: title/content/category; list body is Post[]. Feed create expects body = Post. |
| Comments | GET and POST /posts/{postId}/comments; PUT and DELETE /posts/{postId}/comments/{commentId} | Create sends text; GET body is Comment[]. Feed POST expects bare Comment; profile/public expects {success:true,data:Comment}. |
| Forum | GET and POST /forum/topics; GET, PUT and DELETE /forum/topics/{id} | Form implies title/major/content; wrapper bodies/responses unspecified, no page invokes them. |
| Search | GET /search?q={encodedQuery} | Body unspecified, no actual consumer; no existing filter params. |

No route names exist for chat, forum reply/like mutations, eligibility checks, 2FA challenge/enrollment, settings, notification events, work experience, export, deactivation or reference data. Their operations are requirements; future agents must not present guessed paths as existing contracts.

### Read models and naming reconciliation

Frontend public-profile fixture: `id, name, jobTitle, description, avatar, cover, education[], licenses[]`. Education entries contain `institution, degree, logo, startDate, endDate`; certificate entries contain `title, issuer, date, logo, credential`. A public lookup currently returns the bare object instead of Axios's response wrapper.

Post read model: `id, title, content, category, createdAt, author:{name,avatar}, comments[]`. Comment read model: `id, text, createdAt, author:{name,avatar}`. Some fixture comments omit id; durable APIs must supply it. Author identity is absent from fixtures but needed for profile links and permissions. Current profile/public card counts are hardcoded and cannot be authoritative.

Required adapters/contract decisions:

| Concept | Storage / frontend difference |
| --- | --- |
| Full name | Users stores FirstName/LastName separately; display combines them. Inline editor submits no HTTP and calls the full-name field name. |
| Professional headline | UI jobTitle or title versus Users.Specialization; mapping needs a semantic decision. |
| Biography/media | About→description; ProfilePhotoUrl→avatar; CoverPhotoUrl→cover. |
| Certificates | CertificateName/Organization/IssueDate/Url versus owner name/organization/issueDate/credentialUrl and public title/issuer/date/credential. |
| Comments | Content versus text. |
| Post types | PostTypeId versus category code; display Name alone may be localized and unsuitable as stable code. |
| Roles | graduate/lecturer versus UI teacher; no canonical mapping enforced. |
| Dates | DATE versus UI YYYY, YYYY-MM and malformed fixture dates; timestamps need explicit zone. |
| Envelopes | Arrays/bare objects versus {success,data}; current consumers disagree. |

Specify success/error envelopes, validation-error details, status codes, 401 versus 403 behavior, not-found visibility policy, stable IDs, filtering/pagination, null semantics, update replacement versus partial-update behavior and timestamp precision. These are open contracts, not details established by the current code. Registration anticipates 409 for duplicate email, and refresh is triggered on 401; no other consistent status semantics exist.

## SQL integrity, deletion and operational constraints

### Deletion graph

Users deletion cascades to Education, Certificates, WorkExperience, UserNotificationSettings, Posts, ChatParticipants and Lecturers. Posts deletion cascades to PostComments; ForumTopics deletion cascades to ForumReplies, then ForumReplyLikes; ChatRooms deletion cascades to participants/messages.

However, user references from **PostComments, ForumTopics, ForumReplies, ForumReplyLikes and ChatMessages are non-cascading**. Any surviving reference can block physical user deletion. Removing a user from a room does not remove their sent messages or room. Settings promises “delete account and all data,” which is not guaranteed by these FKs. Define retained/anonymized versus deleted discussion/chat content and ordering/atomicity of associated changes; do not add broad cascades blindly.

### Schema scripts are not a deployment-ready specification

1. Creation SQL declares AlumniRegistry→Specializations and LecturerRegistry→Departments before those reference tables exist in that file. Migration creates the references but expects pre-existing Education/Lecturers/Posts/Users. There is no clean single execution order for the two entire files against an empty database without resolving the split.
2. Migration uses CREATE/ALTER/DROP without existence checks, version tracking or a surrounding transaction; rerunning is not safe. Empty, unmapped or null source values can fail UniversityId/DegreeId/DepartmentId/ProfessionId/RoleId/LanguageId NOT NULL conversions.
3. Original Users.Language has a default constraint; dropping that column may require separately removing its default constraint, which the migration does not do. The normalized RoleId/LanguageId columns do not inherit original text defaults.
4. Synthetic/post seeds reference original Role/Language and Sphere/PostType columns, so they do not work unchanged after normalization. Fixed numeric FK IDs assume a particular seed state. Fake password hashes must never authenticate.
5. Except AlumniRegistry dates, there are no date-order CHECKs. NOT NULL on Content does not reject blank text/HTML. Lookup names/emails/diplomas need deliberate normalization and collation semantics; declared uniqueness alone does not specify application matching rules.
6. Most FK columns have no explicitly declared supporting indexes beyond PK/unique constraints. Queries imply reads by author, topic, post, room and chronological order; indexing/performance requirements must match bounded pagination and data volume, neither of which is currently specified.
7. Certificate Url differs between creation SQL (255) and diagram (MAX). The report's relationship prose sometimes implies required classification while migration leaves post SphereId/PostTypeId nullable. SQL is evidence for declared nullability, not resolution of intended product rules.

### Registry import contract and limitations

`import_alumni.py` reads an Excel workbook (`Avartakan.xlsx` default, not present), sheet by index/name, header row index 2. It expects mapped Armenian columns for surname/first name/patronymic, admission date, graduation date, diploma series/number and specialization. It uses pandas/openpyxl/pymssql, inserts official registry records, creates missing specializations with IsVerified=0, skips existing diploma numbers and commits imports.

It normalizes specialization names by removing parenthesized codes, collapsing whitespace and lowercasing; strips a trailing parenthesized year from diploma identifiers; splits surname then first name and discards patronymic; parses day-first dates or an extracted date token. Missing diploma/dates are skipped. These are operational assumptions, not a validated university feed contract. A one-token name causes an index error; fallback dates are not fully validated before insert; missing columns cause an explicit exit, while unexpected row/name shapes still require stronger validation. Import provenance, audit/approval, correction policy and registry data access are unspecified. The script uses local SQL Server configuration and is not part of a backend service.

## Security, consistency and open decisions

Derived constraints tied to evidenced features: parameterized SQL; server-side ownership/membership/visibility enforcement; validated limits for all inputs and uploads; safe rich-content handling; credential/session revocation; transactionally consistent registry claims, role/subtype rows, room membership and likes. Client flags, display names, fixtures and DOM counts must never serve as authority.

Credentialed cross-origin requests require a defined allowed frontend origin and cookie policy; static port 8000 and API port 3004 are separate origins. Production API/asset URLs and HTTPS configuration are unspecified. No versioned secrets/configuration contract exists; the import script's `sa` placeholder is not an application DB-access model.

Unresolved specification decisions to carry forward (not an implementation plan):

- Exact university email allowlist and alumni exceptions; how registry eligibility and email ownership are proven; claim cardinality, pending state and failed-match handling.
- Canonical roles and permissions; whether 2FA is mandatory; second-factor method, challenge lifecycle and token issuance; password/session/reset policy.
- Public/member access, closed-profile semantics, displayed email, blocked/deactivated user visibility and data retention/export.
- Canonical DTO/envelope/error shapes and `/users/profile` versus `/users/me`; lookup IDs/codes and free-text reference creation; profile headline meaning; date precision/time zone.
- Forum classification, flat versus nested replies and notification subscriptions; genuine university events versus announcement posts.
- Direct/group room rules, delivery/history/read/attachment contracts, encryption model and keys, blocking/muting and deletion scope.
- Missing account/security/notification/media state, lecturer and alumni verification links, certificate URL length and language coverage.
- Actual authoritative database version: locally supplied SQL, diagram, report and unexamined backup must not be assumed identical.

These gaps should remain visible to future agents. The frontend documents an intended user experience, but backend specifications must not copy its authentication bypasses, mock response IDs or simulated success into trusted business behavior.
