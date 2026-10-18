import { apiErrorSchema } from '@job-agent/shared';

export interface ApiFailure {
  status: number;
  code: string;
  message: string;
  /** Field-level problems for VALIDATION_FAILED, when the server provides them. */
  issues: Array<{ path: string; message: string }>;
  details: unknown;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiFailure };

/** Calls our own API and normalises the standard error envelope. */
export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    return {
      ok: false,
      error: {
        status: 0,
        code: 'NETWORK',
        message: 'Network error. Check your connection.',
        issues: [],
        details: null,
      },
    };
  }
  if (response.status === 204) return { ok: true, data: undefined as T };

  const body: unknown = await response.json().catch(() => null);
  if (response.ok) return { ok: true, data: body as T };

  const parsed = apiErrorSchema.safeParse(body);
  const details = parsed.success ? parsed.data.error.details : null;
  const issues = Array.isArray(details)
    ? (details as Array<{ path?: string; message?: string }>).map((i) => ({
        path: i.path ?? '',
        message: i.message ?? '',
      }))
    : [];
  return {
    ok: false,
    error: {
      status: response.status,
      code: parsed.success ? parsed.data.error.code : 'UNKNOWN',
      message: parsed.success ? parsed.data.error.message : `Request failed (${response.status})`,
      issues,
      details,
    },
  };
}

export const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

/** One readable line: field problems when present, otherwise the message. */
export function describeFailure(error: ApiFailure): string {
  if (error.issues.length > 0) {
    return error.issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join(' · ');
  }
  return error.message;
}
