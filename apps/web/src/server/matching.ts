import { BudgetExceededError } from '@job-agent/agent-core';
import {
  createCandidateProfileRepository,
  createJobRepository,
  type JobMatchRecord,
} from '@job-agent/database';
import { ProviderError } from '@job-agent/ai-providers';
import { analyzeJobMatch } from '@job-agent/job-processing';
import type {
  CandidateProfile,
  JobPostingDetail,
  MatchAnalysis,
  MatchFactorResult,
  MatchRecommendation,
  UserId,
} from '@job-agent/shared';
import { createBudgetGuard, createUsageRecorder, requireAiReady } from './ai';
import { getDatabase } from './db';
import { getPrimaryResumeText } from './resumes';
import { getCipher } from './storage';

/** A match analysis could not be produced; the message is safe to show. */
export class MatchAnalysisError extends Error {
  constructor(message: string) {
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

export function toMatchAnalysis(userId: UserId, row: JobMatchRecord): MatchAnalysis {
  const stored = JSON.parse(
    getCipher().decryptText(row.resultEncrypted, matchContext(userId, row.jobPostingId)),
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
 * Runs and stores an evidence-checked match analysis for one saved job against the primary CV
 * and the profile. Requires AI consent and budget; every model call is recorded.
 */
export async function runMatchAnalysis(
  userId: UserId,
  jobId: string,
  options: { signal: AbortSignal; conversationId: string | null },
): Promise<MatchAnalysis> {
  const ai = await requireAiReady(userId);
  const db = getDatabase();
  const jobs = createJobRepository(db);
  const job = await jobs.require(userId, jobId);
  const cv = await getPrimaryResumeText(userId);
  if (!cv) {
    throw new MatchAnalysisError(
      'Upload a CV with readable text first (CVs page), then try again.',
    );
  }
  const profile = await createCandidateProfileRepository(db).getForUser(userId);

  try {
    await createBudgetGuard(userId, ai.budgetUsd)();
  } catch (error) {
    if (error instanceof BudgetExceededError) throw new MatchAnalysisError(error.message);
    throw error;
  }

  const usage = createUsageRecorder(userId, options.conversationId, 'job_matching');
  let result: Awaited<ReturnType<typeof analyzeJobMatch>>;
  try {
    result = await analyzeJobMatch(
      ai.provider,
      {
        cvText: cv.text,
        profileText: profileToText(profile),
        job: { title: job.title, company: job.company, description: job.description },
      },
      { model: ai.model, signal: options.signal, timeoutMs: ai.limits.analysisTimeoutMs },
    );
  } catch (error) {
    // Adapter messages are safe to show and say what to fix (e.g. "Ollama is not running").
    if (error instanceof ProviderError) throw new MatchAnalysisError(error.message);
    throw error;
  }
  await usage.record(result.usage, result.model, result.match !== null);
  if (!result.match) throw new MatchAnalysisError(result.failure ?? 'The analysis failed.');

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
    resultEncrypted: getCipher().encryptText(JSON.stringify(stored), matchContext(userId, job.id)),
  });
  return toMatchAnalysis(userId, row);
}

export async function getJobDetail(userId: UserId, jobId: string): Promise<JobPostingDetail> {
  const jobs = createJobRepository(getDatabase());
  const row = await jobs.require(userId, jobId);
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
