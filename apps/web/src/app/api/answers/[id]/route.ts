import { createAnswerRepository, NotFoundError } from '@job-agent/database';
import {
  answerUpdateSchema,
  findCatalogEntry,
  mentionsProtectedCharacteristic,
  validateAnswerValue,
  type AnswerValue,
} from '@job-agent/shared';
import { parseJsonBody, RequestValidationError, requireUuid, withAuth } from '@/server/api';
import { getDatabase } from '@/server/db';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/answers/:id - edit the question text and/or value. Changing the value of a
 * VERIFIED answer makes it a DRAFT again until the user verifies it.
 */
export const PATCH = withAuth<{ id: string }>(async (request, { auth, params }) => {
  const id = requireUuid(params.id, 'Answer');
  const input = await parseJsonBody(request, answerUpdateSchema);
  const repo = createAnswerRepository(getDatabase());
  const existing = await repo.findForUser(auth.userId, id);
  if (!existing) throw new NotFoundError('Answer');

  const entry = findCatalogEntry(existing.questionKey);
  if (
    input.questionText !== undefined &&
    !entry &&
    mentionsProtectedCharacteristic(input.questionText)
  ) {
    throw new RequestValidationError([
      {
        path: 'questionText',
        message: 'Questions about protected characteristics are not stored as reusable answers.',
      },
    ]);
  }

  let value: AnswerValue | undefined;
  if (input.value !== undefined) {
    const checked = validateAnswerValue(existing.answerType, input.value, entry);
    if (!checked.ok) throw new RequestValidationError(checked.error);
    value = checked.value;
  }

  const answer = await repo.update(auth.userId, id, { questionText: input.questionText, value });
  return Response.json({ answer }, { headers: { 'Cache-Control': 'no-store' } });
});

/** DELETE /api/answers/:id - archive (kept for history, never used to fill forms). */
export const DELETE = withAuth<{ id: string }>(async (_request, { auth, params }) => {
  await createAnswerRepository(getDatabase()).archive(
    auth.userId,
    requireUuid(params.id, 'Answer'),
  );
  return new Response(null, { status: 204 });
});
