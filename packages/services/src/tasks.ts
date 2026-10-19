import {
  taskJobId,
  TaskStepError,
  type AgentTaskRecord,
  type TaskHandler,
  type TaskKind,
  type TaskQueue,
} from '@job-agent/agent-core';
import { NotFoundError, type TaskRepository } from '@job-agent/database';
import type { Logger } from '@job-agent/observability';
import { DecryptionError } from '@job-agent/security';
import type { TaskId, UserId } from '@job-agent/shared';
import { z } from 'zod';
import { AiConsentRequiredError, AiUnavailableError, type AiRuntime } from './ai';
import { MatchAnalysisError, type MatchingService } from './matching';
import type { ResumeService } from './resumes';

/**
 * Background tasks (Phase 3). The web app starts them; the worker runs them through the
 * agent-core runner. Inputs are ids only.
 */

export const jobMatchAnalysisInput = z.object({ jobId: z.uuid() }).strict();
export const cvProcessingInput = z.object({ resumeId: z.uuid() }).strict();

/** Every background task gets this long before it is given up (retries included). */
const TASK_DEADLINE_MS = 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 3;

/** Maps a use-case failure to how the runner should treat it. */
function toStepError(error: unknown): unknown {
  if (error instanceof MatchAnalysisError) {
    return new TaskStepError(
      error.message,
      error.retryable ? 'transient' : 'permanent',
      error.retryAfterMs,
    );
  }
  if (error instanceof AiUnavailableError || error instanceof AiConsentRequiredError) {
    return new TaskStepError(error.message, 'permanent');
  }
  if (error instanceof NotFoundError) {
    return new TaskStepError(`The ${error.entity.toLowerCase()} no longer exists`, 'permanent');
  }
  if (error instanceof DecryptionError) {
    // Wrong key or damaged data: trying again cannot help.
    return new TaskStepError(
      'Stored data could not be decrypted (wrong encryption key?)',
      'permanent',
    );
  }
  return error;
}

export function createTaskHandlers(deps: {
  ai: AiRuntime;
  matching: MatchingService;
  resumes: ResumeService;
  logger: Logger;
}): ReadonlyMap<TaskKind, TaskHandler<never>> {
  const analysis: TaskHandler<z.infer<typeof jobMatchAnalysisInput>> = {
    kind: 'job_match_analysis',
    input: jobMatchAnalysisInput,
    // The analysis has its own limit (8 min locally); this is the outer safety net.
    timeoutMs: deps.ai.config().limits.analysisTimeoutMs + 60_000,
    async run(input, context) {
      try {
        const match = await deps.matching.run(context.userId, input.jobId, {
          signal: context.signal,
          conversationId: null,
        });
        return {
          output: {
            jobId: input.jobId,
            matchId: match.id,
            score: match.score,
            recommendation: match.recommendation,
          },
          summary: `Analysed: ${match.score ?? 'n/a'}/100, ${match.recommendation.replace(/_/g, ' ')}`,
        };
      } catch (error) {
        throw toStepError(error);
      }
    },
  };

  const cvProcessing: TaskHandler<z.infer<typeof cvProcessingInput>> = {
    kind: 'cv_processing',
    input: cvProcessingInput,
    timeoutMs: 120_000,
    async run(input, context) {
      try {
        const resume = await deps.resumes.process(context.userId, input.resumeId, deps.logger);
        const summary =
          resume.extractionStatus === 'EXTRACTED'
            ? `Text extracted (${resume.suggestions.length} suggestions)`
            : resume.extractionStatus === 'NEEDS_REVIEW'
              ? 'Very little text found: needs review'
              : 'Text could not be extracted';
        return {
          output: { resumeId: input.resumeId, status: resume.extractionStatus },
          summary,
        };
      } catch (error) {
        throw toStepError(error);
      }
    },
  };

  return new Map<TaskKind, TaskHandler<never>>([
    ['job_match_analysis', analysis as unknown as TaskHandler<never>],
    ['cv_processing', cvProcessing as unknown as TaskHandler<never>],
  ]);
}

/** Starting, enqueueing and cancelling tasks: used by the web app and the worker. */
export function createTaskService(deps: {
  tasks: TaskRepository;
  queue: TaskQueue;
  logger: Logger;
}) {
  const { tasks, queue, logger } = deps;

  /** Puts the task's current state on the queue. A failure is logged, not thrown: the
   * reconciler enqueues the task again once Redis is back. */
  async function enqueue(task: AgentTaskRecord): Promise<void> {
    try {
      await queue.enqueue(
        'agent-tasks',
        { taskId: task.id, userId: task.userId },
        { idempotencyKey: taskJobId(task), runAt: task.nextRunAt ?? undefined },
      );
    } catch (error) {
      logger.warn('task.enqueue_failed', { taskId: task.id, error });
    }
  }

  /**
   * Starts a task unless the same work is already in progress. `key` names the work (e.g.
   * `analyze:<jobId>`): while one task for it is active, starting again returns that task.
   */
  async function start(
    userId: UserId,
    kind: TaskKind,
    input: Record<string, unknown>,
    key: string,
  ): Promise<{ task: AgentTaskRecord; created: boolean }> {
    const active = await tasks.findActiveByKeyPrefix(userId, `${key}#`);
    if (active) return { task: active, created: false };
    const previous = await tasks.countByKeyPrefix(userId, `${key}#`);
    const result = await tasks.create(userId, {
      kind,
      input,
      // Numbered, so the same work can run again later, while a double click creates one task.
      idempotencyKey: `${key}#${previous + 1}`,
      maxAttempts: MAX_ATTEMPTS,
      deadlineAt: new Date(Date.now() + TASK_DEADLINE_MS),
    });
    if (result.created) await enqueue(result.task);
    return result;
  }

  /** Records the request; a task that is not running is cancelled at once. */
  async function cancel(userId: UserId, taskId: TaskId): Promise<AgentTaskRecord | null> {
    const task = await tasks.requestCancellation(userId, taskId);
    if (!task) return null;
    if (task.state === 'QUEUED' || task.state === 'RETRY_WAIT') {
      const result = await tasks.transition(userId, {
        taskId,
        from: task.state,
        to: 'CANCELLED',
        expectedVersion: task.version,
        reason: 'Cancelled by the user',
      });
      if (result.ok) return result.task;
    }
    return tasks.findById(userId, taskId);
  }

  return { start, enqueue, cancel };
}

export type TaskService = ReturnType<typeof createTaskService>;
