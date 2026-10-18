import { createCandidateProfileRepository } from '@job-agent/database';
import { candidateProfileUpdateSchema } from '@job-agent/shared';
import { parseJsonBody, withAuth } from '@/server/api';
import { getDatabase } from '@/server/db';

export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store' };

/** GET /api/profile - the signed-in user's profile (all-null fields when not yet filled in). */
export const GET = withAuth(async (_request, { auth }) => {
  const profile = await createCandidateProfileRepository(getDatabase()).getForUser(auth.userId);
  return Response.json({ profile }, { headers: noStore });
});

/** PATCH /api/profile - partial update; the merged profile is validated as a whole. */
export const PATCH = withAuth(async (request, { auth, logger }) => {
  const patch = await parseJsonBody(request, candidateProfileUpdateSchema);
  const { profile, changedFields } = await createCandidateProfileRepository(getDatabase()).update(
    auth.userId,
    patch,
  );
  logger.info('profile.updated', { changedFields });
  return Response.json({ profile }, { headers: noStore });
});
