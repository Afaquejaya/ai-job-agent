import { DEFAULT_RETRY_POLICY, decideRecovery } from './recovery';
import type { AgentTaskRecord, TaskMaintenanceStore, TaskStore } from './task';
import { cancellationMode } from './task-state';

/**
 * The reconciler repairs what the queue cannot know about (D-005: PostgreSQL is the truth,
 * Redis only schedules). Run every minute by the worker. It is safe to run on several workers
 * at once: every change is a version-checked transition, and enqueueing is deduplicated.
 *
 * 1. Expired leases (a worker died mid-step):
 *    - RUNNING (a step without external side effects) → RETRY_WAIT, counted as a failed
 *      attempt, so a task that keeps crashing workers still stops at its limit.
 *    - SUBMITTING with `external_action_dispatched_at` set → VERIFYING. The action may have
 *      happened: it is checked, NEVER repeated. Without it → RETRY_WAIT (nothing was sent).
 * 2. Pending cancellations on tasks no runner is working on → CANCELLED.
 * 3. Runnable tasks (QUEUED, due RETRY_WAIT) → enqueued again. Enqueueing is keyed
 *    by task and version, so a task that is already queued is not queued twice.
 */

export interface ReconcilerOptions {
  store: TaskStore;
  maintenance: TaskMaintenanceStore;
  enqueue: (task: AgentTaskRecord) => Promise<void>;
  now?: () => Date;
  batchSize?: number;
}

export interface ReconcileReport {
  leasesRecovered: number;
  sentToVerification: number;
  cancelled: number;
  enqueued: number;
}

export async function reconcileTasks(options: ReconcilerOptions): Promise<ReconcileReport> {
  const now = options.now ?? (() => new Date());
  const limit = options.batchSize ?? 100;
  const { store } = options;
  const report: ReconcileReport = {
    leasesRecovered: 0,
    sentToVerification: 0,
    cancelled: 0,
    enqueued: 0,
  };

  for (const task of await options.maintenance.findExpiredLeases(now(), limit)) {
    const base = { taskId: task.id, from: task.state, expectedVersion: task.version };
    const clear = { leaseExpiresAt: null };

    if (task.state === 'SUBMITTING') {
      const checkpoint = await store.latestCheckpoint(task.userId, task.id);
      if (checkpoint?.externalActionDispatchedAt) {
        const result = await store.transition(task.userId, {
          ...base,
          to: 'VERIFYING',
          reason:
            'The worker stopped after the action was sent; checking the outcome instead of repeating it',
          failure: { kind: 'uncertain_outcome', message: 'Worker stopped after dispatch' },
          set: clear,
        });
        if (result.ok) {
          report.sentToVerification += 1;
          await options.enqueue(result.task);
        }
        continue;
      }
    }

    if (task.state !== 'RUNNING' && task.state !== 'SUBMITTING') continue;
    const failedAttempts = task.failedAttempts + 1;
    const decision = decideRecovery({
      failure: 'transient',
      failedAttempts,
      policy: { ...DEFAULT_RETRY_POLICY, maxAttempts: task.maxAttempts },
      now: now(),
      deadline: task.deadlineAt ?? undefined,
    });
    const message = 'The worker stopped while working on this task';
    const result =
      decision.action === 'retry'
        ? await store.transition(task.userId, {
            ...base,
            to: 'RETRY_WAIT',
            // Run again right away: the worker crashed, the task itself did nothing wrong.
            reason: `${message}. Running it again (attempt ${failedAttempts + 1} of ${task.maxAttempts})`,
            failure: { kind: 'transient', message },
            set: { ...clear, nextRunAt: now(), failedAttempts },
            attempt: {
              step: 'run',
              number: failedAttempts,
              outcome: 'abandoned',
              failureKind: 'transient',
            },
          })
        : await store.transition(task.userId, {
            ...base,
            to: 'FAILED',
            reason: `${message}. ${decision.action === 'fail' ? decision.reason : 'Stopping'}`,
            failure: { kind: 'transient', message },
            set: { ...clear, failedAttempts },
            attempt: {
              step: 'run',
              number: failedAttempts,
              outcome: 'abandoned',
              failureKind: 'transient',
            },
          });
    if (result.ok) {
      report.leasesRecovered += 1;
      if (result.task.state === 'RETRY_WAIT') await options.enqueue(result.task);
    }
  }

  for (const task of await options.maintenance.findPendingCancellations(limit)) {
    if (cancellationMode(task.state) !== 'immediate' || task.state === 'RUNNING') continue;
    const result = await store.transition(task.userId, {
      taskId: task.id,
      from: task.state,
      to: 'CANCELLED',
      expectedVersion: task.version,
      reason: 'Cancelled by the user',
    });
    if (result.ok) report.cancelled += 1;
  }

  for (const task of await options.maintenance.findRunnable(now(), limit)) {
    await options.enqueue(task);
    report.enqueued += 1;
  }
  return report;
}

/** Queue job id for a task at its current version: one job per task state, never two. */
export function taskJobId(task: Pick<AgentTaskRecord, 'id' | 'version'>): string {
  return `${task.id}-v${task.version}`;
}
