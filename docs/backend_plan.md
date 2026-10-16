# PolyLink backend foundation plan

Planning baseline: 17 October 2026. Java, Spring, Microsoft SQL Server running locally through Docker on every developer's machine, and equal development access from two Apple Silicon Macs and one Fedora workstation are confirmed constraints. The team already uses local SQL Server containers on all three machines; this plan takes that setup as given. Everything else below is a proposal. This document plans the foundation; it does not implement a backend or approve product behavior.

Scaffold status, 17 October 2026: the application, Maven Wrapper, formatter, and tests are in `backend/`; optional Linux Compose/restore tooling is in `db/`, and the CI workflow is in `.github/workflows/backend.yml`. The populated May backup was restored on the Linux PC. See [backend setup for Linux and macOS](../backend/README.md) and [local Linux database instructions](../db/README.md). Domain mappings and a reviewed Flyway baseline remain future work.

## Architecture

Start with one Spring Boot application, one Maven module, and one SQL Server database per environment. Organize code by business capability as those capabilities become clear, with controllers, services, persistence, and DTOs inside each capability. Keep shared infrastructure small. This gives three developers clear boundaries while retaining one build and one deployment.

Use Spring MVC with JSON over HTTP. Keep transactions and business rules in services, persistence behind repositories, and HTTP request/response DTOs separate from JPA entities. Avoid introducing microservices, an API gateway, reactive programming, queues, or distributed caching until a concrete requirement justifies them.

Keep the backend in a proposed `backend/` directory in this repository so frontend adapter changes and backend contracts can be reviewed together. The existing frontend service layer remains the integration boundary. Its mock behavior and the recommendations in [specification gaps](specification_gaps.md) are evidence and proposals, not approved production contracts.

## Proposed toolset

| Area | Baseline | Reason |
| --- | --- | --- |
| Java | Eclipse Temurin JDK 25 LTS | Native builds for Apple Silicon and Linux; one shared Java target. |
| Framework | Spring Boot 4.1, stable patch pinned when bootstrapping | Supported Java baseline and coordinated Spring dependencies. |
| Build | Maven 3.9, exact release pinned through Maven Wrapper | Same build commands locally and in CI; no global Maven requirement. |
| Local database runtime | Existing SQL Server container; optional Linux Compose setup in `db/` | Each developer keeps an independent local database and connection settings. |
| HTTP | Spring MVC, Bean Validation | Conventional request handling and server validation. |
| Persistence | Spring Data JPA, Boot-managed Hibernate, Microsoft JDBC driver supporting JDK 25 | Conventional relational persistence with explicit SQL available where useful. |
| Schema | Flyway with SQL Server support | Reviewed, versioned T-SQL migrations; Hibernate validates schema instead of changing it. |
| Security | Spring Security | Shared enforcement point; authentication/session design remains a product decision. |
| Operations | Spring Boot Actuator and application logs | Minimal health and diagnostics. |
| Tests | Boot test support, JUnit, SQL Server integration tests | Test actual database behavior and agreed API contracts. |
| Formatting | Maven-enforced formatter, shared `.editorconfig` | Formatting does not depend on an IDE. |
| Database GUI | Optional DBeaver Community | Cross-platform SQL access without requiring SSMS. |
| Editor | Developer choice, such as IntelliJ IDEA or VS Code | Build and execution must work from the terminal. |
| Collaboration | Git, pull requests, CI | One review and verification workflow. |

Use Spring Boot dependency management where available. Explicitly pin remaining plugins and dependencies, check the JDBC/JDK and Flyway/SQL Server combinations during the initial compatibility check, and upgrade through reviewed changes. Do not add native-image compilation or annotation tooling as initial requirements.

## Local SQL Server through Docker

Every developer runs SQL Server locally through Docker, including on the Macs. Developers with working containers keep them and configure the backend connection independently. The Compose file in `db/` is the optional setup for the Linux laptop and disposable CI runners. Its image is pinned; align database compatibility with the eventual deployment target.

Run the Spring Boot application on the host JVM and connect through JDBC to the locally published SQL Server port. Docker Desktop on macOS and Docker Engine with Compose on Fedora are the reference installations; project commands and configuration should stay consistent across them.

- Use a named Docker volume for each developer's database persistence. Document startup, shutdown, readiness checks, and an explicit reset procedure that identifies when local data will be deleted.
- Bind the development database port to localhost and keep credentials outside Git. Document the local JDBC encryption/certificate settings separately from deployment settings. Do not require Windows integrated authentication or native authentication libraries.
- Give automated tests isolated databases or disposable containers per run, with reliable cleanup. Keep test data synthetic and separate from persistent development data.
- Keep reviewed schema migrations and reproducible development fixtures in Git. Original local SQL/import files, backups, and reference assets remain ignored under `db/scripts/legacy/`, `db/backups/`, and `db/reference/`; obtain and inspect them before creating a baseline. The context document is not a runnable schema.
- Use the same migration path for all developers and CI. Applied migrations are immutable; resolve branch numbering/order conflicts before merge. Run migrations against a fresh database in CI and coordinate changes to long-lived databases.

## Reproducible local workflow

Backend development requires Git, the agreed native JDK, an editor, and access to the developer's existing SQL Server for database-backed work. Container management is separate. Commit Maven Wrapper, build configuration, connection examples, and onboarding instructions. Use environment variables or the ignored local Spring configuration file for connections. `db/.env` configures only the optional Compose service; Spring does not read it.

Document these commands from `backend/` once the scaffold exists:

```sh
./mvnw verify
./mvnw spring-boot:run -Dspring-boot.run.profiles=local
```

The optional Compose service is named `sqlserver` and is managed from `db/`. Its health check confirms SQL readiness. The backend startup and verification commands are the same on all three machines and do not depend on how the container was created.

The normal verification lifecycle should run formatting checks and unit tests everywhere. Add database integration tests to that lifecycle when isolated local test database provisioning is ready; do not report a database check as passing when it was skipped. Provide an explicit unit-test-only command for working without the database running.

Use UTF-8, LF line endings, case-consistent file names, relative paths, UTC instants, and explicit configuration. Preserve the executable bit on the wrapper. Put automation in Maven or portable Java rather than scripts relying on GNU-only utilities, Homebrew paths, Fedora paths, or shell startup files. Installation instructions may differ by OS; project commands and behavior should stay the same.

Add any future local infrastructure services to the shared Compose configuration as requirements become clear. Avoid making Fedora's Podman an assumed drop-in replacement without checking the chosen workflow.

For database integration tests, use a dedicated test database in the local SQL Server container initially. Testcontainers can later manage disposable SQL Server containers if that simplifies test isolation. CI should create its own disposable SQL Server instance. Do not substitute H2 for SQL Server acceptance checks.

## Review workflow

Require one peer review and passing CI before merge. Prefer small changes and short-lived branches. Record consequential technical choices in short decision notes; retain unsettled product questions in the existing specification gaps document.

## Foundation milestones and acceptance

1. **Local environment check.** From each Mac and Fedora, run the pinned JDK/Maven build and connect through JDBC to the developer's existing SQL Server. The optional Linux container is managed from `db/`. Verify Unicode text, migrations, persistence across container restarts, and cleanup on disposable test databases.
2. **Shared scaffold.** Add the backend build, basic health diagnostics, configuration templates, formatter, tests, and CI. Both platform setups must succeed from a clean clone using the documented commands.
3. **Database workflow.** Recover and reconcile the original SQL, establish a reviewed baseline, initialize each local development database, and demonstrate fresh-schema migrations and isolated database tests. Keep migration credentials separate from ordinary application credentials.
4. **First agreed vertical slice.** Select one small feature after its requirements are resolved. Define its HTTP contract, permissions, validation, errors, and transaction boundaries; implement it with its frontend adapter and tests. Use it to validate the foundation before expanding scope.

CI should verify every pull request on Linux using its own SQL Server container. Manual execution on both actual Macs and Fedora is required for the foundation acceptance, and after changes to platform-sensitive tooling. Add macOS checks when a runner with the required Docker environment is available. Prevent concurrent jobs from sharing a writable test database.

## Decisions deliberately left open

Authentication and session policy, eligibility verification, permissions, final schema, API route changes, file storage, messaging transport and encryption, email delivery, and production hosting remain open. Resolve each before implementing the affected feature. The health/build/configuration foundation can proceed without deciding these policies. Spring Security configuration must not accidentally turn an undecided production API into a publicly accessible service.

## Documentation checked

Version and compatibility recommendations should be rechecked when the scaffold is generated:

- [Temurin platform support](https://adoptium.net/supported-platforms/) and [LTS roadmap](https://adoptium.net/support/).
- [Spring Boot system requirements](https://docs.spring.io/spring-boot/system-requirements.html): the checked documentation lists Boot 4.1.1 and Java compatibility through 26.
- [Maven Wrapper](https://maven.apache.org/wrapper/): project-controlled Maven distributions and checksum verification.
- [Microsoft JDBC requirements](https://learn.microsoft.com/en-us/sql/connect/jdbc/system-requirements-for-the-jdbc-driver?view=sql-server-ver17): JDK 25 support begins with driver 13.4.
- [SQL Server container deployment](https://learn.microsoft.com/en-us/sql/linux/containers/deploy?view=sql-server-ver17).
- [Testcontainers runtime requirements](https://java.testcontainers.org/supported_docker_environment/) and [Fedora Docker setup](https://docs.docker.com/engine/install/fedora/).
- [DBeaver Community downloads](https://dbeaver.io/download/).
