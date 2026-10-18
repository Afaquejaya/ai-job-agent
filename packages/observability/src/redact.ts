export const REDACTED = '[REDACTED]';

/**
 * Keys are normalized (lower-case, alphanumerics only) and redacted when they END with one of
 * these. `accessToken` and `api_key` are redacted; `inputTokens` and `tokenCount` are not.
 */
const SENSITIVE_KEY_SUFFIXES = [
  'password',
  'passwd',
  'secret',
  'apikey',
  'token',
  'authorization',
  'cookie',
  'cookies',
  'privatekey',
  'credential',
  'credentials',
  'otp',
];

const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const MAX_DEPTH = 8;

export function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return SENSITIVE_KEY_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

/** Masks bearer tokens and email addresses inside free text. */
export function redactString(value: string): string {
  return value.replace(BEARER_PATTERN, `Bearer ${REDACTED}`).replace(EMAIL_PATTERN, '[EMAIL]');
}

/**
 * Returns a copy of `value` that is safe to log: secret-looking keys are replaced, and
 * bearer tokens / email addresses inside strings are masked. Callers should still log
 * identifiers rather than personal content (CV text, answers, messages).
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[MaxDepth]';
  if (typeof value === 'string') return redactString(value);
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message) };
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = isSensitiveKey(key) ? REDACTED : redact(inner, depth + 1);
    }
    return out;
  }
  return value;
}
