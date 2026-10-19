/**
 * Durable task state machine. This file is the single source of truth for which transitions
 * are legal; docs/architecture/application-state-machine.md explains each one.
 *
 * A task's state is persisted in PostgreSQL. Every transition is written together with a
 * task event (and a checkpoint where required) in one transaction, guarded by an optimistic
 * version check, so a restarted worker always resumes from a known state.
 */
export const TASK_STATES = [
  'QUEUED',
  /** A single-step task (e.g. a match analysis) is being worked on by a worker (D-041). */
  'RUNNING',
  'PLANNING',
  'SEARCHING',
  'NORMALIZING',
  'MATCHING',
  'PREPARING',
  'POLICY_CHECK',
  'AWAITING_APPROVAL',
  'READY_TO_SUBMIT',
  'SUBMITTING',
  'VERIFYING',
  'SUBMITTED',
  'MANUAL_HANDOFF',
  'NEEDS_REVIEW',
  'RETRY_WAIT',
  'COMPLETED',
  'FAILED',
  'REJECTED',
  'CANCELLED',
] as const;

export type TaskState = (typeof TASK_STATES)[number];

export const TERMINAL_STATES: ReadonlySet<TaskState> = new Set<TaskState>([
  'SUBMITTED',
  'COMPLETED',
  'FAILED',
  'REJECTED',
  'CANCELLED',
]);

/**
 * States that must finish before a cancellation takes effect. A cancel request during these
 * is recorded on the task and applied once the outcome of the external action is known -
 * cancelling halfway through a submission would leave its outcome unknown.
 */
export const NON_INTERRUPTIBLE_STATES: ReadonlySet<TaskState> = new Set<TaskState>([
  'SUBMITTING',
  'VERIFYING',
]);

/** Entering these states requires a persisted checkpoint first (irreversible next step). */
export const CHECKPOINT_REQUIRED_STATES: ReadonlySet<TaskState> = new Set<TaskState>([
  'SUBMITTING',
]);

export const TASK_TRANSITIONS: Readonly<Record<TaskState, readonly TaskState[]>> = {
  QUEUED: ['RUNNING', 'PLANNING', 'PREPARING', 'CANCELLED'],
  // Single-step tasks. A worker that dies here loses its lease; the reconciler moves the task
  // to RETRY_WAIT (the step is safe to repeat: it has no external side effect).
  RUNNING: ['COMPLETED', 'RETRY_WAIT', 'NEEDS_REVIEW', 'FAILED', 'CANCELLED'],
  PLANNING: [
    'SEARCHING',
    'PREPARING',
    'COMPLETED',
    'NEEDS_REVIEW',
    'RETRY_WAIT',
    'FAILED',
    'CANCELLED',
  ],
  SEARCHING: ['NORMALIZING', 'RETRY_WAIT', 'FAILED', 'CANCELLED'],
  NORMALIZING: ['MATCHING', 'RETRY_WAIT', 'FAILED', 'CANCELLED'],
  MATCHING: ['COMPLETED', 'RETRY_WAIT', 'FAILED', 'CANCELLED'],
  PREPARING: ['POLICY_CHECK', 'NEEDS_REVIEW', 'RETRY_WAIT', 'FAILED', 'CANCELLED'],
  POLICY_CHECK: [
    'AWAITING_APPROVAL',
    'READY_TO_SUBMIT',
    'MANUAL_HANDOFF',
    'NEEDS_REVIEW',
    'RETRY_WAIT',
    'REJECTED',
    'CANCELLED',
  ],
  AWAITING_APPROVAL: ['READY_TO_SUBMIT', 'MANUAL_HANDOFF', 'REJECTED', 'CANCELLED'],
  READY_TO_SUBMIT: ['SUBMITTING', 'MANUAL_HANDOFF', 'RETRY_WAIT', 'CANCELLED'],
  // FAILED / RETRY_WAIT from SUBMITTING are only legal when the checkpoint proves the submit
  // action was never dispatched. Otherwise the task must go to VERIFYING.
  SUBMITTING: ['VERIFYING', 'MANUAL_HANDOFF', 'RETRY_WAIT', 'FAILED'],
  VERIFYING: ['SUBMITTED', 'READY_TO_SUBMIT', 'NEEDS_REVIEW', 'RETRY_WAIT', 'FAILED'],
  MANUAL_HANDOFF: ['SUBMITTED', 'CANCELLED'],
  NEEDS_REVIEW: [
    'RUNNING',
    'PLANNING',
    'PREPARING',
    'VERIFYING',
    'MANUAL_HANDOFF',
    'SUBMITTED',
    'FAILED',
    'CANCELLED',
  ],
  // Resumes the step recorded in the checkpoint. Never jumps straight to SUBMITTING: a retried
  // submission re-enters READY_TO_SUBMIT and passes the final policy guard again.
  RETRY_WAIT: [
    'RUNNING',
    'PLANNING',
    'SEARCHING',
    'NORMALIZING',
    'MATCHING',
    'PREPARING',
    'POLICY_CHECK',
    'READY_TO_SUBMIT',
    'VERIFYING',
    'FAILED',
    'CANCELLED',
  ],
  SUBMITTED: [],
  COMPLETED: [],
  FAILED: [],
  REJECTED: [],
  CANCELLED: [],
};

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: TaskState,
    readonly to: TaskState,
  ) {
    super(`Invalid task transition ${from} -> ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export function isTerminal(state: TaskState): boolean {
  return TERMINAL_STATES.has(state);
}

export function canTransition(from: TaskState, to: TaskState): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: TaskState, to: TaskState): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

/** Whether a cancel request can be applied immediately or must wait for the step to resolve. */
export function cancellationMode(state: TaskState): 'immediate' | 'deferred' | 'not_applicable' {
  if (isTerminal(state)) return 'not_applicable';
  return NON_INTERRUPTIBLE_STATES.has(state) ? 'deferred' : 'immediate';
}
