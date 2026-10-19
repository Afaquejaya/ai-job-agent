import { BudgetExceededError } from '@job-agent/agent-core';
import {
  createAnthropicProvider,
  createOllamaProvider,
  estimateCallCostUsd,
  hasPrice,
  type ModelProvider,
  type ModelPurpose,
  type ModelRef,
  type TokenUsage,
} from '@job-agent/ai-providers';
import { createDemoFakeProvider } from '@job-agent/ai-providers/testing';
import { createUsageRepository, createUserSettingsRepository } from '@job-agent/database';
import type { AiUsageStatus, UserId } from '@job-agent/shared';
import { ApiProblem } from './api';
import { getDatabase } from './db';
import { getWebEnv } from './env';

/** Anthropic's current default model (decision in docs/development/phase-2c-first-agent-plan.md). */
export const DEFAULT_MODEL = 'claude-opus-5-5';
/** Default local model (decision D-040: answers directly, so an agent turn fits on a laptop). */
export const DEFAULT_OLLAMA_MODEL = 'qwen3:4b-instruct-2507-q4_K_M';

export type AiProviderName = 'anthropic' | 'ollama' | 'fake';

/** Time limits. A model on a laptop processor is much slower than a cloud API (D-038). */
export interface AiLimits {
  turnTimeoutMs: number;
  analysisTimeoutMs: number;
}
const CLOUD_LIMITS: AiLimits = { turnTimeoutMs: 120_000, analysisTimeoutMs: 90_000 };
const LOCAL_LIMITS: AiLimits = { turnTimeoutMs: 600_000, analysisTimeoutMs: 480_000 };

export interface AiConfig {
  provider: ModelProvider | null;
  providerName: AiProviderName;
  model: string;
  /** null = no budget; only allowed for a local model, which costs nothing. */
  budgetUsd: number | null;
  /** True when the model runs on this computer (nothing leaves the machine). */
  runsLocally: boolean;
  limits: AiLimits;
  /** Set when AI cannot be used, with a reason the user can act on. */
  unavailableReason: string | null;
}

const globalForAi = globalThis as unknown as {
  jobAgentAi?: { key: string; provider: ModelProvider };
};

export function getAiConfig(): AiConfig {
  const env = getWebEnv();
  const runsLocally = env.AI_PROVIDER === 'ollama';
  const model = runsLocally
    ? (env.OLLAMA_MODEL ?? DEFAULT_OLLAMA_MODEL)
    : (env.ANTHROPIC_DEFAULT_MODEL ?? DEFAULT_MODEL);
  const base = {
    providerName: env.AI_PROVIDER,
    model,
    budgetUsd: env.AI_MONTHLY_BUDGET_USD ?? null,
    runsLocally,
    limits: runsLocally ? LOCAL_LIMITS : CLOUD_LIMITS,
  };
  const unavailable = (reason: string): AiConfig => ({
    ...base,
    provider: null,
    unavailableReason: reason,
  });

  if (env.AI_PROVIDER === 'fake' && env.NODE_ENV === 'production') {
    return unavailable('The fake AI provider is not allowed in production.');
  }
  if (env.AI_PROVIDER === 'anthropic' && !env.ANTHROPIC_API_KEY) {
    return unavailable(
      'ANTHROPIC_API_KEY is not set in .env. For a free model on this computer, set AI_PROVIDER=ollama.',
    );
  }
  if (!runsLocally && !env.AI_MONTHLY_BUDGET_USD) {
    return unavailable('AI_MONTHLY_BUDGET_USD is not set in .env, so AI is switched off.');
  }
  if (env.AI_PROVIDER === 'anthropic' && !hasPrice(model)) {
    return unavailable(
      `No price is configured for model "${model}", so its cost could not be tracked.`,
    );
  }

  const cacheKey = [
    env.AI_PROVIDER,
    env.ANTHROPIC_API_KEY?.slice(-6) ?? '',
    env.OLLAMA_BASE_URL,
    env.OLLAMA_CONTEXT_TOKENS ?? '',
    env.OLLAMA_THINKING ?? '',
  ].join(':');
  if (globalForAi.jobAgentAi?.key !== cacheKey) {
    globalForAi.jobAgentAi = {
      key: cacheKey,
      provider:
        env.AI_PROVIDER === 'fake'
          ? createDemoFakeProvider()
          : env.AI_PROVIDER === 'ollama'
            ? createOllamaProvider({
                baseUrl: env.OLLAMA_BASE_URL,
                contextTokens: env.OLLAMA_CONTEXT_TOKENS,
                thinking: env.OLLAMA_THINKING ?? false,
              })
            : createAnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY }),
    };
  }
  return { ...base, provider: globalForAi.jobAgentAi.provider, unavailableReason: null };
}

export async function getAiStatus(userId: UserId): Promise<AiUsageStatus> {
  const config = getAiConfig();
  const db = getDatabase();
  const [consentGiven, monthToDateUsd] = await Promise.all([
    createUserSettingsRepository(db).hasAiConsent(userId),
    createUsageRepository(db).monthToDateCostUsd(userId),
  ]);
  return {
    configured: config.provider !== null,
    unavailableReason: config.unavailableReason,
    consentGiven,
    provider: config.providerName,
    runsLocally: config.runsLocally,
    model: config.provider ? config.model : null,
    monthToDateUsd,
    monthlyBudgetUsd: config.budgetUsd,
  };
}

export interface ReadyAi {
  provider: ModelProvider;
  model: string;
  budgetUsd: number | null;
  runsLocally: boolean;
  limits: AiLimits;
}

/** Everything that must be true before any user data is given to the AI model. */
export async function requireAiReady(userId: UserId): Promise<ReadyAi> {
  const config = getAiConfig();
  if (!config.provider) {
    throw new ApiProblem('AI_UNAVAILABLE', `AI is not available: ${config.unavailableReason}`, 503);
  }
  if (!(await createUserSettingsRepository(getDatabase()).hasAiConsent(userId))) {
    throw new ApiProblem(
      'FORBIDDEN',
      'Allow AI processing first: your CV and profile are only given to the AI model after you agree.',
      403,
      { reason: 'consent_required' },
    );
  }
  return {
    provider: config.provider,
    model: config.model,
    budgetUsd: config.budgetUsd,
    runsLocally: config.runsLocally,
    limits: config.limits,
  };
}

/** Throws BudgetExceededError once this month's spend reaches the budget (null = no limit). */
export function createBudgetGuard(userId: UserId, budgetUsd: number | null): () => Promise<void> {
  return async () => {
    if (budgetUsd === null) return;
    const spent = await createUsageRepository(getDatabase()).monthToDateCostUsd(userId);
    if (spent >= budgetUsd) {
      throw new BudgetExceededError(
        `The monthly AI budget ($${budgetUsd.toFixed(2)}) has been used up ($${spent.toFixed(2)} spent).`,
      );
    }
  };
}

/** Records every model call and keeps a running total for the current turn. */
export function createUsageRecorder(
  userId: UserId,
  conversationId: string | null,
  purpose: ModelPurpose,
) {
  let totalUsd = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let calls = 0;
  const record = async (usage: TokenUsage, model: ModelRef, succeeded = true) => {
    const cost = estimateCallCostUsd(model, usage);
    totalUsd += cost;
    inputTokens += usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
    outputTokens += usage.outputTokens;
    calls += 1;
    await createUsageRepository(getDatabase()).record(userId, {
      conversationId,
      purpose,
      provider: model.provider,
      model: model.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      estimatedCostUsd: cost,
      succeeded,
    });
  };
  return {
    record,
    totals: () => ({
      modelCalls: calls,
      inputTokens,
      outputTokens,
      costUsd: Math.round(totalUsd * 1e6) / 1e6,
    }),
  };
}
