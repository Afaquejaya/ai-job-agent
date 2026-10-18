import { createServer, type Server, type ServerResponse } from 'node:http';
import type { DatabaseProbe } from '@job-agent/database';
import type { DependencyStatus, HealthResponse, ReadinessResponse } from '@job-agent/shared';
import type { WorkerEnv } from './env';

export interface HealthServerOptions {
  getHealth: () => Promise<HealthResponse>;
  getReadiness: () => ReadinessResponse;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

/**
 * Minimal HTTP server for the worker host's health checks.
 * - GET /health: the process is alive and its dependencies answer (liveness).
 * - GET /ready: the worker can process jobs (readiness).
 */
export function createHealthServer(options: HealthServerOptions): Server {
  return createServer((req, res) => {
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'method_not_allowed' });
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path === '/health') {
      options
        .getHealth()
        .then((health) => sendJson(res, health.status === 'down' ? 503 : 200, health))
        .catch(() => sendJson(res, 503, { status: 'down' }));
      return;
    }
    if (path === '/ready') {
      const readiness = options.getReadiness();
      return sendJson(res, readiness.ready ? 200 : 503, readiness);
    }
    return sendJson(res, 404, { error: 'not_found' });
  });
}

/**
 * The database is probed for real when configured. Redis stays `not_checked` until the
 * queue client arrives in Phase 3.
 */
export async function buildWorkerHealth(
  env: WorkerEnv,
  startedAt: Date,
  probe: DatabaseProbe | null,
  now: () => Date = () => new Date(),
): Promise<HealthResponse> {
  const database: DependencyStatus = probe ? await probe.ping() : 'not_configured';
  const finishedAt = now();
  return {
    status: database === 'down' ? 'down' : 'ok',
    service: 'worker',
    version: process.env.WORKER_VERSION ?? 'local',
    timestamp: finishedAt.toISOString(),
    uptimeSeconds: Math.max(0, Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000)),
    dependencies: {
      database,
      redis: env.REDIS_URL ? 'not_checked' : 'not_configured',
    },
  };
}

export const NOT_READY_NO_CONSUMERS: ReadinessResponse = {
  ready: false,
  reason: 'No queue consumers are registered yet (they arrive in Phase 3).',
};
