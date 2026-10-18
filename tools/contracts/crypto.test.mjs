import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import sodium from 'libsodium-wrappers-sumo';
await sodium.ready;
const vectors = JSON.parse(await readFile(new URL('../../docs/messenger/fixtures/crypto-vectors.json',import.meta.url)));
const registry = JSON.parse(await readFile(new URL('../../docs/messenger/contracts/plk1.json',import.meta.url)));
const bytes = sodium.from_hex;

test('pinned JS build exposes the agreed Argon2id/KDF and packet operations',()=>{
  for (const fn of ['crypto_pwhash','crypto_kdf_derive_from_key','crypto_aead_xchacha20poly1305_ietf_encrypt','crypto_box_seal','crypto_box_seal_open']) assert.equal(typeof sodium[fn],'function',fn);
  assert.equal(registry.libsodiumJs, '0.8.4');
  assert.equal(new Set(registry.versions).size,6);
});
test('Argon2id precedes independent authentication and wrapping derivation',()=>{
  const v=vectors.password;
  const master=sodium.crypto_pwhash(32,v.password,bytes(v.saltHex),registry.password.opsLimit,registry.password.memoryBytes,sodium.crypto_pwhash_ALG_ARGON2ID13);
  assert.equal(sodium.to_hex(master),v.masterHex);
  for(const [field,expected] of [['login','loginSecretHex'],['passwordWrap','passwordWrapHex']]) {
    const k=registry.kdf[field];
    assert.equal(Buffer.byteLength(k.context),8);
    assert.equal(sodium.to_hex(sodium.crypto_kdf_derive_from_key(32,k.id,k.context,master)),v[expected]);
  }
  assert.notEqual(v.loginSecretHex,v.passwordWrapHex);
});
test('UTF-8 message and binding match the fixed AEAD vector; tampering fails',()=>{
  const v=vectors.message;
  assert.equal(sodium.to_hex(sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(v.plaintext,v.aad,null,bytes(v.nonceHex),bytes(v.keyHex))),v.ciphertextHex);
  const decrypt=(c,a)=>sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null,c,a,bytes(v.nonceHex),bytes(v.keyHex),'text');
  assert.equal(decrypt(bytes(v.ciphertextHex),v.aad),v.plaintext);
  assert.throws(()=>decrypt(bytes(v.ciphertextHex),v.aad.replace('"7"','"8"')));
  const corrupt=bytes(v.ciphertextHex); corrupt[0]^=1;
  assert.throws(()=>decrypt(corrupt,v.aad));
});
test('sealed envelope opens only with the recipient private key and includes its bindings',()=>{
  const v=vectors.envelope;
  const plain=sodium.crypto_box_seal_open(bytes(v.ciphertextHex),bytes(v.publicKeyHex),bytes(v.privateKeyHex),'text');
  assert.equal(plain,v.plaintext);
  const bindings=JSON.parse(plain);
  assert.deepEqual(bindings.slice(0,2),['PLK1','room-key']);
  assert.equal(bindings[3],'7');
  const other=sodium.crypto_box_keypair();
  assert.throws(()=>sodium.crypto_box_seal_open(bytes(v.ciphertextHex),other.publicKey,other.privateKey));
});
