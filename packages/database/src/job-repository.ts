import type {
  JobPostingInput,
  JobPostingSummary,
  MatchRecommendation,
  UserId,
} from '@job-agent/shared';
import type { Database } from './client';
import { ConflictError, isUniqueViolation, NotFoundError } from './errors';
import type { JobMatch, JobPosting } from './generated/prisma/client';

export type JobPostingRecord = JobPosting;
export type JobMatchRecord = JobMatch;

type PostingWithLatest = JobPosting & { matches: JobMatch[] };

export function toJobPostingSummary(row: PostingWithLatest): JobPostingSummary {
  const latest = row.matches[0];
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    company: row.company,
    location: row.location,
    createdAt: row.createdAt.toISOString(),
    latestMatch: latest
      ? {
          score: latest.score,
          recommendation: latest.recommendation as MatchRecommendation,
          createdAt: latest.createdAt.toISOString(),
        }
      : null,
  };
}

const latestMatch = { orderBy: { createdAt: 'desc' as const }, take: 1 };

export interface NewJobMatch {
  jobPostingId: string;
  resumeId: string | null;
  resumeVersion: number | null;
  model: string;
  score: number | null;
  recommendation: MatchRecommendation;
  resultEncrypted: Uint8Array<ArrayBuffer>;
}

/** Pasted jobs and their match analyses. Every method is scoped by userId. */
export function createJobRepository(db: Database) {
  return {
    async create(userId: UserId, input: JobPostingInput): Promise<JobPostingRecord> {
      try {
        return await db.$transaction(async (tx) => {
          const row = await tx.jobPosting.create({ data: { userId, ...input } });
          await tx.auditLog.create({
            data: {
              userId,
              actor: 'user',
              action: 'job.saved',
              targetType: 'job_posting',
              targetId: row.id,
              metadata: { hasUrl: row.url !== null },
            },
          });
          return row;
        });
      } catch (error) {
        if (isUniqueViolation(error) && input.url) {
          const existing = await db.jobPosting.findFirst({ where: { userId, url: input.url } });
          throw new ConflictError('This job link is already saved.', {
            existingJobId: existing?.id ?? '',
          });
        }
        throw error;
      }
    },

    async list(userId: UserId, limit = 50): Promise<JobPostingSummary[]> {
      const rows = await db.jobPosting.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: Math.min(Math.max(limit, 1), 200),
        include: { matches: latestMatch },
      });
      return rows.map(toJobPostingSummary);
    },

    async find(userId: UserId, id: string): Promise<PostingWithLatest | null> {
      return db.jobPosting.findFirst({ where: { id, userId }, include: { matches: latestMatch } });
    },

    async require(userId: UserId, id: string): Promise<PostingWithLatest> {
      const row = await db.jobPosting.findFirst({
        where: { id, userId },
        include: { matches: latestMatch },
      });
      if (!row) throw new NotFoundError('Job');
      return row;
    },

    async delete(userId: UserId, id: string): Promise<void> {
      await db.$transaction(async (tx) => {
        const result = await tx.jobPosting.deleteMany({ where: { id, userId } });
        if (result.count === 0) throw new NotFoundError('Job');
        await tx.auditLog.create({
          data: {
            userId,
            actor: 'user',
            action: 'job.deleted',
            targetType: 'job_posting',
            targetId: id,
            metadata: {},
          },
        });
      });
    },

    async saveMatch(userId: UserId, match: NewJobMatch): Promise<JobMatchRecord> {
      const owned = await db.jobPosting.count({ where: { id: match.jobPostingId, userId } });
      if (owned === 0) throw new NotFoundError('Job');
      return db.jobMatch.create({ data: { userId, ...match } });
    },
  };
}

export type JobRepository = ReturnType<typeof createJobRepository>;
