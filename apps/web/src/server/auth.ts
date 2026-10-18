import { createJsonLogger } from '@job-agent/observability';
import type { AuthContext } from '@job-agent/security';
import type { UserId } from '@job-agent/shared';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { APIError } from 'better-auth/api';
import { getDatabase } from './db';
import { ConfigurationError, getWebEnv } from './env';
import { isSignUpAllowed } from './signup-policy';

const SESSION_DAYS = 7;

function createAuth() {
  const env = getWebEnv();
  if (!env.AUTH_SECRET) {
    throw new ConfigurationError('AUTH_SECRET is not configured (see .env.example)');
  }
  const logger = createJsonLogger({ service: 'web', level: env.LOG_LEVEL });

  return betterAuth({
    appName: 'AI Job Agent',
    baseURL: env.APP_URL,
    secret: env.AUTH_SECRET,
    // Only our own origin may call the auth endpoints with cookies (CSRF protection).
    trustedOrigins: [env.APP_URL],
    database: prismaAdapter(getDatabase(), { provider: 'postgresql' }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      autoSignIn: true,
      // No email provider until Phase 10, so addresses are not verified yet (decision D-018).
      requireEmailVerification: false,
    },
    session: {
      expiresIn: 60 * 60 * 24 * SESSION_DAYS,
      updateAge: 60 * 60 * 24,
    },
    verification: { storeIdentifier: 'hashed' },
    // Stored in Postgres so limits hold across serverless instances. Better Auth enables
    // rate limiting in production by default; these rules tighten the sensitive endpoints.
    rateLimit: {
      storage: 'database',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/sign-up/email': { window: 60 * 60, max: 5 },
      },
    },
    advanced: {
      database: { generateId: 'uuid' },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const allowed = isSignUpAllowed({
              email: user.email,
              allowedEmails: env.AUTH_SIGNUP_ALLOWED_EMAILS,
              isProduction: env.NODE_ENV === 'production',
            });
            if (!allowed) {
              logger.warn('auth.signup_blocked');
              throw new APIError('FORBIDDEN', {
                message: 'Sign-up is not open for this email address.',
              });
            }
          },
          after: async (user) => {
            logger.info('auth.user_created', { userId: user.id });
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as unknown as { jobAgentAuth?: Auth };

/** Created on first use, so builds and health checks work without auth configuration. */
export function getAuth(): Auth {
  globalForAuth.jobAgentAuth ??= createAuth();
  return globalForAuth.jobAgentAuth;
}

/** Resolves the session cookie in `headers` to an AuthContext, or null when signed out. */
export async function getAuthContext(headers: Headers): Promise<AuthContext | null> {
  const result = await getAuth().api.getSession({ headers });
  if (!result) return null;
  return {
    userId: result.user.id as UserId,
    sessionId: result.session.id,
    authenticatedAt: new Date(result.session.createdAt),
    method: 'session',
  };
}
