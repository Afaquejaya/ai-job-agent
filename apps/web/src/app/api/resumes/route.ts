import { createResumeRepository } from '@job-agent/database';
import { RESUME_LIMITS } from '@job-agent/shared';
import { ApiProblem, withAuth } from '@/server/api';
import { getDatabase } from '@/server/db';
import { uploadResume } from '@/server/resumes';

export const dynamic = 'force-dynamic';

/** Multipart overhead allowance on top of the file size limit. */
const MAX_REQUEST_BYTES = RESUME_LIMITS.maxFileBytes + 64 * 1024;

/** GET /api/resumes - all versions, newest first (metadata only, never CV text). */
export const GET = withAuth(async (_request, { auth }) => {
  const resumes = await createResumeRepository(getDatabase()).listForUser(auth.userId);
  return Response.json({ resumes }, { headers: { 'Cache-Control': 'no-store' } });
});

/**
 * POST /api/resumes - multipart/form-data with one `file` field (PDF or DOCX, max 10 MB).
 * The declared Content-Length is checked before the body is read; the server never reads more
 * than that many bytes, so oversized uploads are refused without buffering them.
 */
export const POST = withAuth(async (request, { auth, logger }) => {
  const length = Number(request.headers.get('content-length'));
  if (!Number.isFinite(length) || length <= 0) {
    throw new ApiProblem('VALIDATION_FAILED', 'Content-Length header is required', 411);
  }
  if (length > MAX_REQUEST_BYTES) {
    throw new ApiProblem('PAYLOAD_TOO_LARGE', 'The file is larger than 10 MB.', 413);
  }
  if (!request.headers.get('content-type')?.startsWith('multipart/form-data')) {
    throw new ApiProblem('VALIDATION_FAILED', 'Send the CV as multipart/form-data', 415);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new ApiProblem('VALIDATION_FAILED', 'Could not read the uploaded form', 400);
  }
  const files = form.getAll('file');
  const file = files[0];
  if (files.length !== 1 || !(file instanceof File)) {
    throw new ApiProblem('VALIDATION_FAILED', 'Attach exactly one file in the "file" field', 400);
  }

  // Stored now; text extraction runs as a background task (the page polls `task`).
  const { resume, task } = await uploadResume(auth.userId, file, logger);
  return Response.json({ resume, task }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
});
