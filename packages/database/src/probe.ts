import type { Database } from './client';

/** Connectivity probe used by the /health endpoints. */
export interface DatabaseProbe {
  ping(signal?: AbortSignal): Promise<'up' | 'down'>;
}

/** Runs `SELECT 1`; anything other than a timely success counts as `down`. */
export function createDatabaseProbe(
  db: Pick<Database, '$queryRaw'>,
  timeoutMs = 2_000,
): DatabaseProbe {
  return {
    async ping(signal) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
        signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
      try {
        await Promise.race([db.$queryRaw`SELECT 1`, timeout]);
        return 'up';
      } catch {
        return 'down';
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
