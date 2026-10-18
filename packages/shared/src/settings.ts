import { z } from 'zod';
import { isoTimestampSchema, timeZoneSchema } from './time';

/**
 * How far the agent may go on its own when submitting applications.
 * See docs/architecture/security-and-permissions.md for how each mode is enforced.
 */
export const SUBMISSION_MODES = ['manual_only', 'approve_each', 'auto_where_permitted'] as const;
export const submissionModeSchema = z.enum(SUBMISSION_MODES);
export type SubmissionMode = z.infer<typeof submissionModeSchema>;

export const MAX_DAILY_APPLICATION_LIMIT = 50;
export const MAX_TARGET_COUNTRIES = 30;

/** ISO 3166-1 alpha-2 country code, upper case (e.g. `IN`, `AE`). */
export const countryCodeSchema = z.string().regex(/^[A-Z]{2}$/, 'Use a two-letter country code');

const targetCountriesSchema = z
  .array(countryCodeSchema)
  .max(MAX_TARGET_COUNTRIES)
  .refine((codes) => new Set(codes).size === codes.length, 'Country codes must be unique');

/** Settings as returned by `GET /api/settings`. */
export const userSettingsSchema = z.object({
  timeZone: timeZoneSchema,
  submissionMode: submissionModeSchema,
  dailyApplicationLimit: z.number().int().min(0).max(MAX_DAILY_APPLICATION_LIMIT),
  targetCountries: targetCountriesSchema,
  /** When the user allowed sending CV/profile data to the AI provider; null = not allowed. */
  aiProcessingConsentAt: isoTimestampSchema.nullable(),
  updatedAt: isoTimestampSchema,
});
export type UserSettings = z.infer<typeof userSettingsSchema>;

/** Body of `PATCH /api/settings`: any subset of fields; unknown fields are rejected. */
export const userSettingsUpdateSchema = userSettingsSchema
  .omit({ updatedAt: true, aiProcessingConsentAt: true })
  .extend({ aiProcessingConsent: z.boolean() })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one setting to change');
export type UserSettingsUpdate = z.infer<typeof userSettingsUpdateSchema>;

/** Countries offered in the settings UI: India and the GCC. */
export const TARGET_REGION_COUNTRIES: ReadonlyArray<{ code: string; name: string }> = [
  { code: 'IN', name: 'India' },
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'SA', name: 'Saudi Arabia' },
  { code: 'QA', name: 'Qatar' },
  { code: 'KW', name: 'Kuwait' },
  { code: 'BH', name: 'Bahrain' },
  { code: 'OM', name: 'Oman' },
];
