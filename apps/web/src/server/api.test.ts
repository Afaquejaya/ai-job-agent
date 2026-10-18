import type { Logger } from '@job-agent/observability';
import type { AuthContext } from '@job-agent/security';
import { apiErrorSchema, type UserId } from '@job-agent/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { isAllowedOrigin, parseJsonBody, withAuth, type WithAuthDependencies } from './api';
import { isSignUpAllowed } from './signup-policy';

const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLogger,
};

const alice: AuthContext = {
  userId: '11111111-1111-4111-8111-111111111111' as UserId,
  sessionId: 's1',
  authenticatedAt: new Date(),
  method: 'session',
};

const deps = (auth: AuthContext | null): WithAuthDependencies => ({
  authenticate: async () => auth,
  appUrl: () => 'http://localhost:3000',
  logger: () => silentLogger,
});

const echoUser = withAuth(
  async (_req, { auth }) => Response.json({ userId: auth.userId }),
  deps(alice),
);

describe('withAuth', () => {
  it('returns the 401 envelope without a session', async () => {
    const handler = withAuth(async () => Response.json({}), deps(null));
    const response = await handler(new Request('http://localhost:3000/api/x'));
    expect(response.status).toBe(401);
    expect(apiErrorSchema.parse(await response.json()).error.code).toBe('UNAUTHENTICATED');
    expect(response.headers.get('x-request-id')).toMatch(/[0-9a-f-]{36}/);
  });

  it('passes the authenticated user to the handler', async () => {
    const response = await echoUser(new Request('http://localhost:3000/api/x'));
    expect(await response.json()).toEqual({ userId: alice.userId });
  });

  it('refuses cross-origin writes', async () => {
    const response = await echoUser(
      new Request('http://localhost:3000/api/x', {
        method: 'PATCH',
        headers: { origin: 'https://evil.example' },
      }),
    );
    expect(response.status).toBe(403);
  });

  it('maps validation failures to VALIDATION_FAILED without echoing input', async () => {
    const handler = withAuth(async (request) => {
      await parseJsonBody(request, z.object({ limit: z.number().max(50) }));
      return Response.json({});
    }, deps(alice));
    const response = await handler(
      new Request('http://localhost:3000/api/x', {
        method: 'PATCH',
        body: JSON.stringify({ limit: 987654 }),
      }),
    );
    const body = apiErrorSchema.parse(await response.json());
    expect(response.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(body)).not.toContain('987654');
  });

  it('hides unexpected errors behind a generic 500', async () => {
    const handler = withAuth(async () => {
      throw new Error('db password=hunter2 leaked');
    }, deps(alice));
    const response = await handler(new Request('http://localhost:3000/api/x'));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('hunter2');
  });
});

describe('isAllowedOrigin', () => {
  const url = 'http://localhost:3000';
  it('allows reads from anywhere and same-origin or origin-less writes', () => {
    expect(
      isAllowedOrigin(new Request(`${url}/x`, { headers: { origin: 'https://a.b' } }), url),
    ).toBe(true);
    expect(
      isAllowedOrigin(new Request(`${url}/x`, { method: 'POST', headers: { origin: url } }), url),
    ).toBe(true);
    expect(isAllowedOrigin(new Request(`${url}/x`, { method: 'POST' }), url)).toBe(true);
  });
});

describe('isSignUpAllowed', () => {
  it('is open in development and closed in production when no allow-list is set', () => {
    expect(isSignUpAllowed({ email: 'a@b.test', allowedEmails: '', isProduction: false })).toBe(
      true,
    );
    expect(
      isSignUpAllowed({ email: 'a@b.test', allowedEmails: undefined, isProduction: true }),
    ).toBe(false);
  });

  it('only admits listed emails when an allow-list is set', () => {
    const allowedEmails = ' Me@Example.test , other@example.test';
    expect(isSignUpAllowed({ email: 'me@example.test', allowedEmails, isProduction: true })).toBe(
      true,
    );
    expect(isSignUpAllowed({ email: 'x@example.test', allowedEmails, isProduction: false })).toBe(
      false,
    );
  });
});
