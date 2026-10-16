# Local database — Linux laptop

This directory contains the optional SQL Server container setup for this Linux laptop, restore tooling, and local database assets. Developers with working containers on macOS can keep those containers and configure only [the backend connection](../backend/README.md).

## Layout

```text
db/
├── compose.yaml
├── .env.example
├── .env                    # Local container credentials; ignored
├── scripts/
│   ├── restore-database.sql
│   └── legacy/             # Original SQL, seed and import files; ignored
├── backups/                # Original and safety .bak files; ignored
└── reference/              # Original diagram and database report; ignored
```

The previously ignored `DB/` assets were moved here without changing their contents. Their ignore policy is preserved. A fresh clone contains the Compose setup, restore script, and documentation; obtain backups and legacy assets separately if needed.

Run database commands below from `db/`. Backend commands run separately from `backend/`.

## Existing installation on this PC

The populated May backup is already restored. **Do not restore again for a normal startup.**

- Database: `polylink`, SQL Server 2025 Developer, compatibility level 160.
- Restored source: `backups/polylink-2026523-16-23-23.bak`, dated 23 May 2026.
- Verified after restore: 27 tables, 996 rows, including 60 users, 25 posts, 55 messages, and 395 alumni registry entries.
- Password: `MSSQL_SA_PASSWORD` in the ignored `db/.env`. Matching backend credentials remain in `backend/config/application-local.properties` as `DB_PASSWORD`.
- Safety backup of the earlier empty database: `backups/polylink-before-new-restore-20261017-020820.bak`. The March backup also contains the earlier empty schema.

The Compose project name remains **`polylink-backend`** so moving the file does not create a second project. Its volume remains **`polylink-sqlserver-data`**, mounted at `/var/opt/mssql`. Data is stored in this Docker volume, not inside this repository directory. Moving host `.bak` files does not move or replace live database files.

## Start and stop

Docker Engine and Compose are installed on this Fedora laptop. If the daemon is stopped:

```sh
sudo systemctl start docker
```

Start the existing database:

```sh
docker compose up -d --wait --wait-timeout 180 sqlserver
docker compose ps
```

The health check runs a SQL query. Port `1433` is published only on `127.0.0.1` by default.

These operations preserve the database volume:

```sh
docker compose restart sqlserver
docker compose stop
docker compose start --wait
docker compose down
docker compose up -d --wait --wait-timeout 180 sqlserver
```

**`docker compose down -v` deletes the database volume.** Do not use it for ordinary shutdowns. Keep the explicit project and volume names unchanged when editing Compose.

## Credentials and client connection

Use server `localhost,1433` in VS Code (or host `localhost`, port `1433` in DBeaver), SQL Login, database `polylink`, user `sa`, and the password from `.env`. Enable encryption and trust the local self-signed certificate.

For a fresh installation only, copy `.env.example` to `.env` and choose a strong password. Use the same value for `DB_PASSWORD` in the backend's local configuration. If you change `DB_PORT` in `.env`, update the backend's `DB_PORT` too. Spring does not automatically load the Compose `.env` file.

Changing `.env` does not change a password already stored in SQL Server. Change it through SQL Server first, then update both configuration files. Java properties and Compose have different escaping rules; take care with quotes, `$`, and backslashes. The generated local password already works in both formats.

## Restore on a fresh installation

The database is already populated on this laptop. These instructions are for a new, empty instance. No historical migration or seed scripts are applied automatically.

Obtain the May backup and place it at `backups/polylink-2026523-16-23-23.bak`; create the `backups/` directory if needed. Start the service, then copy the backup into its persistent storage:

```sh
docker compose exec -T sqlserver mkdir -p /var/opt/mssql/backup
docker compose cp backups/polylink-2026523-16-23-23.bak sqlserver:/var/opt/mssql/backup/polylink-2026523-16-23-23.bak
```

The inspected backup contains a full database backup at position 1 with logical files `polylink` and `polylink_log`. Restore and check integrity:

```sh
docker compose exec -T sqlserver sh -c 'SQLCMDPASSWORD="$MSSQL_SA_PASSWORD" exec /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -C -b' < scripts/restore-database.sql
```

The script refuses to overwrite an existing `polylink` database. It verifies the backup, restores with Linux file paths, and runs `DBCC CHECKDB`. It is deliberately not run during container startup. `-C` trusts the local certificate; `-b` fails the command on SQL errors. The original backups remain unchanged. Restoring into the newer SQL Server engine upgrades the database files.

Verify the database without displaying personal data:

```sh
docker compose exec -T sqlserver sh -c 'SQLCMDPASSWORD="$MSSQL_SA_PASSWORD" exec /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -C -b -d polylink' <<'SQL'
SELECT DB_NAME() AS database_name;
SELECT name, state_desc FROM sys.databases WHERE name = N'polylink';
SELECT COUNT(*) AS user_table_count FROM sys.tables;
SELECT COUNT_BIG(*) AS users FROM dbo.Users;
SQL
```

A named volume provides persistence, not an independent backup. Keep `.bak` files outside Docker storage as well.

## Local JDK used during setup

This laptop also has a full Temurin JDK in the user cache. If the system installation cannot compile the backend, select it before running Maven:

```sh
export JAVA_HOME="$HOME/.cache/polylink/jdk/jdk-25.0.4.1+1"
export PATH="$JAVA_HOME/bin:$PATH"
```

This is specific to this laptop. Other developers can use their existing full JDK 25.

## CI

The backend workflow runs Compose from `db/` on a disposable Linux runner, creates an empty CI database, and tests JDBC behavior. It does not use this laptop's volume or require the local backups.
