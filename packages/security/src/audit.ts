import type { UserId } from '@job-agent/shared';

/** Security-relevant actions recorded in the append-only audit log. */
export type AuditAction =
  | 'auth.sign_in'
  | 'auth.sign_out'
  | 'settings.updated'
  | 'cv.uploaded'
  | 'cv.deleted'
  | 'answer.verified'
  | 'approval.granted'
  | 'approval.denied'
  | 'application.submitted'
  | 'application.handoff_created'
  | 'email.sent'
  | 'browser_agent.registered'
  | 'browser_agent.revoked'
  | 'policy.denied';

export interface AuditEntry {
  userId: UserId;
  action: AuditAction;
  /** Who performed it: the user directly, the agent on their behalf, or the system. */
  actor: 'user' | 'agent' | 'system';
  targetType: string;
  targetId: string | null;
  /** Identifiers and outcomes only - no secrets, no CV text, no message bodies. */
  metadata: Record<string, string | number | boolean | null>;
  occurredAt: Date;
}

/** Append-only audit log port, implemented in @job-agent/database. */
export interface AuditLog {
  append(entry: AuditEntry): Promise<void>;
}
