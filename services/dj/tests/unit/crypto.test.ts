import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('crypto utility (AES-256-GCM)', () => {
  const validKey = 'a'.repeat(64); // 64 hex chars = 32 bytes

  beforeEach(() => {
    process.env.SOCIAL_TOKEN_ENCRYPTION_KEY = validKey;
  });

  afterEach(() => {
    delete process.env.SOCIAL_TOKEN_ENCRYPTION_KEY;
  });

  it('encrypt returns a colon-separated string with 3 parts', async () => {
    const { encrypt } = await import('../../src/lib/crypto');
    const result = encrypt('hello world');
    const parts = result.split(':');
    expect(parts).toHaveLength(3);
  });

  it('decrypt is the inverse of encrypt (roundtrip)', async () => {
    const { encrypt, decrypt } = await import('../../src/lib/crypto');
    const plaintext = 'super-secret-oauth-token-12345';
    expect(decrypt(encrypt(plaintext))).toBe(plaintext);
  });

  it('produces different ciphertext each call (random IV)', async () => {
    const { encrypt } = await import('../../src/lib/crypto');
    const a = encrypt('same-value');
    const b = encrypt('same-value');
    expect(a).not.toBe(b);
  });

  it('throws on tampered ciphertext', async () => {
    const { encrypt, decrypt } = await import('../../src/lib/crypto');
    const enc = encrypt('sensitive');
    const tampered = enc.slice(0, -4) + 'ffff';
    expect(() => decrypt(tampered)).toThrow();
  });

  it('throws if SOCIAL_TOKEN_ENCRYPTION_KEY is not set', async () => {
    delete process.env.SOCIAL_TOKEN_ENCRYPTION_KEY;
    const { encrypt } = await import('../../src/lib/crypto');
    expect(() => encrypt('anything')).toThrow(/SOCIAL_TOKEN_ENCRYPTION_KEY/);
  });

  it('throws if key is wrong length', async () => {
    process.env.SOCIAL_TOKEN_ENCRYPTION_KEY = 'short';
    const { encrypt } = await import('../../src/lib/crypto');
    expect(() => encrypt('anything')).toThrow(/64 hex/);
  });
});
