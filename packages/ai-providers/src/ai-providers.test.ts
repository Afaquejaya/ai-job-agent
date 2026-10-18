import { describe, expect, it } from 'vitest';
import { detectConfiguredProviders, ProviderError } from './index';

describe('detectConfiguredProviders', () => {
  it('reports nothing configured for an empty environment', () => {
    expect(detectConfiguredProviders({}).every((p) => !p.configured)).toBe(true);
  });

  it('treats blank values as not configured and never echoes keys', () => {
    const result = detectConfiguredProviders({
      ANTHROPIC_API_KEY: 'test-key-value',
      ANTHROPIC_DEFAULT_MODEL: 'some-model',
      OPENAI_API_KEY: '   ',
      OPENAI_COMPATIBLE_BASE_URL: 'http://localhost:11434/v1',
    });
    expect(result).toEqual([
      { provider: 'anthropic', configured: true, defaultModel: 'some-model' },
      { provider: 'google', configured: false, defaultModel: null },
      { provider: 'openai', configured: false, defaultModel: null },
      { provider: 'openai_compatible', configured: true, defaultModel: null },
    ]);
    expect(JSON.stringify(result)).not.toContain('test-key-value');
  });
});

describe('ProviderError', () => {
  it('only falls back on availability problems, not on auth or invalid requests', () => {
    expect(new ProviderError('openai', 'rate_limited', 'slow down').canFallback).toBe(true);
    expect(new ProviderError('openai', 'auth', 'bad key').canFallback).toBe(false);
    expect(new ProviderError('openai', 'invalid_request', 'bad input').canFallback).toBe(false);
  });
});
