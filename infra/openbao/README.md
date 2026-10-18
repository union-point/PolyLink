# OpenBao for PolyLink M1

The [Compose service](compose.yaml) runs pinned OpenBao 2.7.1 in normal server mode, with TLS, persistent single-node Raft storage and manual operator unseal. The application uses only [the backend policy](backend-policy.hcl). The browser never contacts OpenBao. Default SQL/Java startup does not create this infrastructure or initialize its keys.

## Provisioning

Put an issued server certificate and private key at ignored `tls/server.crt` and `tls/server.key`; configure certificate names for the backend's chosen address. The reference local address is `https://localhost:18200`. Restrict the private key to the container identity, and trust the issuing CA in the backend JVM. Keep the normal JVM trust roots when adding a private CA. Change the listener/api addresses for a real deployment; the reference host port is loopback-only.

```sh
cd infra/openbao
docker compose up -d openbao
```

Initialize once with five unseal shares and a threshold of three. Redirect JSON output to an operator-controlled protected location outside this repository and SQL backup storage, then distribute shares to separate custody. For example, with `POLYLINK_ADMIN_DIR` already identifying that protected location:

```sh
docker compose exec -T openbao bao operator init -key-shares=5 -key-threshold=3 -format=json > "$POLYLINK_ADMIN_DIR/openbao-init.json"
docker compose exec openbao bao operator unseal
```

The interactive unseal command requests one share; repeat with three distinct shares. Never put shares/root credentials in application configuration, the database, a container image or this repository. Operator login and the following provisioning use the operator's CLI credentials, not the application's token:

```sh
bao secrets enable transit
bao write transit/keys/polylink-vault type=aes256-gcm96 derived=true exportable=false allow_plaintext_backup=false
bao policy write polylink-backend backend-policy.hcl
bao token create -policy=polylink-backend -period=1h -no-default-policy -format=json
```

Set `BAO_ADDR`/`BAO_CACERT` appropriately before using the host CLI. Capture the token-create output securely and install only its `auth.client_token` as the backend-readable token file; do not print it to application logs. The backend reads `OPENBAO_TOKEN_FILE` for each request so operators can replace a revoked token without embedding credentials in images or SQL. It renews the periodic token every ten minutes. The policy grants only this key's encrypt/decrypt plus token-self lookup/renew; it cannot create/export/delete Transit keys or administer OpenBao. Do not run the backend with the initialization root token.

On key creation leave convergent encryption off. PLK1 derives a context from owner, purpose and vault-key version. Setup checks an encrypt/decrypt round-trip before publishing an identity. M1 has no user-facing service-unlock route; possession of an ordinary session never authorizes that operation.

## Restart, backup and outages

After restart the persisted server is sealed until three shares are provided. The backend returns a retryable service-unavailable result for setup without publishing an identity or losing an existing vault. Ordinary login with an established password copy and local device unlock continue without OpenBao. Keep the persistent volume; `down -v` is destructive and is not a normal shutdown operation.

Back up Raft snapshots through the operator CLI and protect/store them independently. Keep the required protective-key versions for all live service copies and supported SQL backups. Restore SQL and a compatible OpenBao snapshot in an isolated rehearsal; verify a retained service copy with the proper context before relying on the backup. Operator unseal shares must remain separately recoverable. Rewrap/Transit key maintenance stays an operator activity and never changes message ciphertext. A volume alone is not a backup.

Monitor sealing, errors and token-renewal failures. Application errors are deliberately generic and exclude response/request bodies, codes, tokens and open vault keys. Disable body capture in reverse proxies/tracing as well. Single-node Raft is the agreed first-version availability model; operator unseal is independent of users' login/recovery.

## Local mail and automated acceptance

For local development only, `docker compose --profile local-mail up -d mailpit` exposes SMTP on `localhost:1025` and the capture UI on `localhost:8025`. Configure real authenticated TLS mail delivery before using external recipients.

`python3 tools/m1/verify.py --browser` from the repository root creates its own uniquely named disposable TLS OpenBao server, local SMTP capture server and SQL database. Its one-share test-only initialization is generated in an owner-only temporary directory, never used by normal Compose or a deployment. Only the narrow app token is configured in the backend. All disposable resources are removed after the checks; it does not initialize or migrate the working database.
