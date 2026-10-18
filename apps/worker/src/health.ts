import { createServer, type Server, type ServerResponse } from 'node:http';
import type { HealthResponse, ReadinessResponse } from '@job-agent/shared';
import type { WorkerEnv } from './env';

export interface HealthServerOptions {
  getHealth: () => HealthResponse;
  getReadiness: () => ReadinessResponse;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

/**
 * Minimal HTTP server for the worker host's health checks.
 * - GET /health: the process is alive (liveness).
 * - GET /ready: the worker can process jobs (readiness).
 */
export function createHealthServer(options: HealthServerOptions): Server {
  return createServer((req, res) => {
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'method_not_allowed' });
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path === '/health') {
      const health = options.getHealth();
      return sendJson(res, health.status === 'down' ? 503 : 200, health);
    }
    if (path === '/ready') {
      const readiness = options.getReadiness();
      return sendJson(res, readiness.ready ? 200 : 503, readiness);
    }
    return sendJson(res, 404, { error: 'not_found' });
  });
}

/**
 * Phase 1 health: the process is alive; dependencies are reported as configured or not, but
 * not probed (`not_checked`), because no Redis or database client exists yet.
 */
export function buildWorkerHealth(
  env: WorkerEnv,
  startedAt: Date,
  now = new Date(),
): HealthResponse {
  return {
    status: 'ok',
    service: 'worker',
    version: process.env.WORKER_VERSION ?? 'local',
    timestamp: now.toISOString(),
    uptimeSeconds: Math.max(0, Math.round((now.getTime() - startedAt.getTime()) / 1000)),
    dependencies: {
      database: env.DATABASE_URL ? 'not_checked' : 'not_configured',
      redis: env.REDIS_URL ? 'not_checked' : 'not_configured',
    },
  };
}

export const PHASE_1_READINESS: ReadinessResponse = {
  ready: false,
  reason: 'No queue consumers are registered yet (Phase 1 foundation).',
};
