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

Health: [http://127.0.0.1:3004/actuator/health](http://127.0.0.1:3004/actuator/health). Other endpoints are denied until feature APIs and authentication are implemented.

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
./mvnw -Pdatabase-tests verify   # JDBC probe and isolated database migration tests
./mvnw spotless:apply            # Format Java sources
```

The JDBC probe uses the same local connection settings or environment overrides and a temporary table. It checks Unicode and rollback without changing application tables. Migration tests additionally require `DB_TEST_ADMIN_PASSWORD` and optionally `DB_TEST_ADMIN_USERNAME` (default `sa`), with permission to create/drop disposable databases on the configured host/port. They create uniquely named databases, test fresh/upgrade/drift behavior and remove only those databases. Missing credentials or connection failures fail that profile.

Flyway startup remains disabled; Hibernate uses schema validation and domain entity mappings are not implemented yet. M0 includes a captured legacy baseline and additive messenger migrations. Run them explicitly with separate migration credentials using the [schema workflow](../docs/messenger/schema-and-migrations.md). Historical ignored SQL scripts are never run automatically. API/crypto contracts and remaining gates are in the [M0 handoff](../docs/messenger/README.md).
