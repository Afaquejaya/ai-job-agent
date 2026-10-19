import { BudgetExceededError } from '@job-agent/agent-core';
import { ProviderError } from '@job-agent/ai-providers';
import {
  createCandidateProfileRepository,
  createJobRepository,
  type Database,
  type JobMatchRecord,
} from '@job-agent/database';
import { analyzeJobMatch } from '@job-agent/job-processing';
import type { DataCipher } from '@job-agent/security';
import type {
  CandidateProfile,
  JobPostingDetail,
  MatchAnalysis,
  MatchFactorResult,
  MatchRecommendation,
  UserId,
} from '@job-agent/shared';
import type { AiRuntime } from './ai';
import type { ResumeService } from './resumes';

/**
 * A match analysis could not be produced; the message is safe to show. `retryable` says
 * whether trying again later can help (AI temporarily unavailable) or not (no CV uploaded).
 */
export class MatchAnalysisError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'MatchAnalysisError';
  }
}

const matchContext = (userId: string, jobId: string) => `job-match:${userId}:${jobId}`;

interface StoredMatchResult {
  factors: MatchFactorResult[];
  gaps: string[];
  summary: string;
}

/** Profile values as plain lines, so CV-side quotes can also be checked against the profile. */
export function profileToText(profile: CandidateProfile): string {
  return Object.entries(profile)
    .filter(([key, value]) => key !== 'updatedAt' && value !== null)
    .map(
      ([key, value]) =>
        `${key}: ${typeof value === 'string' || typeof value === 'number' ? value : JSON.stringify(value)}`,
    )
    .join('\n');
}

export function createMatchingService(deps: {
  db: Database;
  cipher: DataCipher;
  ai: AiRuntime;
  resumes: ResumeService;
}) {
  const { db, cipher, ai, resumes } = deps;

  function toMatchAnalysis(userId: UserId, row: JobMatchRecord): MatchAnalysis {
    const stored = JSON.parse(
      cipher.decryptText(row.resultEncrypted, matchContext(userId, row.jobPostingId)),
    ) as StoredMatchResult;
    return {
      id: row.id,
      jobPostingId: row.jobPostingId,
      resumeId: row.resumeId,
      resumeVersion: row.resumeVersion,
      score: row.score,
      recommendation: row.recommendation as MatchRecommendation,
      factors: stored.factors,
      gaps: stored.gaps,
      summary: stored.summary,
      model: row.model,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /**
   * Runs and stores an evidence-checked match analysis for one saved job against the primary
   * CV and the profile. Requires AI consent and budget; every model call is recorded.
   */
  async function run(
    userId: UserId,
    jobId: string,
    options: { signal: AbortSignal; conversationId: string | null },
  ): Promise<MatchAnalysis> {
    const ready = await ai.requireReady(userId);
    const jobs = createJobRepository(db);
    const job = await jobs.require(userId, jobId);
    const cv = await resumes.primaryText(userId);
    if (!cv) {
      throw new MatchAnalysisError(
        'Upload a CV with readable text first (CVs page), then try again.',
      );
    }
    const profile = await createCandidateProfileRepository(db).getForUser(userId);

    try {
      await ai.budgetGuard(userId, ready.budgetUsd)();
    } catch (error) {
      if (error instanceof BudgetExceededError) throw new MatchAnalysisError(error.message);
      throw error;
    }

    const usage = ai.usageRecorder(userId, options.conversationId, 'job_matching');
    let result: Awaited<ReturnType<typeof analyzeJobMatch>>;
    try {
      result = await analyzeJobMatch(
        ready.provider,
        {
          cvText: cv.text,
          profileText: profileToText(profile),
          job: { title: job.title, company: job.company, description: job.description },
        },
        { model: ready.model, signal: options.signal, timeoutMs: ready.limits.analysisTimeoutMs },
      );
    } catch (error) {
      // Adapter messages are safe to show and say what to fix (e.g. "Ollama is not running").
      if (error instanceof ProviderError) {
        throw new MatchAnalysisError(error.message, error.canFallback, error.retryAfterMs);
      }
      throw error;
    }
    await usage.record(result.usage, result.model, result.match !== null);
    // A small model sometimes returns an unusable answer; another try can succeed.
    if (!result.match) throw new MatchAnalysisError(result.failure ?? 'The analysis failed.', true);

    const stored: StoredMatchResult = {
      factors: result.match.factors,
      gaps: result.match.gaps,
      summary: result.match.summary,
    };
    const row = await jobs.saveMatch(userId, {
      jobPostingId: job.id,
      resumeId: cv.resumeId,
      resumeVersion: cv.version,
      model: result.model.model,
      score: result.match.score,
      recommendation: result.match.recommendation,
      resultEncrypted: cipher.encryptText(JSON.stringify(stored), matchContext(userId, job.id)),
    });
    return toMatchAnalysis(userId, row);
  }

  async function jobDetail(userId: UserId, jobId: string): Promise<JobPostingDetail> {
    const row = await createJobRepository(db).require(userId, jobId);
    const latest = row.matches[0];
    return {
      id: row.id,
      url: row.url,
      title: row.title,
      company: row.company,
      location: row.location,
      description: row.description,
      createdAt: row.createdAt.toISOString(),
      latestMatch: latest
        ? {
            score: latest.score,
            recommendation: latest.recommendation as MatchRecommendation,
            createdAt: latest.createdAt.toISOString(),
          }
        : null,
      match: latest ? toMatchAnalysis(userId, latest) : null,
    };
  }

  return { run, jobDetail, toMatchAnalysis };
}

export type MatchingService = ReturnType<typeof createMatchingService>;
