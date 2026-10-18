import { describe, expect, it } from 'vitest';
import { backoffDelayMs, decideRecovery, DEFAULT_RETRY_POLICY, type RetryPolicy } from './recovery';

const policy: RetryPolicy = { maxAttempts: 3, baseDelayMs: 1_000, maxDelayMs: 10_000 };
const now = new Date('2026-10-18T00:00:00.000Z');

describe('backoffDelayMs', () => {
  it('grows exponentially, stays within [window/2, window] and respects the cap', () => {
    expect(backoffDelayMs(1, policy, () => 0)).toBe(500);
    expect(backoffDelayMs(1, policy, () => 1)).toBe(1_000);
    expect(backoffDelayMs(3, policy, () => 1)).toBe(4_000);
    expect(backoffDelayMs(10, policy, () => 1)).toBe(10_000);
  });
});

describe('decideRecovery', () => {
  it('never retries an uncertain outcome', () => {
    expect(
      decideRecovery({ failure: 'uncertain_outcome', failedAttempts: 1, policy, now }).action,
    ).toBe('needs_review');
  });

  it('hands blockers such as CAPTCHA or OTP to the user', () => {
    expect(
      decideRecovery({ failure: 'blocked_needs_user', failedAttempts: 1, policy, now }).action,
    ).toBe('manual_handoff');
  });

  it('fails permanent and policy failures without retrying', () => {
    expect(decideRecovery({ failure: 'permanent', failedAttempts: 1, policy, now }).action).toBe(
      'fail',
    );
    expect(
      decideRecovery({ failure: 'policy_denied', failedAttempts: 1, policy, now }).action,
    ).toBe('fail');
  });

  it('retries transient failures until the attempt limit', () => {
    const first = decideRecovery({
      failure: 'transient',
      failedAttempts: 1,
      policy,
      now,
      random: () => 1,
    });
    expect(first).toEqual({
      action: 'retry',
      delayMs: 1_000,
      retryAt: new Date(now.getTime() + 1_000),
    });
    expect(decideRecovery({ failure: 'transient', failedAttempts: 3, policy, now }).action).toBe(
      'fail',
    );
  });

  it('waits at least as long as the remote Retry-After', () => {
    const decision = decideRecovery({
      failure: 'rate_limited',
      failedAttempts: 1,
      policy,
      now,
      retryAfterMs: 60_000,
      random: () => 0,
    });
    expect(decision).toMatchObject({ action: 'retry', delayMs: 60_000 });
  });

  it('does not schedule a retry past the deadline', () => {
    const decision = decideRecovery({
      failure: 'transient',
      failedAttempts: 1,
      policy: DEFAULT_RETRY_POLICY,
      now,
      deadline: new Date(now.getTime() + 1_000),
    });
    expect(decision.action).toBe('fail');
  });
});
