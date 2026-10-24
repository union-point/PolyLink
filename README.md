# PolyLink

A university alumni/lecturer networking project with a Java 25/Spring Boot backend and a vanilla JavaScript frontend. The real application currently supports invitation registration, email verification, encrypted direct/group text and image messaging, group membership management, persistent sessions, password changes, email-based account/history recovery, own-message export and account lifecycle actions. Encryption-key setup is automatic; users never save or enter a recovery key.

## Requirements — Linux and macOS

Install a **full JDK 25**, **Python 3.10+**, **OpenSSL/LibreSSL**, and **Docker with Compose**. Have your existing SQL Server/database and credentials available; database provisioning is machine-specific and is covered separately in [db/README.md](db/README.md). Node.js 22+ and npm are needed only for automated tests.

The commands below work in Bash or Zsh on Linux and macOS. Run them from the project root. Setup finds JDK 25 in `JAVA_HOME`, the system path, common Linux/macOS locations or `/usr/libexec/java_home` on macOS. If it cannot find one, install a full JDK 25 or set `JAVA_HOME` and rerun it.

## Run the real application

### 1. Prepare local configuration

```sh
bash tools/local/setup.sh
```

Open the generated **`$HOME/.config/polylink/local.env`** and fill in your existing SQL credentials if they were not discovered. Then load this terminal:

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

An existing instance whose operator state is elsewhere may need its existing three unseal shares. Follow the script's instructions or [the operator runbook](infra/openbao/README.md); it will not reinitialize that instance. Moving an existing service's mounts out of an old worktree can require this one-time unseal after Compose recreates the container. Automatic local operator storage is for development; deployment uses the runbook's separate custody procedure.

Mail is captured at [http://localhost:8025](http://localhost:8025), not sent to external inboxes.

### 3. Apply migrations explicitly

Back up your existing database, stop any old backend, and use a migration-capable SQL account:

```sh
export MIGRATION_DB_USERNAME="$DB_USERNAME"
export MIGRATION_DB_PASSWORD="$DB_PASSWORD"
./backend/mvnw -f backend/pom.xml compile exec:java -Dexec.mainClass=am.polylink.database.SchemaCommand -Dexec.args=upgrade
```

Use separate migration credentials if your runtime SQL user lacks permission. For an already-created **empty** database, use `-Dexec.args=fresh` instead. An existing database must pass the baseline guard; do not force it or delete tables. This applies/validates migrations through V13. If historical forum topics/replies exist, first stop at V12 and complete the [reviewed category/timezone backfill](docs/forum_implementation.md#existing-database-upgrade); V13 refuses unreviewed data. Application startup never migrates a database. See [schema details](docs/messenger/schema-and-migrations.md).

### 4. Invite two test users

```sh
./backend/mvnw -f backend/pom.xml compile exec:java -Dexec.mainClass=am.polylink.auth.AdmissionCommand -Dexec.args='invite alice@example.invalid graduate'
./backend/mvnw -f backend/pom.xml compile exec:java -Dexec.mainClass=am.polylink.auth.AdmissionCommand -Dexec.args='invite bob@example.invalid graduate'
```

Invitations authorize matching email/role registration for seven days. They do not bypass email verification or reset existing accounts. If these users already exist, log in or use new test addresses.

### 5. Start the app in two terminals

In each new terminal, open this checkout's root. For the **backend**, load the environment and run:

```sh
source tools/local/env.sh
export FORUM_ENABLED=true
(cd backend && ./mvnw spring-boot:run)
```

For the **frontend**:

```sh
python3 server.py --port 8001
```

Check [backend health](http://localhost:3004/actuator/health), then open [registration](http://localhost:8001/register.html). `js/config.js` already selects `http` and `http://localhost:3004`. No frontend install/build is needed for manual use; Axios/fonts/styles can still require internet access.

If recovery returns `SERVICE_UNAVAILABLE` from `/auth/recovery/unlock`, check that OpenBao is unsealed and its application token is valid. A backend started without the local JVM truststore cannot reach its HTTPS endpoint. Stop the backend, rerun `bash tools/local/setup.sh`, then `source tools/local/env.sh` **in the same terminal** and start it again. Sourcing `local.env` directly does not configure Java TLS. These steps preserve existing Transit keys and account data; see [local troubleshooting](tools/local/README.md).

Use **`localhost` consistently**, rather than mixing it with `127.0.0.1`. Keep the default ports unless you also update the allowed frontend origin and API URL. Stop older app servers occupying ports 3004/8001 so you test this checkout.

### 6. Try it

1. Register Alice as **graduate** with a password containing 8–128 characters, an uppercase letter, a number and a symbol.
2. Read Alice's verification code in [Mailpit](http://localhost:8025) and finish registration/login. Key setup completes automatically.
3. In a **different browser profile or browser**, register and verify Bob. Two ordinary tabs share one login and cannot represent different users.
4. In Alice's [Search page](http://localhost:8001/search.html), find Bob and click **Connect**. Exchange text through [Messages](http://localhost:8001/message.html).
5. Reload or restart the browser: a valid session and working secure browser storage restore access without another password. Bob can also close his browser and read Alice's later message when he returns.
6. Try **Settings → Password**. The new password should preserve history and revoke other device sessions. A clean browser profile can open the same history with that password.

Use **Messages → «Ստեղծել խումբ»** to create a group. Click the group name or avatar in the chat header to view members and manage the group as its owner. Members can leave through the three-dot menu. Settings provides own-message/image export and account deactivation/deletion; see [M6](docs/messenger/m6.md) for V8/V9 legacy-schema retirement and lifecycle operations. Some unrelated profile and announcement actions remain unavailable and fail explicitly; HTTP mode never falls back to demo data. See [LIVE_TESTING.md](LIVE_TESTING.md) for detailed checks and troubleshooting.

## Test automatically

The test script handles dependency installation, a private Python virtual environment, contract/client tests and Maven verification:

```sh
bash tools/local/test.sh
```

For focused forum SQL/mail/browser acceptance, run `bash tools/local/test.sh --forum`.

For the complete disposable SQL/OpenBao/mail/browser acceptance suite:

```sh
bash tools/local/test.sh --full
```

`--full` and `--forum` need running Docker and SQL credentials allowed to create/drop **disposable** databases. It uses `DB_TEST_ADMIN_USERNAME`/`DB_TEST_ADMIN_PASSWORD` when supplied, otherwise your configured migration/runtime credentials. It creates its own temporary services and never migrates the working database. On Linux, Playwright may also request missing system browser libraries; follow its reported dependency instructions.

A quick backend-only check remains a direct command:

```sh
./backend/mvnw -f backend/pom.xml verify
```

## Worktrees and restarting

Each worktree uses its own source code and the same private local configuration. Run setup again to reconcile paths/certificates, then `source tools/local/env.sh` in each terminal. To use a separate local configuration, export `POLYLINK_LOCAL_DIR` to a directory **outside the checkout** before setup/loading.

Stop app servers with Ctrl+C; retain the database, OpenBao volumes and private local state. Start them later with the same one-liners above. The backend renews its service token while running; rerun the provisioning script after a long shutdown if it expired. Existing infrastructure without saved local operator credentials requires an operator-issued replacement. Do not use `down -v` for normal shutdown.

## Frontend-only demo

To explore the independent mock UI without a backend, set `dataMode: 'mock'` in `js/config.js`, then run `python3 server.py --port 8001` and open [Profile](http://localhost:8001/profile.html). After demo logout, use `demo.alumni@polytechnic.am` or `demo.lecturer@polytechnic.am` with `DemoPass123!`; the fictional verification code is `123456`.

[Developer controls](http://localhost:8001/dev-tools.html) reset the mock dataset and inject demo events. Mock accounts/codes do not authenticate against the real backend. Restore `dataMode: 'http'` before following the real-app instructions.

To check the messenger UI with the static server running, use:

```sh
npm ci --prefix tools/m1
M1_FRONTEND=http://localhost:8001 node tools/m1/messenger-ui.mjs
```

The browser check uses isolated mock data without editing `js/config.js`. It covers group controls, sending, drafts, search, emoji, attachments, themes, sender contrast and mobile layouts. Install Chromium with `npx --prefix tools/m1 playwright install chromium` if needed. Set `M1_ARTIFACT_DIR` to save screenshots.

## Further documentation

- [Forum API, legacy migration, notifications and takedown operations](docs/forum_implementation.md)

- [Detailed live testing and troubleshooting](LIVE_TESTING.md)
- [Local setup automation and generated files](tools/local/README.md)
- [Backend configuration and schema workflow](backend/README.md)
- [OpenBao operator runbook](infra/openbao/README.md)
- [Messenger specification](docs/messenger_spec.md) and [implementation plan](docs/messenger_implementation_plan.md)
- [M0 contracts](docs/messenger/README.md), [M1 identity](docs/messenger/m1.md), [M2 messaging](docs/messenger/m2.md), [M3 sessions/passwords](docs/messenger/m3.md), [M4 recovery](docs/messenger/m4.md), [M5 messenger UI/images](docs/messenger/m5.md), [M6 groups/lifecycle](docs/messenger/m6.md)
- [Frontend architecture](docs/frontend_context.md) and [profile module](js/profile/README.md)
