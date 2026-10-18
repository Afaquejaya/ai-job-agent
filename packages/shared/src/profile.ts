import { z } from 'zod';
import { countryCodeSchema } from './settings';

/**
 * Candidate profile contract. Every field is nullable: null means "not provided / unknown".
 * Nothing is ever inferred - values come only from the user (typed in, or a CV suggestion the
 * user explicitly accepted).
 */

const text = (max: number) => z.string().trim().min(1).max(max);
const yearMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');
const isoDate = z.iso.date();

export const currencyCodeSchema = z.string().regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code');

/** International format without spaces, e.g. +919876543210 (E.164: 8-15 digits). */
export const phoneSchema = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, 'Use international format, e.g. +919876543210');

export const locationSchema = z
  .object({ city: text(100).nullable(), countryCode: countryCodeSchema })
  .strict();

export const preferredLocationSchema = z
  .object({
    city: text(100).nullable(),
    countryCode: countryCodeSchema,
    remoteOk: z.boolean().nullable(),
  })
  .strict();

export const educationSchema = z
  .object({
    institution: text(200),
    degree: text(200).nullable(),
    fieldOfStudy: text(200).nullable(),
    startDate: yearMonth.nullable(),
    endDate: yearMonth.nullable(),
    grade: text(50).nullable(),
  })
  .strict();

export const workExperienceSchema = z
  .object({
    company: text(200),
    title: text(200),
    startDate: yearMonth,
    endDate: yearMonth.nullable(),
    current: z.boolean(),
    location: text(200).nullable(),
    summary: text(2000).nullable(),
  })
  .strict()
  .refine((job) => !(job.current && job.endDate), 'A current role has no end date')
  .refine((job) => !job.endDate || job.endDate >= job.startDate, 'End date is before start date');

export const SKILL_LEVELS = ['beginner', 'intermediate', 'advanced', 'expert'] as const;
export const skillSchema = z
  .object({
    name: text(100),
    level: z.enum(SKILL_LEVELS).nullable(),
    years: z.number().int().min(0).max(60).nullable(),
  })
  .strict();

export const certificationSchema = z
  .object({
    name: text(200),
    issuer: text(200).nullable(),
    issuedOn: yearMonth.nullable(),
    expiresOn: yearMonth.nullable(),
    credentialId: text(100).nullable(),
  })
  .strict();

export const LANGUAGE_PROFICIENCIES = ['native', 'fluent', 'professional', 'basic'] as const;
export const languageSchema = z
  .object({ language: text(100), proficiency: z.enum(LANGUAGE_PROFICIENCIES) })
  .strict();

export const WORK_AUTHORIZATION_STATUSES = [
  'citizen',
  'permanent_resident',
  'work_visa',
  'needs_sponsorship',
  'unknown',
] as const;
export const workAuthorizationSchema = z
  .object({
    countryCode: countryCodeSchema,
    status: z.enum(WORK_AUTHORIZATION_STATUSES),
    validUntil: isoDate.nullable(),
  })
  .strict();

export const noticePeriodSchema = z
  .object({
    days: z.number().int().min(0).max(365).nullable(),
    negotiable: z.boolean().nullable(),
  })
  .strict();

export const EMPLOYMENT_TYPES = [
  'full_time',
  'part_time',
  'contract',
  'internship',
  'temporary',
] as const;
export const WORKPLACE_TYPES = ['onsite', 'hybrid', 'remote'] as const;
export const employmentPreferencesSchema = z
  .object({
    employmentTypes: z.array(z.enum(EMPLOYMENT_TYPES)).max(EMPLOYMENT_TYPES.length),
    workplaceTypes: z.array(z.enum(WORKPLACE_TYPES)).max(WORKPLACE_TYPES.length),
    willingToRelocate: z.boolean().nullable(),
    earliestStartDate: isoDate.nullable(),
  })
  .strict();

function uniqueBy<T>(items: T[], key: (item: T) => string): boolean {
  const keys = items.map((item) => key(item).toLowerCase());
  return new Set(keys).size === keys.length;
}

const profileFieldShape = {
  fullName: text(200).nullable(),
  preferredName: text(200).nullable(),
  email: z.email().max(254).nullable(),
  phone: phoneSchema.nullable(),
  currentLocation: locationSchema.nullable(),
  preferredLocations: z.array(preferredLocationSchema).max(20).nullable(),
  professionalSummary: text(3000).nullable(),
  totalExperienceMonths: z.number().int().min(0).max(720).nullable(),
  currentRole: text(200).nullable(),
  education: z.array(educationSchema).max(20).nullable(),
  workExperience: z.array(workExperienceSchema).max(50).nullable(),
  skills: z
    .array(skillSchema)
    .max(100)
    .refine((skills) => uniqueBy(skills, (s) => s.name), 'Skill names must be unique')
    .nullable(),
  certifications: z.array(certificationSchema).max(50).nullable(),
  languages: z
    .array(languageSchema)
    .max(20)
    .refine((langs) => uniqueBy(langs, (l) => l.language), 'Languages must be unique')
    .nullable(),
  workAuthorization: z
    .array(workAuthorizationSchema)
    .max(30)
    .refine((items) => uniqueBy(items, (w) => w.countryCode), 'One entry per country')
    .nullable(),
  noticePeriod: noticePeriodSchema.nullable(),
  expectedSalary: z
    .number()
    .min(0)
    .max(10_000_000_000)
    // Tolerance: n * 100 is not exact in floating point (1234567.89 * 100 = 123456788.99999999).
    .refine((n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6, 'At most 2 decimal places')
    .nullable(),
  salaryCurrency: currencyCodeSchema.nullable(),
  employmentPreferences: employmentPreferencesSchema.nullable(),
};

export const PROFILE_FIELDS = Object.keys(profileFieldShape) as Array<
  keyof typeof profileFieldShape
>;
export type ProfileField = (typeof PROFILE_FIELDS)[number];

const profileFieldsSchema = z.object(profileFieldShape).strict();

/** A complete profile. Cross-field rules apply to the merged result of every update. */
export const candidateProfileFieldsSchema = profileFieldsSchema.superRefine((profile, ctx) => {
  if (profile.expectedSalary !== null && profile.salaryCurrency === null) {
    ctx.addIssue({
      code: 'custom',
      path: ['salaryCurrency'],
      message: 'Choose a currency for the expected salary',
    });
  }
});
export type CandidateProfileFields = z.infer<typeof profileFieldsSchema>;

/** `GET /api/profile` response body (`profile`). `updatedAt` is null until first saved. */
export type CandidateProfile = CandidateProfileFields & { updatedAt: string | null };

/** `PATCH /api/profile` body: any subset of fields; unknown fields are rejected. */
export const candidateProfileUpdateSchema = profileFieldsSchema
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to change');
export type CandidateProfileUpdate = z.infer<typeof candidateProfileUpdateSchema>;

export const EMPTY_PROFILE_FIELDS: CandidateProfileFields = Object.fromEntries(
  PROFILE_FIELDS.map((field) => [field, null]),
) as CandidateProfileFields;
