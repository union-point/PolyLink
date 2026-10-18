# PLK1 cryptographic format decision

Status: M0 implementation baseline, 18 October 2026. [Registry](contracts/plk1.json), [OpenAPI](contracts/openapi.yaml) and [synthetic vectors](fixtures/crypto-vectors.json) form one versioned contract. The [specification](../messenger_spec.md) controls trust and recovery behavior. This decision selects formats; it does not assert protocol auditing or completed browser acceptance.

## Primitives and encoding

Pin `libsodium-wrappers-sumo` and its underlying sumo distribution to 0.8.4 through the [contract harness lockfile](../../tools/contracts/package-lock.json). The sumo build exposes password hashing as well as the chosen KDF, AEAD and sealed-box operations. The harness checks those actual exports. Vendor reviewed browser assets in M1; a runtime CDN fetch is not the production supply path.

Use UTF-8, unpadded canonical base64url for binary JSON fields and decimal strings for versions/sequences. Reject invalid decoded lengths, noncanonical base64 and unsupported schemes before expensive work. UUIDs are lowercase hyphenated strings. Counter values fit signed SQL BIGINT (0 through 9223372036854775807); object IDs from existing Users fit positive SQL INT. The JSON schema limits representation; application decoders also enforce numeric bounds. Password input is exact UTF-8, without trim/Unicode normalization. Apply the agreed text trim before measuring the 5,000 UTF-16-unit message limit; encrypted payload JSON includes `{text,attachment}` and is at most 32,768 bytes. Empty text is allowed only with an image. Vault plaintext has a 1 MiB initial cap; treat growth beyond this as an explicit storage/format decision rather than dropping old keys.

Use Argon2id13 with a fresh random 16-byte per-account salt, 32-byte output, initial `opslimit=2`, `memlimit=67,108,864`. Validate received bounds before invoking Argon2id: ops 2–4, memory 64–256 MiB. Derive 32-byte subkeys using `crypto_kdf_derive_from_key`:

| Purpose | Exact 8-byte context | Subkey ID |
| --- | --- | --- |
| Authentication secret | `PLK1AUTH` | 1 |
| Password protection of vault key | `PLK1WRAP` | 1 |

Only the canonical base64url login secret goes to auth APIs. Hash its 43-character ASCII representation on the server using a separately salted password hash; never compare it to a stored open secret. The server implementation/parameters and supported-browser timing/memory measurements remain M1 gates. These are provisional cost parameters until browser acceptance, not a benchmark claim. Any adjustment changes stored parameters explicitly; changing contexts requires a scheme migration. Never derive authentication through a cheap independent password hash.

Use XChaCha20-Poly1305-IETF with 32-byte keys, fresh 24-byte random nonces and 16-byte appended tags for vault, password copy, messages, file bytes and encrypted local drafts/outbox. Vault keys and room keys are independently random. A `CipherPacket` carries scheme, nonce and ciphertext; its AAD is reconstructed from authorized metadata. The password copy encrypts exactly 32 vault-key bytes and has 48 ciphertext bytes. Fresh encryption gets a new nonce; retry of a saved/ambiguous operation reuses the exact original packet, without invoking encryption again.

Use `crypto_box_keypair` identities and `crypto_box_seal` participant envelopes. A sealed box adds 48 bytes, accepts no separate AAD and establishes no sender identity. Its plaintext contains the binding tuple below; after opening, compare all bindings with authorized server metadata before using the room key. Clients trust the server's identity directory and authenticated sender attribution. Keep historical private identities in the encrypted user vault and historical envelopes on the server; no peer supplies a user's recovery key.

## Binding tuples

AAD is UTF-8 of a compact JSON array, with the elements in exactly the order shown. All counter/ID entries are strings; no whitespace, BOM or trailing newline. These ASCII-only fields avoid inconsistent Unicode encoders. `roomKeyVersion` and `membershipVersion` are independent. Do not include a future server sequence or timestamp in pre-send AAD.

| Purpose | Tuple |
| --- | --- |
| Message | `["PLK1","message",roomId,senderId,operationId,roomKeyVersion,membershipVersion]` |
| Vault | `["PLK1","vault",userId,vaultKeyVersion,vaultRevision]` |
| Password copy | `["PLK1","password-copy",userId,vaultKeyVersion,credentialVersion]` |
| Image ciphertext | `["PLK1","image",roomId,ownerId,attachmentId]` |
| Persistent draft/outbox | `["PLK1","outbox",userId,roomId,localDraftId,vaultKeyVersion]` |
| Sealed room-key plaintext | `["PLK1","room-key",roomId,recipientId,recipientIdentityVersion,membershipVersion,roomKeyVersion,base64urlRoomKey]` |

The file uses its own random AEAD key. Its key, nonce, attachment ID, original filename, type and plaintext size are inside the encrypted message's attachment object. Only ciphertext bytes go to upload storage. Ciphertext length is plaintext bytes + 16; the 24-byte nonce lives in encrypted metadata, so the server file cap is 5,242,896 bytes. Send idempotency includes the attachment ID/digest; staged uploads may survive a definitive rejected send. The receiver authenticates/decrypts before validating actual image bytes, type, size and safe rendering.

Backend computes the send fingerprint as SHA-256 over UTF-8 of:

```text
["PLK1","send",roomId,authenticatedSenderId,operationId,membershipVersion,
 roomKeyVersion,sortedRecipientVersionTuples,packet.nonce,packet.ciphertext,attachmentIdOrNull]
```

This array is serialized compactly. Sort recipient tuples numerically by existing user ID; reject duplicate recipient IDs, and compare the full list to current membership. An attachment ID uniquely binds immutable uploaded bytes; never replace them. Fingerprints are equality checks, not authentication substitutes. The message packet itself and full version snapshot must still be validated.

For Transit, the backend chooses a fixed protective key and a derived context: base64 of UTF-8 `["PLK1","service-copy",userId,vaultKeyVersion]`. Disable convergent encryption and export. Service ciphertext includes Transit’s own protective-key version and stays in SQL. Only authorized setup/service recovery may submit a vault key for wrapping; wrapping verifies decrypt round-trip before readiness. Unlock takes its stored ciphertext/context from the authorized operation's account, never from browser-supplied values. Implement against a pinned OpenBao version in M1.

## Local device copy and transitions

Device storage follows the agreed exception: Web Crypto AES-256-GCM, `extractable:false`, persisted as an IndexedDB `CryptoKey`. Encrypt the local vault-key copy with a fresh 96-bit IV and AAD `["PLK1","device-copy",userId,recordId,vaultKeyVersion]`. Store account, session-family and credential version next to it and validate them with the server before opening. Device encryption is not used for network packets. Browser structured-clone/quota/multipage tests remain M1/M3 acceptance work; non-extractability does not resist hostile same-origin code.

Never collapse credential version, vault-key version, vault content revision, identity version, membership revision and room-key version. An ordinary password change updates the credential version/password copy, keeping the vault, identity and service context. Local-key recovery does the same. Service unlock selects the service-recovery path, which creates a new vault key and identity and retains historical private keys; commit changes credentials/vault/copies/identity together. New room epochs bind the resulting complete identity snapshot. A setup/rotation candidate is unusable until accepted and fully backed up.

Run `npm ci --prefix tools/contracts && npm test --prefix tools/contracts` to verify the fixed Argon2id/KDF, UTF-8 AEAD, tamper rejection and sealed-box vectors. The keys/passwords in fixtures are public synthetic values, never deployment material. Fixed test nonces are solely for reproducible vectors. Changing vectors requires a deliberate format review; `make-vectors.mjs` preserves its existing randomized sealed-box packet.

Primitive documentation: [libsodium.js](https://github.com/jedisct1/libsodium.js), [Argon2id](https://doc.libsodium.org/password_hashing/default_phf), [KDF](https://doc.libsodium.org/key_derivation), [AEAD](https://doc.libsodium.org/secret-key_cryptography/aead/chacha20-poly1305/xchacha20-poly1305_construction), [sealed boxes](https://doc.libsodium.org/public-key_cryptography/sealed_boxes), [Transit](https://openbao.org/docs/secrets/transit/).
