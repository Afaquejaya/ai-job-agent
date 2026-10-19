import { isLoopbackUrl } from '@job-agent/ai-providers';
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
  /**
   * anthropic = paid API; ollama = free model on this computer; fake = deterministic stand-in
   * for tests/dev (refused in production).
   */
  AI_PROVIDER: z.enum(['anthropic', 'ollama', 'fake']).default('anthropic'),
  ANTHROPIC_API_KEY: optionalEnv(z.string().min(20)),
  ANTHROPIC_DEFAULT_MODEL: optionalEnv(z.string().min(1)),
  /** Must be this computer: data for a local model never leaves the machine. */
  OLLAMA_BASE_URL: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z
      .string()
      .default('http://127.0.0.1:11434')
      .refine(isLoopbackUrl, 'OLLAMA_BASE_URL must be http://localhost or http://127.0.0.1'),
  ),
  OLLAMA_MODEL: optionalEnv(z.string().min(1)),
  OLLAMA_CONTEXT_TOKENS: optionalEnv(z.coerce.number().int().min(4096).max(262_144)),
  /** Let a local model think before each agent step. Off by default: minutes per step on a laptop. */
  OLLAMA_THINKING: optionalEnv(z.enum(['true', 'false']).transform((v) => v === 'true')),
  /** Hard monthly AI spend cap in USD. Empty = paid AI disabled (not needed for ollama). */
  AI_MONTHLY_BUDGET_USD: optionalEnv(z.coerce.number().positive().max(10_000)),
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

/** Tests only: re-read process.env on the next getWebEnv() call. */
export function resetWebEnvForTests(): void {
  cached = undefined;
}
