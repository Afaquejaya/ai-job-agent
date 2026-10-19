import { randomUUID } from 'node:crypto';
import type { TaskId, UserId } from '@job-agent/shared';
import type {
  AgentTaskRecord,
  NewTask,
  TaskCheckpoint,
  TaskMaintenanceStore,
  TaskStore,
  TaskTransition,
  TransitionResult,
} from '../task';
import { canTransition, isTerminal } from '../task-state';

/**
 * In-memory TaskStore with the same rules as the database one (version check, legal
 * transitions, user scoping, idempotent create). For unit tests only.
 */
export interface MemoryTaskStore extends TaskStore, TaskMaintenanceStore {
  tasks: Map<string, AgentTaskRecord>;
  events: Array<{
    taskId: string;
    from: string | null;
    to: string;
    reason: string;
    failureKind: string | null;
  }>;
  attempts: Map<string, { step: string; number: number; outcome: string }>;
  checkpoints: TaskCheckpoint[];
  /** Test helper: change a row directly (e.g. to simulate time passing). */
  patch(taskId: string, changes: Partial<AgentTaskRecord>): void;
}

export function createMemoryTaskStore(now: () => Date = () => new Date()): MemoryTaskStore {
  const tasks = new Map<string, AgentTaskRecord>();
  const events: MemoryTaskStore['events'] = [];
  const attempts: MemoryTaskStore['attempts'] = new Map();
  const checkpoints: TaskCheckpoint[] = [];
  const copy = (task: AgentTaskRecord): AgentTaskRecord => ({ ...task });
  const owned = (userId: UserId, taskId: TaskId) => {
    const task = tasks.get(taskId);
    return task && task.userId === userId ? task : undefined;
  };

  return {
    tasks,
    events,
    attempts,
    checkpoints,
    patch(taskId, changes) {
      const task = tasks.get(taskId);
      if (task) tasks.set(taskId, { ...task, ...changes });
    },

    async create(userId: UserId, input: NewTask) {
      const existing = [...tasks.values()].find(
        (t) => t.userId === userId && t.idempotencyKey === input.idempotencyKey,
      );
      if (existing) return { task: copy(existing), created: false };
      const at = now();
      const task: AgentTaskRecord = {
        id: randomUUID() as TaskId,
        userId,
        kind: input.kind,
        state: 'QUEUED',
        input: input.input,
        output: null,
        parentTaskId: input.parentTaskId ?? null,
        idempotencyKey: input.idempotencyKey,
        failedAttempts: 0,
        maxAttempts: input.maxAttempts,
        deadlineAt: input.deadlineAt,
        nextRunAt: null,
        leaseExpiresAt: null,
        cancelRequestedAt: null,
        version: 1,
        createdAt: at,
        updatedAt: at,
      };
      tasks.set(task.id, task);
      events.push({
        taskId: task.id,
        from: null,
        to: 'QUEUED',
        reason: 'Queued',
        failureKind: null,
      });
      return { task: copy(task), created: true };
    },

    async findById(userId, taskId) {
      const task = owned(userId, taskId);
      return task ? copy(task) : null;
    },

    async transition(userId, t: TaskTransition): Promise<TransitionResult> {
      const task = owned(userId, t.taskId);
      if (!task) return { ok: false, reason: 'not_found' };
      if (task.version !== t.expectedVersion || task.state !== t.from) {
        return { ok: false, reason: 'version_conflict' };
      }
      if (!canTransition(t.from, t.to)) return { ok: false, reason: 'invalid_transition' };
      const updated: AgentTaskRecord = {
        ...task,
        ...(t.set ?? {}),
        state: t.to,
        version: task.version + 1,
        updatedAt: now(),
      };
      tasks.set(task.id, updated);
      events.push({
        taskId: task.id,
        from: t.from,
        to: t.to,
        reason: t.reason,
        failureKind: t.failure?.kind ?? null,
      });
      if (t.checkpoint) checkpoints.push({ ...t.checkpoint, taskId: task.id, createdAt: now() });
      if (t.attempt) {
        const key = `${task.id}:${t.attempt.step}:${t.attempt.number}`;
        attempts.set(key, {
          step: t.attempt.step,
          number: t.attempt.number,
          outcome: t.attempt.outcome ?? 'running',
        });
      }
      return { ok: true, task: copy(updated) };
    },

    async renewLease(userId, taskId, expectedVersion, until) {
      const task = owned(userId, taskId);
      if (!task || task.version !== expectedVersion || task.state !== 'RUNNING') return false;
      tasks.set(taskId, { ...task, leaseExpiresAt: until });
      return true;
    },

    async latestCheckpoint(userId, taskId) {
      if (!owned(userId, taskId)) return null;
      return checkpoints.filter((c) => c.taskId === taskId).at(-1) ?? null;
    },

    async requestCancellation(userId, taskId) {
      const task = owned(userId, taskId);
      if (!task) return null;
      if (!isTerminal(task.state) && !task.cancelRequestedAt) {
        tasks.set(taskId, { ...task, cancelRequestedAt: now() });
      }
      return copy(tasks.get(taskId)!);
    },

    async findRunnable(at, limit) {
      return [...tasks.values()]
        .filter(
          (t) =>
            !t.cancelRequestedAt &&
            (t.state === 'QUEUED' ||
              (t.state === 'RETRY_WAIT' && t.nextRunAt !== null && t.nextRunAt <= at)),
        )
        .slice(0, limit)
        .map(copy);
    },

    async findExpiredLeases(at, limit) {
      return [...tasks.values()]
        .filter((t) => t.leaseExpiresAt !== null && t.leaseExpiresAt < at)
        .slice(0, limit)
        .map(copy);
    },

    async findPendingCancellations(limit) {
      return [...tasks.values()]
        .filter((t) => t.cancelRequestedAt && !isTerminal(t.state) && t.state !== 'RUNNING')
        .slice(0, limit)
        .map(copy);
    },
  };
}
