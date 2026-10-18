import { expect, test } from '@playwright/test';

test('web health endpoint responds with an uncached ok status', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toBe('no-store');

  const body = (await response.json()) as { service: string; status: string };
  expect(body).toMatchObject({ service: 'web', status: 'ok' });
});

test('home page states that Phase 1 has no product features yet', async ({ request }) => {
  const response = await request.get('/');
  expect(response.ok()).toBe(true);
  expect(response.headers()['x-frame-options']).toBe('DENY');
  expect(await response.text()).toContain('Phase 1 foundation');
});
