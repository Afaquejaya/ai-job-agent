import type { AddressInfo } from 'node:net';
import { healthResponseSchema } from '@job-agent/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { loadWorkerEnv } from './env';
import { buildWorkerHealth, createHealthServer, PHASE_1_READINESS } from './health';

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
  it('reports dependencies honestly as not configured or not checked', () => {
    const env = loadWorkerEnv({ REDIS_URL: 'redis://localhost:6379' });
    const health = buildWorkerHealth(
      env,
      new Date('2026-10-18T00:00:00.000Z'),
      new Date('2026-10-18T00:01:00.000Z'),
    );
    expect(healthResponseSchema.parse(health)).toMatchObject({
      status: 'ok',
      service: 'worker',
      uptimeSeconds: 60,
      dependencies: { database: 'not_configured', redis: 'not_checked' },
    });
  });
});

describe('createHealthServer', () => {
  const env = loadWorkerEnv({});
  const server = createHealthServer({
    getHealth: () => buildWorkerHealth(env, new Date()),
    getReadiness: () => PHASE_1_READINESS,
  });

  afterEach(() => {
    if (server.listening) server.close();
  });

  it('serves /health, /ready and 404', async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;

    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);
    expect(healthResponseSchema.parse(await health.json()).service).toBe('worker');

    const ready = await fetch(`${base}/ready`);
    expect(ready.status).toBe(503);
    expect(await ready.json()).toEqual(PHASE_1_READINESS);

    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });
});
