import { describe, expect, it } from 'vitest';
import { browserCommandSchema, healthResponseSchema, isValidTimeZone, optionalEnv } from './index';
import { z } from 'zod';

describe('isValidTimeZone', () => {
  it('accepts IANA zones used by target regions', () => {
    expect(isValidTimeZone('Asia/Kolkata')).toBe(true);
    expect(isValidTimeZone('Asia/Dubai')).toBe(true);
  });

  it('rejects unknown zones', () => {
    expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false);
  });
});

describe('optionalEnv', () => {
  const schema = z.object({ REDIS_URL: optionalEnv(z.string().min(1)) });

  it('treats an empty value as not set', () => {
    expect(schema.parse({ REDIS_URL: '' })).toEqual({ REDIS_URL: undefined });
  });

  it('keeps a real value', () => {
    expect(schema.parse({ REDIS_URL: 'redis://localhost:6379' }).REDIS_URL).toBe(
      'redis://localhost:6379',
    );
  });
});

describe('healthResponseSchema', () => {
  it('requires UTC timestamps', () => {
    const base = {
      status: 'ok',
      service: 'web',
      version: 'local',
      uptimeSeconds: 1,
      dependencies: {},
    } as const;
    expect(
      healthResponseSchema.safeParse({ ...base, timestamp: '2026-10-18T10:00:00.000Z' }).success,
    ).toBe(true);
    expect(
      healthResponseSchema.safeParse({ ...base, timestamp: '2026-10-18T15:30:00+05:30' }).success,
    ).toBe(false);
  });
});

describe('browserCommandSchema', () => {
  it('rejects commands from a different protocol version', () => {
    const result = browserCommandSchema.safeParse({
      protocolVersion: 2,
      commandId: '6f1c2f0e-6a43-4b8e-9b7e-0d6f0f6f2b11',
      taskId: '1b0f8f43-3f3f-4f62-a2a8-6d1f3a9a2c55',
      agentId: '0a8e4c1d-9a2b-4c6d-8e1f-2a3b4c5d6e7f',
      type: 'open_page',
      idempotencyKey: 'task-1:open_page:1',
      issuedAt: '2026-10-18T10:00:00.000Z',
      expiresAt: '2026-10-18T10:05:00.000Z',
      payload: {},
    });
    expect(result.success).toBe(false);
  });
});
