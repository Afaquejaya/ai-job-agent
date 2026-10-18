import type { DatabaseProbe } from '@job-agent/database';
import { isEnvSet, type DependencyStatus, type HealthResponse } from '@job-agent/shared';

const startedAt = Date.now();

/**
 * Web health. The database is probed for real (`up` / `down`) when configured; Redis is
 * reported as `not_checked` until Phase 3 adds a client.
 *
 * This endpoint is public, so it reports only coarse statuses - never connection strings,
 * hostnames or error details.
 */
export async function buildWebHealth(
  env: Record<string, string | undefined>,
  getProbe: () => DatabaseProbe,
  now: () => Date = () => new Date(),
): Promise<HealthResponse> {
  const database: DependencyStatus = isEnvSet(env.DATABASE_URL)
    ? await getProbe().ping()
    : 'not_configured';
  const finishedAt = now();
  return {
    status: database === 'down' ? 'down' : 'ok',
    service: 'web',
    version: env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local',
    timestamp: finishedAt.toISOString(),
    uptimeSeconds: Math.max(0, Math.round((finishedAt.getTime() - startedAt) / 1000)),
    dependencies: {
      database,
      redis: isEnvSet(env.REDIS_URL) ? 'not_checked' : 'not_configured',
    },
  };
}
