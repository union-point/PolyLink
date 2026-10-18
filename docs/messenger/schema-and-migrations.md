# Schema inventory and migration workflow

M0 baseline, 18 October 2026. Source: read-only SQL catalog inspection of the restored `polylink` database, SQL Server 17.0.5015.4, compatibility 160, collation `SQL_Latin1_General_CP1_CI_AS`. The [catalog query](../../backend/src/main/resources/db/inventory/legacy-schema.sql) and [metadata snapshot](../../backend/src/main/resources/db/inventory/legacy-schema.json) contain no row values, users' email addresses, password hashes or message bodies.

M1 follow-up: [invitation enrollment and real sessions](m1.md) add V3 and additional integration dependencies. V1/V2 and their historical validation below remain unchanged.

## Inspected legacy schema

There are 27 tables, no user views/procedures/triggers/functions/sequences. V1 reproduces their columns, collations, identity seeds, defaults, checks, primary/unique indexes and foreign-key actions. It preserves original generated constraint names so a different schema cannot silently pass as this baseline. `AlumniRegistry_Import` is a staging heap without a primary key. Legacy `Users.LanguageId` references `Languages.Id` (not a fabricated `LanguageId` primary key).

| Area | Tables |
| --- | --- |
| Accounts | Users, Roles, Languages, UserNotificationSettings |
| Profile | Education, Certificates, WorkExperience, Lecturers |
| Registry | AlumniRegistry, AlumniRegistry_Import, LecturerRegistry |
| Reference data | Degrees, Departments, Institutes, PostTypes, Professions, Specializations, Spheres, Universities |
| Publications/forum | Posts, PostComments, ForumTopics, ForumReplies, ForumReplyLikes |
| Legacy chat | ChatRooms, ChatParticipants, ChatMessages |

Existing chat tables have only primary-key indexes. They lack pair uniqueness, sequence cursors, personal state, encrypted attachments, cryptographic identities/vaults and deduplication. The [messenger specification](../messenger_spec.md) establishes that the 55 existing message bodies are plaintext fixtures despite the column name `EncryptedContent`. Legacy `datetime2` values have no verified timezone. Nothing in V1/V2 converts their dates, claims they are encrypted, deletes them or uses their fake password hashes for login.

Neither a `Users` row, its role nor `TwoFactorEnabled` proves active admission or verified email. V2 deliberately inserts no `auth.AccountSecurity` rows. M1 must implement an authoritative admission/email-enrollment process; the exact registry claim cardinality, proof and alumni exception policy remain general-account dependencies. Existing users cannot authenticate by treating legacy hashes as new server verifiers. Missing security state means no messaging authorization.

## Additive physical model

[V2](../../backend/src/main/resources/db/migration/V2__messenger_foundation.sql) creates separate capability schemas. No legacy table is altered. Keep encrypted messaging in `messaging` so legacy bodies cannot enter ciphertext endpoints through an accidental ORM mapping. `LegacyRoomId` is an optional, unique reference for an explicitly approved later migration.

| Logical state | Physical model / boundary |
| --- | --- |
| Principal, verifier and credential epoch | `auth.AccountSecurity`, one per legacy user; explicit admission, verified email, client derivation and separate server verifier. |
| Session family/revocation | `auth.Sessions` plus V4 `auth.AccessTokens`, hashed random credentials, credential version, independent access expiry and session idle/absolute expiry. Expiry formulas and family/version checks also belong in services. |
| Purpose-bound code/rate limits | `auth.EmailChallenges`, `auth.RateLimits`; code MAC secret and scope-hashing secrets stay outside SQL. Unknown-account challenge may have no UserId. |
| Historical public identities | `keyvault.Identities`, composite owner/version key; private keys exist only inside vault ciphertext. |
| Active vault/copies | `keyvault.Vaults`, independent vault-key version/content revision and current identity FK; JSON packets serialized as UTF-8 bytes. Transit ciphertext/context are retained separately. |
| Durable prepared transitions | `keyvault.Operations`, operation kind/state, expected independent versions, expiry, protected authorization, immutable fingerprint, ciphertext/verifier and completion result. No raw secret/password/vault key. |
| Rooms and unique pairs | `messaging.Rooms`, `messaging.DirectPairs`; ordered user pair PK, no self-pair, one pair per direct room. Services enforce room kind/two participants. |
| Membership/visibility | `messaging.Participants`, fixed continuous membership start, cutoff, read marker, hidden/mute; user-room lookup index. Rejoin intervals remain outside v1. |
| Personal direct blocking | `messaging.Blocks`; both directions checked for direct send only. |
| Room epochs and recipient envelopes | `messaging.RoomKeys`, `messaging.Envelopes`; composite room/version keys, complete canonical recipient snapshot, identity references. Complete membership/snapshot validation and a single active winner are transactional service invariants. |
| Sequenced bodies/results | `messaging.Messages`, `messaging.SendOperations`; clustered `(room,sequence)`, unique server message ID, unique sender/room/client operation and immutable fingerprint/result. Deleted bodies become null with a neutral retained position. |
| Private encrypted objects | `messaging.Attachments`; random storage object key, owner/room, length/digest, optional committed message sequence, unbound expiry index. Filtered uniqueness permits at most one image per message without limiting multiple staged uploads. |

New FKs use no automatic delete cascades. General-account deletion must deliberately remove bodies/files/security material and references while preserving required neutral positions; existing legacy non-cascading author FKs still apply. A later deletion/membership migration must implement safe group-key rotation. Prepared/transient uploads need expiry cleanup; send tombstones remain until account deletion. Vault updates use optimistic expected revisions, not last-write-wins.

## Running explicit migrations

The application still has Flyway disabled. Deployments must run the offline [SchemaCommand](../../backend/src/main/java/am/polylink/database/SchemaCommand.java) with separate migration credentials. It never runs at Spring startup, enables baseline-on-migrate or invokes clean. The helper uses the already pinned Flyway dependencies; it does not require another global Flyway installation.

From `backend/`, set `DB_HOST`, `DB_PORT`, `DB_NAME`, `MIGRATION_DB_USERNAME`, `MIGRATION_DB_PASSWORD`, and trusted JDBC TLS settings in the environment. The tool does not read local application configuration, does not default a target database, and does not accept credentials on the command line. Local self-signed SQL Server requires explicit `DB_TRUST_SERVER_CERTIFICATE=true`.

```sh
./mvnw compile exec:java -Dexec.mainClass=am.polylink.database.SchemaCommand -Dexec.args=inventory
./mvnw compile exec:java -Dexec.mainClass=am.polylink.database.SchemaCommand -Dexec.args=fresh
```

`inventory` is read-only and prints metadata. `fresh` requires an empty database, executes V1 then V2 and validates checksums. It seeds no data or credentials. The DBA creates the empty database first. Use the inspected collation for consistency; V1 explicitly declares legacy string collations.

For an existing restored database, first compare the inventory against the snapshot and take an independent safety backup. Then use:

```sh
./mvnw compile exec:java -Dexec.mainClass=am.polylink.database.SchemaCommand -Dexec.args=upgrade
```

Without history, `upgrade` verifies exact legacy structure and rejects unexpected tables/objects before explicitly baselining at V1 and applying V2. With history, it rechecks legacy structure, runs unapplied migrations and validates checksums. Equivalent schemas with different generated constraint names require deliberate reconciliation, not an automatic baseline. Do not use `flyway baseline`, `baselineOnMigrate=true`, `clean` or Hibernate schema generation to bypass the guard. Migrations are immutable after acceptance; add a subsequent version for changes.

Ordinary runtime DB credentials need only required application permissions. Migration/test-admin credentials are separate from runtime configuration. Test administrators need permission to create/drop databases; production application users do not. Historical ignored scripts are not part of this deployment path.

## Transaction and lock contract

For a mutation, discover the involved accounts, acquire security-row locks in numeric user order, then room locks in room-ID order, then dependent rows. Recheck membership after discovery; restart if its snapshot changed. A room send validates admission, direct blocks, membership, key snapshot and current credential/session versions under those locks. Identity activation/blocks/account lifecycle use the same account-before-room order. Never call OpenBao/mail/object storage while holding SQL locks; prepare external work first and recheck all expected versions at commit.

Allocate the next room sequence by incrementing `Rooms.LastSequence` inside the message transaction and retain its room lock until commit. SQL identity allocation alone is not a commit-order guarantee. The authorization → existing operation/fingerprint → fresh-version check ordering is mandatory: an already saved operation is returned even after key rotation if the current caller can access its result. One transaction records message, attachment binding, dedup result and counter. A competing original request must resolve before a definitive unsaved reply. Bounded deadlock retries reuse the same operation and bytes.

Read uses a monotonic accessible sequence; hide records the current committed sequence and only changes the caller's visibility. Key activation compares all current recipient identity versions and membership revision. Recovery commit activates auth/vault/copies/identity and revocation atomically, without network calls. The constraints establish durable identities and references; service transaction/race tests are required in M2/M4 before exposing those APIs.

## Validation and remaining gates

`./mvnw -Pdatabase-tests verify` now requires `DB_TEST_ADMIN_PASSWORD` (and optionally `DB_TEST_ADMIN_USERNAME`, default `sa`) in addition to the existing JDBC probe's connection settings. Migration tests create their own uniquely named `polylink_m0_…` databases and drop only those databases in finally blocks. They test fresh migrations, structural equivalence, repeat migrate/validate, nonempty-schema refusal, guarded upgrade with retained synthetic plaintext and rejection of drift. Missing credentials/dependencies fail the profile; no H2 substitute or silent skip is used.

CI runs the same profile with an ephemeral SQL Server. The local restored database is inspected read-only; migration acceptance against the actual May backup is performed in a separate disposable restore, never by migrating the working `polylink` database. The [M0 status](README.md) records actual evidence and remaining M1/M6 gates.

Migration semantics follow the official [Flyway baseline](https://documentation.red-gate.com/flyway/reference/commands/baseline) and [SQL Server support](https://documentation.red-gate.com/flyway/reference/database-driver-reference/sql-server-database) documentation: baseline skips migrations through that version; fresh install executes V1, restored upgrade explicitly records V1 before V2.

V5 adds hashed, purpose-limited recovery authorizations and email-address snapshots on new challenges. Existing vaults, identities, sessions and chat data are retained. Older in-flight recovery codes without an email snapshot must be requested again. See [M4](m4.md).

V6 adds `messaging.AttachmentBodies` for private binary ciphertext storage. Expired unbound bodies are removed while attachment UUID/digest tombstones remain immutable. Bound objects share message transactions and SQL backup coverage. Existing messages, identities and personal cutoffs are retained. See [M5](m5.md).

V7 adds group metadata, durable group-operation receipts, current/historical membership intervals and the account-deletion ledger. Existing encrypted group owners are the lowest admitted, verified participant IDs; ownerless groups close. Personal state, direct-pair mappings, ciphertext and envelopes remain intact. Legacy plaintext is retained separately. See [M6](m6.md) for explicit import, lifecycle and restore replay commands.
