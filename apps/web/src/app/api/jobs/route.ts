import { createJobRepository } from '@job-agent/database';
import { jobPostingInputSchema } from '@job-agent/shared';
import { parseJsonBody, withAuth } from '@/server/api';
import { getDatabase } from '@/server/db';
import { listJobsWithOverlap } from '@/server/matching';

export const dynamic = 'force-dynamic';

/** GET /api/jobs - saved jobs (newest first) with their latest match result. */
export const GET = withAuth(async (_request, { auth }) => {
  const jobs = await listJobsWithOverlap(auth.userId);
  return Response.json({ jobs }, { headers: { 'Cache-Control': 'no-store' } });
});

/** POST /api/jobs - save a pasted job. The link is a reference only; it is never fetched. */
export const POST = withAuth(async (request, { auth }) => {
  const input = await parseJsonBody(request, jobPostingInputSchema);
  const job = await createJobRepository(getDatabase()).create(auth.userId, input);
  return Response.json(
    { job: { id: job.id, title: job.title, company: job.company } },
    { status: 201, headers: { 'Cache-Control': 'no-store' } },
  );
});
