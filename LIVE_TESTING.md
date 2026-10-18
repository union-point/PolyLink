# Run PolyLink locally and test M1–M3 live

Use this guide for the real HTTP application: invitation registration, automatic encryption-key setup, direct text messaging, session continuity and password changes.

**Users do not save, download or type a recovery key.** After password login and email verification, the application creates and protects the encryption keys automatically. OpenBao administration below is an operator task; it is separate from a user's login. Forgotten-password recovery is still M4 and is not available yet.

## 1. Open the checkout you want to test

Open a terminal in this project's root—the directory containing this file, `backend/`, and `server.py`:

```sh
export POLYLINK_ROOT="$PWD"
pwd
git log -3 --oneline
```

Keep this terminal for configuration and migrations. Later, open two more terminals for the backend and frontend.

At the time this guide was written, this machine already had SQL Server on **1433**, OpenBao on **18200**, Mailpit on **1025/8025**, and app servers on **3004/8001**. The app servers and OpenBao configuration were associated with another worktree. Running services do not prove that the latest M3 code is being served.

Stop the previous **frontend and backend app processes** using Ctrl+C in their terminals before step 7. If those terminals are unavailable, identify the listeners first:

```sh
lsof -nP -iTCP:3004 -sTCP:LISTEN
lsof -nP -iTCP:8001 -sTCP:LISTEN
```

For each old app process you own, `kill PID` requests a normal shutdown; replace `PID` with the inspected Java/backend or Python/frontend process ID. Stop only those two app servers. If `lsof` is unavailable on Linux, inspect listeners with `ss -lptn`.

Keep the existing database, OpenBao volume and Mailpit. Do not restore the database, reinitialize OpenBao, or delete their volumes to run this checkout.

## 2. Check the tools and existing infrastructure

```sh
java -version
javac -version
python3 --version
docker compose version
docker ps --format 'table {{.Names}}\t{{.Ports}}'
```

You need a **full JDK 25**, including `javac`. A Java runtime alone cannot build the backend.

On this Linux machine, a usable JDK was found at the following location. If it still exists, select it:

```sh
export JAVA_HOME="$HOME/.cache/polylink/jdk/jdk-25.0.4.1+1"
export PATH="$JAVA_HOME/bin:$PATH"
"$JAVA_HOME/bin/javac" -version
```

On macOS, after installing a full JDK 25, select it with:

```sh
export JAVA_HOME="$(/usr/libexec/java_home -v 25)"
export PATH="$JAVA_HOME/bin:$PATH"
```

If SQL Server is unavailable, follow your machine's existing database setup. The optional local instructions are in [db/README.md](db/README.md); database/container creation is not required when your current database is already running.

Check the existing OpenBao instance:

```sh
docker exec polylink-security-openbao-1 bao status
```

Expected: **Initialized: true** and **Sealed: false**. If it is sealed, an operator must provide three distinct existing unseal shares, running this interactive command three times:

```sh
docker exec -it polylink-security-openbao-1 bao operator unseal
```

Do not initialize an already initialized instance. If OpenBao or Mailpit needs starting, use the checkout that owns the existing infrastructure configuration, as identified in the next step. For first-time provisioning rather than reuse, follow [the OpenBao runbook](infra/openbao/README.md) before continuing.

## 3. Reuse the existing certificate and backend service token

Find the directory that actually owns the running OpenBao configuration:

```sh
export POLYLINK_SECURITY_DIR="$(docker inspect polylink-security-openbao-1 --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}')"
export POLYLINK_PREVIOUS_ROOT="$(dirname "$(dirname "$POLYLINK_SECURITY_DIR")")"
printf 'Existing security configuration: %s\n' "$POLYLINK_SECURITY_DIR"
```

In the current local setup, the application's narrow OpenBao token is in that checkout's `backend/secrets/openbao.token`. Check the paths without printing the token:

```sh
test -r "$POLYLINK_SECURITY_DIR/tls/server.crt"
test -r "$POLYLINK_PREVIOUS_ROOT/backend/secrets/openbao.token"
```

Both commands should finish successfully with no output. A missing file means you need the correct existing certificate/token location from the operator. Do not substitute the initialization root token for the backend token.

If these services were stopped, start them using their existing configuration:

```sh
docker compose -f "$POLYLINK_SECURITY_DIR/compose.yaml" --profile local-mail up -d openbao mailpit
```

Recheck OpenBao sealing after a restart. Keep this infrastructure checkout and its private files available while using these paths; creating a new Git worktree does not copy ignored certificates or tokens.

## 4. Save the local application configuration once

Keep configuration outside Git so the same secrets survive terminal and app restarts:

```sh
export POLYLINK_LOCAL_DIR="$HOME/.config/polylink"
mkdir -p "$POLYLINK_LOCAL_DIR"
chmod 700 "$POLYLINK_LOCAL_DIR"
```

The following command creates `local.env` **only if it does not already exist**. It generates two independent authentication secrets and records your existing OpenBao paths. It does not print secret values:

```sh
python3 - <<'PY'
import os
from pathlib import Path
import secrets
import shlex

folder = Path(os.environ['POLYLINK_LOCAL_DIR'])
path = folder / 'local.env'
if path.exists():
    print(f'{path} already exists; edit and reuse it.')
else:
    values = {
        'JAVA_HOME': os.environ['JAVA_HOME'],
        'DB_HOST': 'localhost',
        'DB_PORT': '1433',
        'DB_NAME': 'polylink',
        'DB_USERNAME': 'sa',
        'DB_PASSWORD': 'REPLACE_WITH_YOUR_EXISTING_LOCAL_SQL_PASSWORD',
        'DB_TRUST_SERVER_CERTIFICATE': 'true',
        'IDENTITY_ENABLED': 'true',
        'MESSENGER_ENABLED': 'true',
        'FRONTEND_ORIGINS': 'http://localhost:8001',
        'SERVER_PORT': '3004',
        'AUTH_HMAC_KEY': secrets.token_urlsafe(32),
        'AUTH_REPLAY_KEY': secrets.token_urlsafe(32),
        'OPENBAO_URL': 'https://localhost:18200',
        'OPENBAO_TOKEN_FILE': str(Path(os.environ['POLYLINK_PREVIOUS_ROOT']) / 'backend/secrets/openbao.token'),
        'SMTP_HOST': 'localhost',
        'SMTP_PORT': '1025',
        'MAIL_FROM': 'no-reply@polylink.invalid',
    }
    with path.open('x', opener=lambda name, flags: os.open(name, flags, 0o600)) as output:
        output.write(''.join(f'export {key}={shlex.quote(value)}\n' for key, value in values.items()))
    print(f'Created {path}; edit the SQL settings before continuing.')
PY
```

Open `$HOME/.config/polylink/local.env` in your editor. Replace the password placeholder with your **existing** SQL password; adjust host, port, database and username if needed. Preserve the shell quoting. You can consult your previous checkout's ignored `backend/config/application-local.properties` for the existing database settings.

Keep the generated `AUTH_HMAC_KEY` and `AUTH_REPLAY_KEY` unchanged on subsequent runs. If you already maintain those secrets for this local application, reuse those values instead. This guide does not require putting any secret into a tracked file.

Load the configuration:

```sh
source "$HOME/.config/polylink/local.env"
export PATH="$JAVA_HOME/bin:$PATH"
```

Mailpit captures verification email locally at [http://localhost:8025](http://localhost:8025). It does not send it to real mailboxes. Local test addresses such as `alice@example.invalid` are sufficient.

## 5. Trust the existing OpenBao certificate in Java

Create a local JVM truststore from the JDK's normal roots, then add the existing OpenBao certificate. Run the copy/import block once; reuse this truststore afterward:

```sh
if [ ! -f "$HOME/.config/polylink/openbao-truststore" ]; then
  cp "$JAVA_HOME/lib/security/cacerts" "$HOME/.config/polylink/openbao-truststore"
  "$JAVA_HOME/bin/keytool" -importcert -noprompt \
    -alias polylink-local-openbao \
    -file "$POLYLINK_SECURITY_DIR/tls/server.crt" \
    -keystore "$HOME/.config/polylink/openbao-truststore" \
    -storepass changeit
fi
chmod 600 "$HOME/.config/polylink/openbao-truststore"
```

`changeit` is the conventional password for this local **certificate truststore**, not an OpenBao token, database password or user password. This keeps normal JVM trust roots and adds the local certificate; it does not disable certificate validation.

## 6. Apply the schema through V4 and invite two users

Keep the old backend stopped while upgrading. Take a backup of your existing database using your normal local backup procedure before applying migrations.

The migration and invitation CLIs read **environment variables**, not the ignored Spring local properties file. From the project root, load the configuration and supply the existing migration-capable SQL credentials:

```sh
source "$HOME/.config/polylink/local.env"
export PATH="$JAVA_HOME/bin:$PATH"
export MIGRATION_DB_USERNAME="$DB_USERNAME"
export MIGRATION_DB_PASSWORD="$DB_PASSWORD"
cd "$POLYLINK_ROOT/backend"
./mvnw --version
```

The two credential exports above suit the current local administrator setup. If your runtime SQL user lacks migration privileges, use your separate migration username/password for those exports.

For the **existing database**, inspect and upgrade:

```sh
./mvnw compile exec:java \
  -Dexec.mainClass=am.polylink.database.SchemaCommand \
  -Dexec.args=inventory

./mvnw compile exec:java \
  -Dexec.mainClass=am.polylink.database.SchemaCommand \
  -Dexec.args=upgrade
```

Expected: `Schema migrated and validated; application data was not imported.` All pending migrations through **V4** are applied; an already current database is validated. If the baseline differs, stop and reconcile it using [the schema workflow](docs/messenger/schema-and-migrations.md). Do not force a baseline or delete existing tables. Use `fresh` only for an already-created, empty database—not for your existing database.

Approve two new local test addresses:

```sh
./mvnw compile exec:java \
  -Dexec.mainClass=am.polylink.auth.AdmissionCommand \
  -Dexec.args='invite alice@example.invalid graduate'

./mvnw compile exec:java \
  -Dexec.mainClass=am.polylink.auth.AdmissionCommand \
  -Dexec.args='invite bob@example.invalid graduate'
```

Each invitation lasts seven days and must match the registration email and role. It authorizes registration; it does not create a logged-in user or bypass email verification. Use new addresses if you need fresh accounts. If these accounts are already admitted, simply log in; another invitation does not reset them. Mock/demo credentials are not real backend accounts.

## 7. Start the backend and frontend from this checkout

### Terminal A — backend

Open a new terminal in this project root:

```sh
source "$HOME/.config/polylink/local.env"
export PATH="$JAVA_HOME/bin:$PATH"
export JAVA_TOOL_OPTIONS="-Djavax.net.ssl.trustStore=$HOME/.config/polylink/openbao-truststore -Djavax.net.ssl.trustStorePassword=changeit"
cd backend
./mvnw spring-boot:run
```

If you already need other `JAVA_TOOL_OPTIONS`, retain them when adding the two truststore options. The exported configuration is sufficient; the `local` Spring profile is not needed for these commands.

Leave the process running. In another terminal:

```sh
curl --fail http://localhost:3004/actuator/health
```

Expected: `{"status":"UP"}`. This checks backend health; complete registration below also checks SMTP and the OpenBao service token.

### Terminal B — frontend

Open another terminal in this same project root:

```sh
python3 server.py --port 8001
```

Check `js/config.js` contains:

```js
dataMode: 'http',
apiBaseUrl: 'http://localhost:3004',
```

Those are the current committed values. No frontend npm install/build is needed for manual testing. The vendored crypto assets are local; the Axios/font/style CDNs can still require internet access.

Use **`http://localhost:8001` throughout this test**, matching `FRONTEND_ORIGINS`. Do not switch between `localhost` and `127.0.0.1`; they have different cookie/storage origins. These are local development servers, not a public deployment.

## 8. Register and test encrypted text messaging

1. Open a normal browser profile at [the registration page](http://localhost:8001/register.html).
2. Register `alice@example.invalid` with role **graduate** and a password you choose. The password must contain 8–128 characters, an uppercase letter, a number and a symbol.
3. Open [Mailpit](http://localhost:8025), find the message addressed to Alice and enter its six-digit code in the registration page. Codes expire after ten minutes; use the latest email.
4. Wait for login and automatic encryption-key setup to finish and for the profile page to open. There is no recovery-key task for Alice.
5. Open a **separate browser profile or a different browser** for Bob. Register and verify `bob@example.invalid` in the same way. Two ordinary tabs share cookies and do not represent two independent users.
6. In Alice's browser, open [Search](http://localhost:8001/search.html), find Bob and click **Connect**. The direct conversation opens.
7. Send a text message. In Bob's browser, open [Messages](http://localhost:8001/message.html). The text should appear within a few seconds while the page is visible. Reply from Bob and confirm Alice receives it.
8. For the offline-recipient check, close Bob's browser after his setup has completed. Send another message from Alice, then reopen Bob's browser. Bob should be able to read it without any key exchange or action by Alice.

Only direct **text** is included in this slice. Images, full personal-state actions, legacy/group migration and forgotten-password recovery remain later milestones. Some unrelated profile/forum/settings actions still report that they are unavailable; that does not mean the implemented messenger is using mock data.

## 9. Test session continuity and password change

### Page and browser continuity

In Alice's browser:

1. Navigate from Profile to Messages, Search and Settings.
2. Reload the page and open another tab in the **same browser profile**.
3. Close and reopen the browser, using the same persistent profile and `localhost:8001`.

Expected: a valid session and working secure browser storage restore the keys automatically. No repeated password or chat-specific unlock is required. If IndexedDB/CryptoKey storage is blocked, the UI explains why password entry is needed after navigation; password-based reading on the current page remains possible.

To test a genuinely new device, use another clean browser profile and log in with Alice's password. Its permitted history should open without Bob being online, without creating a new identity, and without manually importing a key.

### Ordinary password change

1. Keep Alice logged in in two separate browser profiles, representing two devices.
2. In one profile, open [Settings](http://localhost:8001/settings.html), expand the Password editor, enter the current password and confirm a new password.
3. If email verification is enabled for the account, complete the inline code step using Mailpit.
4. Confirm that the current browser is signed in and can still read the old conversation. Send another text.
5. In the other profile, refocus/reload or access Messages. Its old session should be rejected.
6. Confirm the old password no longer logs in and the new password opens the same history in a clean profile.

Unrelated settings toggles are currently disabled in HTTP mode. You do not need to enable any of them to change the password.

## 10. If something fails

| Symptom | What to check |
| --- | --- |
| Port 3004/8001 already in use, or old behavior still appears | Stop the old app processes and start both servers from this checkout. Reload the browser afterward. |
| `release version 25 not supported`, missing `javac`, or wrong Maven JVM | Select the full JDK 25, export its `JAVA_HOME`/`PATH`, then check `./mvnw --version`. |
| Backend does not start or reports missing auth tables | Check the SQL credentials and run the explicit upgrade through V4. Starting the backend never applies migrations. |
| Registration produces no verification email | Check the invitation's exact email/role, Mailpit and SMTP port 1025. Uninvited registration is deliberately neutral. |
| Verification succeeds but key setup cannot finish | Check OpenBao is unsealed, the JVM trusts its certificate, and `OPENBAO_TOKEN_FILE` points to a valid narrow service token. Retry login after fixing the prerequisite. |
| Token stopped working after a long shutdown | The backend token is periodic and needs renewal. If it expired while the backend was stopped, an operator must issue/install a replacement using the [runbook](infra/openbao/README.md). Keep the existing Transit key and volume. |
| Origin/cookie/refresh failures | Use `localhost` consistently, port 8001 for the frontend, and the matching allowed origin. Do not open HTML via `file://`. |
| Sending says a participant is unconfigured | Both users must finish a verified password login and automatic setup at least once. |
| Browser asks for a password after navigation | Check secure browser storage permissions and whether the session expired/was revoked. A signed-out profile must perform normal login. |
| Old demo chats/users are absent | The HTTP messenger does not seed mock accounts or silently import legacy plaintext messages. Register the invited test users. |
| Too many email attempts | Respect resend/aggregate limits. Do not repeatedly register the same address or restart verification to bypass a limit. |

## 11. Optional: run the complete automated checks

Manual live testing does not require these frontend test dependencies. For the reproducible acceptance suite, keep the same full JDK selected and run from the project root:

```sh
source "$HOME/.config/polylink/local.env"
export PATH="$JAVA_HOME/bin:$PATH"
export DB_TEST_ADMIN_USERNAME="$DB_USERNAME"
export DB_TEST_ADMIN_PASSWORD="$DB_PASSWORD"
npm ci --prefix tools/contracts --ignore-scripts
npm ci --prefix tools/m1 --ignore-scripts
npx --prefix tools/m1 playwright install chromium
npm test --prefix tools/contracts
./backend/mvnw -f backend/pom.xml verify
python3 tools/m1/verify.py --continuity
```

Use separate test-administrator credentials if your runtime SQL user cannot create/drop disposable databases. Node 22+ is required for this optional suite. The runner provisions its own temporary SQL database, TLS OpenBao and Mailpit on separate ports, runs M1–M3 checks and cleans them up. It does not upgrade your working database or use your live OpenBao instance. It also proves clean-browser login/history and ordinary password change while its test OpenBao instance is sealed.

## 12. Stop and resume later

Use Ctrl+C in the frontend/backend terminals. Keep the existing SQL/OpenBao volumes and the local environment file. On the next run, check infrastructure and unseal status, load `local.env`, and repeat step 7. Run the upgrade step again after pulling new migrations; existing admitted users simply log in.

The backend renews its OpenBao service token while running. After a sufficiently long shutdown, new account setup may need an operator token renewal/replacement even though existing password-based logins and message history can work without OpenBao.
