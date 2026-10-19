import type { Database } from '@job-agent/database';
import { NotFoundError } from '@job-agent/database';
import type { Logger } from '@job-agent/observability';
import { DecryptionError } from '@job-agent/security';
import { describe, expect, it } from 'vitest';
import { createAiRuntime } from './ai';
import { MatchAnalysisError, type MatchingService } from './matching';
import type { ResumeService } from './resumes';
import { createTaskHandlers } from './tasks';

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
