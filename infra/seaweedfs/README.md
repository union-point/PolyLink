# Private SeaweedFS storage

PolyLink uses the S3 API of SeaweedFS **4.52**, pinned by multi-architecture digest. Master state, volume data/indexes, and the filer's LevelDB2 metadata all use bind mounts under the private local configuration directory. No application tables are added: V22 extends attachment metadata and retains avatar versions for upload/deletion work and immutable retry receipts.

The backend authorizes every operation. Messenger objects contain the exact browser ciphertext; image keys, names, MIME types and nonces remain in encrypted message content. Avatars retain server validation and JPEG normalization and are unencrypted. Neither browser code nor SQL stores an S3 URL. Backend avatar paths are relative and authenticated; HTTP clients fetch them to blob URLs.

## Prepare and start

Run `bash tools/local/setup.sh`, then `source tools/local/env.sh`. Setup creates private storage state, TLS, credentials, a truststore retaining normal JVM roots, and the Compose template outside Git. It preserves existing keys and data. The default bucket is `polylink`; configure matching bucket-specific actions in private `storage/s3.json` before selecting a different bucket.

```sh
docker compose -f "$POLYLINK_STORAGE_COMPOSE" up -d
./backend/mvnw -f backend/pom.xml compile exec:java \
  -Dexec.mainClass=am.polylink.storage.StorageCommand -Dexec.args=init-bucket
```

`init-bucket` uses `S3_ADMIN_CREDENTIALS_FILE`; the backend uses only `S3_CREDENTIALS_FILE`. No root/cloud credential discovery is used. The runtime identity has bucket-scoped Read/Write/List, including object deletion, without bucket administration. Keep operator credentials outside application deployments; local setup stores them owner-only for local administration. Rotate identities in private S3 config and credential files together, then restart the filer/backend. Do not add anonymous identities or CORS/public policies.

Only TLS S3 is published, at `127.0.0.1:18333`. Master/volume/filer and their gRPC/admin ports have no host mappings. An internal network connects storage services; a separate gateway network allows Docker to publish the loopback TLS port. For a containerized backend, remove `ports` and join its container to the private gateway network with a certificate covering the endpoint hostname. Never expose filer/volume HTTP as a download shortcut. Docker host administrators are trusted administrative operators.

`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_CREDENTIALS_FILE` and `OBJECT_STORAGE_TEMP_DIR` configure the backend. HTTPS and explicit credentials are required. The JVM uses the setup truststore. `OBJECT_STORAGE_ENABLED=false` preserves the SQL compatibility path during rollout. Once S3 writes exist, disabling it is not a rollback. After SQL binary retirement, the backend refuses SQL-only startup.

## Offline migration and cutover

Use a disposable restore first. Stop **all** backend instances, scheduled workers and administrative writes. Take and verify a SQL safety backup and compatible OpenBao snapshot. Apply V22 using the existing explicit `SchemaCommand upgrade`; historical migrations are unchanged.

```sh
./backend/mvnw -f backend/pom.xml compile exec:java \
  -Dexec.mainClass=am.polylink.storage.StorageCommand -Dexec.args=migrate
./backend/mvnw -f backend/pom.xml compile exec:java \
  -Dexec.mainClass=am.polylink.storage.StorageCommand -Dexec.args=verify
```

`migrate` streams SQL bodies to deterministic migration keys, verifies full GET length/SHA-256, and marks each row ready only after success. Retry it after interruption. It preserves IDs, ciphertext and JPEG bytes and retains SQL bodies. Expired staged attachment rows become cleanup work, not newly accessible objects. A missing live body or hash mismatch stops migration. The verifier refuses legacy/incomplete uploads and checks every ready object; ETag is never treated as SHA-256.

Resolve expired unfinished requests offline with `StorageCommand abandon-uploads`, then `cleanup`. It only abandons attempts whose two-minute lease has expired; their operation IDs remain unusable. The browser must choose a new attachment/avatar operation after a definitive rejection. If an avatar's current version changed while its upload was in flight, refresh enrollment before retrying the user's selection.

Enable `OBJECT_STORAGE_ENABLED=true` in private `local.env` only after verification; source the environment again and start the matching backend. Verify messenger decryption, avatar views and own export. New S3 writes do not duplicate binary bodies into SQL. Never run an older backend against V22 avatar version rows.

Before cutover, retained SQL and the pre-migration backup permit SQL-only recovery. After S3 writes, repair/restore object storage with a compatible backend or restore an entire coordinated backup set. Do not restore SQL alone or silently fall back from a corrupt S3 object to old bytes.

Binary retirement is a separate explicit operator command, not an automatic Flyway migration. After a successful coordinated restore rehearsal, keep the resulting protected report in `STORAGE_RESTORE_REPORT`, stop writers, back up again and run:

```sh
./backend/mvnw -f backend/pom.xml compile exec:java \
  -Dexec.mainClass=am.polylink.storage.StorageCommand -Dexec.args=retire-sql-bodies
```

This requires a successful restore/Transit/deletion-ledger report and independently verifies every current object before transactionally dropping `AttachmentBodies` and avatar `Content`. A database extended property records retirement; schema validation accepts only complete retained or complete retired layouts. Keep the matching backend and S3 enabled. Historical SQL backups still contain bodies until retired under the backup retention policy.

## Lifecycle and retries

Uploads spool bounded ciphertext to private temporary files, calculate SHA-256, reserve immutable IDs in SQL, then PUT/read back outside SQL transactions. Each two-minute fenced lease has a unique key; each S3 operation has a 60-second deadline and at most three attempts. A late PUT cannot overwrite a newer attempt. Failed finalization leaves retry/cleanup work. A verified ready attachment binds to its message only in the existing send transaction; failed binding leaves it staged until its original 24-hour expiry. Existing 20-file/100-MiB pending quotas and rate limits remain.

Avatar operations include `operationId` and nullable `expectedPhotoId`. Matching retries return the current result. Replacements switch current pointers only after verification and a SQL comparison against the expected version. Deletes include `?expectedPhotoId=...`; stale replacements/removals cannot overwrite a newer avatar. Admitted viewers may read admitted avatars; pending enrollment sessions may read only their own. Anonymous and inactive viewers cannot read them.

Cleanup marks SQL state unavailable first and deletes objects afterward. Expiry, replacement, enrollment expiry, account deletion and deletion-ledger replay all retain durable deletion work. Deactivation denies access without erasing retained images; conversation hiding changes visibility without deleting shared objects. Every minute workers claim up to 100 deletion rows per table, retry with backoff and retain tombstones. Missing objects count as deleted. Hourly reconciliation lists only application prefixes, waits 24 hours after object modification and checks both tables before deleting unreferenced keys. SQL unavailability aborts reconciliation. No bucket-wide lifecycle expiry is configured.

S3 orphan scanning cannot see raw chunks left behind before filer metadata was committed. Monitor physical disk use separately: SeaweedFS vacuum reclaims deleted needles, while native `volume.fsck` diagnoses unreferenced chunks. Run native maintenance through `docker compose exec` as an operator in a stopped-writer window after a verified cold backup; review the pinned version's dry-run findings before enabling deletion. Do not automate force-purge fsck from SQL reconciliation or scan only one bucket/volume as if it covered all filer references. See the upstream [shell maintenance documentation](https://github.com/seaweedfs/seaweedfs/wiki/weed-shell).

Downloads authorize before opening S3 and stream through the backend with bounded buffers; export also requires its existing grant/owner checks. A request already authorized can finish during a later membership change. Temporary ciphertext files are deleted on completion; files older than a day are swept on startup. Do not share a spool directory between independently managed backend hosts.

Monitor `polylink.storage.failures` counters (operation tags only), backend storage errors, cleanup warnings, disk space, expired upload leases, deletion backlog (`StorageState='DELETE_PENDING'`, `Attempts`, `RetryAt`) and object-verification failures. Storage outages return retryable 503 errors, never successful empty reads. Request/response body capture must stay disabled.

## Coordinated backup

Use a maintenance window. Stop all backends/workers and freeze operator mutations and Transit key maintenance **before** generating the files below. Keep them stopped through packaging. Drain requests; use `abandon-uploads`/`cleanup` for expired incomplete attempts, replay the cumulative deletion ledger if applicable, and verify all ready objects.

1. Export `MessengerMaintenanceCommand export-deletions` into a protected cumulative ledger outside historical backups. Preserve its union across exports; never replace a newer ledger with one from a restored backup.
2. Generate a SQL Server `BACKUP DATABASE` with `COPY_ONLY,CHECKSUM`, run `RESTORE VERIFYONLY ... WITH CHECKSUM`, and copy the `.bak` out of Docker/server-local storage. Database provisioning/path/permissions remain machine-specific; use the existing database operator procedure.
3. Save an OpenBao Raft snapshot with an operator credential: `bao operator raft snapshot save /secure/staging/openbao.snap`. Retain all Transit versions needed by current SQL and supported older backups. Keep unseal shares/operator recovery credentials separately recoverable. Do not put root tokens or unseal shares in the bundle.
4. Run `StorageCommand verify` and save its JSON output as `inventory.json`. For machine-readable output, invoke the compiled main class directly with the Maven dependency classpath; do not mix Maven/log output into JSON files. The bundle manifest records the checkout commit; package from the deployed application commit.
5. Package the supplied captures and a cold copy of all SeaweedFS bind directories:

```sh
python3 tools/storage/backup.py pack --writers-stopped \
  --state "$POLYLINK_LOCAL_DIR/storage" --bundle /secure/backups/new-set \
  --sql /secure/staging/sql.bak --bao /secure/staging/openbao.snap \
  --ledger /secure/operator/deletions.json --inventory /secure/staging/inventory.json
```

The helper stops SeaweedFS, archives the complete `data` directory, writes checksums and a backup-set UUID, and leaves services stopped. The supplied SQL/Bao captures must come from this same stopped-writer window; the helper cannot infer whether external writers were stopped. Protect/encrypt the bundle using the organization's backup tooling and store it independently of the source disks. The manifest includes the application commit, compatible image versions and schema; it contains no credentials. Restart SeaweedFS and then the backend after packaging. A bind mount or Docker volume alone is not a backup.

## Restore and transfer to another Linux/macOS machine

1. Install the root README prerequisites and obtain the application commit matching the manifest. Keep the installation isolated. Restore/configure the recipient's SQL Server separately; do not commit machine-specific `db/` material.
2. Validate the bundle with `python3 tools/storage/backup.py validate --bundle /secure/backups/set`. Run setup in a **new** private local configuration directory to generate recipient configuration/certificates. Stop its containers and remove only its newly created empty storage data directories before unpacking; never overwrite existing data.
3. Run `backup.py unpack --writers-stopped --bundle ... --state "$POLYLINK_LOCAL_DIR/storage"`. It verifies checksums, refuses nonempty targets, rejects archive traversal/links, and restores files with private permissions under the recipient's ownership.
4. On Linux, run `backup.py repair-permissions --writers-stopped --bundle ... --state ...` if imported files have foreign UIDs. It changes only the selected storage data mount to the invoking UID/GID; Compose's private `.env` must use those same IDs. On SELinux hosts label only these private mounts for container access, according to local policy. Do not use `chmod 777`.
5. On macOS Docker Desktop, allow the selected private bind root under **Settings → Resources → File sharing** where required. Keep it on a local writable filesystem. The pinned image includes Linux amd64 and arm64; Docker Desktop supplies the Linux VM. Do not copy Docker Desktop's internal disk image as the handoff mechanism.
6. Restore SQL `.bak` using the recipient's machine-specific SQL procedure. Transfer the application `AUTH_HMAC_KEY` and `AUTH_REPLAY_KEY` through separate protected secret custody if retaining the restored authentication/challenge state; do not replace them accidentally with fresh setup values. Any intentional rotation must revoke affected sessions/challenges before reopening. Restore the matching OpenBao Raft snapshot through the operator CLI in isolation, using the supported snapshot-restore procedure and the required original protective/unseal state. A fresh OpenBao initialization/key is not a replacement. Unseal, issue a narrow backend token and install it in the recipient's private token file.
7. Install/rotate S3 identities and matching private backend credentials. Use issued certificates covering the recipient's endpoint; run setup to import the CA while retaining normal JVM roots. Restored filer metadata includes S3 administrative metadata: apply the private static identity config and verify old/anonymous credentials are denied after rotation. Configure SQL, S3 and OpenBao endpoints in private environment files, never SQL object references.
8. Recreate containers from the pinned templates, still without backend access. Replay the **latest external** deletion ledger with `MessengerMaintenanceCommand replay-deletions /secure/operator/deletions.json`, then run object cleanup. Do not expose the restored app before this succeeds.
9. Set `BACKUP_SET` to the manifest UUID and `DELETION_LEDGER_FILE` to that ledger. `StorageCommand restore-report` verifies ledger application, unwraps every retained SQL service copy with its original context (zeroing keys immediately), and fully hashes every ready object. Save its JSON privately. A missing/corrupt object, incompatible Transit state, or unprocessed deletion blocks the gate.
10. Start the backend only after successful verification. Check actual client-side message/image decryption, avatar authorization, replacement and export, then reopen traffic. Keep the original bundle until the restored installation and a new backup are verified.

## Acceptance

`python3 tools/m1/verify.py --storage` creates isolated SQL databases, TLS OpenBao/mail fixtures and the pinned SeaweedFS topology; it requires administrator SQL test credentials. It never migrates the working database. It runs avatar/ACL/lifecycle tests on real S3, failure injection across the SQL/object boundary, migration preservation/corruption tests, then a cold SQL/SeaweedFS/OpenBao restore, retained Transit-copy verification, deletion replay and SQL binary retirement against the disposable restore. The SQL test login must permit backup/restore into the SQL Server's default data directory.

Run `--storage --groups-only` to include the existing Chromium messenger encryption/group scenarios as well. Install pinned tools with `npm ci --prefix tools/m1` and `npx --prefix tools/m1 playwright install chromium`. Client checks use `npm ci --prefix tools/contracts && npm test --prefix tools/contracts`; archive safety checks use `python3 -m unittest discover -s tools/storage -p 'test_*.py'`.

Linux Docker verification does not substitute for an actual macOS transfer or production backup rehearsal. Record performed platforms and restore reports with release evidence.
