import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient, createDatabaseProbe } from '@job-agent/database';
import { createJsonLogger } from '@job-agent/observability';
import { loadWorkerEnv } from './env';
import { buildWorkerHealth, createHealthServer, NOT_READY_NO_CONSUMERS } from './health';

// Local development reads the repository-root .env. Hosted environments inject variables
// directly; existing process variables are never overridden.
const rootEnvFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile);

const env = loadWorkerEnv(process.env);
const logger = createJsonLogger({ service: 'worker', level: env.LOG_LEVEL });
const startedAt = new Date();
const db = env.DATABASE_URL ? createDatabaseClient(env.DATABASE_URL) : null;
const probe = db ? createDatabaseProbe(db) : null;

const server = createHealthServer({
  getHealth: () => buildWorkerHealth(env, startedAt, probe),
  // Phase 3 replaces this with the real consumer state.
  getReadiness: () => NOT_READY_NO_CONSUMERS,
});

server.listen(env.WORKER_HEALTH_PORT, () => {
  logger.info('worker.started', {
    healthPort: env.WORKER_HEALTH_PORT,
    database: db ? 'configured' : 'not_configured',
    queueConsumers: 0,
  });
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('worker.stopping', { signal });
  server.close(() => {
    void (db?.$disconnect() ?? Promise.resolve()).finally(() => {
      logger.info('worker.stopped');
      process.exit(0);
    });
  });
  // Do not hang forever on open keep-alive connections.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
