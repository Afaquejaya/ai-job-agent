import type { AgentTaskRecord, TaskQueue } from '@job-agent/agent-core';
import {
  createTaskRepository,
  type TaskAttemptRecord,
  type TaskEventRecord,
} from '@job-agent/database';
import { createJsonLogger } from '@job-agent/observability';
import { createTaskService, type TaskService } from '@job-agent/services';
import type { TaskDetail, TaskSummary } from '@job-agent/shared';
import { createBullTaskQueue } from '@job-agent/task-queue';
import { getDatabase } from './db';
import { getWebEnv } from './env';

/**
 * Background tasks from the web app's side (Phase 3): it creates them and puts them on the
 * queue; the worker runs them. If Redis is down, the task still exists in PostgreSQL and the
 * worker's reconciler queues it once Redis is back.
 */

export const DEFAULT_REDIS_URL = 'redis://127.0.0.1:6379';

const globalForTasks = globalThis as unknown as {
  jobAgentTaskQueue?: TaskQueue;
  jobAgentTaskService?: { queue: TaskQueue; service: TaskService };
};

export function getTaskQueue(): TaskQueue {
  const env = getWebEnv();
  globalForTasks.jobAgentTaskQueue ??= createBullTaskQueue({
    url: env.REDIS_URL ?? DEFAULT_REDIS_URL,
    prefix: env.TASK_QUEUE_PREFIX,
  });
  return globalForTasks.jobAgentTaskQueue;
}

/** Tests: replace the queue (e.g. with an in-memory one) for this process. */
export function setTaskQueueForTests(queue: TaskQueue): void {
  globalForTasks.jobAgentTaskQueue = queue;
}

export function getTaskService(): TaskService {
  const queue = getTaskQueue();
  if (globalForTasks.jobAgentTaskService?.queue !== queue) {
    globalForTasks.jobAgentTaskService = {
      queue,
      service: createTaskService({
        tasks: createTaskRepository(getDatabase()),
        queue,
        logger: createJsonLogger({ service: 'web', level: getWebEnv().LOG_LEVEL }),
      }),
    };
  }
  return globalForTasks.jobAgentTaskService.service;
}

const ACTIVE = new Set(['QUEUED', 'RUNNING', 'RETRY_WAIT']);

export function toTaskSummary(
  task: AgentTaskRecord,
  lastReason: string | null = null,
): TaskSummary {
  return {
    id: task.id,
    kind: task.kind,
    state: task.state,
    active: ACTIVE.has(task.state),
    input: task.input,
    output: task.output,
    failedAttempts: task.failedAttempts,
    maxAttempts: task.maxAttempts,
    nextRunAt: task.nextRunAt?.toISOString() ?? null,
    cancelRequested: task.cancelRequestedAt !== null,
    lastReason,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

export function toTaskDetail(
  task: AgentTaskRecord,
  events: TaskEventRecord[],
  attempts: TaskAttemptRecord[],
): TaskDetail {
  return {
    ...toTaskSummary(task, events.at(-1)?.reason ?? null),
    events: events.map((e) => ({
      id: e.id,
      fromState: e.fromState,
      toState: e.toState,
      reason: e.reason,
      failureKind: e.failureKind,
      createdAt: e.createdAt.toISOString(),
    })),
    attempts: attempts.map((a) => ({
      attempt: a.attempt,
      step: a.step,
      outcome: a.outcome,
      failureKind: a.failureKind,
      startedAt: a.startedAt.toISOString(),
      finishedAt: a.finishedAt?.toISOString() ?? null,
      durationMs: a.finishedAt ? a.finishedAt.getTime() - a.startedAt.getTime() : null,
    })),
  };
}

/** The newest task for a piece of work (e.g. `analyze:<jobId>`), with its latest reason. */
export async function latestTaskFor(userId: string, key: string): Promise<TaskSummary | null> {
  const tasks = createTaskRepository(getDatabase());
  const task = await tasks.findLatestByKeyPrefix(userId as never, `${key}#`);
  if (!task) return null;
  const timeline = await tasks.timeline(task.userId, task.id);
  return toTaskSummary(task, timeline?.events.at(-1)?.reason ?? null);
}

export const analysisKey = (jobId: string) => `analyze:${jobId}`;
export const cvProcessingKey = (resumeId: string) => `cv:${resumeId}`;
export const jobSearchKey = 'job-search';
