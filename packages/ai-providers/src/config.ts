import { isEnvSet } from '@job-agent/shared';
import type { ProviderId } from './types';

export interface ProviderAvailability {
  provider: ProviderId;
  configured: boolean;
  /** Default model id from configuration, if one is set. */
  defaultModel: string | null;
}

type Env = Record<string, string | undefined>;

const blankToNull = (value: string | undefined) => (isEnvSet(value) ? value.trim() : null);

/**
 * Reports which providers have credentials configured. Never returns or logs key values.
 * `openai_compatible` (e.g. a local model server) needs a base URL; its API key is optional.
 */
export function detectConfiguredProviders(env: Env): ProviderAvailability[] {
  return [
    {
      provider: 'anthropic',
      configured: isEnvSet(env.ANTHROPIC_API_KEY),
      defaultModel: blankToNull(env.ANTHROPIC_DEFAULT_MODEL),
    },
    {
      provider: 'google',
      configured: isEnvSet(env.GEMINI_API_KEY),
      defaultModel: blankToNull(env.GEMINI_DEFAULT_MODEL),
    },
    {
      provider: 'openai',
      configured: isEnvSet(env.OPENAI_API_KEY),
      defaultModel: blankToNull(env.OPENAI_DEFAULT_MODEL),
    },
    {
      provider: 'openai_compatible',
      configured: isEnvSet(env.OPENAI_COMPATIBLE_BASE_URL),
      defaultModel: blankToNull(env.OPENAI_COMPATIBLE_DEFAULT_MODEL),
    },
  ];
}
