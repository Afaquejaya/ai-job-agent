import { isoTimestampSchema } from '@job-agent/shared';
import { sourceIdSchema } from '@job-agent/job-sources';
import { z } from 'zod';

/** Source-independent job record. One NormalizedJob can be seen on several sources. */
export const normalizedJobSchema = z.object({
  title: z.string().min(1),
  company: z.string().min(1),
  locations: z.array(
    z.object({
      countryCode: z.string().length(2),
      city: z.string().nullable(),
    }),
  ),
  workplace: z.enum(['onsite', 'hybrid', 'remote', 'unknown']),
  employmentType: z.enum([
    'full_time',
    'part_time',
    'contract',
    'internship',
    'temporary',
    'unknown',
  ]),
  description: z.string(),
  salary: z
    .object({
      min: z.number().nonnegative().nullable(),
      max: z.number().nonnegative().nullable(),
      currency: z.string().length(3),
      period: z.enum(['year', 'month', 'hour']),
    })
    .nullable(),
  postedAt: isoTimestampSchema.nullable(),
  applyUrl: z.url(),
  sightings: z
    .array(
      z.object({
        sourceId: sourceIdSchema,
        externalId: z.string(),
        url: z.url(),
        fetchedAt: isoTimestampSchema,
      }),
    )
    .min(1),
  /** Stable hash of normalized company + title + location, used for duplicate detection. */
  fingerprint: z.string().min(1),
});
export type NormalizedJob = z.infer<typeof normalizedJobSchema>;
