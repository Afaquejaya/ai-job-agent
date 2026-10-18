import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

test.skip(!process.env.TEST_DATABASE_URL, 'Requires TEST_DATABASE_URL (run `pnpm db:up` first)');

const origin = 'http://localhost:3100';

test('sign up, reach the app, change settings, sign out', async ({ request }) => {
  const email = `${randomUUID()}@example.test`;
  const password = randomBytes(18).toString('base64url');

  const signUp = await request.post('/api/auth/sign-up/email', {
    headers: { origin },
    data: { email, password, name: 'E2E Test' },
  });
  expect(signUp.status()).toBe(200);

  // The request context keeps the session cookie from here on.
  const app = await request.get('/app');
  expect(app.status()).toBe(200);
  expect(await app.text()).toContain('You are signed in');

  const update = await request.patch('/api/settings', {
    headers: { origin },
    data: { timeZone: 'Asia/Dubai', dailyApplicationLimit: 10 },
  });
  expect(update.status()).toBe(200);
  expect(await update.json()).toMatchObject({
    settings: { timeZone: 'Asia/Dubai', dailyApplicationLimit: 10 },
  });

  // Better Auth only accepts JSON POSTs (as its browser client sends); a bare POST gets 415.
  const signOut = await request.post('/api/auth/sign-out', { headers: { origin }, data: {} });
  expect(signOut.ok(), `sign-out: ${signOut.status()} ${await signOut.text()}`).toBe(true);

  const afterSignOut = await request.get('/api/settings');
  expect(afterSignOut.status()).toBe(401);
});

test('sign-in rejects a wrong password', async ({ request }) => {
  const response = await request.post('/api/auth/sign-in/email', {
    headers: { origin },
    data: { email: `${randomUUID()}@example.test`, password: 'definitely-wrong-password' },
  });
  expect(response.status()).toBe(401);
});
