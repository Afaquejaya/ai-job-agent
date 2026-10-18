import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Application-level encryption for sensitive data at rest (CV files, extracted CV text,
 * parsed CV data). AES-256-GCM with a random 96-bit IV per message.
 *
 * Every call takes a `context` string that is bound into the authentication tag (AAD). A
 * ciphertext copied to another row, user or storage key therefore fails to decrypt instead of
 * silently revealing someone else's data.
 *
 * Payload layout: [format version (1 byte)] [IV (12 bytes)] [ciphertext] [auth tag (16 bytes)]
 */
const FORMAT_VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class DecryptionError extends Error {
  constructor() {
    super('Data could not be decrypted (wrong key, wrong context or tampered data)');
    this.name = 'DecryptionError';
  }
}

export interface DataCipher {
  encrypt(plaintext: Uint8Array, context: string): Uint8Array<ArrayBuffer>;
  decrypt(payload: Uint8Array, context: string): Uint8Array<ArrayBuffer>;
  encryptText(text: string, context: string): Uint8Array<ArrayBuffer>;
  decryptText(payload: Uint8Array, context: string): string;
}

/** @param base64Key 32 random bytes, base64-encoded (DATA_ENCRYPTION_KEY). */
export function createDataCipher(base64Key: string): DataCipher {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32) {
    throw new Error('DATA_ENCRYPTION_KEY must be 32 random bytes, base64-encoded');
  }

  const encrypt = (plaintext: Uint8Array, context: string): Uint8Array<ArrayBuffer> => {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return new Uint8Array(
      Buffer.concat([Buffer.from([FORMAT_VERSION]), iv, body, cipher.getAuthTag()]),
    );
  };

  const decrypt = (payload: Uint8Array, context: string): Uint8Array<ArrayBuffer> => {
    if (payload.length < 1 + IV_BYTES + TAG_BYTES || payload[0] !== FORMAT_VERSION) {
      throw new DecryptionError();
    }
    const data = Buffer.from(payload);
    const iv = data.subarray(1, 1 + IV_BYTES);
    const tag = data.subarray(data.length - TAG_BYTES);
    const body = data.subarray(1 + IV_BYTES, data.length - TAG_BYTES);
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAAD(Buffer.from(context, 'utf8'));
      decipher.setAuthTag(tag);
      return new Uint8Array(Buffer.concat([decipher.update(body), decipher.final()]));
    } catch {
      throw new DecryptionError();
    }
  };

  return {
    encrypt,
    decrypt,
    encryptText: (text, context) => encrypt(Buffer.from(text, 'utf8'), context),
    decryptText: (payload, context) => Buffer.from(decrypt(payload, context)).toString('utf8'),
  };
}
