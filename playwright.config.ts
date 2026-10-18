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
  // The dev server compiles each route on its first request; a cold run needs headroom.
  timeout: 90_000,
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
      NEXT_DIST_DIR: '.next-e2e',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
      AUTH_SECRET: randomBytes(32).toString('base64'),
      AUTH_SIGNUP_ALLOWED_EMAILS: '',
      DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      STORAGE_DRIVER: 'local',
      // Uploaded test CVs go to a throwaway folder, never the development storage.
      STORAGE_LOCAL_DIR: mkdtempSync(path.join(tmpdir(), 'job-agent-e2e-storage-')),
      // The deterministic fake model: e2e runs never call a paid API or send data anywhere.
      AI_PROVIDER: 'fake',
      AI_MONTHLY_BUDGET_USD: '5',
      ANTHROPIC_API_KEY: '',
    },
  },
});
