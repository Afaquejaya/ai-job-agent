import { createJobRepository } from '@job-agent/database';
import type { JobPostingDetail, JobPostingSummary, MatchAnalysis, UserId } from '@job-agent/shared';
import { getDatabase } from './db';
import { getServices } from './services';

/** Match analysis for the web app; the logic lives in @job-agent/services (shared with the worker). */

export { MatchAnalysisError, profileToText } from '@job-agent/services';

/** Runs the analysis inline (the agent chat's tool). The Jobs page starts a background task instead. */
export function runMatchAnalysis(
  userId: UserId,
  jobId: string,
  options: { signal: AbortSignal; conversationId: string | null },
): Promise<MatchAnalysis> {
  return getServices().matching.run(userId, jobId, options);
}

export function getJobDetail(userId: UserId, jobId: string): Promise<JobPostingDetail> {
  return getServices().matching.jobDetail(userId, jobId);
}

/** Saved jobs with the instant skills pre-score (no AI) added. */
export async function listJobsWithOverlap(userId: UserId): Promise<JobPostingSummary[]> {
  const db = getDatabase();
  const jobs = await createJobRepository(db).list(userId);
  const texts = await db.jobPosting.findMany({
    where: { userId, id: { in: jobs.map((j) => j.id) } },
    select: { id: true, title: true, description: true },
  });
  const overlap = await getServices().matching.skillsOverlap(userId, texts);
  return jobs.map((job) => ({ ...job, skillsOverlap: overlap.get(job.id) ?? null }));
}
