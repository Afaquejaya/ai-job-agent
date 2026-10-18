import { apiError } from '@/server/api';
import { getAuth } from '@/server/auth';
import { ConfigurationError } from '@/server/env';

// Better Auth serves sign-up, sign-in, sign-out and session endpoints under /api/auth/*.
// The instance is created lazily so the app still builds and serves /api/health when
// authentication is not configured.
async function handle(request: Request): Promise<Response> {
  try {
    return await getAuth().handler(request);
  } catch (error) {
    if (error instanceof ConfigurationError) {
      return apiError('INTERNAL', 'Authentication is not configured', 503);
    }
    throw error;
  }
}

export { handle as GET, handle as POST };
