import { healthResponseSchema } from '@job-agent/shared';
import { describe, expect, it } from 'vitest';
import { buildWebHealth } from './health';

const probeReturning = (status: 'up' | 'down') => () => ({ ping: async () => status });
const unusedProbe = () => {
  throw new Error('probe must not be created when the database is not configured');
};

describe('buildWebHealth', () => {
  it('reports unconfigured dependencies without probing them', async () => {
    const health = await buildWebHealth({ DATABASE_URL: '', REDIS_URL: undefined }, unusedProbe);
    expect(healthResponseSchema.parse(health)).toMatchObject({
      status: 'ok',
      dependencies: { database: 'not_configured', redis: 'not_configured' },
    });
  });

  it('reports a reachable database as up', async () => {
    const health = await buildWebHealth({ DATABASE_URL: 'postgresql://x' }, probeReturning('up'));
    expect(health).toMatchObject({ status: 'ok', dependencies: { database: 'up' } });
  });

  it('reports the service as down when the database is unreachable', async () => {
    const health = await buildWebHealth({ DATABASE_URL: 'postgresql://x' }, probeReturning('down'));
    expect(health).toMatchObject({ status: 'down', dependencies: { database: 'down' } });
  });

  it('never exposes connection details', async () => {
    const health = await buildWebHealth(
      { DATABASE_URL: 'postgresql://user:pw@host/db' },
      probeReturning('up'),
    );
    expect(JSON.stringify(health)).not.toContain('postgresql://');
  });
});
