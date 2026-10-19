import type { TaskId, UserId } from '@job-agent/shared';
import type { z } from 'zod';
import { DEFAULT_RETRY_POLICY, decideRecovery, type FailureKind } from './recovery';
import type { AgentTaskRecord, TaskKind, TaskStore, TaskTransition } from './task';
import { isTerminal } from './task-state';

/**
 * Runs one step of a single-step background task (Phase 3). The database row is the truth;
 * this code only moves it forward with version-checked transitions:
 *
 *   QUEUED / RETRY_WAIT ──► RUNNING (lease) ──► COMPLETED
 *                                         ├──► RETRY_WAIT (decideRecovery: retry later)
 *                                         ├──► NEEDS_REVIEW / FAILED
 *                                         └──► CANCELLED
 *
 * While the step runs, a heartbeat renews the lease and checks for a cancel request. If the
 * worker dies, the lease expires and the reconciler hands the task to another run. A run that
 * lost its lease (the version moved on) never writes its result.
 */

export interface TaskHandlerContext {
  userId: UserId;
  taskId: TaskId;
  signal: AbortSignal;
}

export interface TaskHandler<Input = unknown> {
  kind: TaskKind;
  input: z.ZodType<Input>;
  /** Wall-clock limit for one attempt. */
  timeoutMs: number;
  run(
    input: Input,
    context: TaskHandlerContext,
  ): Promise<{ output: Record<string, unknown>; summary: string }>;
}

/** A failure the handler classified itself. The message is shown in the task timeline. */
export class TaskStepError extends Error {
  constructor(
    message: string,
    readonly failure: FailureKind,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'TaskStepError';
  }
}

export interface TaskRunnerOptions {
  store: TaskStore;
  handlers: ReadonlyMap<TaskKind, TaskHandler<never>>;
  /** Puts the task on the queue again at `runAt` (a delayed retry). */
  schedule: (task: AgentTaskRecord, runAt: Date) => Promise<void>;
  leaseMs?: number;
  heartbeatMs?: number;
  now?: () => Date;
  random?: () => number;
  log?: (event: string, fields: Record<string, unknown>) => void;
}

export type RunOutcome =
  | 'completed'
  | 'retry_scheduled'
  | 'needs_review'
  | 'failed'
  | 'cancelled'
  | 'released'
  | 'skipped';

export interface RunResult {
  outcome: RunOutcome;
  reason: string;
}

const STARTABLE = new Set(['QUEUED', 'RETRY_WAIT']);
const STEP = 'run';

type StopReason = 'cancel' | 'shutdown' | 'lease_lost' | 'timeout';

/**
 * @param shutdown aborted when the worker is stopping: the task is released to run again
 *   later (not counted as a failed attempt).
 */
export async function runTask(
  options: TaskRunnerOptions,
  ref: { userId: UserId; taskId: TaskId },
  shutdown: AbortSignal,
): Promise<RunResult> {
  const now = options.now ?? (() => new Date());
  const leaseMs = options.leaseMs ?? 60_000;
  const heartbeatMs = options.heartbeatMs ?? 20_000;
  const { store } = options;
  const log = options.log ?? (() => {});

  const task = await store.findById(ref.userId, ref.taskId);
  if (!task) return { outcome: 'skipped', reason: 'Task not found' };
  if (isTerminal(task.state)) return { outcome: 'skipped', reason: `Already ${task.state}` };
  if (!STARTABLE.has(task.state))
    return { outcome: 'skipped', reason: `Not startable from ${task.state}` };

  const base = { taskId: task.id, from: task.state, expectedVersion: task.version };

  if (task.cancelRequestedAt) {
    await store.transition(task.userId, {
      ...base,
      to: 'CANCELLED',
      reason: 'Cancelled before it started',
    });
    return { outcome: 'cancelled', reason: 'Cancelled before it started' };
  }
  if (task.state === 'RETRY_WAIT' && task.nextRunAt && task.nextRunAt > now()) {
    return { outcome: 'skipped', reason: 'Not due yet' };
  }
  if (task.deadlineAt && task.deadlineAt <= now()) {
    await store.transition(task.userId, {
      ...base,
      to: 'FAILED',
      reason: 'The deadline passed before the task could run',
      failure: { kind: 'permanent', message: 'Deadline passed' },
    });
    return { outcome: 'failed', reason: 'Deadline passed' };
  }

  const handler = options.handlers.get(task.kind);
  if (!handler) {
    await store.transition(task.userId, {
      ...base,
      to: 'NEEDS_REVIEW',
      reason: `No worker can run "${task.kind}" tasks yet`,
    });
    return { outcome: 'needs_review', reason: 'No handler' };
  }
  const parsed = handler.input.safeParse(task.input);
  if (!parsed.success) {
    await store.transition(task.userId, {
      ...base,
      to: 'FAILED',
      reason: 'The task input is not valid',
      failure: { kind: 'permanent', message: 'Invalid task input' },
    });
    return { outcome: 'failed', reason: 'Invalid input' };
  }

  // ---- Start: take the lease and record the attempt, atomically.
  const attempt = task.failedAttempts + 1;
  const started = await store.transition(task.userId, {
    ...base,
    to: 'RUNNING',
    reason: attempt === 1 ? 'Started' : `Started attempt ${attempt} of ${task.maxAttempts}`,
    set: { leaseExpiresAt: new Date(now().getTime() + leaseMs), nextRunAt: null },
    attempt: { step: STEP, number: attempt },
  });
  if (!started.ok) return { outcome: 'skipped', reason: `Could not start: ${started.reason}` };
  let running = started.task;

  // ---- Run, with heartbeat (lease + cancel check), timeout and shutdown.
  const controller = new AbortController();
  let stopReason: StopReason | null = null;
  const stop = (reason: StopReason) => {
    if (stopReason) return;
    stopReason = reason;
    controller.abort(new Error(reason));
  };
  const onShutdown = () => stop('shutdown');
  shutdown.addEventListener('abort', onShutdown, { once: true });
  if (shutdown.aborted) stop('shutdown');
  const timer = setTimeout(() => stop('timeout'), handler.timeoutMs);
  const heartbeat = setInterval(() => {
    void (async () => {
      const renewed = await store.renewLease(
        running.userId,
        running.id,
        running.version,
        new Date(now().getTime() + leaseMs),
      );
      if (!renewed) return stop('lease_lost');
      const latest = await store.findById(running.userId, running.id);
      if (latest?.cancelRequestedAt) stop('cancel');
    })().catch((error: unknown) => log('task.heartbeat_failed', { taskId: running.id, error }));
  }, heartbeatMs);

  let output: { output: Record<string, unknown>; summary: string } | null = null;
  let error: unknown = null;
  try {
    output = await (handler as TaskHandler<unknown>).run(parsed.data, {
      userId: running.userId,
      taskId: running.id,
      signal: controller.signal,
    });
  } catch (caught) {
    error = caught;
  } finally {
    clearTimeout(timer);
    clearInterval(heartbeat);
    shutdown.removeEventListener('abort', onShutdown);
  }

  // A cancel request may have arrived in the last moments; check before recording.
  const latest = await store.findById(running.userId, running.id);
  if (!latest || latest.version !== running.version) {
    log('task.lease_lost', { taskId: running.id });
    return { outcome: 'skipped', reason: 'Another run took over this task; result discarded' };
  }
  running = latest;
  const finish = (rest: Omit<TaskTransition, 'taskId' | 'from' | 'expectedVersion'>) =>
    store.transition(running.userId, {
      taskId: running.id,
      from: 'RUNNING',
      expectedVersion: running.version,
      ...rest,
      set: { leaseExpiresAt: null, ...rest.set },
    });

  if (output && !stopReason) {
    await finish({
      to: 'COMPLETED',
      reason: output.summary,
      set: { output: output.output },
      attempt: { step: STEP, number: attempt, outcome: 'succeeded' },
    });
    return { outcome: 'completed', reason: output.summary };
  }

  if (stopReason === 'cancel' || (running.cancelRequestedAt && !output)) {
    await finish({
      to: 'CANCELLED',
      reason: 'Cancelled by the user',
      attempt: { step: STEP, number: attempt, outcome: 'cancelled' },
    });
    return { outcome: 'cancelled', reason: 'Cancelled by the user' };
  }
  if (stopReason === 'shutdown') {
    // Not the task's fault: release it to run again soon, without counting a failure.
    const runAt = now();
    const released = await finish({
      to: 'RETRY_WAIT',
      reason: 'The worker was stopping; the task will run again',
      set: { nextRunAt: runAt },
      attempt: { step: STEP, number: attempt, outcome: 'abandoned' },
    });
    if (released.ok) await options.schedule(released.task, runAt);
    return { outcome: 'released', reason: 'Worker stopping' };
  }

  // ---- Failure: classify, then let decideRecovery choose.
  // Unexpected errors and timeouts are treated as transient: retried, within the attempt limit.
  const failure: FailureKind = error instanceof TaskStepError ? error.failure : 'transient';
  const message =
    stopReason === 'timeout'
      ? `The step did not finish within ${Math.round(handler.timeoutMs / 60_000)} min`
      : error instanceof TaskStepError
        ? error.message
        : 'The step failed unexpectedly';
  if (!(error instanceof TaskStepError) && stopReason !== 'timeout') {
    log('task.step_error', { taskId: running.id, kind: running.kind, error });
  }

  const decision = decideRecovery({
    failure,
    failedAttempts: attempt,
    policy: { ...DEFAULT_RETRY_POLICY, maxAttempts: running.maxAttempts },
    now: now(),
    deadline: running.deadlineAt ?? undefined,
    retryAfterMs: error instanceof TaskStepError ? error.retryAfterMs : undefined,
    random: options.random,
  });
  const failed = {
    failure: { kind: failure, message },
    attempt: { step: STEP, number: attempt, outcome: 'failed' as const, failureKind: failure },
  };

  if (decision.action === 'retry') {
    const result = await finish({
      to: 'RETRY_WAIT',
      reason: `${message}. Retrying (attempt ${attempt + 1} of ${running.maxAttempts})`,
      set: { nextRunAt: decision.retryAt, failedAttempts: attempt },
      ...failed,
    });
    if (result.ok) await options.schedule(result.task, decision.retryAt);
    return { outcome: 'retry_scheduled', reason: message };
  }
  if (decision.action === 'needs_review' || decision.action === 'manual_handoff') {
    await finish({
      to: 'NEEDS_REVIEW',
      reason: `${message}. ${decision.reason}`,
      set: { failedAttempts: attempt },
      ...failed,
    });
    return { outcome: 'needs_review', reason: message };
  }
  await finish({
    to: 'FAILED',
    reason: `${message}. ${decision.reason}`,
    set: { failedAttempts: attempt },
    ...failed,
  });
  return { outcome: 'failed', reason: message };
}
