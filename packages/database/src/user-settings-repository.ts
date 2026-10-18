import type { UserId, UserSettings, UserSettingsUpdate } from '@job-agent/shared';
import type { Database } from './client';
import type { UserSettings as UserSettingsRow } from './generated/prisma/client';

function toUserSettings(row: UserSettingsRow): UserSettings {
  return {
    timeZone: row.timeZone,
    submissionMode: row.submissionMode,
    dailyApplicationLimit: row.dailyApplicationLimit,
    targetCountries: row.targetCountries,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export interface SettingsUpdateResult {
  settings: UserSettings;
  /** Names of fields whose value actually changed (never their values). */
  changedFields: Array<keyof UserSettingsUpdate>;
}

/**
 * Settings are keyed by user id, so one user can never address another user's row.
 * Rows are created lazily with safe defaults (`manual_only`, limit 20, UTC).
 */
export function createUserSettingsRepository(db: Database) {
  return {
    async getOrCreate(userId: UserId): Promise<UserSettings> {
      const row = await db.userSettings.upsert({
        where: { userId },
        create: { userId },
        update: {},
      });
      return toUserSettings(row);
    },

    /**
     * Applies an already-validated patch and records an audit entry in the same
     * transaction. A patch that changes nothing writes nothing.
     */
    async update(userId: UserId, patch: UserSettingsUpdate): Promise<SettingsUpdateResult> {
      return db.$transaction(async (tx) => {
        const current = await tx.userSettings.upsert({
          where: { userId },
          create: { userId },
          update: {},
        });
        const changedFields = (Object.keys(patch) as Array<keyof UserSettingsUpdate>).filter(
          (field) => !sameValue(current[field], patch[field]),
        );
        if (changedFields.length === 0) {
          return { settings: toUserSettings(current), changedFields };
        }

        const updated = await tx.userSettings.update({ where: { userId }, data: patch });
        await tx.auditLog.create({
          data: {
            userId,
            actor: 'user',
            action: 'settings.updated',
            targetType: 'user_settings',
            targetId: userId,
            metadata: { changedFields: changedFields.join(',') },
          },
        });
        return { settings: toUserSettings(updated), changedFields };
      });
    },
  };
}

export type UserSettingsRepository = ReturnType<typeof createUserSettingsRepository>;
