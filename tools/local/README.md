# Local setup tools

Start with the [root quickstart](../../README.md). Scripts locate their own checkout, so they can run from a different current directory. They require Python 3.10+; Bash wrappers are compatible with macOS Bash 3.2, and `env.sh` can be sourced in Bash or Zsh.

| Command | Work performed |
| --- | --- |
| `bash tools/local/setup.sh` | Find/validate a full JDK 25; generate/load configuration from `config.example.json`; preserve HMAC/replay keys; adopt existing local SQL settings and OpenBao TLS/token paths when available; prepare stable infrastructure files and a JVM truststore. No service start, SQL connection or migration. |
| `source tools/local/env.sh` | Load private configuration into the current shell, resolve JDK 25 again, set PATH and replace only the local truststore JVM options while retaining other options. No provisioning. |
| `bash tools/local/provision-openbao.sh` | Provision a running loopback HTTPS OpenBao for local development, with guarded initialization/unseal, existing Transit-key validation and narrow token creation/renewal. No Docker or SQL start. |
| `bash tools/local/test.sh` | Install pinned test dependencies; run setup, client/crypto, OpenAPI and backend checks. |
| `bash tools/local/test.sh --full` | Include combined isolated SQL/SMTP/TLS/browser acceptance through the groups runner, including forum regressions. |
| `bash tools/local/test.sh --forum` | Run focused forum SQL/mail/browser acceptance. |

Simple starts remain explicit in the README: Maven for the backend, Python for the frontend, and Docker Compose for mail/OpenBao. Migrations remain explicit commands; new accounts use [registry enrollment](../../docs/registry_enrollment.md). Invitations are retired.

## State and worktrees

The default state directory is `$HOME/.config/polylink`. Override it by exporting `POLYLINK_LOCAL_DIR` before setup and sourcing. Private state must be outside the checkout. `--config-dir /absolute/path` can also select a setup destination, but export the same directory before sourcing `env.sh`.

- `local.env`: shell-quoted literal exports, mode 0600. Edit SQL settings here. Existing configured values win over template/environment defaults; missing secrets are generated independently. Do not use shell commands or variable expansions in values.
- `security/compose.yaml`, `security/openbao.hcl`, `security/backend-policy.hcl`: generated from tracked sources, outside worktrees.
- `security/tls/server.crt` and `server.key`: reused from the existing local OpenBao container where possible, otherwise generated once for localhost. A partial/mismatched pair is an error, never a reason to overwrite a key. The local root directory restricts access; private key files are mode 0600.
- `openbao-truststore`: starts from the selected JDK's normal CA roots. Certificate-fingerprint aliases avoid duplicate imports; newly configured local certificates are added atomically. Other JVM options are preserved. `changeit` protects a local certificate store, not user/application keys.
- `openbao.token`: only the narrow application's service credential, mode 0600. An existing token is copied out of an old worktree so subsequent app startup does not depend on that checkout.
- `test-venv`: test-only Python dependencies.

Generated Compose keeps the existing `polylink-security_openbao-data` volume. A short initialization service copies TLS material into a dedicated Docker volume with the pinned image's OpenBao ownership, allowing private host files on Linux and macOS without world-readable keys or a root-running OpenBao server. All ports bind to loopback. Recreating an existing OpenBao container preserves Raft data but seals it until its existing shares are supplied.

Existing container discovery reads paths from Docker metadata and imports only local database settings and matching TLS/token files. It does not discover or copy initialization root credentials/unseal shares. `--no-discovery` prepares an independent config without inspecting the existing service; use a separate Docker project/ports for independent running infrastructure.

## Local operator state

For a genuinely fresh server, provisioning initializes five shares with threshold three and stores the initialization result in the separate sibling directory `$HOME/.config/polylink-operator` (0700 directory/0600 file). This automatic, single-machine custody is **development only**. It never becomes an application environment variable or backend token. For deployment, use the [operator runbook](../../infra/openbao/README.md) and separate custody/backups.

An already-initialized server is never initialized again. If it is sealed and no matching local operator state is available, supply the three existing shares interactively:

```sh
docker compose -f "$POLYLINK_SECURITY_COMPOSE" exec openbao bao operator unseal
```

Repeat with three distinct shares. If its narrow token is expired, an operator can install a replacement at `OPENBAO_TOKEN_FILE`, or point the provisioning command at an existing **local development** initialization bundle:

```sh
bash tools/local/provision-openbao.sh --operator-dir /private/existing-operator-directory
```

The directory must contain `openbao-init.json` and be outside both the checkout and application state. Existing Transit keys are read/validated before use and never deleted, replaced, exported or rotated by setup. If operator authorization is unavailable, the script stops with instructions. It does not guess credentials or disable TLS verification.

## Testing these tools

No running services/configuration are touched by the normal unit tests:

```sh
python3 -m unittest discover -s tools/local -p 'test_*.py' -v
```

They cover literal secret quoting, permissions, preservation/repeated runs, paths with spaces, Bash/Zsh loading, Linux/macOS JDK discovery, truststore imports and existing-server authorization safeguards. The macOS discovery branch is mocked locally; CI also runs the suite on an actual macOS runner.

An explicit Docker smoke test creates uniquely named disposable volumes/containers, runs the generated Compose stack and checks real TLS, initialization, idempotency, unseal, token replacement and preserved Transit material:

```sh
python3 tools/local/test_infrastructure.py
```

Its cleanup removes only that uniquely named disposable project. It does not provision or stop the developer's running OpenBao.

## Recovery reports service unavailable

`POST /auth/recovery/unlock` needs the real OpenBao Transit service. SQL migrations alone do not configure Java TLS. If OpenBao is unsealed and its narrow token is valid but recovery still fails, inspect the backend terminal for TLS/truststore failures. Stop the backend, run `bash tools/local/setup.sh`, then `source tools/local/env.sh` and restart from that same terminal. An environment loaded before local setup, or one loaded directly from `local.env`, can lack `JAVA_TOOL_OPTIONS` and leave Java unable to trust the local certificate. Environment changes do not update an already-running Java process.

Setup reuses the existing certificate/key and copies the narrow token into the stable private state directory. It does not reinitialize OpenBao, replace Transit keys or modify account data. If the token has expired, use the existing provisioning command and operator state as described above.

## SMTP timeouts in disposable acceptance tests

A `503 SERVICE_UNAVAILABLE` while requesting a registration/recovery code, followed by “Verification email was not delivered”, can originate before any message is sent. Mailpit normally performs a reverse DNS lookup before its SMTP greeting. An unavailable Docker DNS resolver can delay that greeting beyond the backend's five-second read timeout. The [Mailpit runtime options](https://mailpit.axllent.org/docs/configuration/runtime-options/) document `MP_SMTP_DISABLE_RDNS` for this case.

The tracked local Compose template and disposable acceptance fixture disable SMTP reverse DNS. The fixture waits for `/readyz` and an SMTP greeting/NOOP before tests, and explicitly overrides inherited SMTP credentials/auth/STARTTLS settings for its isolated, unauthenticated loopback Mailpit. Application SMTP timeouts remain five seconds, and genuine delivery failures still fail tests. Recovery test fixtures assert the request's HTTP status before trying to read an email, so a send failure is reported directly.

For an existing local Mailpit, run `bash tools/local/setup.sh`, reload `source tools/local/env.sh`, then run `docker compose -f "$POLYLINK_SECURITY_COMPOSE" up -d mailpit` to apply the updated template. The acceptance runner creates its own temporary Mailpit and needs no change to running local services.

For focused SQL/SMTP registration, identity and recovery checks, load the environment, set `DB_TEST_ADMIN_USERNAME`/`DB_TEST_ADMIN_PASSWORD` to the disposable-database administrator, then run:

```sh
python3 tools/m1/verify.py --mail
```

A database-free Docker regression deliberately gives the isolated Mailpit an unreachable TEST-NET DNS resolver and verifies 80 SMTP messages with the unchanged five-second client timeout:

```sh
python3 tools/m1/mailpit_smoke.py
```

It creates/removes only a uniquely named temporary container. Fixture unit tests (`python3 -m unittest discover -s tools/m1 -p 'test_*.py'`) exercise bounded readiness, delayed greetings and unexpected HTTP errors; the standard `tools/local/test.sh` runs them too.

On 27 October 2026 the controlled comparison produced 8/8 SMTP greeting timeouts with reverse DNS enabled and 0/8 failures with it disabled (maximum 39 ms). The fixed 80-message regression completed in 1.3 seconds. This isolates the dependency on Docker DNS rather than compensating with longer application timeouts or retrying failed API requests.

After the fix, the full disposable suite passed all 58 integration tests and 16 backend unit tests. Two further `--mail` runs each passed all 21 enrollment/identity/recovery integration tests on fresh temporary databases. All seven fixture unit tests and twelve local-tooling tests passed as well; temporary containers/databases were removed after every run.
