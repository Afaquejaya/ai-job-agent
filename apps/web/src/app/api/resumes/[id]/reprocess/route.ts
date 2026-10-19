import { createResumeRepository } from '@job-agent/database';
import { ApiProblem, requireUuid, withAuth } from '@/server/api';
import { getDatabase } from '@/server/db';
import { getResumeDetail, startCvProcessing } from '@/server/resumes';

export const dynamic = 'force-dynamic';

/** PROCESSING/UPLOADED are retryable too, in case a previous run was interrupted. */
const RETRYABLE = new Set(['FAILED', 'NEEDS_REVIEW', 'PROCESSING', 'UPLOADED']);

/** POST /api/resumes/:id/reprocess - extract the text again, as a background task. */
export const POST = withAuth<{ id: string }>(async (_request, { auth, params }) => {
  const id = requireUuid(params.id, 'Resume');
  const row = await createResumeRepository(getDatabase()).requireForUser(auth.userId, id);
  if (!RETRYABLE.has(row.extractionStatus)) {
    throw new ApiProblem('CONFLICT', 'This CV was already processed successfully.', 409);
  }
  const task = await startCvProcessing(auth.userId, id);
  const resume = await getResumeDetail(auth.userId, id);
  return Response.json({ resume, task }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
});
