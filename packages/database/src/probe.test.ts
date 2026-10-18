import { describe, expect, it } from 'vitest';
import { createDatabaseProbe } from './probe';

type QueryRaw = Parameters<typeof createDatabaseProbe>[0]['$queryRaw'];

const fakeDb = (impl: () => Promise<unknown>) => ({ $queryRaw: impl as unknown as QueryRaw });

describe('createDatabaseProbe', () => {
  it('reports up when the query succeeds', async () => {
    expect(await createDatabaseProbe(fakeDb(async () => [{ '?column?': 1 }])).ping()).toBe('up');
  });

  it('reports down when the query fails', async () => {
    const probe = createDatabaseProbe(
      fakeDb(async () => {
        throw new Error('connection refused');
      }),
    );
    expect(await probe.ping()).toBe('down');
  });

  it('reports down when the database does not answer in time', async () => {
    const probe = createDatabaseProbe(
      fakeDb(() => new Promise(() => undefined)),
      20,
    );
    expect(await probe.ping()).toBe('down');
  });
});
