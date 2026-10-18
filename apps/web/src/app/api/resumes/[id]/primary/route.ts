import { createResumeRepository } from '@job-agent/database';
import { requireUuid, withAuth } from '@/server/api';
import { getDatabase } from '@/server/db';

export const dynamic = 'force-dynamic';

/** POST /api/resumes/:id/primary - make this version the primary CV. */
export const POST = withAuth<{ id: string }>(async (_request, { auth, params }) => {
  await createResumeRepository(getDatabase()).setPrimary(
    auth.userId,
    requireUuid(params.id, 'Resume'),
  );
  return new Response(null, { status: 204 });
});
