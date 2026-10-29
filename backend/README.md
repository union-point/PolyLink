# PolyLink backend

Java 25, Spring Boot 4.1.1 and Maven 3.9.16 via the committed Maven Wrapper. The backend uses SQL Server with explicit JDBC transactions, SMTP and OpenBao Transit. Follow the [root quickstart](../README.md) for Linux/macOS setup and complete application startup.

## Configuration and startup

From the repository root:

```sh
bash tools/local/setup.sh
source tools/local/env.sh
export FORUM_ENABLED=true
(cd backend && ./mvnw spring-boot:run)
```

Setup preserves private configuration outside Git. Fill in existing SQL credentials in `$HOME/.config/polylink/local.env`, start the configured OpenBao/mail services and explicitly apply migrations before starting the backend, as described in the quickstart. Health is available at [localhost:3004/actuator/health](http://localhost:3004/actuator/health).

| Setting | Default / purpose |
| --- | --- |
| `DB_HOST`, `DB_PORT`, `DB_NAME` | `localhost`, `1433`, `polylink`; existing database target. |
| `DB_USERNAME`, `DB_PASSWORD` | Runtime SQL credentials; password has no usable default. |
| `DB_TRUST_SERVER_CERTIFICATE` | `false`; use `true` only for a local self-signed SQL certificate. |
| `IDENTITY_ENABLED` | `true` in application properties; requires HMAC/replay keys, mail, Transit and migrated schema. |
| `MESSENGER_ENABLED` | `false` in application properties; local setup enables it. Requires identity. |
| `FORUM_ENABLED` | `false`; enable explicitly after the historical backfill and schema prerequisites. Independent of messenger. |
| `POSTS_ENABLED` | `false`; enable after V21 and reviewed historical timestamps. Independent of forum/messenger. |
| `FRONTEND_ORIGINS` | `http://localhost:8001`; mutation origin boundary. |
| `SERVER_ADDRESS`, `SERVER_PORT` | `127.0.0.1`, `3004`. |

See [application properties](src/main/resources/application.properties) for SMTP, OpenBao and remaining settings. `source tools/local/env.sh` also configures the JVM TLS truststore; sourcing `local.env` directly is insufficient.

For a manually managed backend-only configuration, copy `config/application-local.properties.example` to ignored `config/application-local.properties`, edit it and run `./mvnw spring-boot:run -Dspring-boot.run.profiles=local` from `backend/`. This alternative does not provision mail, Transit, TLS or required secrets. Environment variables override local properties. Spring does not read `db/.env`.

See [posts API, notification settings and rollout](../docs/posts_implementation.md) for the admitted announcement/comment APIs and retained in-app history.

## Migrations

Current source includes **V1–V21**. Application startup never migrates: Flyway and SQL initialization are disabled, and Hibernate is configured for validation. Use migration credentials with schema-change permissions, separately from runtime credentials.

From the root, after loading the environment, set `MIGRATION_DB_USERNAME` and `MIGRATION_DB_PASSWORD`, then inspect the selected database:

```sh
./backend/mvnw -f backend/pom.xml compile exec:java -Dexec.mainClass=am.polylink.database.SchemaCommand -Dexec.args=inventory
```

Stop application access, verify a backup and use `-Dexec.args=upgrade` for an existing/restored database. The first upgrade validates the captured legacy structure before recording V1; later upgrades validate the versioned layout and checksums. Drift stops the command. For an already-created empty database use `-Dexec.args=fresh`; it refuses nonempty databases. Fresh migrations do not seed eligible user identities or usable credentials.

Historical forum rows require `upgrade --target=12`, an offline reviewed category/timezone backfill, then `upgrade`; V13 refuses unreviewed rows. See [forum migration operations](../docs/forum_implementation.md#existing-database-upgrade). V8/V9 remove obsolete plaintext chat and authentication fields and require a matching backend after migration. V14 introduces registry enrollment; V15 adds enrollment avatars. V16 removes retired import staging, invitations (including `PendingEnrollments.InvitationId`) and the legacy forum review log. V17 adds the enrollment institute reference, allows unknown education degrees and backfills verified graduate education. V18 adds staged posts reference/UTC/activity/settings changes; V19 gates canonical ordering on an offline timestamp review. V20 removes `CreatedAt` from Posts/PostComments/ForumTopics/ForumReplies and drops `auth.PostsLegacyReview`, retaining canonical UTC and edited timestamps. V21 clears references to retired post types, removes those types and makes both PostTypes/Spheres codes mandatory and unique. Post directions are selected with `sphereCode` in the matching API. This backend requires V21. Existing announcements/comments require `upgrade --target=18`, then `PostsMaintenanceCommand inspect/dry-run/apply` and final `upgrade`; see the [posts review runbook](../docs/posts_implementation.md#existing-database-upgrade-and-historical-review). See [schema workflow](../docs/messenger/schema-and-migrations.md) and [enrollment rollout](../docs/registry_enrollment.md).

`SchemaCommand` reads environment variables, including an explicit database target; it does not read local Spring properties or `db/.env`. Never bypass its baseline guard or rewrite applied migrations. Add the next unused migration under `src/main/resources/db/migration/` and verify fresh/upgrade paths in disposable databases.

## Verification

From the repository root:

```sh
./backend/mvnw -f backend/pom.xml verify
bash tools/local/test.sh
bash tools/local/test.sh --forum
bash tools/local/test.sh --posts
bash tools/local/test.sh --full
```

The first command runs formatting, database-free tests and executable JAR packaging. The normal local script also installs/runs client and contract dependencies. `--forum` runs focused disposable forum acceptance; `--full` runs combined SQL/OpenBao/mail/browser acceptance. See [local test tooling](../tools/local/README.md).

The Maven `-Pdatabase-tests verify` profile requires real SQL test-admin credentials and the configured TLS OpenBao/SMTP dependencies; missing prerequisites fail rather than skip acceptance. Prefer the local runner to provision isolated dependencies. Focused registry SQL and HTTP/mock browser checks use `python3 tools/m1/verify.py --enrollment` with the same test environment. From `backend/`, `./mvnw spotless:apply` formats Java.

## Contracts and limitations

- [Backend architecture](../docs/backend_design_context.md) maps implemented capabilities and migrations.
- [Registry enrollment](../docs/registry_enrollment.md), [settings/export](../docs/settings_backend.md) and [forum](../docs/forum_implementation.md) describe current APIs and operations.
- [Messenger handoffs](../docs/README.md#historical-implementation-evidence) retain security, lifecycle, migration and dated acceptance details.
- General profile/education/certificate/media mutations remain unavailable; an HTTP adapter route does not establish server support. Enrollment avatars are a separate implemented capability.
- M7 platform, restore and retention release checks remain outstanding. Test success in disposable databases does not establish the schema version of a running installation.

For focused posts SQL, SMTP, live and mock browser checks, run `bash tools/local/test.sh --posts` from the repository root.
