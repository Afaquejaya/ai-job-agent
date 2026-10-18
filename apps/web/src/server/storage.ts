import { existsSync } from 'node:fs';
import path from 'node:path';
import { createDataCipher, type DataCipher } from '@job-agent/security';
import { createEncryptedStorage, createLocalStorage, type ObjectStorage } from '@job-agent/storage';
import { ConfigurationError, getWebEnv } from './env';

const globalForStorage = globalThis as unknown as {
  jobAgentCipher?: DataCipher;
  jobAgentStorage?: ObjectStorage;
};

export function getCipher(): DataCipher {
  if (!globalForStorage.jobAgentCipher) {
    const key = getWebEnv().DATA_ENCRYPTION_KEY;
    if (!key) {
      throw new ConfigurationError('DATA_ENCRYPTION_KEY is not configured (see .env.example)');
    }
    globalForStorage.jobAgentCipher = createDataCipher(key);
  }
  return globalForStorage.jobAgentCipher;
}

/** Relative STORAGE_LOCAL_DIR values are resolved from the repository root, not apps/web. */
function resolveLocalDir(dir: string): string {
  if (path.isAbsolute(dir)) return dir;
  const workspaceRoot = path.resolve(process.cwd(), '../..');
  const base = existsSync(path.join(workspaceRoot, 'pnpm-workspace.yaml'))
    ? workspaceRoot
    : process.cwd();
  return path.resolve(base, dir);
}

/** Private, encrypted object storage. The S3 driver arrives with the deployment phase (D-028). */
export function getStorage(): ObjectStorage {
  if (!globalForStorage.jobAgentStorage) {
    const env = getWebEnv();
    if (env.STORAGE_DRIVER !== 'local') {
      throw new ConfigurationError('STORAGE_DRIVER=s3 is not implemented yet (deployment phase)');
    }
    globalForStorage.jobAgentStorage = createEncryptedStorage(
      createLocalStorage(resolveLocalDir(env.STORAGE_LOCAL_DIR)),
      getCipher(),
    );
  }
  return globalForStorage.jobAgentStorage;
}
