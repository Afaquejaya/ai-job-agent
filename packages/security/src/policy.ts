/**
 * Server-side policy engine for actions with external effects. These are pure functions so
 * the rules can be tested exhaustively; the caller gathers the inputs from the database and
 * the source capability registry. The engine is deny-by-default: anything not explicitly
 * permitted falls back to a manual handoff.
 *
 * The agent cannot change these inputs for itself: source declarations are code-reviewed,
 * and user settings change only through authenticated user actions.
 */

export type SubmissionMode =
  /** The agent prepares everything; the user always submits. */
  | 'manual_only'
  /** The agent may submit on permitted sources after the user approves each application. */
  | 'approve_each'
  /** The agent may submit on permitted sources without per-application approval. */
  | 'auto_where_permitted';

export type PolicyEffect =
  | 'allow'
  | 'require_approval'
  | 'manual_handoff'
  /** Not now - e.g. daily limit reached or source unhealthy. Reschedule. */
  | 'defer'
  /** Missing or unverified information; the user must review before continuing. */
  | 'needs_review'
  | 'deny';

export type PolicyReason =
  | 'DUPLICATE_SUBMISSION'
  | 'UNRESOLVED_REQUIRED_FIELDS'
  | 'UNVERIFIED_ANSWERS'
  | 'BLOCKER_REQUIRES_USER'
  | 'DAILY_LIMIT_REACHED'
  | 'SOURCE_UNHEALTHY'
  | 'USER_MANUAL_MODE'
  | 'SOURCE_AUTOMATION_NOT_PERMITTED'
  | 'SOURCE_POLICY_NOT_REVIEWED'
  | 'APPROVAL_REQUIRED'
  | 'APPROVED_BY_USER'
  | 'AUTOMATION_PERMITTED';

export interface PolicyDecision {
  effect: PolicyEffect;
  reason: PolicyReason;
}

export interface SubmissionPolicyInput {
  source: {
    /** From the source declaration: automated submission is allowed by the source. */
    autoSubmitPermitted: boolean;
    /** The declaration has been reviewed against the source's terms. */
    policyReviewed: boolean;
    healthy: boolean;
  };
  user: {
    submissionMode: SubmissionMode;
    dailyLimit: number;
    /** Counted in the user's configured time zone. */
    submittedToday: number;
  };
  application: {
    alreadySubmitted: boolean;
    unresolvedRequiredFields: number;
    usesUnverifiedAnswers: boolean;
    hasBlocker: boolean;
    /** Approval exists and matches the current application content hash. */
    hasValidApproval: boolean;
  };
}

/** Decides whether the agent may submit this application itself. Rules apply in order. */
export function evaluateSubmissionPolicy(input: SubmissionPolicyInput): PolicyDecision {
  const { source, user, application } = input;

  if (application.alreadySubmitted) return { effect: 'deny', reason: 'DUPLICATE_SUBMISSION' };
  if (application.unresolvedRequiredFields > 0) {
    return { effect: 'needs_review', reason: 'UNRESOLVED_REQUIRED_FIELDS' };
  }
  if (application.usesUnverifiedAnswers)
    return { effect: 'needs_review', reason: 'UNVERIFIED_ANSWERS' };
  if (application.hasBlocker) return { effect: 'manual_handoff', reason: 'BLOCKER_REQUIRES_USER' };
  if (user.submittedToday >= user.dailyLimit)
    return { effect: 'defer', reason: 'DAILY_LIMIT_REACHED' };
  if (!source.healthy) return { effect: 'defer', reason: 'SOURCE_UNHEALTHY' };
  if (user.submissionMode === 'manual_only')
    return { effect: 'manual_handoff', reason: 'USER_MANUAL_MODE' };
  if (!source.policyReviewed)
    return { effect: 'manual_handoff', reason: 'SOURCE_POLICY_NOT_REVIEWED' };
  if (!source.autoSubmitPermitted) {
    return { effect: 'manual_handoff', reason: 'SOURCE_AUTOMATION_NOT_PERMITTED' };
  }
  if (user.submissionMode === 'approve_each') {
    return application.hasValidApproval
      ? { effect: 'allow', reason: 'APPROVED_BY_USER' }
      : { effect: 'require_approval', reason: 'APPROVAL_REQUIRED' };
  }
  return { effect: 'allow', reason: 'AUTOMATION_PERMITTED' };
}

export interface EmailSendPolicyInput {
  /** Hash of the exact draft (recipient, subject, body, attachments) about to be sent. */
  draftContentHash: string;
  approval: { status: 'pending' | 'approved' | 'denied' | 'expired'; contentHash: string } | null;
}

/**
 * Email always requires explicit approval of the exact content. Editing a draft after
 * approval changes its hash, which invalidates the approval.
 */
export function evaluateEmailSendPolicy(input: EmailSendPolicyInput): PolicyDecision {
  const { approval } = input;
  if (approval?.status === 'approved' && approval.contentHash === input.draftContentHash) {
    return { effect: 'allow', reason: 'APPROVED_BY_USER' };
  }
  return { effect: 'require_approval', reason: 'APPROVAL_REQUIRED' };
}
