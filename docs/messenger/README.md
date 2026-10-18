# M0 contract and schema handoff

Implemented 18 October 2026 against the [messenger specification](../messenger_spec.md) and [implementation plan](../messenger_implementation_plan.md). This milestone adds reviewable contracts and executable migration/format validation. Messenger endpoints remain unavailable; it does not implement M1 authentication or ship encryption to users.

Follow-up: [M1 identity and backed-up key setup](m1.md) implements the approved invitation/email flow, real sessions, local crypto assets and guarded key publication. The API is now version 0.2.0; the evidence below records the earlier M0 baseline.

| Artifact | Purpose |
| --- | --- |
| [OpenAPI 0.1.0](contracts/openapi.yaml) | 33 operations, strict request/response DTOs, independent versions, cookie/Bearer boundaries, pagination and replay/recovery transitions. |
| [PLK1 decision](crypto-format.md) and [registry](contracts/plk1.json) | Selected primitives, exact encoding/AAD/KDF contexts, packet limits and local-device exception. |
| [Client payload schemas](contracts/client-payloads.schema.json) | Decrypted message/image metadata and historical private-key vault; these objects never become HTTP request bodies. |
| [DTO fixtures](fixtures/contracts.json), [state fixtures](fixtures/transitions.json), [crypto vectors](fixtures/crypto-vectors.json) | Positive/negative secret/nonce/version cases, recovery terminal states and reproducible cryptographic compatibility checks. |
| [Schema inventory/workflow](schema-and-migrations.md) | Physical mapping, guarded fresh/restore migration commands, transaction/locking rules and legacy dependencies. |
| [Migration tests](../../backend/src/test/java/am/polylink/DatabaseMigrationIT.java) | Isolated real-SQL acceptance, retained legacy content, checksum validation and refusal of drift. |

## Validation evidence

- Backend verification passed: two HTTP/security tests and four SQL integration tests (three migration tests and the JDBC Unicode/rollback probe). No skipped checks; only disposable uniquely named databases were migrated.
- Fresh V1 + V2 installation structurally matches all 27 inspected legacy tables. Guarded restored-schema upgrade is repeatable and preserves synthetic legacy plaintext. Schema drift is rejected.
- An actual May `.bak` was restored into a separate disposable database and upgraded through the documented `SchemaCommand`. Its 60 users, 55 messages and SHA-256 of the complete ordered legacy message rows were unchanged; no security/admission rows were created. The disposable restore was removed. The working `polylink` database was not migrated.
- OpenAPI validates, all positive/negative DTO fixtures pass and terminal recovery states have no outgoing transition.
- Four Node crypto tests pass using pinned libsodium.js 0.8.4. Fixed Argon2id, AEAD and sealed-envelope fixtures also matched native PyNaCl/libsodium independently. This is primitive/encoding evidence, not a claim of full protocol auditing or browser timing acceptance.

Run the portable contract checks from the repository root:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r tools/contracts/requirements.txt
.venv/bin/python tools/contracts/validate.py
npm ci --prefix tools/contracts --ignore-scripts
npm test --prefix tools/contracts
```

Run `./mvnw verify` from `backend/` for checks without a database. For full M0 SQL checks, set the JDBC probe connection and dedicated `DB_TEST_ADMIN_PASSWORD` as described in the [schema workflow](schema-and-migrations.md), then run `./mvnw -Pdatabase-tests verify`. CI adds contract checks and isolated migrations using the same commands; hosted CI and actual macOS execution have not been run in this session.

## Gates carried into implementation

M1 must establish authoritative admission/registry enrollment and verified-email ownership, including safe enrollment of existing users. Current schema supplies neither proof; M0 grants nobody admission. The general registry claim/exception policy remains to be agreed before accepting production accounts.

Before M1 acceptance, measure Argon2id and IndexedDB `CryptoKey` behavior on the target Linux/macOS browsers; pin the audited server password-hash implementation/parameters, mail delivery/aggregate limits and OpenBao image/storage/TLS/service policy. Opaque access credentials, 10-minute access lifetime, refresh/recovery cookie isolation and format/version rules are the chosen engineering baseline. No secret may reach logs or persistent queues.

M2/M4 must prove actual transaction serialization, send/result authorization, recovery failpoints and concurrent activation. M6 must resolve the source timezone, explicit treatment of the 55 plaintext fixtures, retention/export/deletion and recovery from older backups. Existing group membership must be deliberately imported; no group or private-key state is manufactured from plaintext history. The legacy table copy is preserved until that reviewed migration exists.

These gates do not reopen the agreed platform-trusted recovery model, six-digit email-code rules, session durations, fixed group scope or automatic rotation after service unlock.
