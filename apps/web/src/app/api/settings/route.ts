import { createUserSettingsRepository } from '@job-agent/database';
import { userSettingsUpdateSchema } from '@job-agent/shared';
import { parseJsonBody, withAuth } from '@/server/api';
import { getDatabase } from '@/server/db';

export const dynamic = 'force-dynamic';

/** GET /api/settings - the signed-in user's settings (created with safe defaults). */
export const GET = withAuth(async (_request, { auth }) => {
  const settings = await createUserSettingsRepository(getDatabase()).getOrCreate(auth.userId);
  return Response.json({ settings }, { headers: { 'Cache-Control': 'no-store' } });
});

/** PATCH /api/settings - change any subset of settings; unknown fields are rejected. */
export const PATCH = withAuth(async (request, { auth, logger }) => {
  const patch = await parseJsonBody(request, userSettingsUpdateSchema);
  const { settings, changedFields } = await createUserSettingsRepository(getDatabase()).update(
    auth.userId,
    patch,
  );
  logger.info('settings.updated', { changedFields });
  return Response.json({ settings }, { headers: { 'Cache-Control': 'no-store' } });
});
