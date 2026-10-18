import type { TaskId, UserId } from '@job-agent/shared';
import type { FailureKind } from './recovery';
import type { TaskState } from './task-state';

export type TaskKind =
  'daily_discovery' | 'job_application' | 'cv_analysis' | 'email_outreach' | 'morning_report';

/** Persisted task row (see docs/architecture/database-design.md, table `agent_tasks`). */
export interface AgentTaskRecord {
  id: TaskId;
  userId: UserId;
  kind: TaskKind;
  state: TaskState;
  parentTaskId: TaskId | null;
  /** Unique per user; enqueueing the same logical work twice returns the existing task. */
  idempotencyKey: string;
  failedAttempts: number;
  maxAttempts: number;
  deadlineAt: Date | null;
  nextRunAt: Date | null;
  cancelRequestedAt: Date | null;
  /** Optimistic concurrency token; every transition increments it. */
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Enough information to resume safely after a worker restart. Written in the same
 * transaction as the transition that precedes an external side effect.
 */
export interface TaskCheckpoint {
  taskId: TaskId;
  state: TaskState;
  /** Name of the step about to run, e.g. `submit_form`. */
  step: string;
  /** For submissions: set immediately before the submit action is dispatched. */
  externalActionDispatchedAt: Date | null;
  data: Record<string, unknown>;
  createdAt: Date;
}

export interface TaskTransition {
  taskId: TaskId;
  from: TaskState;
  to: TaskState;
  expectedVersion: number;
  reason: string;
  failure?: { kind: FailureKind; message: string };
  checkpoint?: Omit<TaskCheckpoint, 'taskId' | 'createdAt'>;
}

export type TransitionResult =
  | { ok: true; task: AgentTaskRecord }
  | { ok: false; reason: 'version_conflict' | 'invalid_transition' | 'not_found' };

/**
 * Persistence port for tasks, implemented by @job-agent/database (Phase 3).
 * Every method takes the owning user id; there is no unscoped lookup.
 */
export interface TaskStore {
  create(
    userId: UserId,
    input: Pick<
      AgentTaskRecord,
      'kind' | 'parentTaskId' | 'idempotencyKey' | 'maxAttempts' | 'deadlineAt'
    >,
  ): Promise<{ task: AgentTaskRecord; created: boolean }>;
  findById(userId: UserId, taskId: TaskId): Promise<AgentTaskRecord | null>;
  /** Validates with `assertTransition`, checks `expectedVersion`, writes event + checkpoint atomically. */
  transition(userId: UserId, transition: TaskTransition): Promise<TransitionResult>;
  latestCheckpoint(userId: UserId, taskId: TaskId): Promise<TaskCheckpoint | null>;
  requestCancellation(userId: UserId, taskId: TaskId): Promise<void>;
}
