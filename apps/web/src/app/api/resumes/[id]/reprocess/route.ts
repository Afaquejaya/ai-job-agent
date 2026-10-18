import { createResumeRepository } from '@job-agent/database';
import { ApiProblem, requireUuid, withAuth } from '@/server/api';
import { getDatabase } from '@/server/db';
import { processResume } from '@/server/resumes';

export const dynamic = 'force-dynamic';

/** PROCESSING/UPLOADED are retryable too, in case a previous run was interrupted. */
const RETRYABLE = new Set(['FAILED', 'NEEDS_REVIEW', 'PROCESSING', 'UPLOADED']);

/** POST /api/resumes/:id/reprocess - retry text extraction (e.g. after a failure). */
export const POST = withAuth<{ id: string }>(async (_request, { auth, params, logger }) => {
  const id = requireUuid(params.id, 'Resume');
  const row = await createResumeRepository(getDatabase()).requireForUser(auth.userId, id);
  if (!RETRYABLE.has(row.extractionStatus)) {
    throw new ApiProblem('CONFLICT', 'This CV was already processed successfully.', 409);
  }
  const resume = await processResume(auth.userId, id, logger);
  return Response.json({ resume }, { headers: { 'Cache-Control': 'no-store' } });
});
