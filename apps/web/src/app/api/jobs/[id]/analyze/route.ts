import { createJobRepository } from '@job-agent/database';
import { requireUuid, withAuth } from '@/server/api';
import { getDatabase } from '@/server/db';
import { requireAiReady } from '@/server/ai';
import { analysisKey, getTaskService, toTaskSummary } from '@/server/tasks';

export const dynamic = 'force-dynamic';

/**
 * POST /api/jobs/:id/analyze - start an evidence-based match analysis in the background
 * (Phase 3). Returns 202 with the task; the page polls it. While an analysis of this job is
 * still running, the same task is returned instead of starting a second one.
 */
export const POST = withAuth<{ id: string }>(async (_request, { auth, params, logger }) => {
  const jobId = requireUuid(params.id, 'Job');
  await createJobRepository(getDatabase()).require(auth.userId, jobId);
  // Refuse at once (403 / 503) instead of queueing work that cannot run.
  await requireAiReady(auth.userId);
  const { task, created } = await getTaskService().start(
    auth.userId,
    'job_match_analysis',
    { jobId },
    analysisKey(jobId),
  );
  logger.info('job.analysis_queued', { jobId, taskId: task.id, created });
  return Response.json(
    { task: toTaskSummary(task) },
    { status: 202, headers: { 'Cache-Control': 'no-store' } },
  );
});
