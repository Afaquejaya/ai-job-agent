import { requireUuid, withAuth } from '@/server/api';
import { getResumeDetail } from '@/server/resumes';

export const dynamic = 'force-dynamic';

/** GET /api/resumes/:id/suggestions - values found in the CV, with evidence and current values. */
export const GET = withAuth<{ id: string }>(async (_request, { auth, params }) => {
  const { suggestions } = await getResumeDetail(auth.userId, requireUuid(params.id, 'Resume'));
  return Response.json({ suggestions }, { headers: { 'Cache-Control': 'no-store' } });
});
