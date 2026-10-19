import { aiEnvShape, jobSearchEnvShape } from '@job-agent/services';
import { optionalEnv } from '@job-agent/shared';
import { z } from 'zod';

const redisUrl = z
  .string()
  .refine(
    (value) => /^rediss?:\/\//.test(value),
    'REDIS_URL must start with redis:// or rediss://',
  );

/** Local docker compose Redis, used when REDIS_URL is empty. */
export const DEFAULT_REDIS_URL = 'redis://127.0.0.1:6379';

export const workerEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  WORKER_HEALTH_PORT: z.coerce.number().int().min(0).max(65535).default(8081),
  /** How many background tasks one worker runs at the same time. */
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
  DATABASE_URL: optionalEnv(z.string().min(1)),
  REDIS_URL: optionalEnv(redisUrl),
  /** Redis key prefix for the task queue. Tests use their own so they never share queues. */
  TASK_QUEUE_PREFIX: z
    .string()
    .regex(/^[a-z0-9-]{1,40}$/, 'TASK_QUEUE_PREFIX may only contain a-z, 0-9 and -')
    .default('job-agent'),
  /** Same key as the web app: the worker reads and writes the same encrypted CV data. */
  DATA_ENCRYPTION_KEY: optionalEnv(
    z.string().min(40, 'DATA_ENCRYPTION_KEY must be 32 bytes, base64'),
  ),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().min(1).default('.data/storage'),
  // AI settings, shared with the web app (@job-agent/services).
  ...aiEnvShape,
  ...jobSearchEnvShape,
});
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

/** Validates the environment. Error messages name the variable, never its value. */
export function loadWorkerEnv(source: Record<string, string | undefined>): WorkerEnv {
  const result = workerEnvSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`,
    );
    throw new Error(`Invalid worker environment:\n  ${problems.join('\n  ')}`);
  }
  return result.data;
}
