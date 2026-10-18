import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootEnv = path.resolve(process.cwd(), '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

// Route handlers run in-process against the dedicated *_test database (migrated by
// `pnpm --filter @job-agent/database db:migrate:test`). A throwaway AUTH_SECRET is generated
// per run, so no real secret is needed for tests.
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
      APP_URL: 'http://localhost:3000',
      AUTH_SIGNUP_ALLOWED_EMAILS: '',
      LOG_LEVEL: 'error',
    },
  },
});
