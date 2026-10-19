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
import {
  createUsageRepository,
  createUserSettingsRepository,
  type Database,
} from '@job-agent/database';
import type { AiUsageStatus, UserId } from '@job-agent/shared';

/** Anthropic's current default model (decision in docs/development/phase-2c-first-agent-plan.md). */
export const DEFAULT_MODEL = 'claude-opus-5-5';
/** Default local model (decision D-040: answers directly, so an agent turn fits on a laptop). */
export const DEFAULT_OLLAMA_MODEL = 'qwen3:4b-instruct-2507-q4_K_M';

export type AiProviderName = 'anthropic' | 'ollama' | 'fake';

/** The AI part of the environment, read by each app (web, worker) from its own env. */
export interface AiSettings {
  provider: AiProviderName;
  production: boolean;
  anthropicApiKey?: string;
  anthropicModel?: string;
  ollamaBaseUrl: string;
  ollamaModel?: string;
  ollamaContextTokens?: number;
  ollamaThinking?: boolean;
  monthlyBudgetUsd?: number;
}

/** Time limits. A model on a laptop processor is much slower than a cloud API (D-038). */
export interface AiLimits {
  turnTimeoutMs: number;
  analysisTimeoutMs: number;
}
const CLOUD_LIMITS: AiLimits = { turnTimeoutMs: 120_000, analysisTimeoutMs: 90_000 };
// One local analysis gets up to 15 minutes; a chat turn that includes one, 20 (D-048).
const LOCAL_LIMITS: AiLimits = { turnTimeoutMs: 1_200_000, analysisTimeoutMs: 900_000 };

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

export interface ReadyAi {
  provider: ModelProvider;
  model: string;
  budgetUsd: number | null;
  runsLocally: boolean;
  limits: AiLimits;
}

/** AI is not configured; the message says what to set. */
export class AiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiUnavailableError';
  }
}

/** The user has not allowed AI processing. */
export class AiConsentRequiredError extends Error {
  constructor() {
    super(
      'Allow AI processing first: your CV and profile are only given to the AI model after you agree.',
    );
    this.name = 'AiConsentRequiredError';
  }
}

export function createAiRuntime(settings: AiSettings, db: Database) {
  let cached: ModelProvider | null = null;

  function config(): AiConfig {
    const runsLocally = settings.provider === 'ollama';
    const model = runsLocally
      ? (settings.ollamaModel ?? DEFAULT_OLLAMA_MODEL)
      : (settings.anthropicModel ?? DEFAULT_MODEL);
    const base = {
      providerName: settings.provider,
      model,
      budgetUsd: settings.monthlyBudgetUsd ?? null,
      runsLocally,
      limits: runsLocally ? LOCAL_LIMITS : CLOUD_LIMITS,
    };
    const unavailable = (reason: string): AiConfig => ({
      ...base,
      provider: null,
      unavailableReason: reason,
    });

    if (settings.provider === 'fake' && settings.production) {
      return unavailable('The fake AI provider is not allowed in production.');
    }
    if (settings.provider === 'anthropic' && !settings.anthropicApiKey) {
      return unavailable(
        'ANTHROPIC_API_KEY is not set in .env. For a free model on this computer, set AI_PROVIDER=ollama.',
      );
    }
    if (!runsLocally && !settings.monthlyBudgetUsd) {
      return unavailable('AI_MONTHLY_BUDGET_USD is not set in .env, so AI is switched off.');
    }
    if (settings.provider === 'anthropic' && !hasPrice(model)) {
      return unavailable(
        `No price is configured for model "${model}", so its cost could not be tracked.`,
      );
    }

    cached ??=
      settings.provider === 'fake'
        ? createDemoFakeProvider()
        : settings.provider === 'ollama'
          ? createOllamaProvider({
              baseUrl: settings.ollamaBaseUrl,
              contextTokens: settings.ollamaContextTokens,
              thinking: settings.ollamaThinking ?? false,
            })
          : createAnthropicProvider({ apiKey: settings.anthropicApiKey });
    return { ...base, provider: cached, unavailableReason: null };
  }

  async function status(userId: UserId): Promise<AiUsageStatus> {
    const current = config();
    const [consentGiven, monthToDateUsd] = await Promise.all([
      createUserSettingsRepository(db).hasAiConsent(userId),
      createUsageRepository(db).monthToDateCostUsd(userId),
    ]);
    return {
      configured: current.provider !== null,
      unavailableReason: current.unavailableReason,
      consentGiven,
      provider: current.providerName,
      runsLocally: current.runsLocally,
      model: current.provider ? current.model : null,
      monthToDateUsd,
      monthlyBudgetUsd: current.budgetUsd,
    };
  }

  /** Everything that must be true before any user data is given to the AI model. */
  async function requireReady(userId: UserId): Promise<ReadyAi> {
    const current = config();
    if (!current.provider) {
      throw new AiUnavailableError(`AI is not available: ${current.unavailableReason}`);
    }
    if (!(await createUserSettingsRepository(db).hasAiConsent(userId))) {
      throw new AiConsentRequiredError();
    }
    return {
      provider: current.provider,
      model: current.model,
      budgetUsd: current.budgetUsd,
      runsLocally: current.runsLocally,
      limits: current.limits,
    };
  }

  /** Throws BudgetExceededError once this month's spend reaches the budget (null = no limit). */
  function budgetGuard(userId: UserId, budgetUsd: number | null): () => Promise<void> {
    return async () => {
      if (budgetUsd === null) return;
      const spent = await createUsageRepository(db).monthToDateCostUsd(userId);
      if (spent >= budgetUsd) {
        throw new BudgetExceededError(
          `The monthly AI budget ($${budgetUsd.toFixed(2)}) has been used up ($${spent.toFixed(2)} spent).`,
        );
      }
    };
  }

  /** Records every model call and keeps a running total for the current turn. */
  function usageRecorder(userId: UserId, conversationId: string | null, purpose: ModelPurpose) {
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
      await createUsageRepository(db).record(userId, {
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

  return { settings, config, status, requireReady, budgetGuard, usageRecorder };
}

export type AiRuntime = ReturnType<typeof createAiRuntime>;
