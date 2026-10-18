// Regenerate only when deliberately changing PLK1. Inputs are public synthetic fixtures.
import sodium from 'libsodium-wrappers-sumo';
import { readFile, writeFile } from 'node:fs/promises';
await sodium.ready;
const hex = sodium.to_hex;
const salt = Uint8Array.from({ length: 16 }, (_, i) => i);
const password = 'Synthetic PLK1 fixture only!';
const master = sodium.crypto_pwhash(32, password, salt, 2, 67108864, sodium.crypto_pwhash_ALG_ARGON2ID13);
const auth = sodium.crypto_kdf_derive_from_key(32, 1, 'PLK1AUTH', master);
const wrap = sodium.crypto_kdf_derive_from_key(32, 1, 'PLK1WRAP', master);
const aad = JSON.stringify(['PLK1', 'message', '00000000-0000-4000-8000-000000000001', '7', '00000000-0000-4000-8000-000000000002', '1', '1']);
const plaintext = JSON.stringify({text:'Synthetic բարեւ 😀',attachment:null});
const key = Uint8Array.from({length:32},(_,i)=>i);
const nonce = Uint8Array.from({length:24},(_,i)=>i+32);
const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext,aad,null,nonce,key);
const pair = sodium.crypto_box_seed_keypair(new Uint8Array(32).fill(11));
const envelopePlaintext = JSON.stringify(['PLK1','room-key','00000000-0000-4000-8000-000000000001','7','3','1','1',sodium.to_base64(key,sodium.base64_variants.URLSAFE_NO_PADDING)]);
let existing;
try { existing=JSON.parse(await readFile(new URL('../../docs/messenger/fixtures/crypto-vectors.json',import.meta.url))); } catch {}
const envelope = existing?.envelope?.ciphertextHex || hex(sodium.crypto_box_seal(envelopePlaintext,pair.publicKey));
await writeFile(new URL('../../docs/messenger/fixtures/crypto-vectors.json',import.meta.url),JSON.stringify({password:{password,saltHex:hex(salt),masterHex:hex(master),loginSecretHex:hex(auth),passwordWrapHex:hex(wrap)},message:{keyHex:hex(key),nonceHex:hex(nonce),aad,plaintext,ciphertextHex:hex(ciphertext)},envelope:{privateKeyHex:hex(pair.privateKey),publicKeyHex:hex(pair.publicKey),plaintext:envelopePlaintext,ciphertextHex:envelope}},null,2)+'\n');
