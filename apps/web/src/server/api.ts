import { randomUUID } from 'node:crypto';
import { createJsonLogger, type Logger } from '@job-agent/observability';
import type { AuthContext } from '@job-agent/security';
import type { ApiError, ApiErrorCode } from '@job-agent/shared';
import type { z } from 'zod';
import { ConfigurationError, getWebEnv } from './env';

/**
 * API foundation shared by every private route handler:
 * request id, authentication, same-origin check for writes, body validation, the standard
 * error envelope, and one structured log line per request.
 */

export class RequestValidationError extends Error {
  constructor(readonly issues: Array<{ path: string; message: string }>) {
    super('Request validation failed');
    this.name = 'RequestValidationError';
  }
}

export function apiError(
  code: ApiErrorCode,
  message: string,
  status: number,
  requestId?: string,
  details?: unknown,
): Response {
  const body: ApiError = { error: { code, message, requestId, details } };
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** Parses a JSON body with `schema`. Issues report paths and messages, never input values. */
export async function parseJsonBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new RequestValidationError([{ path: '', message: 'Body must be valid JSON' }]);
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new RequestValidationError(
      result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
  return result.data;
}

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Browsers always send `Origin` on cross-site writes. A write whose Origin differs from the
 * app's own origin is refused (CSRF defence for cookie-authenticated routes).
 */
export function isAllowedOrigin(request: Request, appUrl: string): boolean {
  if (!UNSAFE_METHODS.has(request.method)) return true;
  const origin = request.headers.get('origin');
  return origin === null || origin === new URL(appUrl).origin;
}

export interface RouteContext {
  auth: AuthContext;
  requestId: string;
  logger: Logger;
}

export type AuthenticatedHandler = (request: Request, context: RouteContext) => Promise<Response>;

export interface WithAuthDependencies {
  authenticate: (request: Request) => Promise<AuthContext | null>;
  appUrl: () => string;
  logger: () => Logger;
}

const defaultDependencies: WithAuthDependencies = {
  authenticate: async (request) => {
    const { getAuthContext } = await import('./auth');
    return getAuthContext(request.headers);
  },
  appUrl: () => getWebEnv().APP_URL,
  logger: () => createJsonLogger({ service: 'web', level: getWebEnv().LOG_LEVEL }),
};

export function withAuth(
  handler: AuthenticatedHandler,
  dependencies: WithAuthDependencies = defaultDependencies,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const started = Date.now();
    const requestId = randomUUID();
    let logger = dependencies.logger().child({ requestId });
    let response: Response;

    try {
      if (!isAllowedOrigin(request, dependencies.appUrl())) {
        response = apiError('FORBIDDEN', 'Cross-origin request refused', 403, requestId);
      } else {
        const auth = await dependencies.authenticate(request);
        if (!auth) {
          response = apiError('UNAUTHENTICATED', 'Authentication required', 401, requestId);
        } else {
          logger = logger.child({ userId: auth.userId });
          response = await handler(request, { auth, requestId, logger });
        }
      }
    } catch (error) {
      if (error instanceof RequestValidationError) {
        response = apiError('VALIDATION_FAILED', 'Invalid request', 400, requestId, error.issues);
      } else if (error instanceof ConfigurationError) {
        logger.error('api.not_configured', { error });
        response = apiError('INTERNAL', 'Service is not configured', 503, requestId);
      } else {
        logger.error('api.unhandled_error', { error });
        response = apiError('INTERNAL', 'Something went wrong', 500, requestId);
      }
    }

    response.headers.set('x-request-id', requestId);
    logger.info('api.request', {
      method: request.method,
      path: new URL(request.url).pathname,
      status: response.status,
      durationMs: Date.now() - started,
    });
    return response;
  };
}
