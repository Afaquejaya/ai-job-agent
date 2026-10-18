import { defineConfig } from '@playwright/test';

const PORT = 3100;

/**
 * End-to-end tests. Phase 1 tests use Playwright's HTTP `request` fixture only, so no browser
 * download is needed. Browser-driven tests will need `pnpm exec playwright install chromium`.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
  },
  webServer: {
    command: `pnpm --filter @job-agent/web exec next dev --port ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
