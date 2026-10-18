import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createJsonLogger } from '@job-agent/observability';
import { loadWorkerEnv } from './env';
import { buildWorkerHealth, createHealthServer, PHASE_1_READINESS } from './health';

// Local development reads the repository-root .env. Hosted environments inject variables
// directly; existing process variables are never overridden.
const rootEnvFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile);

const env = loadWorkerEnv(process.env);
const logger = createJsonLogger({ service: 'worker', level: env.LOG_LEVEL });
const startedAt = new Date();

const server = createHealthServer({
  getHealth: () => buildWorkerHealth(env, startedAt),
  // Phase 3 replaces this with the real consumer state.
  getReadiness: () => PHASE_1_READINESS,
});

server.listen(env.WORKER_HEALTH_PORT, () => {
  logger.info('worker.started', {
    healthPort: env.WORKER_HEALTH_PORT,
    queueConsumers: 0,
    note: 'Phase 1: health endpoints only; no jobs are processed',
  });
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('worker.stopping', { signal });
  server.close(() => {
    logger.info('worker.stopped');
    process.exit(0);
  });
  // Do not hang forever on open keep-alive connections.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
