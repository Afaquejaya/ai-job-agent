import type { ExtractionStatus, ResumeSummary, UserId } from '@job-agent/shared';
import type { Database } from './client';
import { ConflictError, isUniqueViolation, NotFoundError } from './errors';
import type { Resume as ResumeRow } from './generated/prisma/client';

/** Full stored record, including the ENCRYPTED text/data. Only services should see this. */
export type ResumeRecord = ResumeRow;

export function toResumeSummary(row: ResumeRow): ResumeSummary {
  return {
    id: row.id,
    version: row.version,
    originalFilename: row.originalFilename,
    mimeType: row.mimeType,
    fileSizeBytes: row.fileSizeBytes,
    extractionStatus: row.extractionStatus,
    extractionError: row.extractionError,
    isPrimary: row.isPrimary,
    pageCount: row.pageCount,
    textCharCount: row.textCharCount,
    createdAt: row.createdAt.toISOString(),
    processedAt: row.processedAt?.toISOString() ?? null,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
  };
}

export interface NewResume {
  originalFilename: string;
  storageKey: string;
  mimeType: string;
  fileSizeBytes: number;
  checksum: string;
}

export interface ExtractionOutcome {
  status: Extract<ExtractionStatus, 'EXTRACTED' | 'NEEDS_REVIEW' | 'FAILED'>;
  extractedTextEncrypted: Uint8Array<ArrayBuffer> | null;
  parsedProfileEncrypted: Uint8Array<ArrayBuffer> | null;
  extractionError: string | null;
  pageCount: number | null;
  textCharCount: number | null;
  textTruncated: boolean;
}

const MAX_CREATE_ATTEMPTS = 3;

/**
 * Every method is scoped by userId: a resume id that belongs to someone else behaves exactly
 * like a missing one.
 */
export function createResumeRepository(db: Database) {
  const requireOwned = async (userId: UserId, id: string): Promise<ResumeRow> => {
    const row = await db.resume.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundError('Resume');
    return row;
  };

  return {
    async listForUser(userId: UserId): Promise<ResumeSummary[]> {
      const rows = await db.resume.findMany({ where: { userId }, orderBy: { version: 'desc' } });
      return rows.map(toResumeSummary);
    },

    async findForUser(userId: UserId, id: string): Promise<ResumeRecord | null> {
      return db.resume.findFirst({ where: { id, userId } });
    },

    requireForUser: requireOwned,

    async findByChecksum(userId: UserId, checksum: string): Promise<ResumeSummary | null> {
      const row = await db.resume.findFirst({ where: { userId, checksum } });
      return row ? toResumeSummary(row) : null;
    },

    /**
     * Stores a new version (next number for this user). The first resume becomes primary.
     * Concurrent uploads are resolved by unique constraints and a bounded retry.
     */
    async create(userId: UserId, input: NewResume): Promise<ResumeRecord> {
      for (let attempt = 1; ; attempt++) {
        try {
          return await db.$transaction(async (tx) => {
            const latest = await tx.resume.aggregate({
              where: { userId },
              _max: { version: true },
            });
            const hasPrimary = (await tx.resume.count({ where: { userId, isPrimary: true } })) > 0;
            const row = await tx.resume.create({
              data: {
                userId,
                ...input,
                version: (latest._max.version ?? 0) + 1,
                isPrimary: !hasPrimary,
              },
            });
            await tx.auditLog.create({
              data: {
                userId,
                actor: 'user',
                action: 'cv.uploaded',
                targetType: 'resume',
                targetId: row.id,
                metadata: {
                  version: row.version,
                  mimeType: row.mimeType,
                  fileSizeBytes: row.fileSizeBytes,
                },
              },
            });
            return row;
          });
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
          const duplicate = await db.resume.findFirst({
            where: { userId, checksum: input.checksum },
          });
          if (duplicate) {
            throw new ConflictError('This exact file has already been uploaded.', {
              existingResumeId: duplicate.id,
              existingVersion: duplicate.version,
            });
          }
          if (attempt >= MAX_CREATE_ATTEMPTS) throw error;
        }
      }
    },

    async markProcessing(userId: UserId, id: string): Promise<void> {
      const result = await db.resume.updateMany({
        where: { id, userId },
        data: { extractionStatus: 'PROCESSING', extractionError: null },
      });
      if (result.count === 0) throw new NotFoundError('Resume');
    },

    async saveExtraction(
      userId: UserId,
      id: string,
      outcome: ExtractionOutcome,
    ): Promise<ResumeRecord> {
      return db.$transaction(async (tx) => {
        const result = await tx.resume.updateMany({
          where: { id, userId },
          data: {
            extractionStatus: outcome.status,
            extractedTextEncrypted: outcome.extractedTextEncrypted,
            parsedProfileEncrypted: outcome.parsedProfileEncrypted,
            extractionError: outcome.extractionError,
            pageCount: outcome.pageCount,
            textCharCount: outcome.textCharCount,
            textTruncated: outcome.textTruncated,
            processedAt: new Date(),
            reviewedAt: null,
          },
        });
        if (result.count === 0) throw new NotFoundError('Resume');
        await tx.auditLog.create({
          data: {
            userId,
            actor: 'system',
            action: 'cv.processed',
            targetType: 'resume',
            targetId: id,
            metadata: { status: outcome.status },
          },
        });
        return tx.resume.findFirstOrThrow({ where: { id, userId } });
      });
    },

    async setPrimary(userId: UserId, id: string): Promise<void> {
      await db.$transaction(async (tx) => {
        const row = await tx.resume.findFirst({ where: { id, userId } });
        if (!row) throw new NotFoundError('Resume');
        if (row.isPrimary) return;
        await tx.resume.updateMany({
          where: { userId, isPrimary: true },
          data: { isPrimary: false },
        });
        await tx.resume.update({ where: { id }, data: { isPrimary: true } });
        await tx.auditLog.create({
          data: {
            userId,
            actor: 'user',
            action: 'cv.primary_changed',
            targetType: 'resume',
            targetId: id,
            metadata: { version: row.version },
          },
        });
      });
    },

    async markReviewed(userId: UserId, id: string): Promise<void> {
      const result = await db.resume.updateMany({
        where: { id, userId },
        data: { reviewedAt: new Date() },
      });
      if (result.count === 0) throw new NotFoundError('Resume');
    },

    /**
     * Deletes the row and returns its storage key (the caller deletes the stored file).
     * The only remaining resume cannot be deleted while it is primary (approved plan, B1).
     * Deleting a primary resume when others exist promotes the newest remaining version.
     */
    async delete(userId: UserId, id: string): Promise<{ storageKey: string }> {
      return db.$transaction(async (tx) => {
        const row = await tx.resume.findFirst({ where: { id, userId } });
        if (!row) throw new NotFoundError('Resume');
        const total = await tx.resume.count({ where: { userId } });
        if (row.isPrimary && total === 1) {
          throw new ConflictError(
            'This is your only CV and it is your primary one. Upload another version before deleting it.',
          );
        }
        await tx.resume.delete({ where: { id } });
        if (row.isPrimary) {
          const newest = await tx.resume.findFirst({
            where: { userId },
            orderBy: { version: 'desc' },
          });
          if (newest)
            await tx.resume.update({ where: { id: newest.id }, data: { isPrimary: true } });
        }
        await tx.auditLog.create({
          data: {
            userId,
            actor: 'user',
            action: 'cv.deleted',
            targetType: 'resume',
            targetId: id,
            metadata: { version: row.version },
          },
        });
        return { storageKey: row.storageKey };
      });
    },

    /** Upload count for the rolling rate limit (counts audit entries, so deletes don't reset it). */
    async countUploadsSince(userId: UserId, since: Date): Promise<number> {
      return db.auditLog.count({
        where: { userId, action: 'cv.uploaded', occurredAt: { gte: since } },
      });
    },
  };
}

export type ResumeRepository = ReturnType<typeof createResumeRepository>;
