/**
 * Background tasks as the API returns them (Phase 3). The task itself lives in PostgreSQL; the
 * page polls `GET /api/tasks/:id` every TASK_POLL_INTERVAL_MS while a task is active.
 */

export const TASK_POLL_INTERVAL_MS = 3_000;

export interface TaskSummary {
  id: string;
  kind: string;
  state: string;
  /** Not finished yet (queued, running or waiting to retry). */
  active: boolean;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  failedAttempts: number;
  maxAttempts: number;
  nextRunAt: string | null;
  cancelRequested: boolean;
  /** The latest timeline reason (e.g. why it is waiting to retry). */
  lastReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskTimelineEvent {
  id: string;
  fromState: string | null;
  toState: string;
  reason: string;
  failureKind: string | null;
  createdAt: string;
}

export interface TaskAttemptSummary {
  attempt: number;
  step: string;
  outcome: string;
  failureKind: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
}

export interface TaskDetail extends TaskSummary {
  events: TaskTimelineEvent[];
  attempts: TaskAttemptSummary[];
}
