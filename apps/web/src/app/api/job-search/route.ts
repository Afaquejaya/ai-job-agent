import { jobSearchRequestSchema } from '@job-agent/shared';
import { parseJsonBody, withAuth } from '@/server/api';
import { getServices } from '@/server/services';
import { getTaskService, jobSearchKey, toTaskSummary } from '@/server/tasks';

export const dynamic = 'force-dynamic';

/** GET /api/job-search - the search suggested from the CV and profile, and which sources are on. */
export const GET = withAuth(async (_request, { auth }) => {
  const suggestion = await getServices().jobSearch.suggest(auth.userId);
  return Response.json(suggestion, { headers: { 'Cache-Control': 'no-store' } });
});

/**
 * POST /api/job-search - start a job search in the background (D-049). New jobs that match the
 * CV best are saved to the Jobs list. While a search is running, that task is returned.
 */
export const POST = withAuth(async (request, { auth, logger }) => {
  const input = await parseJsonBody(request, jobSearchRequestSchema);
  const { task, created } = await getTaskService().start(
    auth.userId,
    'job_search',
    input,
    jobSearchKey,
  );
  logger.info('job_search.queued', { taskId: task.id, created });
  return Response.json(
    { task: toTaskSummary(task) },
    { status: 202, headers: { 'Cache-Control': 'no-store' } },
  );
});
