import type { AuthContext } from '@job-agent/security';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAuthContext } from './auth';
import { ConfigurationError } from './env';

/** The signed-in user for a server component, or null (also null when auth is not configured). */
export async function getOptionalUser(): Promise<AuthContext | null> {
  try {
    return await getAuthContext(await headers());
  } catch (error) {
    if (error instanceof ConfigurationError) return null;
    throw error;
  }
}

/**
 * Use at the top of every protected page/layout. Every check happens on the server for each
 * request; there is no client-side-only protection.
 */
export async function requireUser(): Promise<AuthContext> {
  const user = await getOptionalUser();
  if (!user) redirect('/sign-in');
  return user;
}
