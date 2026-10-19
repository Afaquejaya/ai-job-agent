import type { TaskId, UserId } from '@job-agent/shared';
import type { FailureKind } from './recovery';
import type { TaskState } from './task-state';

export const TASK_KINDS = [
  // Single-step background tasks (Phase 3).
  'job_match_analysis',
  'cv_processing',
  // Later phases.
  'daily_discovery',
  'job_application',
  'cv_analysis',
  'email_outreach',
  'morning_report',
] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

/** Persisted task row (see docs/architecture/database-design.md, table `agent_tasks`). */
export interface AgentTaskRecord {
  id: TaskId;
  userId: UserId;
  kind: TaskKind;
  state: TaskState;
  /** What to work on: ids only, validated per kind. Never personal data. */
  input: Record<string, unknown>;
  /** What came out: ids, counts and scores only. */
  output: Record<string, unknown> | null;
  parentTaskId: TaskId | null;
  /** Unique per user; enqueueing the same logical work twice returns the existing task. */
  idempotencyKey: string;
  failedAttempts: number;
  maxAttempts: number;
  deadlineAt: Date | null;
  nextRunAt: Date | null;
  /** While a worker works on the task, it renews this. Expired = the worker died. */
  leaseExpiresAt: Date | null;
  cancelRequestedAt: Date | null;
  /** Optimistic concurrency token; every transition increments it. */
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewTask {
  kind: TaskKind;
  input: Record<string, unknown>;
  idempotencyKey: string;
  maxAttempts: number;
  deadlineAt: Date | null;
  parentTaskId?: TaskId | null;
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

export type AttemptOutcome = 'succeeded' | 'failed' | 'cancelled' | 'abandoned';

export interface TaskTransition {
  taskId: TaskId;
  from: TaskState;
  to: TaskState;
  expectedVersion: number;
  /** Shown in the task timeline. Must not contain personal data. */
  reason: string;
  failure?: { kind: FailureKind; message: string };
  checkpoint?: Omit<TaskCheckpoint, 'taskId' | 'createdAt'>;
  /** Columns changed together with the state. */
  set?: {
    leaseExpiresAt?: Date | null;
    nextRunAt?: Date | null;
    output?: Record<string, unknown> | null;
    failedAttempts?: number;
    cancelRequestedAt?: Date | null;
  };
  /**
   * The attempt row for this step: created when `outcome` is absent (the step starts),
   * finished when it is present. Written in the same transaction as the state change.
   */
  attempt?: { step: string; number: number; outcome?: AttemptOutcome; failureKind?: FailureKind };
}

export type TransitionResult =
  | { ok: true; task: AgentTaskRecord }
  | { ok: false; reason: 'version_conflict' | 'invalid_transition' | 'not_found' };

/**
 * Persistence port for tasks, implemented by @job-agent/database.
 * Every method takes the owning user id; there is no unscoped lookup here.
 */
export interface TaskStore {
  /** Idempotent: the same (user, idempotencyKey) returns the existing task. */
  create(userId: UserId, input: NewTask): Promise<{ task: AgentTaskRecord; created: boolean }>;
  findById(userId: UserId, taskId: TaskId): Promise<AgentTaskRecord | null>;
  /** Validates with `assertTransition`, checks `expectedVersion`, writes event + checkpoint + attempt atomically. */
  transition(userId: UserId, transition: TaskTransition): Promise<TransitionResult>;
  /** Extends the lease of a RUNNING task without changing its version. False = lease lost. */
  renewLease(
    userId: UserId,
    taskId: TaskId,
    expectedVersion: number,
    until: Date,
  ): Promise<boolean>;
  latestCheckpoint(userId: UserId, taskId: TaskId): Promise<TaskCheckpoint | null>;
  /** Records the request; the runner or the reconciler applies it. Null when not found. */
  requestCancellation(userId: UserId, taskId: TaskId): Promise<AgentTaskRecord | null>;
}

/** System-wide queries for the reconciler (not user-scoped; never exposed through the API). */
export interface TaskMaintenanceStore {
  /** QUEUED tasks, and RETRY_WAIT tasks whose next run is due. */
  findRunnable(now: Date, limit: number): Promise<AgentTaskRecord[]>;
  /** Tasks whose worker stopped renewing the lease. */
  findExpiredLeases(now: Date, limit: number): Promise<AgentTaskRecord[]>;
  /** Tasks with a cancellation request that no runner is applying (not running). */
  findPendingCancellations(limit: number): Promise<AgentTaskRecord[]>;
}
