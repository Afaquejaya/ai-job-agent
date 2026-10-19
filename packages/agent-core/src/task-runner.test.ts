import type { UserId } from '@job-agent/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { reconcileTasks, taskJobId } from './reconciler';
import type { AgentTaskRecord, TaskKind } from './task';
import { runTask, TaskStepError, type TaskHandler, type TaskRunnerOptions } from './task-runner';
import { createMemoryTaskStore, type MemoryTaskStore } from './testing/memory-task-store';

const USER = 'u-1' as UserId;
const OTHER = 'u-2' as UserId;
const JOB = '6b1f0b8e-2a5e-4a51-9f51-3c0e3f5c9a11';

let clock: Date;
let store: MemoryTaskStore;
let scheduled: Array<{ id: string; runAt: Date }>;

beforeEach(() => {
  clock = new Date('2026-10-19T10:00:00Z');
  store = createMemoryTaskStore(() => clock);
  scheduled = [];
});
afterEach(() => vi.useRealTimers());

function handler(
  run: TaskHandler<{ jobId: string }>['run'],
  overrides: Partial<TaskHandler<{ jobId: string }>> = {},
): TaskHandler<never> {
  return {
    kind: 'job_match_analysis',
    input: z.object({ jobId: z.uuid() }).strict(),
    timeoutMs: 5_000,
    run,
    ...overrides,
  } as unknown as TaskHandler<never>;
}

function options(h: TaskHandler<never>, extra: Partial<TaskRunnerOptions> = {}): TaskRunnerOptions {
  return {
    store,
    handlers: new Map<TaskKind, TaskHandler<never>>([[h.kind, h]]),
    schedule: async (task, runAt) => {
      scheduled.push({ id: task.id, runAt });
    },
    now: () => clock,
    random: () => 0.5,
    heartbeatMs: 10,
    ...extra,
  };
}

async function newTask(
  overrides: Partial<{
    maxAttempts: number;
    deadlineAt: Date | null;
    input: Record<string, unknown>;
  }> = {},
) {
  const { task } = await store.create(USER, {
    kind: 'job_match_analysis',
    input: overrides.input ?? { jobId: JOB },
    idempotencyKey: `analyze:${JOB}`,
    maxAttempts: overrides.maxAttempts ?? 3,
    deadlineAt: overrides.deadlineAt ?? null,
  });
  return task;
}

const run = (
  opts: TaskRunnerOptions,
  task: AgentTaskRecord,
  shutdown = new AbortController().signal,
) => runTask(opts, { userId: task.userId, taskId: task.id }, shutdown);

const stateOf = (task: AgentTaskRecord) => store.tasks.get(task.id)!;

describe('task store rules', () => {
  it('creates one task per idempotency key and keeps users apart', async () => {
    const first = await newTask();
    const again = await store.create(USER, {
      kind: 'job_match_analysis',
      input: { jobId: JOB },
      idempotencyKey: `analyze:${JOB}`,
      maxAttempts: 3,
      deadlineAt: null,
    });
    expect(again).toMatchObject({ created: false, task: { id: first.id } });
    expect(await store.findById(OTHER, first.id)).toBeNull();
  });
});

describe('runTask', () => {
  it('runs a queued task to COMPLETED with its output, recording each state', async () => {
    const task = await newTask();
    const result = await run(
      options(
        handler(async (input) => ({
          output: { matchId: 'm1', jobId: input.jobId },
          summary: 'Score 80',
        })),
      ),
      task,
    );
    expect(result).toEqual({ outcome: 'completed', reason: 'Score 80' });
    expect(stateOf(task)).toMatchObject({
      state: 'COMPLETED',
      output: { matchId: 'm1' },
      leaseExpiresAt: null,
    });
    expect(store.events.map((e) => e.to)).toEqual(['QUEUED', 'RUNNING', 'COMPLETED']);
    expect([...store.attempts.values()]).toEqual([
      { step: 'run', number: 1, outcome: 'succeeded' },
    ]);
  });

  it('takes a lease while running and renews it', async () => {
    const task = await newTask();
    let leaseSeen: Date | null = null;
    await run(
      options(
        handler(async () => {
          leaseSeen = stateOf(task).leaseExpiresAt;
          clock = new Date(clock.getTime() + 30_000);
          await new Promise((r) => setTimeout(r, 40)); // a few heartbeats
          expect(stateOf(task).leaseExpiresAt!.getTime()).toBe(clock.getTime() + 60_000);
          return { output: {}, summary: 'ok' };
        }),
      ),
      task,
    );
    expect(leaseSeen).toEqual(new Date('2026-10-19T10:01:00Z'));
  });

  it('retries a transient failure later, with the reason, and stops at the attempt limit', async () => {
    const task = await newTask({ maxAttempts: 2 });
    const failing = handler(async () => {
      throw new TaskStepError('Ollama is not running on this computer', 'transient');
    });

    expect(await run(options(failing), task)).toMatchObject({ outcome: 'retry_scheduled' });
    const waiting = stateOf(task);
    expect(waiting).toMatchObject({ state: 'RETRY_WAIT', failedAttempts: 1 });
    // equal jitter with random 0.5: 30 s window -> 22.5 s
    expect(waiting.nextRunAt).toEqual(new Date(clock.getTime() + 22_500));
    expect(scheduled).toEqual([{ id: task.id, runAt: waiting.nextRunAt }]);
    expect(store.events.at(-1)!.reason).toMatch(/Ollama is not running.*attempt 2 of 2/);

    // Not due yet: nothing happens.
    expect(await run(options(failing), task)).toMatchObject({
      outcome: 'skipped',
      reason: 'Not due yet',
    });

    clock = waiting.nextRunAt!;
    expect(await run(options(failing), task)).toMatchObject({ outcome: 'failed' });
    expect(stateOf(task)).toMatchObject({ state: 'FAILED', failedAttempts: 2 });
    expect(store.events.at(-1)!.reason).toMatch(/Retry limit reached/);
  });

  it('honours the deadline', async () => {
    const task = await newTask({ deadlineAt: new Date('2026-10-19T10:00:10Z') });
    const failing = handler(async () => {
      throw new TaskStepError('Temporary problem', 'transient');
    });
    expect(await run(options(failing), task)).toMatchObject({ outcome: 'failed' });
    expect(store.events.at(-1)!.reason).toMatch(/deadline/);

    const late = await store.create(USER, {
      kind: 'job_match_analysis',
      input: { jobId: JOB },
      idempotencyKey: 'late',
      maxAttempts: 3,
      deadlineAt: new Date('2026-10-19T09:00:00Z'),
    });
    expect(await run(options(failing), late.task)).toMatchObject({
      outcome: 'failed',
      reason: 'Deadline passed',
    });
  });

  it('fails permanent errors at once, and sends uncertain outcomes to review', async () => {
    const permanent = await newTask();
    await run(
      options(
        handler(async () => {
          throw new TaskStepError('No CV to compare against', 'permanent');
        }),
      ),
      permanent,
    );
    expect(stateOf(permanent)).toMatchObject({ state: 'FAILED', failedAttempts: 1 });

    const uncertain = (
      await store.create(USER, {
        kind: 'job_match_analysis',
        input: { jobId: JOB },
        idempotencyKey: 'u',
        maxAttempts: 3,
        deadlineAt: null,
      })
    ).task;
    await run(
      options(
        handler(async () => {
          throw new TaskStepError('Unknown result', 'uncertain_outcome');
        }),
      ),
      uncertain,
    );
    expect(stateOf(uncertain).state).toBe('NEEDS_REVIEW');
  });

  it('treats unexpected errors and timeouts as transient', async () => {
    const task = await newTask();
    await run(
      options(
        handler(async () => {
          throw new Error('database password leaked?');
        }),
      ),
      task,
    );
    expect(stateOf(task).state).toBe('RETRY_WAIT');
    expect(store.events.at(-1)!.reason).toMatch(/^The step failed unexpectedly/);
    expect(JSON.stringify(store.events)).not.toContain('password');

    const slow = (
      await store.create(USER, {
        kind: 'job_match_analysis',
        input: { jobId: JOB },
        idempotencyKey: 's',
        maxAttempts: 3,
        deadlineAt: null,
      })
    ).task;
    await run(
      options(
        handler(
          (_input, ctx) =>
            new Promise((_, reject) =>
              ctx.signal.addEventListener('abort', () => reject(new Error('aborted'))),
            ),
          { timeoutMs: 30 },
        ),
      ),
      slow,
    );
    expect(stateOf(slow).state).toBe('RETRY_WAIT');
    expect(store.events.at(-1)!.reason).toMatch(/did not finish within/);
  });

  it('cancels a queued task without running it, and a running task through its signal', async () => {
    const queued = await newTask();
    await store.requestCancellation(USER, queued.id);
    const neverRuns = vi.fn();
    expect(await run(options(handler(neverRuns)), queued)).toMatchObject({ outcome: 'cancelled' });
    expect(neverRuns).not.toHaveBeenCalled();

    const running = (
      await store.create(USER, {
        kind: 'job_match_analysis',
        input: { jobId: JOB },
        idempotencyKey: 'r',
        maxAttempts: 3,
        deadlineAt: null,
      })
    ).task;
    const result = await run(
      options(
        handler(async (_input, ctx) => {
          await store.requestCancellation(USER, running.id);
          await new Promise((resolve, reject) => {
            ctx.signal.addEventListener('abort', () => reject(new Error('aborted')));
            setTimeout(resolve, 2_000);
          });
          return { output: {}, summary: 'should not complete' };
        }),
      ),
      running,
    );
    expect(result.outcome).toBe('cancelled');
    expect(stateOf(running).state).toBe('CANCELLED');
  });

  it('releases the task without counting a failure when the worker shuts down', async () => {
    const task = await newTask();
    const shutdown = new AbortController();
    const result = await run(
      options(
        handler(
          (_input, ctx) =>
            new Promise((_, reject) => {
              ctx.signal.addEventListener('abort', () => reject(new Error('aborted')));
              shutdown.abort();
            }),
        ),
      ),
      task,
      shutdown.signal,
    );
    expect(result.outcome).toBe('released');
    expect(stateOf(task)).toMatchObject({ state: 'RETRY_WAIT', failedAttempts: 0 });
    expect(scheduled).toHaveLength(1);
  });

  it('discards the result of a run that lost its lease (exactly-once completion)', async () => {
    const task = await newTask();
    const result = await run(
      options(
        handler(async () => {
          // Meanwhile the reconciler decided this worker was dead and moved the task on.
          const current = stateOf(task);
          await store.transition(USER, {
            taskId: task.id,
            from: 'RUNNING',
            to: 'RETRY_WAIT',
            expectedVersion: current.version,
            reason: 'lease expired',
            set: { leaseExpiresAt: null, nextRunAt: clock },
          });
          return { output: { late: true }, summary: 'late result' };
        }),
      ),
      task,
    );
    expect(result.outcome).toBe('skipped');
    expect(stateOf(task)).toMatchObject({ state: 'RETRY_WAIT', output: null });
  });

  it('refuses invalid input and kinds without a handler', async () => {
    const bad = await newTask({ input: { jobId: 'not-a-uuid' } });
    expect(await run(options(handler(vi.fn())), bad)).toMatchObject({
      outcome: 'failed',
      reason: 'Invalid input',
    });

    const other = (
      await store.create(USER, {
        kind: 'daily_discovery',
        input: {},
        idempotencyKey: 'd',
        maxAttempts: 3,
        deadlineAt: null,
      })
    ).task;
    expect(await run(options(handler(vi.fn())), other)).toMatchObject({ outcome: 'needs_review' });
  });

  it('skips tasks that are finished or already running', async () => {
    const task = await newTask();
    await run(options(handler(async () => ({ output: {}, summary: 'done' }))), task);
    expect(await run(options(handler(vi.fn())), task)).toMatchObject({
      outcome: 'skipped',
      reason: 'Already COMPLETED',
    });
  });
});

describe('reconcileTasks', () => {
  const reconcile = (enqueued: string[]) =>
    reconcileTasks({
      store,
      maintenance: store,
      now: () => clock,
      enqueue: async (task) => {
        enqueued.push(taskJobId(task));
      },
    });

  it('recovers a task whose worker died mid-step, so it runs again (exactly once)', async () => {
    const task = await newTask();
    // Worker A starts, then dies: lease set, no heartbeats any more.
    await store.transition(USER, {
      taskId: task.id,
      from: 'QUEUED',
      to: 'RUNNING',
      expectedVersion: 1,
      reason: 'Started',
      set: { leaseExpiresAt: new Date(clock.getTime() + 60_000) },
      attempt: { step: 'run', number: 1 },
    });
    const enqueued: string[] = [];
    expect((await reconcile(enqueued)).leasesRecovered).toBe(0); // lease still valid

    clock = new Date(clock.getTime() + 61_000);
    const report = await reconcile(enqueued);
    expect(report.leasesRecovered).toBe(1);
    expect(stateOf(task)).toMatchObject({
      state: 'RETRY_WAIT',
      failedAttempts: 1,
      leaseExpiresAt: null,
    });
    expect(store.attempts.get(`${task.id}:run:1`)?.outcome).toBe('abandoned');

    // Worker B picks it up and completes it.
    const work = vi.fn(async () => ({ output: { ok: true }, summary: 'done' }));
    await run(options(handler(work)), task);
    expect(work).toHaveBeenCalledTimes(1);
    expect(stateOf(task).state).toBe('COMPLETED');
  });

  it('sends an interrupted submission to verification, never back to submitting', async () => {
    const task = (
      await store.create(USER, {
        kind: 'job_application',
        input: {},
        idempotencyKey: 'apply',
        maxAttempts: 3,
        deadlineAt: null,
      })
    ).task;
    store.patch(task.id, { state: 'READY_TO_SUBMIT' });
    await store.transition(USER, {
      taskId: task.id,
      from: 'READY_TO_SUBMIT',
      to: 'SUBMITTING',
      expectedVersion: 1,
      reason: 'Submitting',
      checkpoint: {
        state: 'SUBMITTING',
        step: 'submit_form',
        externalActionDispatchedAt: clock,
        data: {},
      },
      set: { leaseExpiresAt: new Date(clock.getTime() + 60_000) },
    });
    clock = new Date(clock.getTime() + 120_000);
    const enqueued: string[] = [];
    const report = await reconcile(enqueued);
    expect(report.sentToVerification).toBe(1);
    expect(stateOf(task).state).toBe('VERIFYING');
    expect(store.events.at(-1)).toMatchObject({
      to: 'VERIFYING',
      failureKind: 'uncertain_outcome',
    });
  });

  it('fails a task that keeps crashing workers once attempts run out', async () => {
    const task = await newTask({ maxAttempts: 1 });
    await store.transition(USER, {
      taskId: task.id,
      from: 'QUEUED',
      to: 'RUNNING',
      expectedVersion: 1,
      reason: 'Started',
      set: { leaseExpiresAt: new Date(clock.getTime() - 1) },
    });
    await reconcile([]);
    expect(stateOf(task).state).toBe('FAILED');
  });

  it('re-enqueues runnable tasks keyed by version, and applies pending cancellations', async () => {
    const queued = await newTask();
    const toCancel = (
      await store.create(USER, {
        kind: 'job_match_analysis',
        input: { jobId: JOB },
        idempotencyKey: 'c',
        maxAttempts: 3,
        deadlineAt: null,
      })
    ).task;
    await store.requestCancellation(USER, toCancel.id);
    const enqueued: string[] = [];
    const report = await reconcile(enqueued);
    expect(report).toMatchObject({ cancelled: 1, enqueued: 1 });
    expect(enqueued).toEqual([`${queued.id}-v1`]);
    expect(stateOf(toCancel).state).toBe('CANCELLED');
  });
});
