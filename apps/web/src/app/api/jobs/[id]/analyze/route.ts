import { ApiProblem, requireUuid, withAuth } from '@/server/api';
import { MatchAnalysisError, runMatchAnalysis } from '@/server/matching';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** POST /api/jobs/:id/analyze - run a new evidence-based match analysis (uses the AI budget). */
export const POST = withAuth<{ id: string }>(async (request, { auth, params, logger }) => {
  const jobId = requireUuid(params.id, 'Job');
  try {
    const match = await runMatchAnalysis(auth.userId, jobId, {
      signal: request.signal,
      conversationId: null,
    });
    logger.info('job.analyzed', {
      jobId,
      score: match.score,
      recommendation: match.recommendation,
    });
    return Response.json({ match }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof MatchAnalysisError) throw new ApiProblem('AI_FAILED', error.message, 422);
    throw error;
  }
});
