import { createTaskRepository } from '@job-agent/database';
import { withAuth } from '@/server/api';
import { getDatabase } from '@/server/db';
import { toTaskSummary } from '@/server/tasks';

export const dynamic = 'force-dynamic';

/** GET /api/tasks - the user's recent background tasks (newest first). */
export const GET = withAuth(async (_request, { auth }) => {
  const tasks = await createTaskRepository(getDatabase()).listForUser(auth.userId, 50);
  return Response.json(
    { tasks: tasks.map((t) => toTaskSummary(t)) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});
