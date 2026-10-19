import {
  canTransition,
  isTerminal,
  TERMINAL_STATES,
  type AgentTaskRecord,
  type NewTask,
  type TaskCheckpoint,
  type TaskKind,
  type TaskMaintenanceStore,
  type TaskState,
  type TaskStore,
  type TaskTransition,
  type TransitionResult,
} from '@job-agent/agent-core';
import type { TaskId, UserId } from '@job-agent/shared';
import type { Database } from './client';
import { isUniqueViolation } from './errors';
import {
  Prisma,
  type AgentTask,
  type TaskAttempt,
  type TaskCheckpoint as TaskCheckpointRow,
  type TaskEvent,
} from './generated/prisma/client';

/**
 * The durable task store (Phase 3). Every state change is ONE transaction: a version-checked
 * update of the task, its timeline event, and (when given) the checkpoint and the attempt row.
 * Two workers racing for the same task: one wins, the other gets `version_conflict`.
 */

export type TaskEventRecord = TaskEvent;
export type TaskAttemptRecord = TaskAttempt;

function toTask(row: AgentTask): AgentTaskRecord {
  return {
    id: row.id as TaskId,
    userId: row.userId as UserId,
    kind: row.kind as TaskKind,
    state: row.state as TaskState,
    input: (row.input ?? {}) as Record<string, unknown>,
    output: (row.output ?? null) as Record<string, unknown> | null,
    parentTaskId: (row.parentTaskId ?? null) as TaskId | null,
    idempotencyKey: row.idempotencyKey,
    failedAttempts: row.failedAttempts,
    maxAttempts: row.maxAttempts,
    deadlineAt: row.deadlineAt,
    nextRunAt: row.nextRunAt,
    leaseExpiresAt: row.leaseExpiresAt,
    cancelRequestedAt: row.cancelRequestedAt,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toCheckpoint(row: TaskCheckpointRow): TaskCheckpoint {
  return {
    taskId: row.taskId as TaskId,
    state: row.state as TaskState,
    step: row.step,
    externalActionDispatchedAt: row.externalActionDispatchedAt,
    data: (row.data ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt,
  };
}

const json = (value: Record<string, unknown>) => value as Prisma.InputJsonValue;
const TERMINAL = [...TERMINAL_STATES];

export function createTaskRepository(db: Database): TaskStore &
  TaskMaintenanceStore & {
    listForUser(userId: UserId, limit?: number): Promise<AgentTaskRecord[]>;
    timeline(
      userId: UserId,
      taskId: TaskId,
    ): Promise<{
      task: AgentTaskRecord;
      events: TaskEventRecord[];
      attempts: TaskAttemptRecord[];
    } | null>;
    /** The task with exactly this idempotency key. */
    findByIdempotencyKey(userId: UserId, idempotencyKey: string): Promise<AgentTaskRecord | null>;
    /** A task for this work (key prefix) that has not finished, if any. */
    findActiveByKeyPrefix(userId: UserId, prefix: string): Promise<AgentTaskRecord | null>;
    /** The newest task for this work (key prefix), finished or not. */
    findLatestByKeyPrefix(userId: UserId, prefix: string): Promise<AgentTaskRecord | null>;
    countByKeyPrefix(userId: UserId, prefix: string): Promise<number>;
  } {
  return {
    async create(userId: UserId, input: NewTask) {
      try {
        const task = await db.$transaction(async (tx) => {
          const row = await tx.agentTask.create({
            data: {
              userId,
              kind: input.kind,
              input: json(input.input),
              idempotencyKey: input.idempotencyKey,
              maxAttempts: input.maxAttempts,
              deadlineAt: input.deadlineAt,
              parentTaskId: input.parentTaskId ?? null,
            },
          });
          await tx.taskEvent.create({
            data: { taskId: row.id, userId, fromState: null, toState: 'QUEUED', reason: 'Queued' },
          });
          return row;
        });
        return { task: toTask(task), created: true };
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const existing = await db.agentTask.findUnique({
          where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } },
        });
        if (!existing) throw error;
        return { task: toTask(existing), created: false };
      }
    },

    async findById(userId, taskId) {
      const row = await db.agentTask.findFirst({ where: { id: taskId, userId } });
      return row ? toTask(row) : null;
    },

    async findByIdempotencyKey(userId, idempotencyKey) {
      const row = await db.agentTask.findUnique({
        where: { userId_idempotencyKey: { userId, idempotencyKey } },
      });
      return row ? toTask(row) : null;
    },

    async findActiveByKeyPrefix(userId, prefix) {
      const row = await db.agentTask.findFirst({
        where: { userId, idempotencyKey: { startsWith: prefix }, state: { notIn: TERMINAL } },
        orderBy: { createdAt: 'desc' },
      });
      return row ? toTask(row) : null;
    },

    async findLatestByKeyPrefix(userId, prefix) {
      const row = await db.agentTask.findFirst({
        where: { userId, idempotencyKey: { startsWith: prefix } },
        orderBy: { createdAt: 'desc' },
      });
      return row ? toTask(row) : null;
    },

    async countByKeyPrefix(userId, prefix) {
      return db.agentTask.count({ where: { userId, idempotencyKey: { startsWith: prefix } } });
    },

    async transition(userId, t: TaskTransition): Promise<TransitionResult> {
      if (!canTransition(t.from, t.to)) return { ok: false, reason: 'invalid_transition' };
      return db.$transaction(async (tx) => {
        const set = t.set ?? {};
        const updated = await tx.agentTask.updateMany({
          where: { id: t.taskId, userId, version: t.expectedVersion, state: t.from },
          data: {
            state: t.to,
            version: { increment: 1 },
            ...('leaseExpiresAt' in set ? { leaseExpiresAt: set.leaseExpiresAt } : {}),
            ...('nextRunAt' in set ? { nextRunAt: set.nextRunAt } : {}),
            ...('failedAttempts' in set ? { failedAttempts: set.failedAttempts } : {}),
            ...('cancelRequestedAt' in set ? { cancelRequestedAt: set.cancelRequestedAt } : {}),
            ...('output' in set
              ? {
                  output:
                    set.output === null || set.output === undefined
                      ? Prisma.DbNull
                      : json(set.output),
                }
              : {}),
          },
        });
        if (updated.count === 0) {
          const exists = await tx.agentTask.count({ where: { id: t.taskId, userId } });
          return {
            ok: false as const,
            reason: exists ? ('version_conflict' as const) : ('not_found' as const),
          };
        }
        await tx.taskEvent.create({
          data: {
            taskId: t.taskId,
            userId,
            fromState: t.from,
            toState: t.to,
            reason: t.reason.slice(0, 1000),
            failureKind: t.failure?.kind ?? null,
            failureMessage: t.failure?.message.slice(0, 1000) ?? null,
          },
        });
        if (t.checkpoint) {
          await tx.taskCheckpoint.create({
            data: {
              taskId: t.taskId,
              userId,
              state: t.checkpoint.state,
              step: t.checkpoint.step,
              externalActionDispatchedAt: t.checkpoint.externalActionDispatchedAt,
              data: json(t.checkpoint.data),
            },
          });
        }
        if (t.attempt) {
          const key = {
            taskId_step_attempt: {
              taskId: t.taskId,
              step: t.attempt.step,
              attempt: t.attempt.number,
            },
          };
          if (t.attempt.outcome) {
            const finished = {
              finishedAt: new Date(),
              outcome: t.attempt.outcome,
              failureKind: t.attempt.failureKind ?? null,
            };
            await tx.taskAttempt.upsert({
              where: key,
              update: finished,
              create: {
                taskId: t.taskId,
                userId,
                step: t.attempt.step,
                attempt: t.attempt.number,
                ...finished,
              },
            });
          } else {
            await tx.taskAttempt.upsert({
              where: key,
              update: {
                startedAt: new Date(),
                finishedAt: null,
                outcome: 'running',
                failureKind: null,
              },
              create: { taskId: t.taskId, userId, step: t.attempt.step, attempt: t.attempt.number },
            });
          }
        }
        const row = await tx.agentTask.findUniqueOrThrow({ where: { id: t.taskId } });
        return { ok: true as const, task: toTask(row) };
      });
    },

    async renewLease(userId, taskId, expectedVersion, until) {
      const result = await db.agentTask.updateMany({
        where: { id: taskId, userId, version: expectedVersion, state: 'RUNNING' },
        data: { leaseExpiresAt: until },
      });
      return result.count === 1;
    },

    async latestCheckpoint(userId, taskId) {
      const row = await db.taskCheckpoint.findFirst({
        where: { taskId, userId },
        orderBy: { createdAt: 'desc' },
      });
      return row ? toCheckpoint(row) : null;
    },

    async requestCancellation(userId, taskId) {
      return db.$transaction(async (tx) => {
        const row = await tx.agentTask.findFirst({ where: { id: taskId, userId } });
        if (!row) return null;
        if (isTerminal(row.state as TaskState) || row.cancelRequestedAt) return toTask(row);
        // Version unchanged on purpose: a running step keeps its lease and notices the flag.
        const updated = await tx.agentTask.update({
          where: { id: taskId },
          data: { cancelRequestedAt: new Date() },
        });
        await tx.taskEvent.create({
          data: {
            taskId,
            userId,
            fromState: row.state,
            toState: row.state,
            reason: 'Cancellation requested',
          },
        });
        return toTask(updated);
      });
    },

    async findRunnable(now, limit) {
      const rows = await db.agentTask.findMany({
        where: {
          cancelRequestedAt: null,
          OR: [{ state: 'QUEUED' }, { state: 'RETRY_WAIT', nextRunAt: { lte: now } }],
        },
        orderBy: { createdAt: 'asc' },
        take: limit,
      });
      return rows.map(toTask);
    },

    async findExpiredLeases(now, limit) {
      const rows = await db.agentTask.findMany({
        where: { leaseExpiresAt: { lt: now } },
        orderBy: { leaseExpiresAt: 'asc' },
        take: limit,
      });
      return rows.map(toTask);
    },

    async findPendingCancellations(limit) {
      const rows = await db.agentTask.findMany({
        where: { cancelRequestedAt: { not: null }, state: { notIn: [...TERMINAL, 'RUNNING'] } },
        take: limit,
      });
      return rows.map(toTask);
    },

    async listForUser(userId, limit = 50) {
      const rows = await db.agentTask.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: Math.min(Math.max(limit, 1), 200),
      });
      return rows.map(toTask);
    },

    async timeline(userId, taskId) {
      const row = await db.agentTask.findFirst({
        where: { id: taskId, userId },
        include: {
          events: { orderBy: { createdAt: 'asc' } },
          attempts: { orderBy: { attempt: 'asc' } },
        },
      });
      if (!row) return null;
      return { task: toTask(row), events: row.events, attempts: row.attempts };
    },
  };
}

export type TaskRepository = ReturnType<typeof createTaskRepository>;
