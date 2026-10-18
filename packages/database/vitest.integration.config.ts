import { existsSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

const rootEnv = path.resolve(process.cwd(), '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? '';

// Integration tests run against the dedicated *_test database (migrated by
// scripts/migrate-test-database.mjs). They never reset or drop anything: each test creates
// its own users with unique emails.
export default defineConfig({
  test: {
    include: ['src/**/*.int.test.ts'],
    env: { DATABASE_URL: testDatabaseUrl },
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
