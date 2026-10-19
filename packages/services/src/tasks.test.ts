import type { Database } from '@job-agent/database';
import { NotFoundError } from '@job-agent/database';
import type { Logger } from '@job-agent/observability';
import { DecryptionError } from '@job-agent/security';
import { describe, expect, it } from 'vitest';
import { createAiRuntime } from './ai';
import { MatchAnalysisError, type MatchingService } from './matching';
import type { ResumeService } from './resumes';
import { createTaskHandlers, queueForKind } from './tasks';
import { toAnalysisError } from './matching';
import { ProviderError } from '@job-agent/ai-providers';

const logger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  child() {
    return logger;
  },
} as unknown as Logger;
const ai = createAiRuntime(
  {
    provider: 'fake',
    production: false,
    ollamaBaseUrl: 'http://127.0.0.1:11434',
    monthlyBudgetUsd: 5,
  },
  {} as Database,
);
const jobId = '6b1f0b8e-2a5e-4a51-9f51-3c0e3f5c9a11';
const context = {
  userId: 'u' as never,
  taskId: 't' as never,
  signal: new AbortController().signal,
};

function analysisFailingWith(error: unknown) {
  const matching = {
    run: async () => {
      throw error;
    },
  } as unknown as MatchingService;
  const handler = createTaskHandlers({ ai, matching, resumes: {} as ResumeService, logger }).get(
    'job_match_analysis',
  )!;
  return (handler.run as (input: unknown, ctx: typeof context) => Promise<unknown>)(
    { jobId },
    context,
  );
}

describe('task handlers classify failures for the runner', () => {
  it.each([
    [new MatchAnalysisError('Ollama is not running on this computer.', true), 'transient'],
    [new MatchAnalysisError('Upload a CV with readable text first'), 'permanent'],
    [new NotFoundError('Job'), 'permanent'],
    [new DecryptionError(), 'permanent'],
  ])('%s -> %s', async (error, failure) => {
    await expect(analysisFailingWith(error)).rejects.toMatchObject({
      name: 'TaskStepError',
      failure,
    });
  });

  it('passes unknown errors through (the runner treats them as transient)', async () => {
    await expect(analysisFailingWith(new Error('boom'))).rejects.toThrow('boom');
  });
});

describe('local model rules (D-048)', () => {
  const local = { runsLocally: true, limits: { analysisTimeoutMs: 900_000 } };
  const cloud = { runsLocally: false, limits: { analysisTimeoutMs: 90_000 } };

  it('does not retry a local model that ran out of time', () => {
    const error = toAnalysisError(new ProviderError('ollama', 'timeout', 'slow'), local);
    expect(error.retryable).toBe(false);
    expect(error.message).toMatch(/did not finish within 15 minutes/);
  });

  it('still retries temporary problems, and cloud time-outs', () => {
    expect(
      toAnalysisError(new ProviderError('ollama', 'unavailable', 'Ollama is not running'), local)
        .retryable,
    ).toBe(true);
    expect(
      toAnalysisError(new ProviderError('anthropic', 'timeout', 'slow'), cloud).retryable,
    ).toBe(true);
    expect(
      toAnalysisError(new ProviderError('anthropic', 'auth', 'bad key'), cloud).retryable,
    ).toBe(false);
  });

  it('puts AI tasks on their own queue', () => {
    expect(queueForKind('job_match_analysis')).toBe('ai-tasks');
    expect(queueForKind('cv_processing')).toBe('agent-tasks');
  });
});
