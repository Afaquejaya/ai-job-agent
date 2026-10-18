import type { AddressInfo } from 'node:net';
import { healthResponseSchema } from '@job-agent/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { loadWorkerEnv } from './env';
import { buildWorkerHealth, createHealthServer, NOT_READY_NO_CONSUMERS } from './health';

const probe = (status: 'up' | 'down') => ({ ping: async () => status });

describe('loadWorkerEnv', () => {
  it('applies defaults and treats blank values as not configured', () => {
    expect(loadWorkerEnv({ REDIS_URL: '', DATABASE_URL: '' })).toEqual({
      LOG_LEVEL: 'info',
      WORKER_HEALTH_PORT: 8081,
      DATABASE_URL: undefined,
      REDIS_URL: undefined,
    });
  });

  it('names the bad variable without echoing its value', () => {
    expect(() => loadWorkerEnv({ REDIS_URL: 'http://secret-host' })).toThrow(/REDIS_URL/);
    expect(() => loadWorkerEnv({ REDIS_URL: 'http://secret-host' })).not.toThrow(/secret-host/);
  });
});

describe('buildWorkerHealth', () => {
  const startedAt = new Date('2026-10-18T00:00:00.000Z');
  const oneMinuteLater = () => new Date('2026-10-18T00:01:00.000Z');

  it('reports an unconfigured database without probing', async () => {
    const env = loadWorkerEnv({ REDIS_URL: 'redis://localhost:6379' });
    const health = await buildWorkerHealth(env, startedAt, null, oneMinuteLater);
    expect(healthResponseSchema.parse(health)).toMatchObject({
      status: 'ok',
      service: 'worker',
      uptimeSeconds: 60,
      dependencies: { database: 'not_configured', redis: 'not_checked' },
    });
  });

  it('reports the probe result and goes down with the database', async () => {
    const env = loadWorkerEnv({ DATABASE_URL: 'postgresql://x' });
    expect(await buildWorkerHealth(env, startedAt, probe('up'))).toMatchObject({
      status: 'ok',
      dependencies: { database: 'up' },
    });
    expect(await buildWorkerHealth(env, startedAt, probe('down'))).toMatchObject({
      status: 'down',
      dependencies: { database: 'down' },
    });
  });
});

describe('createHealthServer', () => {
  const env = loadWorkerEnv({});
  let databaseStatus: 'up' | 'down' = 'up';
  const server = createHealthServer({
    getHealth: () => buildWorkerHealth(env, new Date(), { ping: async () => databaseStatus }),
    getReadiness: () => NOT_READY_NO_CONSUMERS,
  });

  afterEach(() => {
    if (server.listening) server.close();
  });

  it('serves /health (200 or 503), /ready and 404', async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;

    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);
    expect(healthResponseSchema.parse(await health.json()).service).toBe('worker');

    databaseStatus = 'down';
    expect((await fetch(`${base}/health`)).status).toBe(503);

    const ready = await fetch(`${base}/ready`);
    expect(ready.status).toBe(503);
    expect(await ready.json()).toEqual(NOT_READY_NO_CONSUMERS);

    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });
});
