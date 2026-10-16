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

## Tests

```sh
./mvnw verify                    # Formatting, HTTP/security tests, executable JAR; no DB required
./mvnw -Pdatabase-tests verify   # Also test your configured SQL Server connection
./mvnw spotless:apply            # Format Java sources
```

The database test uses the same local connection settings or environment overrides and a temporary table. It checks Unicode and rollback without changing application tables. Missing credentials or connection failures fail that profile.

Flyway is included but disabled pending a reviewed baseline. Hibernate uses schema validation; domain entity mappings are not implemented yet. Historical SQL scripts are never run automatically.
