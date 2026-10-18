import { requireUuid, withAuth } from '@/server/api';
import { deleteResume, getResumeDetail } from '@/server/resumes';

export const dynamic = 'force-dynamic';

/** GET /api/resumes/:id - status, metadata, text preview and suggestions (owner only). */
export const GET = withAuth<{ id: string }>(async (_request, { auth, params }) => {
  const resume = await getResumeDetail(auth.userId, requireUuid(params.id, 'Resume'));
  return Response.json({ resume }, { headers: { 'Cache-Control': 'no-store' } });
});

/** DELETE /api/resumes/:id - removes the version and its stored file. */
export const DELETE = withAuth<{ id: string }>(async (_request, { auth, params }) => {
  await deleteResume(auth.userId, requireUuid(params.id, 'Resume'));
  return new Response(null, { status: 204 });
});
