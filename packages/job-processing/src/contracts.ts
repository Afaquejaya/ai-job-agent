import type { RawJobPosting } from '@job-agent/job-sources';
import type { MatchAnalysis, Result, UserId } from '@job-agent/shared';
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

/**
 * Explainable match results are defined in @job-agent/shared (`MatchAnalysis`,
 * `MatchFactorResult`) and produced by `analyzeJobMatch` in ./match-analysis (Phase 2C).
 */

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
  ): Promise<MatchAnalysis>;
}
