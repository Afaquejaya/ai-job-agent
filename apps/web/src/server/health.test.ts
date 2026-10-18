import { healthResponseSchema } from '@job-agent/shared';
import { describe, expect, it } from 'vitest';
import { GET } from '../app/api/health/route';
import { buildWebHealth } from './health';

describe('buildWebHealth', () => {
  it('reports unconfigured dependencies without probing them', () => {
    const health = buildWebHealth({ DATABASE_URL: '', REDIS_URL: undefined });
    expect(healthResponseSchema.parse(health).dependencies).toEqual({
      database: 'not_configured',
      redis: 'not_configured',
    });
  });

  it('marks configured dependencies as not checked rather than up', () => {
    const health = buildWebHealth({ DATABASE_URL: 'postgresql://user:pw@host/db' });
    expect(health.dependencies.database).toBe('not_checked');
    expect(JSON.stringify(health)).not.toContain('postgresql://');
  });
});

describe('GET /api/health', () => {
  it('returns a valid, uncached health response', async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(healthResponseSchema.parse(await response.json()).service).toBe('web');
  });
});
