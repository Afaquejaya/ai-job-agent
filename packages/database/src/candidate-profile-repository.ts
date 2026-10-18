import type { UserId } from '@job-agent/shared';
import type { Database } from './client';

export interface CandidateProfileRecord {
  id: string;
  headline: string | null;
  summary: string | null;
  updatedAt: Date;
}

export interface CandidateProfileInput {
  headline?: string | null;
  summary?: string | null;
}

/**
 * Minimal profile store (Phase 2). One profile per user; every method is scoped by user id.
 * CV-derived fields and the profile UI arrive in Phase 5.
 */
export function createCandidateProfileRepository(db: Database) {
  const select = { id: true, headline: true, summary: true, updatedAt: true } as const;

  return {
    async findByUser(userId: UserId): Promise<CandidateProfileRecord | null> {
      return db.candidateProfile.findUnique({ where: { userId }, select });
    },

    async upsert(userId: UserId, input: CandidateProfileInput): Promise<CandidateProfileRecord> {
      return db.candidateProfile.upsert({
        where: { userId },
        create: { userId, ...input },
        update: input,
        select,
      });
    },
  };
}

export type CandidateProfileRepository = ReturnType<typeof createCandidateProfileRepository>;
