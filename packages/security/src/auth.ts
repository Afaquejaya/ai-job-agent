import type { UserId } from '@job-agent/shared';

/** The authenticated caller. Every private read/write is scoped by `userId`. */
export interface AuthContext {
  readonly userId: UserId;
  readonly sessionId: string;
  readonly authenticatedAt: Date;
  /** How the caller authenticated; browser agents use a device credential, not a session. */
  readonly method: 'session' | 'browser_agent' | 'extension';
}

/** Implemented with the chosen auth library in Phase 2. Returns null when unauthenticated. */
export interface Authenticator {
  authenticate(request: Request): Promise<AuthContext | null>;
}

export class AuthenticationError extends Error {
  readonly code = 'UNAUTHENTICATED' as const;
  constructor(message = 'Authentication required') {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends Error {
  readonly code = 'FORBIDDEN' as const;
  constructor(message = 'Not allowed') {
    super(message);
    this.name = 'AuthorizationError';
  }
}

/**
 * Defense in depth: repositories already filter by user id, and this check runs again on any
 * record loaded by id before it is returned or acted on. The error does not reveal whether
 * the record exists for someone else.
 */
export function assertOwnership(context: AuthContext, ownerId: string): void {
  if (context.userId !== ownerId) throw new AuthorizationError();
}
