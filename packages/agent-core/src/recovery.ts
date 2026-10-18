/**
 * Bounded retry and self-recovery rules. Pure functions: the worker supplies the failure,
 * attempt count and deadline; this module decides what happens next.
 *
 * Recovery never changes permissions or policy - it can only wait and retry, hand off to
 * the user, or stop.
 */

export type FailureKind =
  /** Network blip, timeout, 5xx. Safe to retry. */
  | 'transient'
  /** The remote side asked us to slow down. Retry no sooner than it asked. */
  | 'rate_limited'
  /** Bad input, unsupported page, schema mismatch. Retrying will not help. */
  | 'permanent'
  /** CAPTCHA, OTP, login, access denied. Only the user can resolve it. */
  | 'blocked_needs_user'
  /** An external action may or may not have happened (e.g. timeout after clicking submit). */
  | 'uncertain_outcome'
  /** The policy engine denied the action. */
  | 'policy_denied';

export interface RetryPolicy {
  /** Total attempts including the first one. */
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 30_000,
  maxDelayMs: 30 * 60_000,
};

/**
 * Exponential backoff with "equal jitter": half the window is fixed, half is random, so
 * retries spread out but never fire immediately.
 * @param failedAttempts number of attempts that have failed so far (>= 1)
 */
export function backoffDelayMs(
  failedAttempts: number,
  policy: RetryPolicy,
  random: () => number = Math.random,
): number {
  const exponent = Math.max(0, failedAttempts - 1);
  const window = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** exponent);
  return Math.round(window / 2 + random() * (window / 2));
}

export interface RecoveryInput {
  failure: FailureKind;
  /** Attempts that have failed so far, including this one. */
  failedAttempts: number;
  policy: RetryPolicy;
  now: Date;
  /** Hard deadline for the task. No retry is scheduled past it. */
  deadline?: Date;
  /** From a Retry-After header or provider error, when available. */
  retryAfterMs?: number;
  random?: () => number;
}

export type RecoveryDecision =
  | { action: 'retry'; delayMs: number; retryAt: Date }
  | { action: 'needs_review'; reason: string }
  | { action: 'manual_handoff'; reason: string }
  | { action: 'fail'; reason: string };

export function decideRecovery(input: RecoveryInput): RecoveryDecision {
  switch (input.failure) {
    case 'uncertain_outcome':
      // Never retry an action whose outcome is unknown: verify first, or ask the user.
      return {
        action: 'needs_review',
        reason: 'Outcome uncertain; verification required before any retry',
      };
    case 'blocked_needs_user':
      return { action: 'manual_handoff', reason: 'Blocked by a check only the user may complete' };
    case 'permanent':
      return { action: 'fail', reason: 'Permanent failure; retrying would not help' };
    case 'policy_denied':
      return { action: 'fail', reason: 'Denied by policy' };
    case 'transient':
    case 'rate_limited': {
      if (input.failedAttempts >= input.policy.maxAttempts) {
        return {
          action: 'fail',
          reason: `Retry limit reached (${input.policy.maxAttempts} attempts)`,
        };
      }
      const backoff = backoffDelayMs(input.failedAttempts, input.policy, input.random);
      const delayMs = Math.max(backoff, input.retryAfterMs ?? 0);
      const retryAt = new Date(input.now.getTime() + delayMs);
      if (input.deadline && retryAt > input.deadline) {
        return { action: 'fail', reason: 'Next retry would pass the task deadline' };
      }
      return { action: 'retry', delayMs, retryAt };
    }
  }
}
