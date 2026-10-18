import { withAuth } from '@/server/api';
import { listConversations } from '@/server/agent/turn';

export const dynamic = 'force-dynamic';

/** GET /api/agent/conversations - the user's recent conversations (newest first). */
export const GET = withAuth(async (_request, { auth }) => {
  const conversations = await listConversations(auth.userId);
  return Response.json({ conversations }, { headers: { 'Cache-Control': 'no-store' } });
});
