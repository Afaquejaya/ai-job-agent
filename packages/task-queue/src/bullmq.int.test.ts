import { randomUUID } from 'node:crypto';
import type { QueueJob, QueueMessage } from '@job-agent/agent-core';
import type { TaskId, UserId } from '@job-agent/shared';
import { Redis } from 'ioredis';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createBullTaskConsumer, createBullTaskQueue, toJobId } from './bullmq';

const url = process.env.TEST_REDIS_URL!;
const prefix = `job-agent-test-${randomUUID().slice(0, 8)}`;
const message = (): QueueMessage => ({
  taskId: randomUUID() as TaskId,
  userId: randomUUID() as UserId,
});

const queue = createBullTaskQueue({ url, prefix });
const consumers: Array<ReturnType<typeof createBullTaskConsumer>> = [];

function consumer() {
  const c = createBullTaskConsumer({ url, prefix });
  consumers.push(c);
  return c;
}

const until = async (check: () => boolean, ms = 5_000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 25));
  }
};

afterEach(async () => {
  await Promise.all(consumers.splice(0).map((c) => c.stop(2_000)));
});

afterAll(async () => {
  await queue.close();
  // Remove every key this run created.
  const redis = new Redis(url);
  const keys = await redis.keys(`${prefix}:*`);
  if (keys.length) await redis.del(...keys);
  await redis.quit();
});

describe('BullMQ task queue', () => {
  it('reports Redis health', async () => {
    expect(await queue.ping()).toBe(true);
    const nowhere = createBullTaskQueue({ url: 'redis://127.0.0.1:9', prefix });
    expect(await nowhere.ping()).toBe(false);
    await nowhere.close();
  });

  it('delivers a message once, even when enqueued twice with the same key', async () => {
    const received: QueueJob[] = [];
    await consumer().start('agent-tasks', async (job) => void received.push(job), {
      concurrency: 2,
    });

    const msg = message();
    const key = `${msg.taskId}-v1`;
    const first = await queue.enqueue('agent-tasks', msg, { idempotencyKey: key });
    const second = await queue.enqueue('agent-tasks', msg, { idempotencyKey: key });
    expect(first).toEqual({ jobId: key, deduplicated: false });
    expect(second.deduplicated).toBe(true);

    await until(() => received.length >= 1);
    await new Promise((r) => setTimeout(r, 300));
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ id: key, queue: 'agent-tasks', message: msg });
  });

  it('runs delayed jobs at their time, and can remove a job that has not started', async () => {
    const received: string[] = [];
    await consumer().start('agent-tasks', async (job) => void received.push(job.message.taskId), {
      concurrency: 1,
    });
    const later = message();
    const removed = message();
    const at = Date.now();
    await queue.enqueue('agent-tasks', later, {
      idempotencyKey: `${later.taskId}-v1`,
      runAt: new Date(at + 600),
    });
    await queue.enqueue('agent-tasks', removed, {
      idempotencyKey: `${removed.taskId}-v1`,
      runAt: new Date(at + 600),
    });
    expect(await queue.remove('agent-tasks', `${removed.taskId}-v1`)).toBe(true);

    await until(() => received.length === 1);
    expect(Date.now() - at).toBeGreaterThanOrEqual(500);
    expect(received).toEqual([later.taskId]);
  });

  it('waits for a running job when stopping, within the time limit', async () => {
    const c = consumer();
    let finished = false;
    await c.start(
      'agent-tasks',
      async () => {
        await new Promise((r) => setTimeout(r, 400));
        finished = true;
      },
      { concurrency: 1 },
    );
    const msg = message();
    await queue.enqueue('agent-tasks', msg, { idempotencyKey: `${msg.taskId}-v1` });
    await until(() => c.isRunning());
    await new Promise((r) => setTimeout(r, 100)); // the job is now in flight
    await c.stop(5_000);
    expect(finished).toBe(true);
  });

  it('tells a running job to release its task when the stop time runs out', async () => {
    const c = consumer();
    let sawShutdown = false;
    await c.start(
      'agent-tasks',
      (_job, signal) =>
        new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => {
            sawShutdown = true;
            resolve();
          });
        }),
      { concurrency: 1 },
    );
    const msg = message();
    await queue.enqueue('agent-tasks', msg, { idempotencyKey: `${msg.taskId}-v1` });
    await new Promise((r) => setTimeout(r, 300));
    await c.stop(200);
    expect(sawShutdown).toBe(true);
  });

  it('turns ":" in idempotency keys into job ids BullMQ accepts', () => {
    expect(toJobId('analyze:abc:1')).toBe('analyze-abc-1');
  });
});
