import type { TaskId, UserId } from '@job-agent/shared';

export type NotificationKind =
  'approval_request' | 'blocker_alert' | 'manual_handoff' | 'task_failed' | 'morning_report';

export type NotificationChannelId = 'in_app' | 'email' | 'web_push';

export interface NotificationMessage {
  id: string;
  userId: UserId;
  kind: NotificationKind;
  title: string;
  body: string;
  /** Deep link into the web app. Never contains tokens or personal data in the query string. */
  actionPath: string | null;
  /** Same key within the window = one notification, not many. */
  dedupeKey: string;
  createdAt: Date;
}

export interface DeliveryResult {
  channel: NotificationChannelId;
  status: 'delivered' | 'failed' | 'skipped';
  detail?: string;
}

export interface NotificationChannel {
  readonly id: NotificationChannelId;
  send(message: NotificationMessage): Promise<DeliveryResult>;
}

export type ApprovalAction = 'submit_application' | 'send_email';

/**
 * A request for the user's explicit decision. Approval is bound to `contentHash`; if the
 * content changes afterwards, the approval no longer applies.
 */
export interface ApprovalRequest {
  id: string;
  userId: UserId;
  taskId: TaskId;
  action: ApprovalAction;
  summary: string;
  contentHash: string;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  expiresAt: Date;
  decidedAt: Date | null;
}

export interface MorningReport {
  userId: UserId;
  /** Calendar date in the user's time zone, YYYY-MM-DD. */
  localDate: string;
  periodStart: Date;
  periodEnd: Date;
  counts: {
    jobsDiscovered: number;
    applicationsSubmitted: number;
    manualHandoffs: number;
    awaitingApproval: number;
    needsReview: number;
    failed: number;
  };
  blockers: Array<{ taskId: TaskId; summary: string }>;
  sourceIssues: Array<{ sourceId: string; status: string; summary: string }>;
}
