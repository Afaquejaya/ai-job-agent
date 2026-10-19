import type { Database } from '@job-agent/database';
import { describe, expect, it } from 'vitest';
import { createAiRuntime, DEFAULT_OLLAMA_MODEL, type AiSettings } from './ai';
import { aiSettingsFromEnv } from './env';

// config() never touches the database; status() and requireReady() do (integration tests).
const db = {} as Database;
const runtime = (settings: Partial<AiSettings>) =>
  createAiRuntime(
    {
      provider: 'anthropic',
      production: false,
      ollamaBaseUrl: 'http://127.0.0.1:11434',
      ...settings,
    },
    db,
  );

describe('AI configuration', () => {
  it('runs a local model without an API key or budget, with long time limits', () => {
    const config = runtime({ provider: 'ollama' }).config();
    expect(config).toMatchObject({
      providerName: 'ollama',
      model: DEFAULT_OLLAMA_MODEL,
      runsLocally: true,
      budgetUsd: null,
      unavailableReason: null,
      limits: { turnTimeoutMs: 600_000, analysisTimeoutMs: 480_000 },
    });
    expect(config.provider?.id).toBe('ollama');
  });

  it('uses the configured local model', () => {
    expect(runtime({ provider: 'ollama', ollamaModel: 'bonsai-2:4b' }).config().model).toBe(
      'bonsai-2:4b',
    );
  });

  it('requires a key and a budget for the paid API, and points to the free option', () => {
    const missingKey = runtime({ provider: 'anthropic', monthlyBudgetUsd: 5 }).config();
    expect(missingKey.provider).toBeNull();
    expect(missingKey.unavailableReason).toMatch(/AI_PROVIDER=ollama/);
    expect(missingKey.limits.turnTimeoutMs).toBe(120_000);

    const missingBudget = runtime({
      provider: 'anthropic',
      anthropicApiKey: 'k'.repeat(30),
    }).config();
    expect(missingBudget.unavailableReason).toMatch(/AI_MONTHLY_BUDGET_USD/);

    const ready = runtime({
      provider: 'anthropic',
      anthropicApiKey: 'k'.repeat(30),
      monthlyBudgetUsd: 5,
    }).config();
    expect(ready).toMatchObject({
      providerName: 'anthropic',
      model: 'claude-opus-5-5',
      unavailableReason: null,
    });
  });

  it('refuses the fake model in production', () => {
    expect(
      runtime({ provider: 'fake', production: true, monthlyBudgetUsd: 5 }).config().provider,
    ).toBeNull();
    expect(runtime({ provider: 'fake', monthlyBudgetUsd: 5 }).config().provider).not.toBeNull();
  });

  it('maps the environment to settings the same way for the web app and the worker', () => {
    expect(
      aiSettingsFromEnv({
        NODE_ENV: 'production',
        AI_PROVIDER: 'ollama',
        ANTHROPIC_API_KEY: undefined,
        ANTHROPIC_DEFAULT_MODEL: undefined,
        OLLAMA_BASE_URL: 'http://localhost:11434',
        OLLAMA_MODEL: 'qwen3:4b-instruct-2507-q4_K_M',
        OLLAMA_CONTEXT_TOKENS: 8192,
        OLLAMA_THINKING: false,
        AI_MONTHLY_BUDGET_USD: undefined,
      }),
    ).toMatchObject({
      provider: 'ollama',
      production: true,
      ollamaBaseUrl: 'http://localhost:11434',
      ollamaContextTokens: 8192,
      ollamaThinking: false,
    });
  });
});
