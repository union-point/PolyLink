# PolyLink

A university networking application for graduates and lecturers, built with Java 25, Spring Boot and vanilla JavaScript. It supports registry-based enrollment, encrypted direct/group messaging, a career forum, announcements with comments, account settings and email-based recovery. Encryption-key setup is automatic.

General profile editing APIs remain unavailable in HTTP mode. Announcement and comment APIs are implemented behind `POSTS_ENABLED`; see the [posts implementation and rollout procedure](docs/posts_implementation.md). See the [documentation index](docs/README.md) for current capabilities and limitations.

## Requirements — Linux and macOS

Install a **full JDK 25**, **Python 3.10+**, **OpenSSL/LibreSSL**, and **Docker with Compose**. Have your existing SQL Server/database and credentials available; database provisioning is machine-specific and is covered separately in [db/README.md](db/README.md). Node.js 22+ and npm are needed only for automated tests.

The commands below work in Bash or Zsh on Linux and macOS. Run them from the project root. Setup finds JDK 25 in `JAVA_HOME`, the system path, common Linux/macOS locations or `/usr/libexec/java_home` on macOS. If it cannot find one, install a full JDK 25 or set `JAVA_HOME` and rerun it.

## Run the real application

### 1. Prepare local configuration

```sh
bash tools/local/setup.sh
```

Open the generated **`$HOME/.config/polylink/local.env`** and fill in your existing SQL credentials if they were not discovered. Then load the environment:

```sh
source tools/local/env.sh
```

Setup generates missing HMAC/replay secrets, prepares local TLS files and imports the OpenBao certificate into a JVM truststore while retaining normal Java trust roots. It preserves existing secrets and keeps all private state outside Git. Repeat it safely after switching worktrees; it does not start services or migrate the database.

### 2. Start local encryption infrastructure and email capture

```sh
docker compose -f "$POLYLINK_SECURITY_COMPOSE" up -d openbao
docker compose -f "$POLYLINK_SECURITY_COMPOSE" up -d mailpit
bash tools/local/provision-openbao.sh
```

The provisioning script initializes **only a fresh local development instance**, unseals it using its saved local operator state, configures Transit, and creates/renews the narrow backend token. Existing Transit keys and data are preserved. Its operator credentials are stored separately in `$HOME/.config/polylink-operator`, never in the application environment.

An existing instance without saved local operator state may require its three unseal shares. Follow the script's instructions or the [operator runbook](infra/openbao/README.md), which also covers deployment custody.

Mail is captured at [http://localhost:8025](http://localhost:8025), not sent to external inboxes.

### 3. Apply migrations explicitly

Back up your existing database, stop any old backend, and set `MIGRATION_DB_USERNAME` / `MIGRATION_DB_PASSWORD` in your private environment to a migration-capable SQL account, separate from the runtime `DB_USERNAME` / `DB_PASSWORD`:

```sh
./backend/mvnw -f backend/pom.xml compile exec:java -Dexec.mainClass=am.polylink.database.SchemaCommand -Dexec.args=upgrade
```

For an already-created **empty** database, use `-Dexec.args=fresh` instead. An existing database must pass the baseline guard; do not force it or delete tables. This applies/validates migrations through V21. If historical forum topics/replies exist, first stop at V12 and complete the [reviewed category/timezone backfill](docs/forum_implementation.md#existing-database-upgrade); V13 refuses unreviewed data. Historical announcements/comments also require stopping at V18 for the [reviewed timestamp backfill](docs/posts_implementation.md#existing-database-upgrade-and-historical-review); V19 refuses unreviewed rows. V20 then removes the four obsolete source date columns and the completed posts review journal. V21 removes unsupported post types and requires unique codes in both post reference tables; use the matching backend. Application startup never migrates a database. See [schema details](docs/messenger/schema-and-migrations.md).

### 4. Check registry eligibility

New accounts require a **`polytechnic.am`** address and matching university registry details. Graduates need their diploma number, first/last names, specialization and study years; lecturers need official names, registration email and department, plus a selected profession. Reference choices load from the database. Import verified lecturer names before enabling real lecturer enrollment; V14 does not invent names or seed identities. Invitations are retired. Existing admitted accounts keep access.

For synthetic users, use the disposable acceptance suite below; it seeds its own registry data. See [enrollment and operator guidance](docs/registry_enrollment.md) for the API, expiry, recovery and rollout rules.

### 5. Start the app in two terminals

In each new terminal, open this checkout's root. For the **backend**, load the environment and run:

```sh
source tools/local/env.sh
export FORUM_ENABLED=true
export POSTS_ENABLED=true # only after the V21 migration/review above
(cd backend && ./mvnw spring-boot:run)
```

For the **frontend**:

```sh
python3 server.py --port 8001
```

Check [backend health](http://localhost:3004/actuator/health), then open [registration](http://localhost:8001/register.html). `js/config.js` already selects `http` and `http://localhost:3004`. No frontend install/build is needed for manual use; Axios/fonts/styles can still require internet access.

For OpenBao, token or Java TLS errors, follow [local troubleshooting](tools/local/README.md#recovery-reports-service-unavailable). Always load the environment with `source tools/local/env.sh` before starting the backend.

Use **`localhost` consistently**, rather than mixing it with `127.0.0.1`. Keep the default ports unless you also update the allowed frontend origin and API URL. Stop older app servers occupying ports 3004/8001 so you test this checkout.

## Automated tests

The test script handles dependency installation, a private Python virtual environment, contract/client tests and Maven verification:

```sh
bash tools/local/test.sh
```

For focused SQL/mail/browser acceptance, run `bash tools/local/test.sh --forum` or `bash tools/local/test.sh --posts`. For registration/recovery mail diagnostics and the Docker DNS regression, see [SMTP troubleshooting](tools/local/README.md#smtp-timeouts-in-disposable-acceptance-tests).

For the complete disposable SQL/OpenBao/mail/browser acceptance suite:

```sh
bash tools/local/test.sh --full
```

`--full`, `--forum` and `--posts` need running Docker and SQL credentials allowed to create/drop **disposable** databases. The runner uses `DB_TEST_ADMIN_USERNAME`/`DB_TEST_ADMIN_PASSWORD` when supplied, otherwise your configured migration/runtime credentials. It creates its own temporary services and never migrates the working database. On Linux, Playwright may also request missing system browser libraries; follow its reported dependency instructions.

A quick backend-only check remains a direct command:

```sh
./backend/mvnw -f backend/pom.xml verify
```

## Worktrees and restarting

Each worktree uses its own source code and the same private local configuration. Run setup again to reconcile paths/certificates, then `source tools/local/env.sh` in each terminal. To use a separate local configuration, export `POLYLINK_LOCAL_DIR` to a directory **outside the checkout** before setup/loading.

Stop app servers with Ctrl+C; retain the database, OpenBao volumes and private local state. Start them later with the same one-liners above. The backend renews its service token while running; rerun the provisioning script after a long shutdown if it expired. Existing infrastructure without saved local operator credentials requires an operator-issued replacement. Do not use `down -v` for normal shutdown.

## Frontend-only demo

To explore the independent mock UI without a backend, set `dataMode: 'mock'` in `js/config.js`, then run `python3 server.py --port 8001` and open [Profile](http://localhost:8001/profile.html). After demo logout, use `demo.alumni@polytechnic.am` or `demo.lecturer@polytechnic.am` with `DemoPass123!`; the fictional verification code is `123456`.

[Developer controls](http://localhost:8001/dev-tools.html) reset the mock dataset and inject demo events. For a new demo enrollment, use `new.graduate@polytechnic.am`, names `Demo` / `Graduate`, diploma `DEMO-2025`, the first specialization and years 2021–2025. A lecturer demo uses `new.lecturer@polytechnic.am`, names `Demo` / `Lecturer`, and the first department/profession. Both use code `123456`.

Mock accounts/codes do not authenticate against the real backend. Restore `dataMode: 'http'` before following the real-app instructions.

To check the messenger UI with the static server running, use:

```sh
npm ci --prefix tools/m1
M1_FRONTEND=http://localhost:8001 node tools/m1/messenger-ui.mjs
```

The browser check uses isolated mock data without editing `js/config.js`. It covers group controls, sending, drafts, search, emoji, attachments, themes, sender contrast and mobile layouts. Install Chromium with `npx --prefix tools/m1 playwright install chromium` if needed. Set `M1_ARTIFACT_DIR` to save screenshots.

## Further documentation

Use the [documentation index](docs/README.md) for architecture, product decisions, API contracts, operator runbooks and historical milestone evidence. Start with [live testing](LIVE_TESTING.md) for manual checks or [local tooling](tools/local/README.md) for setup troubleshooting.
