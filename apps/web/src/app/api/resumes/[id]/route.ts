import { requireUuid, withAuth } from '@/server/api';
import { deleteResume, getResumeDetail } from '@/server/resumes';
import { cvProcessingKey, latestTaskFor } from '@/server/tasks';

export const dynamic = 'force-dynamic';

/** GET /api/resumes/:id - status, metadata, text preview, suggestions and the processing task. */
export const GET = withAuth<{ id: string }>(async (_request, { auth, params }) => {
  const id = requireUuid(params.id, 'Resume');
  const resume = await getResumeDetail(auth.userId, id);
  const task = await latestTaskFor(auth.userId, cvProcessingKey(id));
  return Response.json({ resume, task }, { headers: { 'Cache-Control': 'no-store' } });
});

/** DELETE /api/resumes/:id - removes the version and its stored file. */
export const DELETE = withAuth<{ id: string }>(async (_request, { auth, params }) => {
  await deleteResume(auth.userId, requireUuid(params.id, 'Resume'));
  return new Response(null, { status: 204 });
});
