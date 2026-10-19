import { createServer, type Server, type ServerResponse } from 'node:http';
import type { DatabaseProbe } from '@job-agent/database';
import type { DependencyStatus, HealthResponse, ReadinessResponse } from '@job-agent/shared';

export interface HealthServerOptions {
  getHealth: () => Promise<HealthResponse>;
  getReadiness: () => Promise<ReadinessResponse>;
}

export interface WorkerProbes {
  database: DatabaseProbe | null;
  redis: { ping(): Promise<boolean> } | null;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

/**
 * Minimal HTTP server for the worker host's health checks.
 * - GET /health: the process is alive and its dependencies answer (liveness).
 * - GET /ready: the worker is processing tasks (readiness).
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
      options
        .getReadiness()
        .then((readiness) => sendJson(res, readiness.ready ? 200 : 503, readiness))
        .catch(() => sendJson(res, 503, { ready: false, reason: 'Readiness check failed' }));
      return;
    }
    return sendJson(res, 404, { error: 'not_found' });
  });
}

/** Probes PostgreSQL and Redis for real when they are configured. */
export async function buildWorkerHealth(
  startedAt: Date,
  probes: WorkerProbes,
  now: () => Date = () => new Date(),
): Promise<HealthResponse> {
  const [database, redis] = await Promise.all([
    probes.database ? probes.database.ping() : Promise.resolve<DependencyStatus>('not_configured'),
    probes.redis
      ? probes.redis.ping().then((ok): DependencyStatus => (ok ? 'up' : 'down'))
      : Promise.resolve<DependencyStatus>('not_configured'),
  ]);
  const finishedAt = now();
  return {
    status: database === 'down' || redis === 'down' ? 'down' : 'ok',
    service: 'worker',
    version: process.env.WORKER_VERSION ?? 'local',
    timestamp: finishedAt.toISOString(),
    uptimeSeconds: Math.max(0, Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000)),
    dependencies: { database, redis },
  };
}

/** Ready = task consumers are running and both PostgreSQL and Redis answer. */
export function buildReadiness(
  consumersRunning: boolean,
  health: HealthResponse,
): ReadinessResponse {
  if (!consumersRunning) return NOT_READY_NO_CONSUMERS;
  const { database, redis } = health.dependencies;
  if (database !== 'up') return { ready: false, reason: `Database is ${database}` };
  if (redis !== 'up') return { ready: false, reason: `Redis is ${redis}` };
  return { ready: true };
}

export const NOT_READY_NO_CONSUMERS: ReadinessResponse = {
  ready: false,
  reason:
    'Task consumers are not running (database or encryption key not configured, or stopping).',
};
