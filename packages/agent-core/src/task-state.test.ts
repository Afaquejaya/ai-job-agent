import { describe, expect, it } from 'vitest';
import {
  assertTransition,
  canTransition,
  cancellationMode,
  InvalidTransitionError,
  NON_INTERRUPTIBLE_STATES,
  TASK_STATES,
  TASK_TRANSITIONS,
  TERMINAL_STATES,
  type TaskState,
} from './task-state';

function reachable(from: TaskState): Set<TaskState> {
  const seen = new Set<TaskState>([from]);
  const queue: TaskState[] = [from];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of TASK_TRANSITIONS[current]) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

describe('task state machine', () => {
  it('defines transitions for every state and only targets known states', () => {
    for (const state of TASK_STATES) {
      for (const target of TASK_TRANSITIONS[state]) {
        expect(TASK_STATES).toContain(target);
      }
    }
  });

  it('has no transitions out of terminal states', () => {
    for (const state of TERMINAL_STATES) {
      expect(TASK_TRANSITIONS[state]).toEqual([]);
    }
  });

  it('lets every non-terminal state reach a terminal state', () => {
    for (const state of TASK_STATES) {
      const canFinish = [...reachable(state)].some((s) => TERMINAL_STATES.has(s));
      expect(canFinish, `${state} cannot reach a terminal state`).toBe(true);
    }
  });

  it('can take an application task from QUEUED to SUBMITTED', () => {
    expect(reachable('QUEUED').has('SUBMITTED')).toBe(true);
  });

  it('only reaches SUBMITTING through READY_TO_SUBMIT', () => {
    const sources = TASK_STATES.filter((s) => canTransition(s, 'SUBMITTING'));
    expect(sources).toEqual(['READY_TO_SUBMIT']);
  });

  it('never retries straight into a submission', () => {
    expect(canTransition('RETRY_WAIT', 'SUBMITTING')).toBe(false);
    expect(canTransition('VERIFYING', 'SUBMITTING')).toBe(false);
  });

  it('cannot cancel during non-interruptible states, but can cancel any other active state', () => {
    for (const state of TASK_STATES) {
      if (TERMINAL_STATES.has(state)) continue;
      const expected = !NON_INTERRUPTIBLE_STATES.has(state);
      expect(canTransition(state, 'CANCELLED'), state).toBe(expected);
    }
    expect(cancellationMode('SUBMITTING')).toBe('deferred');
    expect(cancellationMode('PREPARING')).toBe('immediate');
    expect(cancellationMode('SUBMITTED')).toBe('not_applicable');
  });

  it('throws a typed error for invalid transitions', () => {
    expect(() => assertTransition('QUEUED', 'SUBMITTED')).toThrow(InvalidTransitionError);
    expect(() => assertTransition('QUEUED', 'PLANNING')).not.toThrow();
  });
});
