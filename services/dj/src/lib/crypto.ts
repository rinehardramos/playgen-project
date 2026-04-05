/**
 * AES-256-GCM encryption/decryption for sensitive OAuth tokens stored in the DB.
 *
 * Key: 64-char hex string (32 bytes) from SOCIAL_TOKEN_ENCRYPTION_KEY env var.
 * Stored format: "<iv_hex>:<authTag_hex>:<ciphertext_hex>"
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';

function getKey(): Buffer {
  const keyHex = process.env.SOCIAL_TOKEN_ENCRYPTION_KEY;
  if (!keyHex) {
    throw new Error(
      'SOCIAL_TOKEN_ENCRYPTION_KEY is not set. ' +
      'Generate a 64-char hex key: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  if (keyHex.length !== 64) {
    throw new Error('SOCIAL_TOKEN_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes).');
  }
  return Buffer.from(keyHex, 'hex');
}

/** Encrypt plaintext. Returns "<iv_hex>:<authTag_hex>:<ciphertext_hex>". */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12);                            // 96-bit IV for GCM
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
}

/** Decrypt a value produced by {@link encrypt}. Throws on tampering or wrong key. */
export function decrypt(encoded: string): string {
  const parts = encoded.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted value format — expected "<iv>:<tag>:<ciphertext>".');
  }
  const [ivHex, authTagHex, ciphertextHex] = parts;
  const key = getKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
