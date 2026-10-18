import { isEnvSet, type HealthResponse } from '@job-agent/shared';

const startedAt = Date.now();

/**
 * Phase 1 health: the web process is up. Dependencies are reported as configured or not,
 * but not probed (`not_checked`) until real clients exist in Phase 2/3.
 *
 * This endpoint is public, so it reports only coarse statuses - never connection strings,
 * hostnames or error details.
 */
export function buildWebHealth(
  env: Record<string, string | undefined>,
  now: Date = new Date(),
): HealthResponse {
  return {
    status: 'ok',
    service: 'web',
    version: env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local',
    timestamp: now.toISOString(),
    uptimeSeconds: Math.max(0, Math.round((now.getTime() - startedAt) / 1000)),
    dependencies: {
      database: isEnvSet(env.DATABASE_URL) ? 'not_checked' : 'not_configured',
      redis: isEnvSet(env.REDIS_URL) ? 'not_checked' : 'not_configured',
    },
  };
}
