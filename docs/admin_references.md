# Admin reference services

This is the reference-service milestone of the [admin delivery plan](admin_panel_implementation_plan.md), following the [approved decisions](admin_panel_decisions.md). It does not deliver the management screens or registry CRUD. Keep the admin feature disabled for general rollout until the remaining integration gates pass.

## Schema and admission

V24 adds a SQL Server `rowversion` column named `AdminVersion` to the nine reference tables. It preserves existing IDs, names, codes, verification flags and consumers. Versions change on all SQL updates, including offline maintenance. Migrations remain explicit; startup does not migrate. The schema inventory validates the new columns on fresh installation and upgrade.

Enrollment resolves Polytechnic through V23's migration-owned `admin.SystemReferences` entry (`universities`, `polytechnic`). A display name or `IsVerified` flag on another university never grants admission. The university-domain and registry checks remain unchanged.

## HTTP contract

All routes require an enabled, current admin session. Member bearer tokens, enrollment credentials and restricted admin challenges cannot authorize them. Cookie mutations also require the session-bound CSRF token and allowed origin. Responses use `Cache-Control: no-store`.

Routes are under `/admin/references/{kind}`:

| Method/path | Contract |
| --- | --- |
| `GET ?q=&cursor=` | Up to 50 `items` in ascending ID order and a nullable `nextCursor`. Search matches literal substrings of names and, where present, codes. The cursor is authenticated and bound to the resource and trimmed query. |
| `GET /{id}` | One reference value or `404 NOT_FOUND`. |
| `POST` | `{ "name": "…" }`; coded resources also require `code`. Returns the created value with status 201. |
| `PUT /{id}` | `{ "name": "…", "version": "…" }`. Returns the updated value and new version. Codes are immutable. |
| `DELETE /{id}` | `{ "version": "…" }`. Returns status 204. |

Each item contains string `id`, `name`, opaque `version`, optional `code` and `protectionReasons`. Reasons are `SYSTEM_VALUE`, `REFERENCE_IN_USE` and/or `POST_TYPE_COMPATIBILITY`. They disclose no dependent records or user information. They describe the read snapshot; writes always recompute protection in their transaction.

Only the exact required fields are accepted. Clients cannot write verification flags, logos, protection metadata, eligibility or IDs. Names are trimmed, must be nonempty, reject control characters and follow the existing column limits. Codes use lowercase ASCII letters/digits with single interior hyphens and the existing column limits. Duplicate comparison follows the database's established collation. No reference hierarchy is introduced.

| Kind | Table/key | Name limit | Code limit | Incoming dependencies |
| --- | --- | ---: | ---: | --- |
| `universities` | `dbo.Universities.UniversityId` | 255 | — | `dbo.Education.UniversityId` |
| `institutes` | `dbo.Institutes.InstituteId` | 255 | — | `dbo.Education.InstituteId`, `auth.PendingEnrollments.InstituteId` |
| `departments` | `dbo.Departments.DepartmentId` | 255 | — | `dbo.Lecturers.DepartmentId`, `dbo.LecturerRegistry.DepartmentId`, `auth.PendingEnrollments.DepartmentId` |
| `specializations` | `dbo.Specializations.SpecializationId` | 255 | — | `dbo.Education.SpecializationId`, `dbo.AlumniRegistry.SpecializationId`, `auth.PendingEnrollments.SpecializationId` |
| `professions` | `dbo.Professions.ProfessionId` | 150 | — | `dbo.Lecturers.ProfessionId`, `auth.PendingEnrollments.ProfessionId` |
| `degrees` | `dbo.Degrees.DegreeId` | 100 | — | `dbo.Education.DegreeId` |
| `post-types` | `dbo.PostTypes.PostTypeId` | 100 | 16 | `dbo.Posts.PostTypeId` |
| `post-spheres` | `dbo.Spheres.SphereId` | 150 | 32 | `dbo.Posts.SphereId` |
| `forum-categories` | `dbo.ForumCategories.CategoryId` | 255 | 32 | `dbo.ForumTopics.CategoryId` |

The protected main university, three built-in post types and `other` sphere cannot be edited/deleted. Every post-type mutation, including creation or mutation of an offline-created custom type, remains explicitly rejected with `POST_TYPE_COMPATIBILITY` until the frontend compatibility phase is delivered. Other listed kinds support CRUD subject to usage and system protection.

Validation returns status 400 and `fieldErrors`. Missing resources/records return 404. Duplicate names/codes, stale versions, system values and in-use values return status 409 with `DUPLICATE_NAME`, `DUPLICATE_CODE`, `VERSION_CONFLICT`, `SYSTEM_VALUE` or `REFERENCE_IN_USE`. A database uniqueness/FK race has the fallback code `DUPLICATE_REFERENCE`/`REFERENCE_CONFLICT`; a deadlock or lock timeout returns `REFERENCE_BUSY`. No raw SQL error is exposed. Clients should retain drafts and offer a reload on conflicts; no automatic mutation retry is performed.

## Dependency and lock protocol

`ReferenceCatalog` owns all identifiers and the complete incoming dependency matrix above. No client input becomes a SQL identifier. All dependencies currently have foreign keys. Add any future consuming column to the catalog and concurrency fixtures before exposing its writes.

Each mutation runs in one transaction:

1. Lock and recheck the admin account, then its session, using the same account-first order as local disable and session rotation. Disable cannot commit between authorization and the reference write.
2. For update/delete, acquire `XLOCK,HOLDLOCK` on the reference row and compare its database version.
3. Hold the matching system-protection key/range and reject system values. Reject unsupported post-type mutations.
4. Check every incoming dependency with `HOLDLOCK` in catalog order. These serializable scans retain key/range locks through commit, including an empty result. Any retained consumer counts as use: deactivation, hidden posts and unfinished/expired-but-not-yet-cleaned enrollment drafts do not bypass protection.
5. For creation/rename, use `UPDLOCK,HOLDLOCK` on duplicate name/code checks, then write and commit. Names/codes remain subject to existing database constraints; forum-category name uniqueness is serialized by its name scan even though the legacy table has no unique name index.

This uses database range locking rather than adding a second application lock protocol to every consumer. Enrollment/profile education, lecturer records, registries, posts, forum topics and offline SQL/seed/maintenance writers all encounter the same physical dependency locks. The parent lock also serializes reference editors and FK checks. A consumer committed before the admin's check causes rejection; a consumer racing after a successful empty scan waits until the admin commits. Rename then precedes that new use; deletion causes the consumer's FK check to fail. An open form that loses an unused choice must reload its options while retaining its draft.

Existing enrollment, claim correction/release, account deletion and pending-expiry cleanup retain their own locking and auditing. They may delete or update dependent rows; the reference scans serialize with those changes. Incompatible multi-resource lock orders can cause a SQL Server deadlock; the victim rolls back and receives a retryable conflict. There is no general admin action audit log. Offline operators still have direct SQL authority and must review their own mutations; these protections enforce panel writes.

## Verification

`AdminReferencesIT` covers all supported resources, system values, the post-type release gate, payload allowlists, immutable codes, literal search/pagination, duplicate names/codes, version conflicts between distinct admins and after offline edits, credential/CSRF boundaries and disabled/expired sessions. A metadata assertion checks the complete foreign-key boundary. Dependency fixtures cover all mutable incoming paths, including pending enrollment. SQL lock-timeout checks attempt real concurrent inserts while the reference mutation holds its locks, a consumer-first race and local disable during a write.

Run the standard backend build and contracts, then the disposable admin suite using privately configured test-administrator credentials:

```sh
./backend/mvnw -f backend/pom.xml verify
npm test --prefix tools/contracts
bash tools/local/test.sh --admin
```

The admin runner includes migrations, reference services, identity, enrollment and the existing access-screen browser journey. Use `bash tools/local/test.sh --full` for the eventual complete rollout gate. No test applies V24 to the working database.
