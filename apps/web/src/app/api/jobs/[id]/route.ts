import { createJobRepository } from '@job-agent/database';
import { requireUuid, withAuth } from '@/server/api';
import { getDatabase } from '@/server/db';
import { getJobDetail } from '@/server/matching';
import { analysisKey, latestTaskFor } from '@/server/tasks';

export const dynamic = 'force-dynamic';

/** GET /api/jobs/:id - the saved job with its full text and latest match analysis. */
export const GET = withAuth<{ id: string }>(async (_request, { auth, params }) => {
  const id = requireUuid(params.id, 'Job');
  const job = await getJobDetail(auth.userId, id);
  const analysisTask = await latestTaskFor(auth.userId, analysisKey(id));
  return Response.json({ job, analysisTask }, { headers: { 'Cache-Control': 'no-store' } });
});

/** DELETE /api/jobs/:id - delete the job and its match results. */
export const DELETE = withAuth<{ id: string }>(async (_request, { auth, params }) => {
  await createJobRepository(getDatabase()).delete(auth.userId, requireUuid(params.id, 'Job'));
  return new Response(null, { status: 204 });
});
