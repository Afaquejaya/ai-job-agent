import type {
  EnqueueOptions,
  EnqueueResult,
  QueueJobHandler,
  QueueMessage,
  QueueName,
  TaskConsumer,
  TaskQueue,
} from '@job-agent/agent-core';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { Redis } from 'ioredis';

/**
 * BullMQ (Redis) adapter for the TaskQueue / TaskConsumer ports (Phase 3).
 *
 * Redis only decides WHEN a task runs. Messages carry ids, never data; PostgreSQL holds the
 * task state. So the settings here favour simplicity over BullMQ's own recovery features:
 * - attempts: 1 — retries are decided and recorded by our runner (decideRecovery), not here;
 * - maxStalledCount: 0 — a job whose worker died is not silently re-run; the task's lease
 *   expires and the reconciler recovers it with a version-checked transition;
 * - finished jobs are removed after a while (the timeline lives in PostgreSQL).
 */

export interface BullQueueOptions {
  /** redis:// or rediss:// URL. */
  url: string;
  /** Key prefix in Redis; tests use their own so they never touch real queues. */
  prefix?: string;
}

const JOB_NAME = 'task';

function connection(url: string): ConnectionOptions {
  // Workers block on Redis; BullMQ requires maxRetriesPerRequest: null for them.
  return { url, maxRetriesPerRequest: null };
}

/** BullMQ job ids may not contain ':'. */
export function toJobId(idempotencyKey: string): string {
  return idempotencyKey.replace(/:/g, '-');
}

export function createBullTaskQueue(options: BullQueueOptions): TaskQueue & {
  /** True when Redis answers. */
  ping(): Promise<boolean>;
  close(): Promise<void>;
} {
  const queues = new Map<QueueName, Queue>();
  const prefix = options.prefix ?? 'job-agent';
  // A separate small connection for health checks: fails fast instead of queueing commands.
  let healthClient: Redis | null = null;
  const queue = (name: QueueName) => {
    let q = queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: connection(options.url), prefix });
      queues.set(name, q);
    }
    return q;
  };

  return {
    async enqueue(
      name: QueueName,
      message: QueueMessage,
      opts: EnqueueOptions,
    ): Promise<EnqueueResult> {
      const q = queue(name);
      const jobId = toJobId(opts.idempotencyKey);
      const existing = await q.getJob(jobId);
      // Adding a job whose id exists is a no-op in BullMQ: the same task state is queued once.
      await q.add(JOB_NAME, message, {
        jobId,
        delay: opts.runAt ? Math.max(0, opts.runAt.getTime() - Date.now()) : undefined,
        priority: opts.priority,
        attempts: 1,
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 24 * 3600, count: 1000 },
      });
      return { jobId, deduplicated: Boolean(existing) };
    },

    async remove(name: QueueName, jobId: string): Promise<boolean> {
      const job = await queue(name).getJob(jobId);
      if (!job) return false;
      if (!((await job.isWaiting()) || (await job.isDelayed()))) return false;
      await job.remove();
      return true;
    },

    async ping() {
      healthClient ??= new Redis(options.url, {
        lazyConnect: true,
        connectTimeout: 2_000,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
      });
      try {
        if (healthClient.status === 'wait' || healthClient.status === 'end')
          await healthClient.connect();
        return (await healthClient.ping()) === 'PONG';
      } catch {
        return false;
      }
    },

    async close() {
      await Promise.all([...queues.values()].map((q) => q.close()));
      queues.clear();
      healthClient?.disconnect();
      healthClient = null;
    },
  };
}

export function createBullTaskConsumer(options: BullQueueOptions): TaskConsumer & {
  isRunning(): boolean;
} {
  const workers: Worker[] = [];
  // Aborted when stop() runs out of patience: running steps release their tasks.
  const shutdown = new AbortController();

  return {
    async start(name: QueueName, handler: QueueJobHandler, { concurrency }) {
      const worker = new Worker<QueueMessage>(
        name,
        async (job) => {
          await handler(
            { id: job.id ?? '', queue: name, message: job.data, attemptsMade: job.attemptsMade },
            shutdown.signal,
          );
        },
        {
          connection: connection(options.url),
          prefix: options.prefix ?? 'job-agent',
          concurrency,
          maxStalledCount: 0,
          autorun: true,
        },
      );
      await worker.waitUntilReady();
      workers.push(worker);
    },

    isRunning() {
      return workers.length > 0 && workers.every((w) => w.isRunning());
    },

    async stop(timeoutMs: number) {
      // 1. Stop taking jobs and give in-flight steps time to finish normally.
      const closing = Promise.all(workers.map((w) => w.close()));
      const patient = await Promise.race([
        closing.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs).unref()),
      ]);
      if (!patient) {
        // 2. Out of time: tell running steps to release their tasks (they will run again),
        //    give them a moment to record that, then close for good.
        shutdown.abort();
        await Promise.race([closing, new Promise((resolve) => setTimeout(resolve, 5_000).unref())]);
        await Promise.all(workers.map((w) => w.close(true)));
      }
      workers.length = 0;
    },
  };
}
