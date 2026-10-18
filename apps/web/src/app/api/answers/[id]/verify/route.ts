import { createAnswerRepository } from '@job-agent/database';
import { requireUuid, withAuth } from '@/server/api';
import { getDatabase } from '@/server/db';

export const dynamic = 'force-dynamic';

/** POST /api/answers/:id/verify - the user confirms this answer is correct and reusable. */
export const POST = withAuth<{ id: string }>(async (_request, { auth, params }) => {
  const answer = await createAnswerRepository(getDatabase()).verify(
    auth.userId,
    requireUuid(params.id, 'Answer'),
  );
  return Response.json({ answer }, { headers: { 'Cache-Control': 'no-store' } });
});
