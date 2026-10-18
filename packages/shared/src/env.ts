import { z } from 'zod';

/**
 * `.env` files commonly contain `NAME=` lines. Treat an empty string as "not set" so that
 * optional variables stay optional instead of failing validation.
 */
export function optionalEnv<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (value === '' ? undefined : value), schema.optional());
}

/** True when an environment variable holds a non-empty value. */
export function isEnvSet(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '';
}
