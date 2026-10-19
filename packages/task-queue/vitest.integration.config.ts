import { existsSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

const rootEnv = path.resolve(process.cwd(), '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

// Runs against the local Redis from docker compose (or REDIS_URL / TEST_REDIS_URL). Every run
// uses its own key prefix and removes it afterwards, so real queues are never touched.
export default defineConfig({
  test: {
    include: ['src/**/*.int.test.ts'],
    env: {
      TEST_REDIS_URL:
        process.env.TEST_REDIS_URL ||
        process.env.REDIS_URL ||
        `redis://127.0.0.1:${process.env.REDIS_PORT || '6379'}`,
    },
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
