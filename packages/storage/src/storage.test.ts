import { randomBytes } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDataCipher, DecryptionError } from '@job-agent/security';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assertValidStorageKey,
  createEncryptedStorage,
  createLocalStorage,
  ObjectNotFoundError,
  StorageKeyError,
} from './index';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'job-agent-storage-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const text = (s: string) => new TextEncoder().encode(s);

describe('assertValidStorageKey', () => {
  it.each(['users/abc/resumes/123', 'a', 'users/0f8e-12/resumes/x_y'])('accepts %s', (key) => {
    expect(() => assertValidStorageKey(key)).not.toThrow();
  });

  it.each([
    '',
    '../secret',
    'users/../../etc/passwd',
    '/etc/passwd',
    'C:/Windows/win.ini',
    'users\\abc',
    'users//abc',
    'users/abc/',
    'Users/ABC',
    'my cv.pdf',
    'users/abc/.env',
  ])('rejects %j', (key) => {
    expect(() => assertValidStorageKey(key)).toThrow(StorageKeyError);
  });
});

describe('createLocalStorage', () => {
  it('stores, reads, checks and deletes objects inside the root only', async () => {
    const storage = createLocalStorage(root);
    await storage.put('users/u1/resumes/r1', text('hello'));

    expect(new TextDecoder().decode(await storage.get('users/u1/resumes/r1'))).toBe('hello');
    expect(await storage.exists('users/u1/resumes/r1')).toBe(true);
    expect(await readdir(path.join(root, 'users', 'u1', 'resumes'))).toEqual(['r1']);

    await storage.delete('users/u1/resumes/r1');
    await storage.delete('users/u1/resumes/r1'); // idempotent
    expect(await storage.exists('users/u1/resumes/r1')).toBe(false);
    await expect(storage.get('users/u1/resumes/r1')).rejects.toThrow(ObjectNotFoundError);
  });

  it('refuses path traversal for every operation', async () => {
    const storage = createLocalStorage(root);
    await expect(storage.put('../escape', text('x'))).rejects.toThrow(StorageKeyError);
    await expect(storage.get('../../etc/passwd')).rejects.toThrow(StorageKeyError);
    await expect(storage.delete('..')).rejects.toThrow(StorageKeyError);
  });
});

describe('createEncryptedStorage', () => {
  const cipher = createDataCipher(randomBytes(32).toString('base64'));

  it('writes only ciphertext to disk and decrypts on read', async () => {
    const storage = createEncryptedStorage(createLocalStorage(root), cipher);
    await storage.put('users/u1/resumes/r1', text('Synthetic CV text'));

    const onDisk = await readFile(path.join(root, 'users', 'u1', 'resumes', 'r1'));
    expect(onDisk.toString('utf8')).not.toContain('Synthetic CV text');
    expect(new TextDecoder().decode(await storage.get('users/u1/resumes/r1'))).toBe(
      'Synthetic CV text',
    );
  });

  it("cannot read an object copied under another user's key", async () => {
    const local = createLocalStorage(root);
    const storage = createEncryptedStorage(local, cipher);
    await storage.put('users/alice/resumes/r1', text('alice data'));
    await local.put('users/bob/resumes/r1', await local.get('users/alice/resumes/r1'));

    await expect(storage.get('users/bob/resumes/r1')).rejects.toThrow(DecryptionError);
  });
});
