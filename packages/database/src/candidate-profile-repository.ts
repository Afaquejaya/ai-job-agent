import {
  candidateProfileFieldsSchema,
  EMPTY_PROFILE_FIELDS,
  PROFILE_FIELDS,
  type CandidateProfile,
  type CandidateProfileFields,
  type CandidateProfileUpdate,
  type ProfileField,
  type UserId,
} from '@job-agent/shared';
import type { Database } from './client';
import { DomainValidationError } from './errors';
import { Prisma, type CandidateProfile as CandidateProfileRow } from './generated/prisma/client';

const JSON_FIELDS = new Set<ProfileField>([
  'currentLocation',
  'preferredLocations',
  'education',
  'workExperience',
  'skills',
  'certifications',
  'languages',
  'workAuthorization',
  'noticePeriod',
  'employmentPreferences',
]);

function toFields(row: CandidateProfileRow | null): CandidateProfileFields {
  if (!row) return { ...EMPTY_PROFILE_FIELDS };
  const fields = {} as Record<ProfileField, unknown>;
  for (const field of PROFILE_FIELDS) {
    const value = row[field];
    fields[field] = field === 'expectedSalary' && value !== null ? Number(value) : value;
  }
  return fields as CandidateProfileFields;
}

/** Converts validated fields to Prisma input. JSON nulls must be written as SQL NULL. */
function toData(fields: Partial<CandidateProfileFields>) {
  const data: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(fields)) {
    data[field] = JSON_FIELDS.has(field as ProfileField) && value === null ? Prisma.DbNull : value;
  }
  return data as Prisma.CandidateProfileUncheckedUpdateInput;
}

export interface ProfileUpdateResult {
  profile: CandidateProfile;
  changedFields: ProfileField[];
}

/** Who changed the profile, for the audit trail (values are never audited). */
export type ProfileChangeSource =
  { kind: 'user' } | { kind: 'resume_suggestion'; resumeId: string };

export function createCandidateProfileRepository(db: Database) {
  return {
    /** The user's profile; an all-null profile when nothing has been saved yet. */
    async getForUser(userId: UserId): Promise<CandidateProfile> {
      const row = await db.candidateProfile.findUnique({ where: { userId } });
      return { ...toFields(row), updatedAt: row ? row.updatedAt.toISOString() : null };
    },

    /**
     * Applies a partial update. The MERGED profile is validated (cross-field rules such as
     * "salary needs a currency"), then saved with an audit entry listing changed field names.
     */
    async update(
      userId: UserId,
      patch: CandidateProfileUpdate,
      source: ProfileChangeSource = { kind: 'user' },
    ): Promise<ProfileUpdateResult> {
      return db.$transaction(async (tx) => {
        const row = await tx.candidateProfile.findUnique({ where: { userId } });
        const current = toFields(row);
        const merged = { ...current, ...patch };

        const parsed = candidateProfileFieldsSchema.safeParse(merged);
        if (!parsed.success) {
          throw new DomainValidationError(
            parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
          );
        }

        const changedFields = (Object.keys(patch) as ProfileField[]).filter(
          (field) => JSON.stringify(current[field]) !== JSON.stringify(parsed.data[field]),
        );
        if (changedFields.length === 0) {
          return {
            profile: { ...current, updatedAt: row ? row.updatedAt.toISOString() : null },
            changedFields,
          };
        }

        const changes = Object.fromEntries(changedFields.map((f) => [f, parsed.data[f]]));
        const saved = await tx.candidateProfile.upsert({
          where: { userId },
          create: { userId, ...toData(changes) } as Prisma.CandidateProfileUncheckedCreateInput,
          update: toData(changes),
        });
        await tx.auditLog.create({
          data: {
            userId,
            actor: 'user',
            action: 'profile.updated',
            targetType: 'candidate_profile',
            targetId: saved.id,
            metadata: {
              changedFields: changedFields.join(','),
              ...(source.kind === 'resume_suggestion' ? { fromResumeId: source.resumeId } : {}),
            },
          },
        });
        return {
          profile: { ...toFields(saved), updatedAt: saved.updatedAt.toISOString() },
          changedFields,
        };
      });
    },
  };
}

export type CandidateProfileRepository = ReturnType<typeof createCandidateProfileRepository>;
