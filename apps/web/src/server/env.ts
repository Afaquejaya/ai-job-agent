import { optionalEnv } from '@job-agent/shared';
import { z } from 'zod';

export const webEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.url().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DATABASE_URL: optionalEnv(z.string().min(1)),
  AUTH_SECRET: optionalEnv(z.string().min(32, 'AUTH_SECRET must be at least 32 characters')),
  AUTH_SIGNUP_ALLOWED_EMAILS: optionalEnv(z.string()),
  /** 32 random bytes, base64. Encrypts CV files, extracted text and parsed CV data. */
  DATA_ENCRYPTION_KEY: optionalEnv(
    z.string().min(40, 'DATA_ENCRYPTION_KEY must be 32 bytes, base64'),
  ),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().min(1).default('.data/storage'),
});
export type WebEnv = z.infer<typeof webEnvSchema>;

/** Raised when a feature is used without the configuration it needs. */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

/** Validates the environment. Errors name the variable, never its value. */
export function parseWebEnv(source: Record<string, string | undefined>): WebEnv {
  const result = webEnvSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new ConfigurationError(`Invalid web environment: ${problems.join('; ')}`);
  }
  return result.data;
}

let cached: WebEnv | undefined;

export function getWebEnv(): WebEnv {
  cached ??= parseWebEnv(process.env);
  return cached;
}
