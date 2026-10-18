import { z } from 'zod';
import { isoTimestampSchema } from './time';

/**
 * Status of a dependency as reported by a health endpoint.
 * - `up` / `down`: a real connectivity probe ran.
 * - `not_configured`: the connection variable is empty.
 * - `not_checked`: configured, but no probe exists yet. Phase 1 reports this instead of
 *   claiming a dependency is healthy without checking it.
 */
export const dependencyStatusSchema = z.enum(['up', 'down', 'not_configured', 'not_checked']);
export type DependencyStatus = z.infer<typeof dependencyStatusSchema>;

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded', 'down']),
  service: z.enum(['web', 'worker', 'browser-agent']),
  version: z.string(),
  timestamp: isoTimestampSchema,
  uptimeSeconds: z.number().nonnegative(),
  dependencies: z.record(z.string(), dependencyStatusSchema),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const readinessResponseSchema = z.object({
  ready: z.boolean(),
  reason: z.string().optional(),
});
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
