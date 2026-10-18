import { applySuggestionsSchema } from '@job-agent/shared';
import { parseJsonBody, requireUuid, withAuth } from '@/server/api';
import { applySuggestions } from '@/server/resumes';

export const dynamic = 'force-dynamic';

/** POST /api/resumes/:id/suggestions/apply - apply ONLY the suggestions the user selected. */
export const POST = withAuth<{ id: string }>(async (request, { auth, params, logger }) => {
  const { suggestionIds } = await parseJsonBody(request, applySuggestionsSchema);
  const applied = await applySuggestions(
    auth.userId,
    requireUuid(params.id, 'Resume'),
    suggestionIds,
  );
  logger.info('resume.suggestions_applied', {
    profileFields: applied.profileFields,
    answers: applied.answers,
  });
  return Response.json({ applied }, { headers: { 'Cache-Control': 'no-store' } });
});
