import { describe, expect, it } from 'vitest';
import { ConfigurationError, parseWebEnv } from './env';

// The AI configuration itself is tested in @job-agent/services (ai.test.ts).
describe('web environment for AI and the task queue', () => {
  it('accepts only an Ollama base URL on this computer', () => {
    expect(parseWebEnv({}).OLLAMA_BASE_URL).toBe('http://127.0.0.1:11434');
    expect(parseWebEnv({ OLLAMA_BASE_URL: '' }).OLLAMA_BASE_URL).toBe('http://127.0.0.1:11434');
    expect(parseWebEnv({ OLLAMA_BASE_URL: 'http://localhost:11434' }).OLLAMA_BASE_URL).toBe(
      'http://localhost:11434',
    );
    expect(() => parseWebEnv({ OLLAMA_BASE_URL: 'http://192.168.1.5:11434' })).toThrow(
      ConfigurationError,
    );
  });

  it('reads AI and queue settings with safe defaults', () => {
    expect(parseWebEnv({ AI_PROVIDER: 'ollama', OLLAMA_THINKING: 'true' })).toMatchObject({
      AI_PROVIDER: 'ollama',
      OLLAMA_THINKING: true,
      TASK_QUEUE_PREFIX: 'job-agent',
    });
    expect(parseWebEnv({}).REDIS_URL).toBeUndefined();
    expect(() => parseWebEnv({ REDIS_URL: 'http://not-redis' })).toThrow(/REDIS_URL/);
    expect(() => parseWebEnv({ TASK_QUEUE_PREFIX: 'Bad Prefix!' })).toThrow(/TASK_QUEUE_PREFIX/);
  });
});
