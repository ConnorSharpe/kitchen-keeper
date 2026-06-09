import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Must be set before importing the module under test
process.env.API_KEY_ENCRYPTION_SECRET = 'a'.repeat(64); // 32 bytes as hex

const { encrypt, decrypt, maskKey } = await import('./keyEncryption.js');

describe('keyEncryption — round-trip', () => {
  test('encrypt then decrypt returns original plaintext', () => {
    const key = 'sk-ant-api03-test-key-abcdefgh12345678';
    assert.strictEqual(decrypt(encrypt(key)), key);
  });

  test('each encrypt call produces a different ciphertext (random IV)', () => {
    const key = 'test-key';
    assert.notStrictEqual(encrypt(key), encrypt(key));
  });
});

describe('keyEncryption — versioned format', () => {
  test('ciphertext matches v1:<iv_hex>:<tag_hex>:<ct_hex>', () => {
    const ct = encrypt('any-key-value');
    assert.match(ct, /^v1:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
  });
});

describe('keyEncryption — maskKey', () => {
  test('returns first4...last4', () => {
    assert.strictEqual(maskKey('sk-ant-api03-xK9z'), 'sk-a...xK9z');
  });

  test('returns *** for short keys', () => {
    assert.strictEqual(maskKey('abc'), '***');
  });
});

describe('keyEncryption — tamper detection', () => {
  test('decrypt throws on tampered ciphertext', () => {
    const ct = encrypt('secret-key');
    // Corrupt the last two hex chars of the ciphertext segment
    const tampered = ct.slice(0, -2) + (ct.slice(-2) === 'ff' ? '00' : 'ff');
    assert.throws(() => decrypt(tampered));
  });

  test('decrypt throws on invalid format', () => {
    assert.throws(() => decrypt('not-valid-at-all'));
  });
});
