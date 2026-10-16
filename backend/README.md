# PolyLink backend scaffold

Java 25, Spring Boot 4.1.1, Maven 3.9.16 through the checked-in Maven Wrapper, and local SQL Server through Docker Compose. Maven itself does not need to be installed. Use a full JDK 25, including `javac`, and point `JAVA_HOME` at it.

## Local setup

Run the commands below from `backend/`.

For a fresh clone, prepare local configuration once:

```sh
cp .env.example .env
cp config/application-local.properties.example config/application-local.properties
```

Choose a strong SQL Server password and put the same value in `MSSQL_SA_PASSWORD` in `.env` and `spring.datasource.password` in `config/application-local.properties`. Both files are ignored by Git. Spring does not read the Compose `.env` automatically. If you change `DB_PORT` in `.env`, set `DB_PORT` in the local Spring configuration too. For uncomplicated configuration, use a password containing letters, numbers, underscores, and punctuation such as `!`; Compose and Java properties have different escaping rules for `$`, backslashes, and quotes.

The scaffold creation session already generated matching local credentials on this PC. Preserve those files; the copies above are for a fresh clone. Changing `.env` on an existing volume does not change SQL Server's stored `sa` password. Change the password through SQL Server and update both files together.

Check your JDK and start the database:

```sh
./mvnw --version
docker compose up -d --wait --wait-timeout 180 sqlserver
docker compose ps
```

On Fedora, if the Docker daemon is stopped, start it with `sudo systemctl start docker`. Docker Desktop provides the daemon on macOS. The Compose health check performs an actual SQL query before the service is considered ready.

Restore the database using the next section on a fresh installation. Then run:

```sh
./mvnw verify
./mvnw -Pdatabase-tests verify
./mvnw spring-boot:run -Dspring-boot.run.profiles=local
```

The application binds to `127.0.0.1:3004`. Its health endpoint is [http://127.0.0.1:3004/actuator/health](http://127.0.0.1:3004/actuator/health). The local profile trusts the local SQL Server certificate; the base configuration requires certificate validation. The `sa` account is used only for this local scaffold. Introduce separate application and migration accounts before adding application features or deployment configuration.

Other HTTP routes are denied until authentication and feature contracts are defined. Spring Security does not create a default user or login form. The existing frontend continues using its configured provider; this scaffold does not yet implement its feature APIs.

## Restore the supplied backup

The source is `../DB/polylink-2026523-16-23-23.bak`. `DB/` is ignored by Git, so each developer must obtain the backup separately. The newer backup has already been restored on this PC; do not rerun the restore against the existing database.

For a fresh local instance, start SQL Server as above, then copy the backup into its persistent volume:

```sh
docker compose exec -T sqlserver mkdir -p /var/opt/mssql/backup
docker compose cp ../DB/polylink-2026523-16-23-23.bak sqlserver:/var/opt/mssql/backup/polylink-2026523-16-23-23.bak
```

Inspect its backup sets and logical files if needed:

```sh
docker compose exec -T sqlserver sh -c 'SQLCMDPASSWORD="$MSSQL_SA_PASSWORD" exec /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -C -b' <<'SQL'
RESTORE HEADERONLY FROM DISK = N'/var/opt/mssql/backup/polylink-2026523-16-23-23.bak';
RESTORE FILELISTONLY FROM DISK = N'/var/opt/mssql/backup/polylink-2026523-16-23-23.bak';
SQL
```

The supplied backup has a full database backup at position 1, database name `polylink`, and logical files `polylink` and `polylink_log`. The checked-in restore script uses those inspected values, verifies the backup, restores it with Linux paths, and runs an integrity check:

```sh
docker compose exec -T sqlserver sh -c 'SQLCMDPASSWORD="$MSSQL_SA_PASSWORD" exec /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -C -b' < docker/restore-database.sql
```

The script refuses to overwrite an existing `polylink` database. A restore is a one-time operation; it is deliberately not attached to container startup. `-C` trusts the local self-signed certificate, and `-b` makes SQL errors fail the command. The password is read inside the container rather than placed in the command arguments.

The selected backup was created on 23 May 2026 at 16:23:45 according to its header. It was independently restored and checked before replacing the earlier empty database. The current database contains **27 tables and 996 rows**, including 60 users, 25 posts, and 395 alumni registry entries. Exact row counts matched the independent restore, and `DBCC CHECKDB` passed. The SQL Server 2022 backup was restored into the pinned SQL Server 2025 Developer image with compatibility level 160; the original `.bak` is unchanged. No additional seed or migration scripts were applied.

The earlier March backup restored to 16 empty tables. Before replacing that database, a verified safety backup was saved to `../DB/polylink-before-new-restore-20261017-020820.bak` and retained inside the SQL Server backup directory. That safety backup represents the earlier empty database, not the populated May backup.

Verify database state and table inventory:

```sh
docker compose exec -T sqlserver sh -c 'SQLCMDPASSWORD="$MSSQL_SA_PASSWORD" exec /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -C -b -d polylink' <<'SQL'
SELECT DB_NAME() AS database_name;
SELECT name, state_desc FROM sys.databases WHERE name = N'polylink';
SELECT COUNT(*) AS user_table_count FROM sys.tables;
SQL
```

## Persistence and normal container operations

The named Docker volume **`polylink-sqlserver-data`** is mounted at `/var/opt/mssql`, including database data/log files and the container's copied backup. The original host `.bak` remains separate. Named volumes avoid binding database storage to host filesystem permissions or Fedora SELinux labels.

These commands preserve the volume and its database:

```sh
docker compose restart sqlserver
docker compose stop
docker compose start --wait
docker compose down
docker compose up -d --wait --wait-timeout 180 sqlserver
```

`docker compose down -v` deletes the database volume and all its contents. Do not add `-v` for ordinary shutdowns. A named volume provides persistence, not an independent backup. Keep backups separately before intentionally resetting the environment.

The SQL Server port is published only on `127.0.0.1`, default port `1433`. For DBeaver, connect to `localhost:1433`, database `polylink`, user `sa`, and the password in your ignored local configuration. Enable encryption and trust the local server certificate for this development instance.

## Tests and schema management

`./mvnw verify` checks Java formatting, runs HTTP/security tests without a database, and builds an executable JAR. Format Java changes with `./mvnw spotless:apply`.

`./mvnw -Pdatabase-tests verify` also runs a real Microsoft JDBC integration test against the local database. It checks connection/database selection, Armenian Unicode round-tripping, and transaction rollback in a session-local temporary table. It does not modify the restored schema. Missing credentials or an unavailable database fail this profile; a normal verification run does not claim database verification.

The database test reads `DB_PASSWORD` from the environment or the ignored local Spring configuration. It also accepts `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USERNAME`, and `DB_TRUST_SERVER_CERTIFICATE` environment variables. It tests infrastructure behavior, not domain tables that have not yet been mapped.

Flyway and its SQL Server module are included but disabled until the restored schema is reviewed and explicitly baselined. SQL initialization is disabled. Hibernate is configured to validate rather than create/update tables, but there are no entity mappings yet, so it currently does not validate the legacy domain schema. No historical SQL scripts are run automatically.

The GitHub Actions workflow builds with Temurin 25, creates its own SQL Server container and empty CI database, and runs the database test profile. It does not require the ignored backup. Platform acceptance on the two Macs remains a team check.

## Verification on this Linux PC

The scaffold session uses a full Temurin JDK installed in the user cache. To use that JDK in a new terminal on this PC:

```sh
export JAVA_HOME="$HOME/.cache/polylink/jdk/jdk-25.0.4.1+1"
export PATH="$JAVA_HOME/bin:$PATH"
```

This path is a local convenience, not a project requirement; any compatible full JDK 25 can run the wrapper.

## References

- [Spring Boot requirements](https://docs.spring.io/spring-boot/system-requirements.html)
- [Maven Wrapper](https://maven.apache.org/tools/wrapper/)
- [SQL Server container deployment](https://learn.microsoft.com/en-us/sql/linux/containers/deploy?view=sql-server-ver17)
- [SQL Server restore with file relocation](https://learn.microsoft.com/en-us/sql/linux/migrate/restore-database?view=sql-server-ver17)
- [Spring database initialization](https://docs.spring.io/spring-boot/how-to/data-initialization.html)
