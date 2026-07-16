import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';

function getSecret() {
  const secret = process.env.API_KEY_ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error(
      'API_KEY_ENCRYPTION_SECRET is not set. Configure this env var to use BYOK household AI keys.'
    );
  }
  return Buffer.from(secret, 'hex');
}

// Returns versioned ciphertext: 'v1:<iv_hex>:<tag_hex>:<ciphertext_hex>'
export function encrypt(plaintext) {
  const key = getSecret();
  const iv = randomBytes(12); // 96-bit IV recommended for GCM
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertextBuf = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('hex')}:${tag.toString('hex')}:${ciphertextBuf.toString('hex')}`;
}

// Decrypts a versioned ciphertext. Throws if secret is wrong, format is invalid, or ciphertext is tampered.
export function decrypt(ciphertext) {
  const key = getSecret();
  const parts = ciphertext.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error(
      'Invalid ciphertext format — expected v1:<iv>:<tag>:<ciphertext>'
    );
  }
  const [, ivHex, tagHex, ctHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const ct = Buffer.from(ctHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ct) + decipher.final('utf8');
}

// Returns a masked preview for display: first 4 chars + '...' + last 4 chars.
export function maskKey(plaintext) {
  if (!plaintext || plaintext.length < 8) return '***';
  return `${plaintext.slice(0, 4)}...${plaintext.slice(-4)}`;
}
