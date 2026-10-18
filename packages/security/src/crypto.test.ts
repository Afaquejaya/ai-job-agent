import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createDataCipher, DecryptionError } from './crypto';

const key = () => randomBytes(32).toString('base64');

describe('createDataCipher', () => {
  it('round-trips bytes and text', () => {
    const cipher = createDataCipher(key());
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    expect(cipher.decrypt(cipher.encrypt(bytes, 'ctx'), 'ctx')).toEqual(bytes);
    expect(cipher.decryptText(cipher.encryptText('Résumé – ✓', 'ctx'), 'ctx')).toBe('Résumé – ✓');
  });

  it('never produces the same ciphertext twice and does not contain the plaintext', () => {
    const cipher = createDataCipher(key());
    const a = cipher.encryptText('secret cv text', 'ctx');
    const b = cipher.encryptText('secret cv text', 'ctx');
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    expect(Buffer.from(a).toString('utf8')).not.toContain('secret cv text');
  });

  it('rejects a ciphertext used with a different context (no row/user swapping)', () => {
    const cipher = createDataCipher(key());
    const payload = cipher.encryptText('alice cv', 'resume:alice');
    expect(() => cipher.decryptText(payload, 'resume:bob')).toThrow(DecryptionError);
  });

  it('rejects tampered data and the wrong key', () => {
    const cipher = createDataCipher(key());
    const payload = cipher.encryptText('data', 'ctx');
    const tampered = new Uint8Array(payload);
    tampered[20] = (tampered[20] ?? 0) ^ 0xff;
    expect(() => cipher.decrypt(tampered, 'ctx')).toThrow(DecryptionError);
    expect(() => createDataCipher(key()).decrypt(payload, 'ctx')).toThrow(DecryptionError);
    expect(() => cipher.decrypt(new Uint8Array([1, 2, 3]), 'ctx')).toThrow(DecryptionError);
  });

  it('requires a 32-byte key', () => {
    expect(() => createDataCipher(randomBytes(16).toString('base64'))).toThrow(/32 random bytes/);
  });
});
