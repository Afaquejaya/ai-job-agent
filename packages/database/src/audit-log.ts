import type { AuditEntry, AuditLog } from '@job-agent/security';
import type { UserId } from '@job-agent/shared';
import type { Database } from './client';

export interface AuditLogRecord {
  id: string;
  action: string;
  actor: AuditEntry['actor'];
  targetType: string;
  targetId: string | null;
  metadata: unknown;
  occurredAt: Date;
}

/** Prisma adapter for the append-only `AuditLog` port. Updates are rejected by a DB trigger. */
export function createAuditLog(db: Database): AuditLog & {
  listForUser(userId: UserId, limit?: number): Promise<AuditLogRecord[]>;
} {
  return {
    async append(entry) {
      await db.auditLog.create({
        data: {
          userId: entry.userId,
          actor: entry.actor,
          action: entry.action,
          targetType: entry.targetType,
          targetId: entry.targetId,
          metadata: entry.metadata,
          occurredAt: entry.occurredAt,
        },
      });
    },

    async listForUser(userId, limit = 50) {
      return db.auditLog.findMany({
        where: { userId },
        orderBy: { occurredAt: 'desc' },
        take: Math.min(Math.max(limit, 1), 200),
        select: {
          id: true,
          action: true,
          actor: true,
          targetType: true,
          targetId: true,
          metadata: true,
          occurredAt: true,
        },
      });
    },
  };
}
