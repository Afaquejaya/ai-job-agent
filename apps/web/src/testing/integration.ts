import { randomBytes, randomUUID } from 'node:crypto';
import {
  runTask,
  type QueueMessage,
  type TaskQueue,
  type TaskRunnerOptions,
} from '@job-agent/agent-core';
import { createTaskRepository } from '@job-agent/database';
import { createJsonLogger } from '@job-agent/observability';
import { createTaskHandlers } from '@job-agent/services';
import type { UserId } from '@job-agent/shared';
import { POST as authPost } from '@/app/api/auth/[...all]/route';
import { getDatabase } from '@/server/db';
import { getServices } from '@/server/services';
import { setTaskQueueForTests } from '@/server/tasks';

/** Helpers for in-process integration tests of route handlers (test database only). */

export const APP = 'http://localhost:3000';

export interface TestUser {
  cookie: string;
  userId: UserId;
  email: string;
  password: string;
}

export function assertTestDatabase(): void {
  const url = process.env.DATABASE_URL;
  if (!url || !new URL(url).pathname.endsWith('_test')) {
    throw new Error('Integration tests require TEST_DATABASE_URL pointing at a *_test database');
  }
}

/** Signs up through the real /api/auth endpoint, exactly as the browser does. */
export async function signUp(): Promise<TestUser> {
  const email = `${randomUUID()}@example.test`;
  const password = randomBytes(18).toString('base64url');
  const response = await authPost(
    new Request(`${APP}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: APP },
      body: JSON.stringify({ email, password, name: 'Integration Test' }),
    }),
  );
  if (response.status !== 200) throw new Error(`sign-up failed: ${response.status}`);
  const body = (await response.json()) as { user: { id: string } };
  const cookie = response.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  return { cookie, userId: body.user.id as UserId, email, password };
}

/** Calls a route handler like Next.js would: with headers, an Origin for writes, and params. */
export function call<P>(
  handler: (request: Request, context?: { params: Promise<P> }) => Promise<Response>,
  options: {
    user?: TestUser;
    method?: string;
    path?: string;
    json?: unknown;
    body?: BodyInit;
    headers?: Record<string, string>;
    params?: P;
  } = {},
): Promise<Response> {
  const headers: Record<string, string> = { origin: APP, ...options.headers };
  if (options.user) headers.cookie = options.user.cookie;
  let body = options.body;
  if (options.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.json);
  }
  const request = new Request(`${APP}${options.path ?? '/api/test'}`, {
    method: options.method ?? 'GET',
    headers,
    body,
  });
  return handler(request, options.params ? { params: Promise.resolve(options.params) } : undefined);
}

/** A multipart upload request body with an accurate Content-Length, as browsers send it. */
export async function multipartFile(
  bytes: Uint8Array,
  filename: string,
  type = 'application/octet-stream',
): Promise<{ body: ArrayBuffer; headers: Record<string, string> }> {
  const form = new FormData();
  form.append('file', new File([new Uint8Array(bytes)], filename, { type }));
  const encoded = new Request('http://local/', { method: 'POST', body: form });
  const body = await encoded.arrayBuffer();
  return {
    body,
    headers: {
      'content-type': encoded.headers.get('content-type') ?? '',
      'content-length': String(body.byteLength),
    },
  };
}

// ---- Background tasks (Phase 3) -------------------------------------------------------------
// Route handlers queue tasks; here an in-memory queue records them and runQueuedTasks() runs
// them exactly as the worker does (agent-core runner + the shared task handlers).

const queued: QueueMessage[] = [];

const memoryQueue: TaskQueue = {
  async enqueue(_queue, message, options) {
    queued.push(message);
    return { jobId: options.idempotencyKey, deduplicated: false };
  },
  async remove() {
    return false;
  },
};

/** Call in beforeAll: tasks are recorded instead of sent to Redis. */
export function useMemoryTaskQueue(): void {
  setTaskQueueForTests(memoryQueue);
}

/** Runs every queued task once, like the worker would. Delayed retries are not re-run. */
export async function runQueuedTasks(): Promise<void> {
  const runner: TaskRunnerOptions = {
    store: createTaskRepository(getDatabase()),
    handlers: createTaskHandlers({
      ...getServices(),
      logger: createJsonLogger({ service: 'test', level: 'error' }),
    }),
    schedule: async () => {},
  };
  while (queued.length > 0) {
    const message = queued.shift()!;
    await runTask(runner, message, new AbortController().signal);
  }
}
