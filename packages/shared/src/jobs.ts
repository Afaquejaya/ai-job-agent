import { z } from 'zod';

/**
 * Jobs the user pasted (Phase 2C). A job link is stored as a reference only - it is never
 * fetched. The description is the exact text the user pasted.
 */

const httpUrl = z
  .url()
  .max(2000)
  .refine((url) => /^https?:\/\//i.test(url), 'Use an http(s) link');

export const JOB_DESCRIPTION_LIMITS = { min: 200, max: 30_000 } as const;

export const jobPostingInputSchema = z
  .object({
    url: httpUrl.nullable(),
    title: z.string().trim().min(1).max(200),
    company: z.string().trim().min(1).max(200),
    location: z.string().trim().min(1).max(200).nullable(),
    description: z
      .string()
      .trim()
      .min(JOB_DESCRIPTION_LIMITS.min, 'Paste the full job description (at least 200 characters)')
      .max(JOB_DESCRIPTION_LIMITS.max),
  })
  .strict();
export type JobPostingInput = z.infer<typeof jobPostingInputSchema>;

/** Factors assessed in a match, with the weight each carries in the score (sums to 100). */
export const MATCH_FACTOR_WEIGHTS = {
  skills: 30,
  experience: 20,
  seniority: 10,
  education: 10,
  location: 10,
  work_authorization: 10,
  salary: 5,
  language: 5,
} as const;
export type MatchFactor = keyof typeof MATCH_FACTOR_WEIGHTS;
export const MATCH_FACTORS = Object.keys(MATCH_FACTOR_WEIGHTS) as MatchFactor[];

export const MATCH_ASSESSMENTS = ['meets', 'partial', 'missing', 'unknown'] as const;
export type MatchAssessment = (typeof MATCH_ASSESSMENTS)[number];

export const MATCH_RECOMMENDATIONS = [
  'strong',
  'possible',
  'weak',
  'ineligible',
  'insufficient_information',
] as const;
export type MatchRecommendation = (typeof MATCH_RECOMMENDATIONS)[number];

/** One assessed factor after the server-side evidence check. */
export interface MatchFactorResult {
  factor: MatchFactor;
  assessment: MatchAssessment;
  /** The job explicitly marks this requirement as mandatory (quoted in jobEvidence). */
  mandatory: boolean;
  /** Exact quote from the job description, or null. */
  jobEvidence: string | null;
  /** Exact quote from the CV or profile, or null. */
  cvEvidence: string | null;
  explanation: string;
  weight: number;
  /** True when every quote was found verbatim in its source. */
  evidenceVerified: boolean;
  /** Why the server changed the model's assessment, if it did. */
  note: string | null;
}

/** `GET /api/jobs/:id` match card. The score is computed by our code, not by the model. */
export interface MatchAnalysis {
  id: string;
  jobPostingId: string;
  resumeId: string | null;
  resumeVersion: number | null;
  /** 0-100, or null when too little could be assessed. */
  score: number | null;
  recommendation: MatchRecommendation;
  factors: MatchFactorResult[];
  gaps: string[];
  summary: string;
  model: string;
  createdAt: string;
}

/** Instant, AI-free pre-score: which skills the job names that the CV also mentions. */
export interface SkillsOverlap {
  /** Share of the job's recognised skills found in the CV, 0-100. */
  score: number;
  matched: string[];
  missing: string[];
}

export interface JobPostingSummary {
  id: string;
  url: string | null;
  title: string;
  company: string;
  location: string | null;
  /** Where it came from: manual_paste, or a search source id such as greenhouse (D-049). */
  source?: string;
  createdAt: string;
  latestMatch: {
    score: number | null;
    recommendation: MatchRecommendation;
    createdAt: string;
  } | null;
  /** Filled by the web app when the user has a readable CV. */
  skillsOverlap?: SkillsOverlap | null;
}

export interface JobPostingDetail extends JobPostingSummary {
  description: string;
  match: MatchAnalysis | null;
}

/** What a job search looks for; the plan suggested from the CV, edited by the user (D-049). */
export const jobSearchRequestSchema = z
  .object({
    keywords: z.array(z.string().trim().min(2).max(60)).min(1).max(3),
    countries: z
      .array(
        z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[A-Z]{2}$/),
      )
      .min(1)
      .max(7),
    remoteOk: z.boolean(),
  })
  .strict();
export type JobSearchRequestInput = z.infer<typeof jobSearchRequestSchema>;

export interface JobSearchSourceStatus {
  id: string;
  name: string;
  enabled: boolean;
  note: string;
}

export interface JobSearchSuggestion {
  plan: (JobSearchRequestInput & { topSkills: string[] }) | null;
  sources: JobSearchSourceStatus[];
}
