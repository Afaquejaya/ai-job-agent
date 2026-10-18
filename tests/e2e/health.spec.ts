import { expect, test } from '@playwright/test';

test('web health endpoint responds with an uncached status', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.headers()['cache-control']).toBe('no-store');

  const body = (await response.json()) as {
    service: string;
    status: string;
    dependencies: { database: string };
  };
  expect(body.service).toBe('web');
  // With a test database configured it must be reachable; otherwise it is not configured.
  if (process.env.TEST_DATABASE_URL) {
    expect(response.status()).toBe(200);
    expect(body.dependencies.database).toBe('up');
  } else {
    expect(body.dependencies.database).toBe('not_configured');
  }
});

test('home page offers sign-in and sets security headers', async ({ request }) => {
  const response = await request.get('/');
  expect(response.ok()).toBe(true);
  expect(response.headers()['x-frame-options']).toBe('DENY');
  const html = await response.text();
  expect(html).toContain('Phase 2');
  expect(html).toContain('/sign-in');
});

test('protected pages redirect to sign-in without a session', async ({ request }) => {
  const response = await request.get('/app/settings', { maxRedirects: 0 });
  expect([303, 307, 308]).toContain(response.status());
  expect(response.headers()['location']).toContain('/sign-in');
});
