import { optionalEnv } from '@job-agent/shared';
import { z } from 'zod';

const redisUrl = z
  .string()
  .refine(
    (value) => /^rediss?:\/\//.test(value),
    'REDIS_URL must start with redis:// or rediss://',
  );

export const workerEnvSchema = z.object({
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  WORKER_HEALTH_PORT: z.coerce.number().int().min(0).max(65535).default(8081),
  DATABASE_URL: optionalEnv(z.string().min(1)),
  REDIS_URL: optionalEnv(redisUrl),
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
