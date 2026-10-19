import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  reconcileTasks,
  runTask,
  type QueueJobHandler,
  type TaskRunnerOptions,
} from '@job-agent/agent-core';
import {
  createDatabaseClient,
  createDatabaseProbe,
  createTaskRepository,
} from '@job-agent/database';
import { createJsonLogger } from '@job-agent/observability';
import { createDataCipher } from '@job-agent/security';
import {
  aiSettingsFromEnv,
  createServices,
  createTaskHandlers,
  jobSearchSettingsFromEnv,
  createTaskService,
} from '@job-agent/services';
import { createEncryptedStorage, createLocalStorage } from '@job-agent/storage';
import { createBullTaskConsumer, createBullTaskQueue } from '@job-agent/task-queue';
import { DEFAULT_REDIS_URL, loadWorkerEnv } from './env';
import { buildReadiness, buildWorkerHealth, createHealthServer } from './health';

/**
 * The background worker (Phase 3). It runs the tasks the web app queues:
 * - consumers take task ids from Redis and run one step each (agent-core `runTask`);
 * - every minute the reconciler repairs what Redis cannot know (dead workers, lost jobs);
 * - on SIGTERM/SIGINT it stops taking work, lets running steps finish (up to 30 s), then
 *   releases whatever is still running so another worker picks it up.
 * PostgreSQL holds every task's state; Redis only decides when a task runs.
 */

// Local development reads the repository-root .env. Hosted environments inject variables
// directly; existing process variables are never overridden.
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const rootEnvFile = path.join(repoRoot, '.env');
if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile);

const env = loadWorkerEnv(process.env);
const logger = createJsonLogger({ service: 'worker', level: env.LOG_LEVEL });
const startedAt = new Date();
const RECONCILE_EVERY_MS = 60_000;
const SHUTDOWN_GRACE_MS = 30_000;

const db = env.DATABASE_URL ? createDatabaseClient(env.DATABASE_URL) : null;
const databaseProbe = db ? createDatabaseProbe(db) : null;
const redisUrl = env.REDIS_URL ?? DEFAULT_REDIS_URL;
const queue = createBullTaskQueue({ url: redisUrl, prefix: env.TASK_QUEUE_PREFIX });
const consumer = createBullTaskConsumer({ url: redisUrl, prefix: env.TASK_QUEUE_PREFIX });
let consumersRunning = false;
let reconcileTimer: NodeJS.Timeout | undefined;

const probes = { database: databaseProbe, redis: queue };
const server = createHealthServer({
  getHealth: () => buildWorkerHealth(startedAt, probes),
  getReadiness: async () =>
    buildReadiness(consumersRunning, await buildWorkerHealth(startedAt, probes)),
});

/** Relative STORAGE_LOCAL_DIR values are resolved from the repository root (same as the web app). */
function storageDir(dir: string): string {
  return path.isAbsolute(dir) ? dir : path.resolve(repoRoot, dir);
}

async function startConsumers(): Promise<void> {
  if (!db) {
    logger.warn('worker.no_consumers', { reason: 'DATABASE_URL is not set' });
    return;
  }
  if (!env.DATA_ENCRYPTION_KEY) {
    logger.warn('worker.no_consumers', { reason: 'DATA_ENCRYPTION_KEY is not set' });
    return;
  }
  if (env.STORAGE_DRIVER !== 'local') {
    logger.warn('worker.no_consumers', { reason: 'Only STORAGE_DRIVER=local is implemented' });
    return;
  }

  const cipher = createDataCipher(env.DATA_ENCRYPTION_KEY);
  const storage = createEncryptedStorage(
    createLocalStorage(storageDir(env.STORAGE_LOCAL_DIR)),
    cipher,
  );
  const services = createServices({
    db,
    cipher,
    storage,
    ai: aiSettingsFromEnv(env),
    jobSearch: jobSearchSettingsFromEnv(env),
  });
  const tasks = createTaskRepository(db);
  const taskService = createTaskService({ tasks, queue, logger });

  const runner: TaskRunnerOptions = {
    store: tasks,
    handlers: createTaskHandlers({ ...services, logger }),
    schedule: (task, runAt) => taskService.enqueue({ ...task, nextRunAt: runAt }),
    log: (event, fields) => logger.warn(event, fields),
  };

  const handle: QueueJobHandler = async (job, shutdown) => {
    const started = Date.now();
    const result = await runTask(runner, job.message, shutdown);
    logger.info('task.step', {
      taskId: job.message.taskId,
      outcome: result.outcome,
      reason: result.reason,
      durationMs: Date.now() - started,
    });
  };
  // Quick tasks (CV text extraction) and AI tasks run on separate queues. A model on this
  // computer gets the whole processor: one AI task at a time (D-048).
  const aiConcurrency = env.AI_PROVIDER === 'ollama' ? 1 : env.WORKER_CONCURRENCY;
  await consumer.start('agent-tasks', handle, { concurrency: env.WORKER_CONCURRENCY });
  await consumer.start('ai-tasks', handle, { concurrency: aiConcurrency });
  consumersRunning = true;

  const reconcile = async () => {
    try {
      const report = await reconcileTasks({
        store: tasks,
        maintenance: tasks,
        enqueue: taskService.enqueue,
      });
      if (report.leasesRecovered || report.sentToVerification || report.cancelled) {
        logger.info('task.reconciled', { ...report });
      }
    } catch (error) {
      logger.error('task.reconcile_failed', { error });
    }
  };
  await reconcile(); // pick up anything left from before this worker started
  reconcileTimer = setInterval(() => void reconcile(), RECONCILE_EVERY_MS);
}

server.listen(env.WORKER_HEALTH_PORT, () => {
  startConsumers()
    .then(() =>
      logger.info('worker.started', {
        healthPort: env.WORKER_HEALTH_PORT,
        database: db ? 'configured' : 'not_configured',
        queueConsumers: consumersRunning ? env.WORKER_CONCURRENCY : 0,
        aiTasksAtOnce: env.AI_PROVIDER === 'ollama' ? 1 : env.WORKER_CONCURRENCY,
        aiProvider: env.AI_PROVIDER,
      }),
    )
    .catch((error: unknown) => logger.error('worker.start_failed', { error }));
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('worker.stopping', { signal });
  clearInterval(reconcileTimer);
  consumersRunning = false;
  // Hard limit: never hang forever (grace period + time to record released tasks).
  setTimeout(() => process.exit(1), SHUTDOWN_GRACE_MS + 15_000).unref();
  void consumer
    .stop(SHUTDOWN_GRACE_MS)
    .catch((error: unknown) => logger.error('worker.stop_failed', { error }))
    .finally(() => {
      server.close();
      void Promise.allSettled([queue.close(), db?.$disconnect()]).finally(() => {
        logger.info('worker.stopped');
        process.exit(0);
      });
    });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
