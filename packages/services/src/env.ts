import { isLoopbackUrl } from '@job-agent/ai-providers';
import { optionalEnv } from '@job-agent/shared';
import { z } from 'zod';
import type { AiSettings } from './ai';

/**
 * AI environment variables, shared by the web app and the worker so both read them the same
 * way. Each app spreads this shape into its own env schema.
 */
export const aiEnvShape = {
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
};

export type AiEnv = z.infer<z.ZodObject<typeof aiEnvShape>>;

export function aiSettingsFromEnv(env: AiEnv & { NODE_ENV?: string }): AiSettings {
  return {
    provider: env.AI_PROVIDER,
    production: env.NODE_ENV === 'production',
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    anthropicModel: env.ANTHROPIC_DEFAULT_MODEL,
    ollamaBaseUrl: env.OLLAMA_BASE_URL,
    ollamaModel: env.OLLAMA_MODEL,
    ollamaContextTokens: env.OLLAMA_CONTEXT_TOKENS,
    ollamaThinking: env.OLLAMA_THINKING,
    monthlyBudgetUsd: env.AI_MONTHLY_BUDGET_USD,
  };
}
