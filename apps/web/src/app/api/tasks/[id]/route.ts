import { createTaskRepository, NotFoundError } from '@job-agent/database';
import type { TaskId } from '@job-agent/shared';
import { requireUuid, withAuth } from '@/server/api';
import { getDatabase } from '@/server/db';
import { toTaskDetail } from '@/server/tasks';

export const dynamic = 'force-dynamic';

/** GET /api/tasks/:id - one task with its timeline (state changes and attempts). */
export const GET = withAuth<{ id: string }>(async (_request, { auth, params }) => {
  const id = requireUuid(params.id, 'Task') as TaskId;
  const timeline = await createTaskRepository(getDatabase()).timeline(auth.userId, id);
  if (!timeline) throw new NotFoundError('Task');
  return Response.json(
    { task: toTaskDetail(timeline.task, timeline.events, timeline.attempts) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});
