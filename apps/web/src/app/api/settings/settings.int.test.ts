import { randomBytes, randomUUID } from 'node:crypto';
import { createAuditLog } from '@job-agent/database';
import type { UserId } from '@job-agent/shared';
import { apiErrorSchema, healthResponseSchema, userSettingsSchema } from '@job-agent/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { POST as authPost } from '@/app/api/auth/[...all]/route';
import { GET as healthGet } from '@/app/api/health/route';
import { getDatabase } from '@/server/db';
import { GET, PATCH } from './route';

const APP = 'http://localhost:3000';

interface TestUser {
  cookie: string;
  userId: UserId;
  email: string;
  password: string;
}

function cookieHeader(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
}

/** Signs up through the real /api/auth endpoint, exactly as the browser does. */
async function signUp(): Promise<TestUser> {
  const email = `${randomUUID()}@example.test`;
  const password = randomBytes(18).toString('base64url');
  const response = await authPost(
    new Request(`${APP}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: APP },
      body: JSON.stringify({ email, password, name: 'Integration Test' }),
    }),
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as { user: { id: string } };
  return { cookie: cookieHeader(response), userId: body.user.id as UserId, email, password };
}

const get = (cookie?: string) =>
  GET(new Request(`${APP}/api/settings`, { headers: cookie ? { cookie } : {} }));

const patch = (cookie: string, body: unknown) =>
  PATCH(
    new Request(`${APP}/api/settings`, {
      method: 'PATCH',
      headers: { cookie, origin: APP, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

let alice: TestUser;
let bob: TestUser;

beforeAll(async () => {
  const url = process.env.DATABASE_URL;
  if (!url || !new URL(url).pathname.endsWith('_test')) {
    throw new Error('Integration tests require TEST_DATABASE_URL pointing at a *_test database');
  }
  alice = await signUp();
  bob = await signUp();
});

describe('authentication', () => {
  it('rejects requests without a session using the error envelope', async () => {
    const response = await get();
    expect(response.status).toBe(401);
    expect(apiErrorSchema.parse(await response.json()).error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a forged session cookie', async () => {
    const response = await get('better-auth.session_token=forged.value');
    expect(response.status).toBe(401);
  });

  it('rejects a wrong password', async () => {
    const response = await authPost(
      new Request(`${APP}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: APP },
        body: JSON.stringify({ email: alice.email, password: `${alice.password}-wrong` }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it('stores a password hash, never the password', async () => {
    const account = await getDatabase().account.findFirst({ where: { userId: alice.userId } });
    expect(account?.password).toBeTruthy();
    expect(account?.password).not.toContain(alice.password);
  });
});

describe('settings API', () => {
  it('returns safe defaults for a new user', async () => {
    const response = await get(alice.cookie);
    expect(response.status).toBe(200);
    const { settings } = (await response.json()) as { settings: unknown };
    expect(userSettingsSchema.parse(settings)).toMatchObject({
      submissionMode: 'manual_only',
      dailyApplicationLimit: 20,
    });
  });

  it("applies a user's changes to that user only", async () => {
    const response = await patch(alice.cookie, {
      timeZone: 'Asia/Kolkata',
      submissionMode: 'approve_each',
      targetCountries: ['IN', 'AE'],
    });
    expect(response.status).toBe(200);

    const aliceSettings = ((await (await get(alice.cookie)).json()) as { settings: unknown })
      .settings;
    const bobSettings = ((await (await get(bob.cookie)).json()) as { settings: unknown }).settings;
    expect(aliceSettings).toMatchObject({
      timeZone: 'Asia/Kolkata',
      submissionMode: 'approve_each',
    });
    expect(bobSettings).toMatchObject({ timeZone: 'UTC', submissionMode: 'manual_only' });
  });

  it('writes an audit entry with field names only', async () => {
    const entries = await createAuditLog(getDatabase()).listForUser(alice.userId);
    const settingsEntry = entries.find((e) => e.action === 'settings.updated');
    expect(settingsEntry?.metadata).toEqual({
      changedFields: 'timeZone,submissionMode,targetCountries',
    });
    expect(await createAuditLog(getDatabase()).listForUser(bob.userId)).toEqual([]);
  });

  it.each([
    ['unknown time zone', { timeZone: 'Mars/Base' }],
    ['limit above 50', { dailyApplicationLimit: 51 }],
    ['negative limit', { dailyApplicationLimit: -1 }],
    ['unknown mode', { submissionMode: 'yolo' }],
    ['lower-case country', { targetCountries: ['in'] }],
    ['unknown field', { isAdmin: true }],
    ['empty patch', {}],
  ])('rejects %s', async (_label, body) => {
    const response = await patch(alice.cookie, body);
    expect(response.status).toBe(400);
    expect(apiErrorSchema.parse(await response.json()).error.code).toBe('VALIDATION_FAILED');
  });

  it('refuses a cross-origin write even with a valid session', async () => {
    const response = await PATCH(
      new Request(`${APP}/api/settings`, {
        method: 'PATCH',
        headers: {
          cookie: alice.cookie,
          origin: 'https://evil.example',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ dailyApplicationLimit: 0 }),
      }),
    );
    expect(response.status).toBe(403);
  });
});

describe('health', () => {
  it('reports the test database as up', async () => {
    const response = await healthGet();
    expect(response.status).toBe(200);
    expect(healthResponseSchema.parse(await response.json()).dependencies.database).toBe('up');
  });
});
