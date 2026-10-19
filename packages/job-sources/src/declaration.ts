import { isoTimestampSchema } from '@job-agent/shared';
import { z } from 'zod';

/**
 * Every job source declares what the system is allowed to do with it. The policy engine reads
 * these declarations server-side; a connector cannot grant itself more than it declares.
 */
export const SOURCE_IDS = [
  'indeed',
  'linkedin',
  'naukri',
  'naukri_gulf',
  'company_career_page',
  // Discovery through published job-search APIs (D-049).
  'jsearch',
  'greenhouse',
  'lever',
  'ashby',
  'remotive',
] as const;
export const sourceIdSchema = z.enum(SOURCE_IDS);
export type SourceId = z.infer<typeof sourceIdSchema>;

export const discoveryMethodSchema = z.enum([
  /** Documented API with credentials issued to us. */
  'official_api',
  /** Public, unauthenticated job-board API published by the platform (e.g. some ATS vendors). */
  'public_job_board_api',
  'rss_feed',
  /** The user browses; the extension reads the page they are looking at. */
  'user_assisted_browser',
  /** The user pastes a job link. */
  'manual_link',
  'none',
]);

export const applyMethodSchema = z.enum([
  'external_redirect',
  'on_platform_form',
  'ats_form',
  'email',
]);

export const sourceDeclarationSchema = z.object({
  sourceId: sourceIdSchema,
  displayName: z.string(),
  /** ISO 3166-1 alpha-2 country codes. */
  countries: z.array(z.string().length(2)).min(1),
  implementationStatus: z.enum(['planned', 'experimental', 'active', 'disabled']),
  discovery: z.array(discoveryMethodSchema).min(1),
  applyMethods: z.array(applyMethodSchema),
  automation: z.object({
    autoFillPermitted: z.boolean(),
    autoSubmitPermitted: z.boolean(),
  }),
  requiresUserSession: z.boolean(),
  rateLimit: z
    .object({
      requestsPerMinute: z.number().int().positive(),
      requestsPerDay: z.number().int().positive(),
    })
    .nullable(),
  policyReview: z.object({
    status: z.enum(['not_reviewed', 'reviewed']),
    reviewedAt: isoTimestampSchema.nullable(),
    /** What was checked (terms of service, robots.txt, API terms) and the conclusion. */
    notes: z.string(),
  }),
});
export type SourceDeclaration = z.infer<typeof sourceDeclarationSchema>;

/** Returns problems with a declaration; an empty list means it is internally consistent. */
export function declarationProblems(declaration: SourceDeclaration): string[] {
  const problems: string[] = [];
  const { automation, policyReview } = declaration;
  if (
    (automation.autoFillPermitted || automation.autoSubmitPermitted) &&
    policyReview.status !== 'reviewed'
  ) {
    problems.push('Automation cannot be permitted before the source policy has been reviewed');
  }
  if (automation.autoSubmitPermitted && !automation.autoFillPermitted) {
    problems.push('Auto-submit requires auto-fill to be permitted');
  }
  if (policyReview.status === 'reviewed' && policyReview.reviewedAt === null) {
    problems.push('A reviewed declaration needs a review date');
  }
  if (declaration.implementationStatus === 'active' && declaration.rateLimit === null) {
    problems.push('An active connector must declare a rate limit');
  }
  return problems;
}
