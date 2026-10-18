import { describe, expect, it } from 'vitest';
import {
  evaluateEmailSendPolicy,
  evaluateSubmissionPolicy,
  type SubmissionPolicyInput,
} from './policy';

/** A fully permitted, approved, clean application. Each test breaks one thing. */
const permitted: SubmissionPolicyInput = {
  source: { autoSubmitPermitted: true, policyReviewed: true, healthy: true },
  user: { submissionMode: 'auto_where_permitted', dailyLimit: 20, submittedToday: 0 },
  application: {
    alreadySubmitted: false,
    unresolvedRequiredFields: 0,
    usesUnverifiedAnswers: false,
    hasBlocker: false,
    hasValidApproval: false,
  },
};

const withChanges = (changes: {
  source?: Partial<SubmissionPolicyInput['source']>;
  user?: Partial<SubmissionPolicyInput['user']>;
  application?: Partial<SubmissionPolicyInput['application']>;
}): SubmissionPolicyInput => ({
  source: { ...permitted.source, ...changes.source },
  user: { ...permitted.user, ...changes.user },
  application: { ...permitted.application, ...changes.application },
});

describe('evaluateSubmissionPolicy', () => {
  it('allows automation only when the source and the user both permit it', () => {
    expect(evaluateSubmissionPolicy(permitted)).toEqual({
      effect: 'allow',
      reason: 'AUTOMATION_PERMITTED',
    });
  });

  it('never submits twice', () => {
    expect(
      evaluateSubmissionPolicy(withChanges({ application: { alreadySubmitted: true } })).effect,
    ).toBe('deny');
  });

  it('does not invent missing answers or use unverified ones', () => {
    expect(
      evaluateSubmissionPolicy(withChanges({ application: { unresolvedRequiredFields: 1 } })),
    ).toEqual({
      effect: 'needs_review',
      reason: 'UNRESOLVED_REQUIRED_FIELDS',
    });
    expect(
      evaluateSubmissionPolicy(withChanges({ application: { usesUnverifiedAnswers: true } }))
        .reason,
    ).toBe('UNVERIFIED_ANSWERS');
  });

  it('hands CAPTCHA/OTP/login blockers to the user', () => {
    expect(
      evaluateSubmissionPolicy(withChanges({ application: { hasBlocker: true } })).effect,
    ).toBe('manual_handoff');
  });

  it('defers when the daily limit is reached or the source is unhealthy', () => {
    expect(evaluateSubmissionPolicy(withChanges({ user: { submittedToday: 20 } })).reason).toBe(
      'DAILY_LIMIT_REACHED',
    );
    expect(evaluateSubmissionPolicy(withChanges({ source: { healthy: false } })).reason).toBe(
      'SOURCE_UNHEALTHY',
    );
  });

  it('falls back to manual handoff when the source does not permit automation', () => {
    expect(
      evaluateSubmissionPolicy(withChanges({ source: { autoSubmitPermitted: false } })),
    ).toEqual({
      effect: 'manual_handoff',
      reason: 'SOURCE_AUTOMATION_NOT_PERMITTED',
    });
    expect(
      evaluateSubmissionPolicy(withChanges({ source: { policyReviewed: false } })).reason,
    ).toBe('SOURCE_POLICY_NOT_REVIEWED');
  });

  it('respects the user choosing manual-only mode even on permitted sources', () => {
    expect(
      evaluateSubmissionPolicy(withChanges({ user: { submissionMode: 'manual_only' } })).reason,
    ).toBe('USER_MANUAL_MODE');
  });

  it('requires per-application approval in approve_each mode', () => {
    const approveEach = withChanges({ user: { submissionMode: 'approve_each' } });
    expect(evaluateSubmissionPolicy(approveEach).effect).toBe('require_approval');
    expect(
      evaluateSubmissionPolicy({
        ...approveEach,
        application: { ...approveEach.application, hasValidApproval: true },
      }),
    ).toEqual({ effect: 'allow', reason: 'APPROVED_BY_USER' });
  });
});

describe('evaluateEmailSendPolicy', () => {
  it('requires approval of the exact draft content', () => {
    expect(evaluateEmailSendPolicy({ draftContentHash: 'h1', approval: null }).effect).toBe(
      'require_approval',
    );
    expect(
      evaluateEmailSendPolicy({
        draftContentHash: 'h2',
        approval: { status: 'approved', contentHash: 'h1' },
      }).effect,
    ).toBe('require_approval');
    expect(
      evaluateEmailSendPolicy({
        draftContentHash: 'h1',
        approval: { status: 'approved', contentHash: 'h1' },
      }).effect,
    ).toBe('allow');
  });
});
