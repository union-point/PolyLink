# PolyLink backend

Spring Boot 4.1.1, Java 25, and Maven 3.9.16 via Maven Wrapper.

## Requirements — Linux and macOS

- Install a full JDK 25 and set `JAVA_HOME` to that installation.
- Have SQL Server running and the `polylink` database available. Use your existing container on either platform. The backend does not start or manage containers.
- Optional Linux database setup and restore instructions: [../db/README.md](../db/README.md).

Run all commands below from `backend/`.

## Configure

On first setup only:

```sh
cp config/application-local.properties.example config/application-local.properties
```

Edit the ignored `config/application-local.properties` to match your SQL Server:

```properties
DB_HOST=localhost
DB_PORT=1433
DB_NAME=polylink
DB_USERNAME=sa
DB_PASSWORD=your-local-password
DB_TRUST_SERVER_CERTIFICATE=true
```

On macOS, use the host port published by your existing container. Keep its existing credentials and database; no container replacement or restore is required. Linux uses the same connection settings. `DB_TRUST_SERVER_CERTIFICATE=true` is for local self-signed certificates; use `false` with a trusted certificate. Environment variables with these names override local settings.

The backend reads this file with the `local` profile. It does not read `db/.env`.

## Build and run

```sh
./mvnw --version
./mvnw verify
./mvnw spring-boot:run -Dspring-boot.run.profiles=local
```

Health: [http://127.0.0.1:3004/actuator/health](http://127.0.0.1:3004/actuator/health). Other endpoints are denied by default. Explicitly enabling configured M1 exposes only the implemented auth/key setup and owner identity endpoints.

## Migrations

Migrations run explicitly, separately from application startup. `SchemaCommand` reads environment variables; it does **not** read `config/application-local.properties` or `db/.env`.

From `backend/`, configure the target and migration credentials, replacing the example values:

```sh
export DB_HOST=localhost
export DB_PORT=1433
export DB_NAME=polylink
export MIGRATION_DB_USERNAME='your-migration-user'
export MIGRATION_DB_PASSWORD='your-migration-password'
export DB_TRUST_SERVER_CERTIFICATE=true
```

Use `true` only for a local self-signed SQL Server certificate; use `false` with a trusted certificate. Match your existing container's host port on Linux or macOS. Migration credentials need schema-change permissions and are separate from ordinary runtime credentials.

Inspect the target without changing it:

```sh
./mvnw compile exec:java \
  -Dexec.mainClass=am.polylink.database.SchemaCommand \
  -Dexec.args=inventory
```

For an existing restored database, review its inventory against the [captured baseline](src/main/resources/db/inventory/legacy-schema.json), take a safety backup, and apply pending migrations:

```sh
./mvnw compile exec:java \
  -Dexec.mainClass=am.polylink.database.SchemaCommand \
  -Dexec.args=upgrade
```

The first `upgrade` checks the legacy structure before explicitly recording the V1 baseline and applying V2. Subsequent upgrades apply pending numbered migrations and validate checksums. A schema mismatch stops the command; reconcile it before retrying rather than bypassing the baseline guard. Run `upgrade` again after pulling new migrations.

For a new installation, first create an empty database, set `DB_NAME` to that database, then run:

```sh
./mvnw compile exec:java \
  -Dexec.mainClass=am.polylink.database.SchemaCommand \
  -Dexec.args=fresh
```

`fresh` refuses a nonempty database. It executes V1 and V2 without seeding users, credentials or messages. Use `upgrade` for subsequent changes. Neither starting Spring Boot nor starting/restarting the SQL Server container applies migrations.

To add a migration, create the next unused version under `src/main/resources/db/migration/`, for example `V3__describe_the_change.sql`. Coordinate version numbers before merging; do not edit already applied migrations. Verify with `./mvnw -Pdatabase-tests verify` using the test credentials below. See the [schema workflow](../docs/messenger/schema-and-migrations.md) for baseline details and transaction rules.

M0 migrations were verified only in disposable test databases, including a restore of the May backup. The working `polylink` database was left at its original 27-table schema. V2 adds the `auth`, `keyvault` and `messaging` structures when an explicit upgrade is run; it preserves the legacy tables and data.

## Tests

```sh
./mvnw verify                    # Formatting, HTTP/security tests, executable JAR; no DB required
./mvnw -Pdatabase-tests verify   # Full integration profile; use the M1 runner below
./mvnw spotless:apply            # Format Java sources
```

The JDBC probe uses the same local connection settings or environment overrides and a temporary table. Migration tests require `DB_TEST_ADMIN_PASSWORD` and optionally `DB_TEST_ADMIN_USERNAME` (default `sa`), with permission to create/drop disposable databases. M1 identity tests additionally require TLS OpenBao and a local SMTP capture service. From the repository root, use `python3 tools/m1/verify.py --browser` to provision those isolated dependencies, run the full profile, exercise real browser flows and clean up. Install the Node/browser dependencies first as described in the [M1 instructions](../docs/messenger/m1.md). Missing dependencies fail the profile rather than skipping acceptance. No working database is migrated by that runner.

Flyway startup remains disabled; Hibernate uses schema validation and domain entity mappings are not implemented yet. M0 includes a captured legacy baseline and additive messenger migrations. Run them explicitly with separate migration credentials using the [schema workflow](../docs/messenger/schema-and-migrations.md). Historical ignored SQL scripts are never run automatically. API/crypto contracts and remaining gates are in the [M0 handoff](../docs/messenger/README.md).

M1 authentication and backed-up client key setup are available behind `IDENTITY_ENABLED=true`. Configure the keys, mail and OpenBao prerequisites, apply V3, and issue email/role invitations using the [M1 deployment instructions](../docs/messenger/m1.md). Set `MESSENGER_ENABLED=true` to enable the M2 encrypted direct-text APIs and existing Search → Connect flow after completing M1. The frontend HTTP provider encrypts messages locally and maintains an encrypted persistent outbox. See [M2 deployment and acceptance](../docs/messenger/m2.md); `python3 tools/m1/verify.py --messenger` includes both messaging and the M1 browser checks. Account/history recovery is implemented in [M4](../docs/messenger/m4.md) and requires V5.

M3 requires explicit V4 migration before starting the new backend. It adds independent access-token records and atomic password changes while preserving vault/identity/service copies. Use **Settings → Password** and see [M3 session/password acceptance](../docs/messenger/m3.md). The complete disposable test run is `python3 tools/m1/verify.py --continuity` from the repository root.

M6 requires explicit **V7** migration. It adds user-created groups, owner/member controls, sequence-bounded membership intervals, own-message/image export and account deactivation/deletion. Use **Messages → Create group** or **Group members**. Existing encrypted groups receive deterministic ownership; legacy plaintext stays separate. Operator-only legacy group import and deletion-ledger replay are documented in [M6 deployment and acceptance](../docs/messenger/m6.md). Run `python3 tools/m1/verify.py --groups` from the root for the complete M1–M6 regression suite, or `--groups-only` for focused M6/M5 SQL and both M6 browser providers.
