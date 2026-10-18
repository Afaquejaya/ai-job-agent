import { createAgentRepository } from '@job-agent/database';
import { requireUuid, withAuth } from '@/server/api';
import { getConversationMessages } from '@/server/agent/turn';
import { getDatabase } from '@/server/db';

export const dynamic = 'force-dynamic';

/** GET /api/agent/conversations/:id - every message of one conversation, with its step trace. */
export const GET = withAuth<{ id: string }>(async (_request, { auth, params }) => {
  const id = requireUuid(params.id, 'Conversation');
  const messages = await getConversationMessages(auth.userId, id);
  return Response.json(
    { conversationId: id, messages },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});

/** DELETE /api/agent/conversations/:id - delete the conversation and its messages. */
export const DELETE = withAuth<{ id: string }>(async (_request, { auth, params }) => {
  await createAgentRepository(getDatabase()).deleteConversation(
    auth.userId,
    requireUuid(params.id, 'Conversation'),
  );
  return new Response(null, { status: 204 });
});
