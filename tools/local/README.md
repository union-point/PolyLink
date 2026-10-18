# Local setup tools

Start with the [root quickstart](../../README.md). Scripts locate their own checkout, so they can run from a different current directory. They require Python 3.10+; Bash wrappers are compatible with macOS Bash 3.2, and `env.sh` can be sourced in Bash or Zsh.

| Command | Work performed |
| --- | --- |
| `bash tools/local/setup.sh` | Find/validate a full JDK 25; generate/load configuration from `config.example.json`; preserve HMAC/replay keys; adopt existing local SQL settings and OpenBao TLS/token paths when available; prepare stable infrastructure files and a JVM truststore. No service start, SQL connection or migration. |
| `source tools/local/env.sh` | Load private configuration into the current shell, resolve JDK 25 again, set PATH and replace only the local truststore JVM options while retaining other options. No provisioning. |
| `bash tools/local/provision-openbao.sh` | Provision a running loopback HTTPS OpenBao for local development, with guarded initialization/unseal, existing Transit-key validation and narrow token creation/renewal. No Docker or SQL start. |
| `bash tools/local/test.sh` | Install pinned test dependencies; run setup, client/crypto, OpenAPI and backend checks. |
| `bash tools/local/test.sh --full` | Include the existing isolated M1–M3 SQL/SMTP/TLS/browser acceptance runner. |

Simple starts remain explicit in the README: Maven for the backend, Python for the frontend, and Docker Compose for mail/OpenBao. Migrations and invitations also remain explicit commands.

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
