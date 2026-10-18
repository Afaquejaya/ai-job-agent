export interface SignUpPolicyInput {
  email: string;
  /** Raw AUTH_SIGNUP_ALLOWED_EMAILS value (comma-separated). */
  allowedEmails: string | undefined;
  isProduction: boolean;
}

/**
 * This is a personal agent, so account creation is closed by default in production.
 * - Allow-list set: only those emails may sign up (case-insensitive).
 * - Allow-list empty: anyone may sign up in development/test; nobody in production.
 */
export function isSignUpAllowed({
  email,
  allowedEmails,
  isProduction,
}: SignUpPolicyInput): boolean {
  const allowed = (allowedEmails ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length === 0) return !isProduction;
  return allowed.includes(email.trim().toLowerCase());
}
