import { createJobRepository } from '@job-agent/database';
import { requireUuid, withAuth } from '@/server/api';
import { getDatabase } from '@/server/db';
import { getJobDetail } from '@/server/matching';

export const dynamic = 'force-dynamic';

/** GET /api/jobs/:id - the saved job with its full text and latest match analysis. */
export const GET = withAuth<{ id: string }>(async (_request, { auth, params }) => {
  const job = await getJobDetail(auth.userId, requireUuid(params.id, 'Job'));
  return Response.json({ job }, { headers: { 'Cache-Control': 'no-store' } });
});

/** DELETE /api/jobs/:id - delete the job and its match results. */
export const DELETE = withAuth<{ id: string }>(async (_request, { auth, params }) => {
  await createJobRepository(getDatabase()).delete(auth.userId, requireUuid(params.id, 'Job'));
  return new Response(null, { status: 204 });
});
