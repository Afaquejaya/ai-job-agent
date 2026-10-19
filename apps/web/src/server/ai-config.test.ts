import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_OLLAMA_MODEL, getAiConfig } from './ai';
import { ConfigurationError, parseWebEnv, resetWebEnvForTests } from './env';

const saved = { ...process.env };

function withEnv(values: Record<string, string | undefined>) {
  for (const key of [
    'AI_PROVIDER',
    'ANTHROPIC_API_KEY',
    'AI_MONTHLY_BUDGET_USD',
    'OLLAMA_BASE_URL',
    'OLLAMA_MODEL',
  ]) {
    delete process.env[key];
  }
  Object.assign(process.env, values);
  resetWebEnvForTests();
}

afterEach(() => {
  process.env = { ...saved };
  resetWebEnvForTests();
});

describe('Ollama configuration', () => {
  it('accepts only a base URL on this computer', () => {
    expect(parseWebEnv({}).OLLAMA_BASE_URL).toBe('http://127.0.0.1:11434');
    expect(parseWebEnv({ OLLAMA_BASE_URL: '' }).OLLAMA_BASE_URL).toBe('http://127.0.0.1:11434');
    expect(parseWebEnv({ OLLAMA_BASE_URL: 'http://localhost:11434' }).OLLAMA_BASE_URL).toBe(
      'http://localhost:11434',
    );
    expect(() => parseWebEnv({ OLLAMA_BASE_URL: 'http://192.168.1.5:11434' })).toThrow(
      ConfigurationError,
    );
  });

  it('works without an API key or budget, uses the default model and long time limits', () => {
    withEnv({ AI_PROVIDER: 'ollama' });
    const config = getAiConfig();
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

  it('uses OLLAMA_MODEL when set', () => {
    withEnv({ AI_PROVIDER: 'ollama', OLLAMA_MODEL: 'bonsai-2:4b' });
    expect(getAiConfig().model).toBe('bonsai-2:4b');
  });

  it('still requires a key and a budget for the paid Anthropic API, and points to the free option', () => {
    withEnv({ AI_PROVIDER: 'anthropic' });
    const config = getAiConfig();
    expect(config.provider).toBeNull();
    expect(config.unavailableReason).toMatch(/AI_PROVIDER=ollama/);
    expect(config.limits.turnTimeoutMs).toBe(120_000);
  });
});
