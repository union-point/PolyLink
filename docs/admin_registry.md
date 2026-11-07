# Admin registry services

This delivers the manual registry-service phase of the [admin plan](admin_panel_implementation_plan.md), under the [approved decisions](admin_panel_decisions.md). Registry management screens and mock management providers belong to the subsequent admin-interface phase. Excel import and a general admin action log are outside this version.

## API

All routes below require a current enabled admin session. Member bearer tokens, enrollment cookies and restricted admin challenges grant no access. Mutations require the admin session CSRF token and an allowed origin. All responses are `no-store`.

The prefix is `/admin/registries/{lecturers|alumni}`:

| Method | Request and result |
| --- | --- |
| `GET ?q=&cursor=` | Search names (including full name) and email/diploma. Returns up to 50 `items` in ascending ID order and nullable `nextCursor`. Literal `%`, `_`, `[` and escape characters do not become wildcards. Exact normalized identity matching supplements display substring search. |
| `GET /{id}` | One maintenance record or `404 NOT_FOUND`. |
| `POST` | Complete writable fields below. Returns the created record with status 201. |
| `PUT /{id}` | Complete writable fields plus current `version`. Returns the updated record/version. |
| `DELETE /{id}` | `{ "version": "…" }`; returns 204. |

Lecturer fields are `firstName`, `lastName`, `email`, `departmentId`. Alumni fields are `firstName`, `lastName`, `diplomaNumber`, `specializationId`, `studyStartDate`, `studyEndDate`. Names are required and limited to 100 UTF-16 code units; email is limited to 255 and diploma to 100. Surrounding whitespace is removed. Email uses the shared lowercase normalization. Diplomas preserve their display spelling. Control characters and malformed Unicode are rejected. Emails reject embedded whitespace and require a valid address, but the registry API does not impose a university-domain restriction. Ordinary enrollment still requires the exact Polytechnic domain and registry verification.

Reference IDs are positive decimal strings pointing to existing departments/specializations. Dates must be real full ISO dates (`YYYY-MM-DD`), with start no later than end. New/edited records cannot omit these fields. Extra fields—including IDs, import timestamps, linkage, hashes, roles and member information—are rejected.

Responses contain string `id`, the writable fields, opaque `version`, boolean `linked` and boolean `needsCorrection`. Existing incomplete lecturer names/departments remain null, visible and marked for correction; no names are fabricated. A linked record remains read-only even if it needs correction. Linked member IDs or private member details are never returned. Internal normalized keys/source hashes and import provenance are not exposed. Create/edit does not create education, member accounts or claims. Existing IDs and `ImportedAt` remain unchanged on edit.

Search is capped at 255 characters; cursors are authenticated and bound to the resource and trimmed query. Every read rechecks current admin enabled/session-version/expiry state. No registry search is exposed to members or the public.

Validation uses status 400 and field errors. Missing kinds/records use 404. Stable 409 conflicts include `DUPLICATE_EMAIL`, `DUPLICATE_DIPLOMA`, `RECORD_LINKED`, `VERSION_CONFLICT`, `REGISTRY_CONFLICT` (reference/FK race) and `REGISTRY_BUSY` (lock timeout/deadlock). SQL errors and dependent member data are never exposed. Clients must retain drafts and offer reload after a conflict; mutations are not retried automatically.

## V25 and registry identity keys

V25 is a transactional Java Flyway migration at `backend/src/main/java/db/migration/V25__registry_keys.java`. It locks both registries, computes keys with the same Java rules as admission, and detects normalized collisions before changing either table. Its error identifies the registry and conflicting IDs without logging identities. Empty normalized identities also require operator review. No record is silently merged, renamed, deleted or reassigned. Failure rolls back schema/data changes and leaves V24 intact.

The migration preserves display values, IDs, imports, claims, users, education and claim history. It adds database-maintained `AdminVersion`, normalized-identity digest (`EmailKey`/`DiplomaKey`) and `KeySourceHash`. Binary unique indexes replace the old collation-dependent raw email/diploma unique constraints. The raw columns retain their original display collation, but no longer decide identity equality.

`RegistryKeys` is the versioned contract: lecturer email uses Unicode strip + ROOT lowercase; diploma uses NFKC + Unicode whitespace collapse/strip + ROOT lowercase (`EnrollmentRules.text`). SHA-256 over the normalized UTF-16LE string gives a fixed binary index key. This supports the full normalization expansion of a 100-character diploma without truncation or an oversized SQL index. A digest collision fails closed as a duplicate; admission additionally compares normalized display strings and all other required fields after locking the candidate, so a hash match alone never proves identity.

`KeySourceHash` binds keys to the exact UTF-16LE display value through a SQL check constraint. A raw email/diploma change that forgets its key metadata fails rather than leaving an undiscoverable/stale identity. Privileged SQL operators can still supply arbitrary key data; supported writers must use the canonical Java helper. Normalization changes require an explicit forward migration, never an edit to V25 or the key contract.

All repository writers are updated: admin CRUD uses `RegistryKeys`; the one-shot synthetic seed and disposable browser fixtures use reviewed ASCII constants with matching hashes; JVM fixtures use Java keys. Historical migration fixtures write the old format before V25 and are backfilled normally. `TestSeedCommand` requires an empty database migrated through V25 and remains explicitly invoked. No machine-specific `db/` files are changed.

## Linkage and locking

`auth.RegistryClaims` is the canonical current linkage, through `LecturerRegistryId` or `AlumniRegistryId`. Its unique indexes and foreign keys remain intact. Retained claims for deactivated accounts still protect records. Historical `RegistryClaimAudit` rows are preserved but do not constitute an active claim after actual account deletion/release.

| Writer | Lock/check order and behavior |
| --- | --- |
| Admin create | Current admin account/session; normalized unique key/range; existing reference; insert. |
| Admin edit/delete | Current admin account/session; registry primary row; current database version; claim key/range; reject any link; uniqueness/reference checks for edit; write. |
| Enrollment submit/final verification | Member account/enrollment session; indexed candidate lookup; registry primary row; recheck current normalized identity, names, references/dates; claim key/range; create claim only during final verification. |
| Offline `AdmissionCommand correct` | Member account; old/new registry primary rows in ascending ID order, each followed by its claim key/range; recheck target existence/availability; move the claim with `CORRECT_OLD`/`CORRECT_NEW` audit entries. It remains restricted to already-admitted/deactivated accounts of the same role. |
| Account deletion/release | Existing member/lifecycle locks; append `RELEASE` audit; delete the current claim. Claim-row/range locks serialize release with admin checks. No panel operation moves or releases claims. |
| Pending enrollment expiry | Existing account/pending-state locks; delete drafts without manufacturing/releasing admitted claims. |

`RegistryLinks` owns the common primary-row-then-claim-range order. Enrollment initially locates a candidate without holding a competing unique-key update lock, then locks its primary row and rechecks its current data. An admin edit that commits first therefore changes the admission proof; deletion removes eligibility. If admission or correction commits first, admin mutation sees the link and fails. Serializable claim range checks also protect against concurrent direct FK-backed claim creation. Existing reference-service dependency scans serialize with registry inserts/updates. Local admin disable shares the admin-account lock, so it cannot commit between authorization and a registry write.

The offline correction command intentionally selects a target by operator-supplied ID; it does not rerun public registration proof. It locks/rechecks the current target and cannot steal another member's claim. Cross-workflow lock-order deadlocks remain possible; SQL Server rolls back a victim and the admin service returns a retryable conflict. No protection relies on a browser badge or preflight outside the transaction.

## Verification and rollout

`AdminRegistryIT` exercises both registries, validation, normalized duplicates/Unicode distinctions, bounded literal search, stale versions, member/admin isolation, CSRF/origin, disabled/expired admins, incomplete legacy records, provenance, retained/deleted claims, concurrent admins, and real SQL blocking races with enrollment and offline correction. Migration tests verify fresh/upgrade/repeat layouts, normalization collision rollback, full Unicode expansion, source binding and inventory drift rejection.

Use the normal local environment and private disposable SQL administrator credentials:

```sh
./backend/mvnw -f backend/pom.xml verify
npm test --prefix tools/contracts
bash tools/local/test.sh --admin
bash tools/local/test.sh --full
```

V25 is applied explicitly through `SchemaCommand`, never on startup and never automatically to the working database by these tests. Back up and rehearse on a restored copy before rollout. Inspect reported collision IDs and resolve them deliberately before retrying an upgrade. Keep the admin feature disabled for general use until the remaining interface and complete rollout gates pass.
