import type { AddressInfo } from 'node:net';
import { healthResponseSchema } from '@job-agent/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { loadWorkerEnv } from './env';
import {
  buildReadiness,
  buildWorkerHealth,
  createHealthServer,
  NOT_READY_NO_CONSUMERS,
} from './health';

const database = (status: 'up' | 'down') => ({ ping: async () => status });
const redis = (ok: boolean) => ({ ping: async () => ok });

describe('loadWorkerEnv', () => {
  it('applies defaults and treats blank values as not configured', () => {
    expect(loadWorkerEnv({ REDIS_URL: '', DATABASE_URL: '' })).toMatchObject({
      LOG_LEVEL: 'info',
      WORKER_HEALTH_PORT: 8081,
      WORKER_CONCURRENCY: 2,
      DATABASE_URL: undefined,
      REDIS_URL: undefined,
      AI_PROVIDER: 'anthropic',
      OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
    });
  });

  it('names the bad variable without echoing its value', () => {
    expect(() => loadWorkerEnv({ REDIS_URL: 'http://secret-host' })).toThrow(/REDIS_URL/);
    expect(() => loadWorkerEnv({ REDIS_URL: 'http://secret-host' })).not.toThrow(/secret-host/);
  });

  it('only accepts a local model on this computer', () => {
    expect(() => loadWorkerEnv({ OLLAMA_BASE_URL: 'http://10.0.0.8:11434' })).toThrow(
      /OLLAMA_BASE_URL/,
    );
  });
});

describe('buildWorkerHealth', () => {
  const startedAt = new Date('2026-10-18T00:00:00.000Z');
  const oneMinuteLater = () => new Date('2026-10-18T00:01:00.000Z');

  it('reports unconfigured dependencies without probing', async () => {
    const health = await buildWorkerHealth(
      startedAt,
      { database: null, redis: null },
      oneMinuteLater,
    );
    expect(healthResponseSchema.parse(health)).toMatchObject({
      status: 'ok',
      service: 'worker',
      uptimeSeconds: 60,
      dependencies: { database: 'not_configured', redis: 'not_configured' },
    });
  });

  it('probes PostgreSQL and Redis, and goes down with either', async () => {
    expect(
      await buildWorkerHealth(startedAt, { database: database('up'), redis: redis(true) }),
    ).toMatchObject({
      status: 'ok',
      dependencies: { database: 'up', redis: 'up' },
    });
    expect(
      await buildWorkerHealth(startedAt, { database: database('down'), redis: redis(true) }),
    ).toMatchObject({
      status: 'down',
    });
    expect(
      await buildWorkerHealth(startedAt, { database: database('up'), redis: redis(false) }),
    ).toMatchObject({
      status: 'down',
      dependencies: { redis: 'down' },
    });
  });
});

describe('buildReadiness', () => {
  const health = async (db: 'up' | 'down', r: boolean) =>
    buildWorkerHealth(new Date(), { database: database(db), redis: redis(r) });

  it('is ready only with consumers running and both stores up', async () => {
    expect(buildReadiness(true, await health('up', true))).toEqual({ ready: true });
    expect(buildReadiness(false, await health('up', true))).toEqual(NOT_READY_NO_CONSUMERS);
    expect(buildReadiness(true, await health('down', true))).toEqual({
      ready: false,
      reason: 'Database is down',
    });
    expect(buildReadiness(true, await health('up', false))).toEqual({
      ready: false,
      reason: 'Redis is down',
    });
  });
});

describe('createHealthServer', () => {
  let databaseStatus: 'up' | 'down' = 'up';
  let consumersRunning = true;
  const probes = { database: { ping: async () => databaseStatus }, redis: redis(true) };
  const server = createHealthServer({
    getHealth: () => buildWorkerHealth(new Date(), probes),
    getReadiness: async () =>
      buildReadiness(consumersRunning, await buildWorkerHealth(new Date(), probes)),
  });

  afterEach(() => {
    if (server.listening) server.close();
  });

  it('serves /health (200 or 503), /ready (200 or 503) and 404', async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;

    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);
    expect(healthResponseSchema.parse(await health.json()).service).toBe('worker');
    expect((await fetch(`${base}/ready`)).status).toBe(200);

    consumersRunning = false;
    const notReady = await fetch(`${base}/ready`);
    expect(notReady.status).toBe(503);
    expect(await notReady.json()).toEqual(NOT_READY_NO_CONSUMERS);

    databaseStatus = 'down';
    expect((await fetch(`${base}/health`)).status).toBe(503);
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });
});
