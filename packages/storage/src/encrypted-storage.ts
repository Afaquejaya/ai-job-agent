import type { DataCipher } from '@job-agent/security';
import type { ObjectStorage } from './object-storage';

/**
 * Encrypts every object before it reaches the underlying driver (AES-256-GCM). The storage key
 * is bound into the ciphertext, so an object copied to another key - for example another
 * user's folder - cannot be decrypted there.
 */
export function createEncryptedStorage(inner: ObjectStorage, cipher: DataCipher): ObjectStorage {
  const context = (key: string) => `object:${key}`;
  return {
    put: (key, data) => inner.put(key, cipher.encrypt(data, context(key))),
    get: async (key) => cipher.decrypt(await inner.get(key), context(key)),
    delete: (key) => inner.delete(key),
    exists: (key) => inner.exists(key),
  };
}
