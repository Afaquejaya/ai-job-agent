import type { RawJobPosting } from '@job-agent/job-sources';
import type { Result, UserId } from '@job-agent/shared';
import type { NormalizedJob } from './normalized-job';

export interface NormalizationIssue {
  field: string;
  problem: 'missing' | 'unparseable' | 'suspicious';
  detail: string;
}

export interface JobNormalizer {
  normalize(raw: RawJobPosting): Result<NormalizedJob, NormalizationIssue[]>;
}

export interface DuplicateMatch {
  existingJobId: string;
  /** `exact`: same fingerprint. `probable`: fuzzy match above threshold. */
  confidence: 'exact' | 'probable';
  reason: string;
}

export interface Deduplicator {
  findDuplicate(userId: UserId, job: NormalizedJob): Promise<DuplicateMatch | null>;
}

export interface Freshness {
  status: 'fresh' | 'stale' | 'expired' | 'unknown';
  reason: string;
}

export interface FreshnessChecker {
  check(job: NormalizedJob, now: Date): Promise<Freshness>;
}

export type MatchFactor =
  'skills' | 'experience' | 'seniority' | 'location' | 'work_authorization' | 'salary' | 'language';

/**
 * Explainable match. Every factor cites evidence from the CV and the job, so the user can see
 * why a job was ranked. `unknown` means the CV does not say - never a guess.
 */
export interface MatchResult {
  /** 0-100. */
  score: number;
  recommendation: 'strong' | 'possible' | 'weak' | 'ineligible';
  factors: Array<{
    factor: MatchFactor;
    assessment: 'meets' | 'partial' | 'missing' | 'unknown';
    weight: number;
    evidence: string;
  }>;
  gaps: string[];
}

/** Compact view of the candidate profile used for matching (built from the verified profile). */
export interface CandidateProfileSummary {
  profileId: string;
  cvVersionId: string;
  skills: string[];
  yearsOfExperience: number | null;
  preferredLocations: string[];
  workAuthorization: Array<{
    countryCode: string;
    status: 'citizen' | 'resident' | 'visa' | 'needs_sponsorship';
  }>;
}

export interface JobMatcher {
  match(
    profile: CandidateProfileSummary,
    job: NormalizedJob,
    signal: AbortSignal,
  ): Promise<MatchResult>;
}
