import { NotFoundError } from '@job-agent/database';
import type { TaskId } from '@job-agent/shared';
import { requireUuid, withAuth } from '@/server/api';
import { getTaskService, toTaskSummary } from '@/server/tasks';

export const dynamic = 'force-dynamic';

/**
 * POST /api/tasks/:id/cancel - a queued or waiting task is cancelled at once; a running one
 * stops within seconds (the worker checks the request while it works).
 */
export const POST = withAuth<{ id: string }>(async (_request, { auth, params }) => {
  const id = requireUuid(params.id, 'Task') as TaskId;
  const task = await getTaskService().cancel(auth.userId, id);
  if (!task) throw new NotFoundError('Task');
  return Response.json({ task: toTaskSummary(task) }, { headers: { 'Cache-Control': 'no-store' } });
});
