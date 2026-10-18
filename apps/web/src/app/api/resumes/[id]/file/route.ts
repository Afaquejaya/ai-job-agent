import { requireUuid, withAuth } from '@/server/api';
import { readResumeFile } from '@/server/resumes';

export const dynamic = 'force-dynamic';

/** ASCII-only fallback name for the Content-Disposition header. */
function asciiFilename(name: string): string {
  return name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
}

/** GET /api/resumes/:id/file - the original file, owner only, always as a download. */
export const GET = withAuth<{ id: string }>(async (_request, { auth, params }) => {
  const file = await readResumeFile(auth.userId, requireUuid(params.id, 'Resume'));
  const disposition =
    `attachment; filename="${asciiFilename(file.filename)}"; ` +
    `filename*=UTF-8''${encodeURIComponent(file.filename)}`;
  return new Response(new Blob([new Uint8Array(file.bytes)]), {
    headers: {
      'Content-Type': file.mimeType,
      'Content-Length': String(file.bytes.length),
      'Content-Disposition': disposition,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  });
});
