import type { TaskId, UserId } from '@job-agent/shared';

/**
 * Durable job queue port. The BullMQ/Redis adapter arrives in Phase 3.
 *
 * Queue messages carry identifiers only. The authoritative task state lives in PostgreSQL,
 * so losing Redis loses scheduling, not progress: a reconciler re-enqueues non-terminal tasks.
 */
export type QueueName = 'agent-tasks' | 'connector-runs' | 'scheduled-reports' | 'notifications';

export interface QueueMessage {
  taskId: TaskId;
  userId: UserId;
}

export interface EnqueueOptions {
  /** Deduplication key; enqueueing the same key twice is a no-op. */
  idempotencyKey: string;
  runAt?: Date;
  priority?: number;
}

export interface EnqueueResult {
  jobId: string;
  deduplicated: boolean;
}

export interface TaskQueue {
  enqueue(queue: QueueName, message: QueueMessage, options: EnqueueOptions): Promise<EnqueueResult>;
  /** Removes a job that has not started. Running jobs are cancelled via the task record. */
  remove(queue: QueueName, jobId: string): Promise<boolean>;
}

export interface QueueJob {
  id: string;
  queue: QueueName;
  message: QueueMessage;
  attemptsMade: number;
}

export type QueueJobHandler = (job: QueueJob, signal: AbortSignal) => Promise<void>;

export interface TaskConsumer {
  start(
    queue: QueueName,
    handler: QueueJobHandler,
    options: { concurrency: number },
  ): Promise<void>;
  /** Stops taking new jobs and waits for in-flight jobs up to `timeoutMs`. */
  stop(timeoutMs: number): Promise<void>;
}
