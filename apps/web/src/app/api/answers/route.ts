import { createAnswerRepository } from '@job-agent/database';
import { answerCreateSchema, validateNewAnswer } from '@job-agent/shared';
import { parseJsonBody, RequestValidationError, withAuth } from '@/server/api';
import { getDatabase } from '@/server/db';

export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store' };

/** GET /api/answers - active answers (add ?includeArchived=true for archived ones). */
export const GET = withAuth(async (request, { auth }) => {
  const includeArchived = new URL(request.url).searchParams.get('includeArchived') === 'true';
  const answers = await createAnswerRepository(getDatabase()).list(auth.userId, {
    includeArchived,
  });
  return Response.json({ answers }, { headers: noStore });
});

/**
 * POST /api/answers - create an answer (always starts as DRAFT; verify it separately).
 * Catalog keys use the catalog's type; custom keys (`custom:<slug>`) need questionText and
 * answerType, and may not ask about protected characteristics.
 */
export const POST = withAuth(async (request, { auth }) => {
  const input = await parseJsonBody(request, answerCreateSchema);
  const validated = validateNewAnswer(input);
  if (!validated.ok) throw new RequestValidationError(validated.error);
  const answer = await createAnswerRepository(getDatabase()).create(auth.userId, validated.value);
  return Response.json({ answer }, { status: 201, headers: noStore });
});
