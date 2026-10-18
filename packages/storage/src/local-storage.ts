import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  assertValidStorageKey,
  ObjectNotFoundError,
  StorageKeyError,
  type ObjectStorage,
} from './object-storage';

/**
 * Filesystem driver for local development. The root must be outside any public web folder
 * (default `.data/storage`, git-ignored). Production uses an S3-compatible driver (deployment
 * phase) because serverless hosts have no persistent disk.
 */
export function createLocalStorage(rootDir: string): ObjectStorage {
  const root = path.resolve(rootDir);

  const pathFor = (key: string): string => {
    assertValidStorageKey(key);
    const target = path.resolve(root, ...key.split('/'));
    // Defence in depth on top of the key pattern: the target must stay inside the root.
    if (!target.startsWith(root + path.sep)) throw new StorageKeyError();
    return target;
  };

  return {
    async put(key, data) {
      const target = pathFor(key);
      await mkdir(path.dirname(target), { recursive: true });
      // Write to a temporary file and rename, so readers never see a half-written object.
      const temp = `${target}.${randomUUID()}.tmp`;
      await writeFile(temp, data, { mode: 0o600 });
      await rename(temp, target);
    },

    async get(key) {
      try {
        return new Uint8Array(await readFile(pathFor(key)));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ObjectNotFoundError(key);
        throw error;
      }
    },

    async delete(key) {
      await rm(pathFor(key), { force: true });
    },

    async exists(key) {
      try {
        return (await stat(pathFor(key))).isFile();
      } catch {
        return false;
      }
    },
  };
}
