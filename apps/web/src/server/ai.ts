import type { ModelPurpose } from '@job-agent/ai-providers';
import type { AiConfig, ReadyAi } from '@job-agent/services';
import type { AiUsageStatus, UserId } from '@job-agent/shared';
import { getServices } from './services';

/**
 * AI setup for the web app. The logic lives in @job-agent/services (shared with the worker);
 * these wrappers bind it to the web app's environment. Errors (AI unavailable, consent
 * missing) are mapped to HTTP responses in ./api.ts.
 */

export {
  DEFAULT_MODEL,
  DEFAULT_OLLAMA_MODEL,
  type AiConfig,
  type AiLimits,
  type AiProviderName,
  type ReadyAi,
} from '@job-agent/services';

export function getAiConfig(): AiConfig {
  return getServices().ai.config();
}

export function getAiStatus(userId: UserId): Promise<AiUsageStatus> {
  return getServices().ai.status(userId);
}

/** Everything that must be true before any user data is given to the AI model. */
export function requireAiReady(userId: UserId): Promise<ReadyAi> {
  return getServices().ai.requireReady(userId);
}

export function createBudgetGuard(userId: UserId, budgetUsd: number | null) {
  return getServices().ai.budgetGuard(userId, budgetUsd);
}

export function createUsageRecorder(
  userId: UserId,
  conversationId: string | null,
  purpose: ModelPurpose,
) {
  return getServices().ai.usageRecorder(userId, conversationId, purpose);
}
