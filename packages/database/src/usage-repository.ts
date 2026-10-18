import type { UserId } from '@job-agent/shared';
import type { Database } from './client';

export interface NewUsageRecord {
  conversationId: string | null;
  purpose: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  estimatedCostUsd: number;
  succeeded: boolean;
}

/** Start of the current calendar month in UTC (budgets reset monthly, UTC). */
export function startOfUtcMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** AI usage records for cost tracking and the monthly budget. Scoped by userId. */
export function createUsageRepository(db: Database) {
  return {
    async record(userId: UserId, usage: NewUsageRecord): Promise<void> {
      await db.aiUsageRecord.create({ data: { userId, ...usage } });
    },

    async monthToDateCostUsd(userId: UserId, now: Date = new Date()): Promise<number> {
      const result = await db.aiUsageRecord.aggregate({
        where: { userId, createdAt: { gte: startOfUtcMonth(now) } },
        _sum: { estimatedCostUsd: true },
      });
      return Number(result._sum.estimatedCostUsd ?? 0);
    },
  };
}

export type UsageRepository = ReturnType<typeof createUsageRepository>;
