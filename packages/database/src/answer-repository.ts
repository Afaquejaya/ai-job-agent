import type {
  AnswerSource,
  AnswerType,
  AnswerValue,
  ProfileAnswer,
  UserId,
  ValidatedAnswer,
} from '@job-agent/shared';
import type { Database } from './client';
import { ConflictError, isUniqueViolation, NotFoundError } from './errors';
import type { Prisma, ProfileAnswer as ProfileAnswerRow } from './generated/prisma/client';

function toAnswer(row: ProfileAnswerRow): ProfileAnswer {
  return {
    id: row.id,
    questionKey: row.questionKey,
    questionText: row.questionText,
    answerType: row.answerType as AnswerType,
    value: row.answerValue as AnswerValue,
    status: row.status,
    source: row.source,
    isSensitive: row.isSensitive,
    usable: row.status === 'VERIFIED',
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Audit metadata never contains answer values - only ids and question keys. */
const auditData = (userId: UserId, action: string, row: ProfileAnswerRow, extra = {}) => ({
  userId,
  actor: 'user' as const,
  action,
  targetType: 'profile_answer',
  targetId: row.id,
  metadata: { questionKey: row.questionKey, ...extra },
});

/**
 * Reusable answers. Values must already be validated (validateNewAnswer / validateAnswerValue
 * in @job-agent/shared). Only VERIFIED answers are `usable`; changing a verified answer's value
 * makes it a DRAFT again.
 */
export function createAnswerRepository(db: Database) {
  const requireOwned = async (tx: Prisma.TransactionClient, userId: UserId, id: string) => {
    const row = await tx.profileAnswer.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundError('Answer');
    return row;
  };
  const requireActive = (row: ProfileAnswerRow) => {
    if (row.status === 'ARCHIVED') throw new ConflictError('This answer is archived.');
  };

  return {
    async list(
      userId: UserId,
      options: { includeArchived?: boolean } = {},
    ): Promise<ProfileAnswer[]> {
      const rows = await db.profileAnswer.findMany({
        where: { userId, ...(options.includeArchived ? {} : { status: { not: 'ARCHIVED' } }) },
        orderBy: [{ questionKey: 'asc' }, { createdAt: 'desc' }],
      });
      return rows.map(toAnswer);
    },

    async findForUser(userId: UserId, id: string): Promise<ProfileAnswer | null> {
      const row = await db.profileAnswer.findFirst({ where: { id, userId } });
      return row ? toAnswer(row) : null;
    },

    async findActiveByKey(userId: UserId, questionKey: string): Promise<ProfileAnswer | null> {
      const row = await db.profileAnswer.findFirst({
        where: { userId, questionKey, status: { not: 'ARCHIVED' } },
      });
      return row ? toAnswer(row) : null;
    },

    async create(
      userId: UserId,
      answer: ValidatedAnswer,
      source: AnswerSource = 'USER_ENTERED',
    ): Promise<ProfileAnswer> {
      try {
        return await db.$transaction(async (tx) => {
          const row = await tx.profileAnswer.create({
            data: {
              userId,
              questionKey: answer.questionKey,
              questionText: answer.questionText,
              answerType: answer.answerType,
              answerValue: answer.value,
              isSensitive: answer.isSensitive,
              source,
              status: 'DRAFT',
            },
          });
          await tx.auditLog.create({ data: auditData(userId, 'answer.created', row, { source }) });
          return toAnswer(row);
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictError(
            'You already have an answer for this question. Edit it instead.',
            {
              questionKey: answer.questionKey,
            },
          );
        }
        throw error;
      }
    },

    /** `value` must be validated for the answer's type by the caller. */
    async update(
      userId: UserId,
      id: string,
      changes: { questionText?: string; value?: AnswerValue },
    ): Promise<ProfileAnswer> {
      return db.$transaction(async (tx) => {
        const row = await requireOwned(tx, userId, id);
        requireActive(row);
        const valueChanged =
          changes.value !== undefined &&
          JSON.stringify(changes.value) !== JSON.stringify(row.answerValue);
        const unverify = valueChanged && row.status === 'VERIFIED';
        const updated = await tx.profileAnswer.update({
          where: { id },
          data: {
            ...(changes.questionText !== undefined ? { questionText: changes.questionText } : {}),
            ...(valueChanged ? { answerValue: changes.value } : {}),
            ...(unverify ? { status: 'DRAFT', verifiedAt: null } : {}),
          },
        });
        await tx.auditLog.create({
          data: auditData(userId, 'answer.updated', updated, {
            valueChanged,
            unverified: unverify,
          }),
        });
        return toAnswer(updated);
      });
    },

    async verify(userId: UserId, id: string): Promise<ProfileAnswer> {
      return db.$transaction(async (tx) => {
        const row = await requireOwned(tx, userId, id);
        requireActive(row);
        if (row.status === 'VERIFIED') return toAnswer(row);
        const updated = await tx.profileAnswer.update({
          where: { id },
          data: { status: 'VERIFIED', verifiedAt: new Date() },
        });
        await tx.auditLog.create({ data: auditData(userId, 'answer.verified', updated) });
        return toAnswer(updated);
      });
    },

    async archive(userId: UserId, id: string): Promise<void> {
      await db.$transaction(async (tx) => {
        const row = await requireOwned(tx, userId, id);
        if (row.status === 'ARCHIVED') return;
        const updated = await tx.profileAnswer.update({
          where: { id },
          data: { status: 'ARCHIVED', verifiedAt: null },
        });
        await tx.auditLog.create({ data: auditData(userId, 'answer.archived', updated) });
      });
    },
  };
}

export type AnswerRepository = ReturnType<typeof createAnswerRepository>;
