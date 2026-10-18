import { withAuth } from '@/server/api';
import { getAiStatus } from '@/server/ai';

export const dynamic = 'force-dynamic';

/** GET /api/ai/usage - whether AI is usable, consent, and this month's spend against the budget. */
export const GET = withAuth(async (_request, { auth }) => {
  const usage = await getAiStatus(auth.userId);
  return Response.json({ usage }, { headers: { 'Cache-Control': 'no-store' } });
});
