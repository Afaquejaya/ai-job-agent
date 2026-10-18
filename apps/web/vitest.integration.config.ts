import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootEnv = path.resolve(process.cwd(), '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

// Route handlers run in-process against the dedicated *_test database (migrated by
// `pnpm --filter @job-agent/database db:migrate:test`). Throwaway secrets are generated per
// run, and uploaded test files go to a fresh temporary folder - never the development storage.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.int.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
      AUTH_SECRET: randomBytes(32).toString('base64'),
      DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      STORAGE_DRIVER: 'local',
      STORAGE_LOCAL_DIR: mkdtempSync(path.join(tmpdir(), 'job-agent-int-storage-')),
      APP_URL: 'http://localhost:3000',
      AUTH_SIGNUP_ALLOWED_EMAILS: '',
      LOG_LEVEL: 'error',
      AI_PROVIDER: 'fake',
      AI_MONTHLY_BUDGET_USD: '5',
      ANTHROPIC_API_KEY: '',
    },
  },
});
