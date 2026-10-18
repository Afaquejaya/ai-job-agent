import { createDatabaseClient, type Database } from '@job-agent/database';
import { ConfigurationError, getWebEnv } from './env';

// One client per server process. In development, Next.js reloads modules on every change,
// so the client is kept on globalThis to avoid opening a new connection pool each time.
const globalForDb = globalThis as unknown as { jobAgentDb?: Database };

export function isDatabaseConfigured(): boolean {
  return Boolean(getWebEnv().DATABASE_URL);
}

export function getDatabase(): Database {
  const url = getWebEnv().DATABASE_URL;
  if (!url) throw new ConfigurationError('DATABASE_URL is not configured');
  globalForDb.jobAgentDb ??= createDatabaseClient(url);
  return globalForDb.jobAgentDb;
}
