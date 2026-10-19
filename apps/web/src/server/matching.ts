import type { JobPostingDetail, MatchAnalysis, UserId } from '@job-agent/shared';
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
