import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defineConfig } from '@playwright/test';

if (existsSync('.env')) process.loadEnvFile('.env');

const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

/**
 * End-to-end tests. They use Playwright's HTTP `request` fixture, so no browser download is
 * needed. Browser-driven tests will need `pnpm exec playwright install chromium`.
 *
 * The dev server under test always uses the *_test database (never development data) and a
 * throwaway auth secret. Without TEST_DATABASE_URL, account tests are skipped.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: BASE_URL,
  },
  webServer: {
    command: `pnpm --filter @job-agent/web exec next dev --port ${PORT}`,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      APP_URL: BASE_URL,
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
      AUTH_SECRET: randomBytes(32).toString('base64'),
      AUTH_SIGNUP_ALLOWED_EMAILS: '',
      DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      STORAGE_DRIVER: 'local',
      // Uploaded test CVs go to a throwaway folder, never the development storage.
      STORAGE_LOCAL_DIR: mkdtempSync(path.join(tmpdir(), 'job-agent-e2e-storage-')),
    },
  },
});
