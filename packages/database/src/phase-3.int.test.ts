import { randomUUID } from 'node:crypto';
import {
  reconcileTasks,
  runTask,
  TaskStepError,
  type AgentTaskRecord,
  type NewTask,
  type TaskHandler,
  type TaskKind,
} from '@job-agent/agent-core';
import type { TaskId, UserId } from '@job-agent/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  createDatabaseClient,
  createTaskRepository,
  type Database,
  type TaskRepository,
} from './index';

let db: Database;
let tasks: TaskRepository;

async function createTestUser(): Promise<UserId> {
  const user = await db.user.create({
    data: { name: 'Integration Test', email: `${randomUUID()}@example.test` },
  });
  return user.id as UserId;
}

const analysis = (key: string = randomUUID()): NewTask => ({
  kind: 'job_match_analysis',
  input: { jobId: randomUUID() },
  idempotencyKey: `analyze:${key}`,
  maxAttempts: 3,
  deadlineAt: null,
});

const handler = (run: TaskHandler<{ jobId: string }>['run']): TaskHandler<never> =>
  ({
    kind: 'job_match_analysis',
    input: z.object({ jobId: z.uuid() }),
    timeoutMs: 10_000,
    run,
  }) as unknown as TaskHandler<never>;

const runner = (h: TaskHandler<never>, scheduled: AgentTaskRecord[] = []) => ({
  store: tasks,
  handlers: new Map<TaskKind, TaskHandler<never>>([['job_match_analysis', h]]),
  schedule: async (task: AgentTaskRecord) => {
    scheduled.push(task);
  },
  random: () => 0.5,
  heartbeatMs: 50,
});

beforeAll(() => {
  const url = process.env.DATABASE_URL;
  if (!url || !new URL(url).pathname.endsWith('_test')) {
    throw new Error('Integration tests require TEST_DATABASE_URL pointing at a *_test database');
  }
  db = createDatabaseClient(url);
  tasks = createTaskRepository(db);
});

afterAll(async () => {
  await db?.$disconnect();
});

describe('task repository', () => {
  it('creates one task per idempotency key, with a first timeline event', async () => {
    const userId = await createTestUser();
    const input = analysis('same');
    const first = await tasks.create(userId, input);
    const second = await tasks.create(userId, input);
    expect(first.created).toBe(true);
    expect(second).toMatchObject({
      created: false,
      task: { id: first.task.id, state: 'QUEUED', version: 1 },
    });
    const timeline = await tasks.timeline(userId, first.task.id);
    expect(timeline?.events.map((e) => e.toState)).toEqual(['QUEUED']);
  });

  it('lets exactly one of two racing workers start a task', async () => {
    const userId = await createTestUser();
    const { task } = await tasks.create(userId, analysis());
    const start = () =>
      tasks.transition(userId, {
        taskId: task.id,
        from: 'QUEUED',
        to: 'RUNNING',
        expectedVersion: task.version,
        reason: 'Started',
        attempt: { step: 'run', number: 1 },
      });
    const results = await Promise.all([start(), start(), start()]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).map((r) => !r.ok && r.reason)).toEqual([
      'version_conflict',
      'version_conflict',
    ]);
    const timeline = await tasks.timeline(userId, task.id);
    expect(timeline?.attempts).toHaveLength(1);
  });

  it('refuses illegal transitions and other users', async () => {
    const [owner, other] = [await createTestUser(), await createTestUser()];
    const { task } = await tasks.create(owner, analysis());
    expect(
      await tasks.transition(owner, {
        taskId: task.id,
        from: 'QUEUED',
        to: 'SUBMITTED',
        expectedVersion: 1,
        reason: 'x',
      }),
    ).toEqual({ ok: false, reason: 'invalid_transition' });
    expect(
      await tasks.transition(other, {
        taskId: task.id,
        from: 'QUEUED',
        to: 'RUNNING',
        expectedVersion: 1,
        reason: 'x',
      }),
    ).toEqual({ ok: false, reason: 'not_found' });
    expect(await tasks.findById(other, task.id)).toBeNull();
    expect(await tasks.timeline(other, task.id)).toBeNull();
    expect(await tasks.requestCancellation(other, task.id)).toBeNull();
    expect(await tasks.listForUser(other)).toEqual([]);
  });

  it('keeps the timeline append-only and enforces the database checks', async () => {
    const userId = await createTestUser();
    const { task } = await tasks.create(userId, analysis());
    await expect(
      db.taskEvent.updateMany({ where: { taskId: task.id }, data: { reason: 'edited' } }),
    ).rejects.toThrow(/append-only/);
    await expect(
      db.agentTask.update({ where: { id: task.id }, data: { state: 'DANCING' } }),
    ).rejects.toThrow();
    await expect(
      db.agentTask.update({ where: { id: task.id }, data: { kind: 'mining' } }),
    ).rejects.toThrow();
    // A lease only exists while a worker is working on the task.
    await expect(
      db.agentTask.update({ where: { id: task.id }, data: { leaseExpiresAt: new Date() } }),
    ).rejects.toThrow();
  });

  it('records cancellation requests in the timeline without changing the version', async () => {
    const userId = await createTestUser();
    const { task } = await tasks.create(userId, analysis());
    const cancelled = await tasks.requestCancellation(userId, task.id);
    expect(cancelled).toMatchObject({ version: 1, cancelRequestedAt: expect.any(Date) });
    expect((await tasks.findPendingCancellations(500)).map((t) => t.id)).toContain(task.id);
    const timeline = await tasks.timeline(userId, task.id);
    expect(timeline?.events.at(-1)?.reason).toBe('Cancellation requested');
  });
});

describe('runner and reconciler against PostgreSQL', () => {
  it('runs a task to completion and records attempts and output', async () => {
    const userId = await createTestUser();
    const { task } = await tasks.create(userId, analysis());
    const result = await runTask(
      runner(
        handler(async () => ({ output: { matchId: 'm-1', score: 80 }, summary: 'Score 80/100' })),
      ),
      { userId, taskId: task.id },
      new AbortController().signal,
    );
    expect(result.outcome).toBe('completed');
    const timeline = await tasks.timeline(userId, task.id);
    expect(timeline?.task).toMatchObject({
      state: 'COMPLETED',
      output: { matchId: 'm-1' },
      leaseExpiresAt: null,
    });
    expect(timeline?.events.map((e) => e.toState)).toEqual(['QUEUED', 'RUNNING', 'COMPLETED']);
    expect(timeline?.attempts.map((a) => a.outcome)).toEqual(['succeeded']);
  });

  it('schedules a retry with its reason, then succeeds on the next run', async () => {
    const userId = await createTestUser();
    const { task } = await tasks.create(userId, analysis());
    const scheduled: AgentTaskRecord[] = [];
    let calls = 0;
    const flaky = handler(async () => {
      calls += 1;
      if (calls === 1)
        throw new TaskStepError('Ollama is not running on this computer', 'transient');
      return { output: { ok: true }, summary: 'done' };
    });
    await runTask(
      runner(flaky, scheduled),
      { userId, taskId: task.id },
      new AbortController().signal,
    );
    const waiting = await tasks.findById(userId, task.id);
    expect(waiting).toMatchObject({ state: 'RETRY_WAIT', failedAttempts: 1 });
    expect(scheduled).toHaveLength(1);

    // Make it due now (instead of waiting the real backoff), then run again.
    await db.agentTask.update({
      where: { id: task.id },
      data: { nextRunAt: new Date(Date.now() - 1000) },
    });
    await runTask(
      runner(flaky, scheduled),
      { userId, taskId: task.id },
      new AbortController().signal,
    );
    const timeline = await tasks.timeline(userId, task.id);
    expect(timeline?.task.state).toBe('COMPLETED');
    expect(timeline?.attempts.map((a) => [a.attempt, a.outcome, a.failureKind])).toEqual([
      [1, 'failed', 'transient'],
      [2, 'succeeded', null],
    ]);
    expect(timeline?.events.find((e) => e.toState === 'RETRY_WAIT')?.reason).toMatch(
      /Ollama is not running/,
    );
  });

  it('resumes a task whose worker died mid-step, and completes it exactly once', async () => {
    const userId = await createTestUser();
    const { task } = await tasks.create(userId, analysis());

    // Worker A takes the task and dies: its lease expires and it never writes again.
    const started = await tasks.transition(userId, {
      taskId: task.id,
      from: 'QUEUED',
      to: 'RUNNING',
      expectedVersion: 1,
      reason: 'Started',
      set: { leaseExpiresAt: new Date(Date.now() - 1000) },
      attempt: { step: 'run', number: 1 },
    });
    expect(started.ok).toBe(true);

    const enqueued: AgentTaskRecord[] = [];
    const report = await reconcileTasks({
      store: tasks,
      maintenance: tasks,
      enqueue: async (t) => {
        enqueued.push(t);
      },
    });
    expect(report.leasesRecovered).toBeGreaterThanOrEqual(1);
    expect(enqueued.some((t) => t.id === task.id && t.state === 'RETRY_WAIT')).toBe(true);

    // Worker B runs it.
    const work = vi.fn(async () => ({ output: { ok: true }, summary: 'done' }));
    await runTask(runner(handler(work)), { userId, taskId: task.id }, new AbortController().signal);
    // Worker A comes back with its stale view and tries to finish: refused.
    const late = await tasks.transition(userId, {
      taskId: task.id,
      from: 'RUNNING',
      to: 'COMPLETED',
      expectedVersion: 2,
      reason: 'late',
    });
    expect(late).toEqual({ ok: false, reason: 'version_conflict' });

    expect(work).toHaveBeenCalledTimes(1);
    const timeline = await tasks.timeline(userId, task.id);
    expect(timeline?.events.filter((e) => e.toState === 'COMPLETED')).toHaveLength(1);
    expect(timeline?.attempts.map((a) => a.outcome)).toEqual(['abandoned', 'succeeded']);
  });

  it('sends an interrupted submission to verification instead of repeating it', async () => {
    const userId = await createTestUser();
    const { task } = await tasks.create(userId, {
      ...analysis(),
      kind: 'job_application',
      input: {},
    });
    await db.agentTask.update({
      where: { id: task.id },
      data: { state: 'READY_TO_SUBMIT', version: 5 },
    });
    const submitting = await tasks.transition(userId, {
      taskId: task.id,
      from: 'READY_TO_SUBMIT',
      to: 'SUBMITTING',
      expectedVersion: 5,
      reason: 'Submitting',
      checkpoint: {
        state: 'SUBMITTING',
        step: 'submit_form',
        externalActionDispatchedAt: new Date(),
        data: {},
      },
      set: { leaseExpiresAt: new Date(Date.now() - 1000) },
    });
    expect(submitting.ok).toBe(true);

    await reconcileTasks({ store: tasks, maintenance: tasks, enqueue: async () => {} });
    const timeline = await tasks.timeline(userId, task.id as TaskId);
    expect(timeline?.task.state).toBe('VERIFYING');
    expect(timeline?.events.at(-1)).toMatchObject({
      toState: 'VERIFYING',
      failureKind: 'uncertain_outcome',
    });
    expect(
      timeline?.events.some((e) => e.fromState === 'VERIFYING' && e.toState === 'SUBMITTING'),
    ).toBe(false);
  });
});
