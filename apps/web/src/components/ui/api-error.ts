import { apiErrorSchema } from '@job-agent/shared';

/** A readable message from an API error body (validation issues listed by field). */
export function apiErrorMessage(body: unknown, fallback: string): string {
  const error = apiErrorSchema.safeParse(body);
  if (!error.success) return fallback;
  const details = error.data.error.details;
  if (Array.isArray(details) && details.length > 0) {
    return details
      .map(
        (issue: { path?: string; message?: string }) =>
          `${issue.path || 'request'}: ${issue.message}`,
      )
      .join('; ');
  }
  return error.data.error.message;
}

/** The `details.reason` of an API error, e.g. `consent_required`. */
export function apiErrorReason(body: unknown): string | null {
  const error = apiErrorSchema.safeParse(body);
  const details = error.success ? error.data.error.details : null;
  return details && typeof details === 'object' && 'reason' in details
    ? String((details as { reason: unknown }).reason)
    : null;
}
