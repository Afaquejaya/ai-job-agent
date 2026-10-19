import { randomUUID } from 'node:crypto';
import { ConflictError, DomainValidationError, NotFoundError } from '@job-agent/database';
import { createJsonLogger, type Logger } from '@job-agent/observability';
import type { AuthContext } from '@job-agent/security';
import {
  AiConsentRequiredError,
  AiUnavailableError,
  MatchAnalysisError,
} from '@job-agent/services';
import type { ApiError, ApiErrorCode } from '@job-agent/shared';
import type { z } from 'zod';
import { ConfigurationError, getWebEnv } from './env';

/**
 * API foundation shared by every private route handler:
 * request id, authentication, same-origin check for writes, body validation, the standard
 * error envelope, and one structured log line per request.
 */

/** An expected failure with a client-facing code and message (e.g. 413, 429). */
export class ApiProblem extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiProblem';
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Route ids that are not UUIDs can never exist, so they are reported as not found. */
export function requireUuid(id: string | undefined, entity: string): string {
  if (!id || !UUID_PATTERN.test(id)) throw new NotFoundError(entity);
  return id;
}

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

export interface RouteContext<P = Record<string, never>> {
  auth: AuthContext;
  requestId: string;
  logger: Logger;
  /** Dynamic route segments, e.g. `{ id }` for /api/resumes/[id]. */
  params: P;
}

export type AuthenticatedHandler<P = Record<string, never>> = (
  request: Request,
  context: RouteContext<P>,
) => Promise<Response>;

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

/** Maps an error to the API envelope. Unexpected errors never leak details to the client. */
function errorResponse(error: unknown, requestId: string, logger: Logger): Response {
  if (error instanceof ApiProblem) {
    return apiError(error.code, error.message, error.status, requestId, error.details);
  }
  if (error instanceof RequestValidationError) {
    return apiError('VALIDATION_FAILED', 'Invalid request', 400, requestId, error.issues);
  }
  if (error instanceof DomainValidationError) {
    return apiError('VALIDATION_FAILED', 'Invalid request', 400, requestId, error.issues);
  }
  if (error instanceof NotFoundError) {
    return apiError('NOT_FOUND', `${error.entity} not found`, 404, requestId);
  }
  if (error instanceof AiUnavailableError) {
    return apiError('AI_UNAVAILABLE', error.message, 503, requestId);
  }
  if (error instanceof AiConsentRequiredError) {
    return apiError('FORBIDDEN', error.message, 403, requestId, { reason: 'consent_required' });
  }
  if (error instanceof MatchAnalysisError) {
    return apiError('AI_FAILED', error.message, 422, requestId);
  }
  if (error instanceof ConflictError) {
    return apiError('CONFLICT', error.message, 409, requestId, error.details);
  }
  if (error instanceof ConfigurationError) {
    logger.error('api.not_configured', { error });
    return apiError('INTERNAL', 'Service is not configured', 503, requestId);
  }
  logger.error('api.unhandled_error', { error });
  return apiError('INTERNAL', 'Something went wrong', 500, requestId);
}

export function withAuth<P extends Record<string, string> = Record<string, never>>(
  handler: AuthenticatedHandler<P>,
  dependencies: WithAuthDependencies = defaultDependencies,
): (request: Request, routeContext?: { params: Promise<P> }) => Promise<Response> {
  return async (request, routeContext) => {
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
          const params = (routeContext ? await routeContext.params : {}) as P;
          response = await handler(request, { auth, requestId, logger, params });
        }
      }
    } catch (error) {
      response = errorResponse(error, requestId, logger);
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
