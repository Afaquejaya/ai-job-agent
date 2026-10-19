import {
  createCandidateProfileRepository,
  createJobRepository,
  type Database,
} from '@job-agent/database';
import { rankDiscoveredJobs, suggestSearchPlan } from '@job-agent/job-processing';
import {
  ConnectorError,
  createCompanyBoardSources,
  createJSearchSource,
  createRemotiveSource,
  parseCompanyBoards,
  type DiscoveredJob,
  type JobSearchRequest,
  type JobSearchSource,
} from '@job-agent/job-sources';
import type { Logger } from '@job-agent/observability';
import {
  JOB_DESCRIPTION_LIMITS,
  optionalEnv,
  type JobSearchSourceStatus,
  type JobSearchSuggestion,
  type UserId,
} from '@job-agent/shared';
import { z } from 'zod';
import type { ResumeService } from './resumes';

/**
 * Job search from the CV (D-049): reads published job-search APIs, keeps listings in the
 * user's countries that are about the searched roles, ranks them by the instant skills
 * pre-score and saves the best new ones to the Jobs list. No AI, no sign-in, no applying.
 */

export const jobSearchEnvShape = {
  /** The user's own JSearch key (RapidAPI). Empty = that source is off. */
  JSEARCH_API_KEY: optionalEnv(z.string().min(10)),
  /** Company boards to read, e.g. "greenhouse:stripe,lever:cred". Empty = the default list. */
  JOB_SEARCH_BOARDS: optionalEnv(z.string().min(3)),
};

export interface JobSearchSettings {
  jsearchApiKey?: string;
  boards?: string;
}

export function jobSearchSettingsFromEnv(env: {
  JSEARCH_API_KEY?: string;
  JOB_SEARCH_BOARDS?: string;
}): JobSearchSettings {
  return { jsearchApiKey: env.JSEARCH_API_KEY, boards: env.JOB_SEARCH_BOARDS };
}

/** Listings below this skills pre-score are not saved. */
export const MIN_SAVE_SCORE = 30;
/** At most this many new jobs are saved per search. */
export const MAX_SAVED_PER_SEARCH = 25;
const SOURCE_TIMEOUT_MS = 60_000;

/** The search could not run at all; the message is safe to show. */
export class JobSearchError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'JobSearchError';
  }
}

export interface JobSearchOutcome {
  found: number;
  relevant: number;
  saved: number;
  alreadySaved: number;
  bestScore: number | null;
  sources: Array<{ id: string; jobs: number; error: string | null }>;
}

const clip = (text: string, max: number) => (text.length > max ? text.slice(0, max) : text);

export function createJobSearchService(deps: {
  db: Database;
  resumes: ResumeService;
  settings: JobSearchSettings;
  fetch?: typeof fetch;
}) {
  const { db, resumes, settings } = deps;
  const fetchImpl = deps.fetch ?? fetch;

  function sources(): JobSearchSource[] {
    return [
      ...(settings.jsearchApiKey ? [createJSearchSource(settings.jsearchApiKey)] : []),
      ...createCompanyBoardSources(parseCompanyBoards(settings.boards)),
      createRemotiveSource(),
    ];
  }

  function sourceStatus(): JobSearchSourceStatus[] {
    const boards = parseCompanyBoards(settings.boards);
    const count = (vendor: string) => boards.filter((b) => b.vendor === vendor).length;
    return [
      {
        id: 'jsearch',
        name: 'JSearch (Google Jobs: LinkedIn, Indeed, Naukri, Naukri Gulf and more)',
        enabled: Boolean(settings.jsearchApiKey),
        note: settings.jsearchApiKey
          ? 'On: up to 3 requests per search from your free monthly quota'
          : 'Off: add JSEARCH_API_KEY to .env to search India and Gulf job sites',
      },
      ...(['greenhouse', 'lever', 'ashby'] as const).map((vendor) => ({
        id: vendor,
        name: `Company career pages (${vendor[0]!.toUpperCase()}${vendor.slice(1)})`,
        enabled: count(vendor) > 0,
        note: `${count(vendor)} companies`,
      })),
      { id: 'remotive', name: 'Remotive (remote jobs)', enabled: true, note: 'When remote is on' },
    ];
  }

  async function suggest(userId: UserId): Promise<JobSearchSuggestion> {
    const cv = await resumes.primaryText(userId);
    if (!cv) return { plan: null, sources: sourceStatus() };
    const profile = await createCandidateProfileRepository(db).getForUser(userId);
    const plan = suggestSearchPlan(cv.text, profile);
    return {
      plan: plan.keywords.length > 0 ? plan : { ...plan, keywords: ['software developer'] },
      sources: sourceStatus(),
    };
  }

  async function run(
    userId: UserId,
    request: JobSearchRequest,
    options: { signal: AbortSignal; taskId: string | null; logger: Logger },
  ): Promise<JobSearchOutcome> {
    const cv = await resumes.primaryText(userId);
    if (!cv) throw new JobSearchError('Upload a CV with readable text first (CVs page).');

    const active = sources();
    const results = await Promise.all(
      active.map(async (source) => {
        const signal = AbortSignal.any([options.signal, AbortSignal.timeout(SOURCE_TIMEOUT_MS)]);
        try {
          const jobs = await source.search(request, { signal, fetch: fetchImpl });
          return { id: source.declaration.sourceId, jobs, error: null };
        } catch (error) {
          if (options.signal.aborted) throw error;
          const message =
            error instanceof ConnectorError
              ? `${error.code}: ${error.message}`
              : signal.aborted
                ? 'timed out'
                : 'failed';
          options.logger.warn('job_search.source_failed', {
            sourceId: source.declaration.sourceId,
            error: message,
          });
          return { id: source.declaration.sourceId, jobs: [] as DiscoveredJob[], error: message };
        }
      }),
    );
    if (results.every((r) => r.error !== null)) {
      throw new JobSearchError('No job source could be reached. Try again later.', true);
    }

    const all = results.flatMap((r) => r.jobs);
    const ranked = rankDiscoveredJobs(cv.text, all, request, {
      minScore: MIN_SAVE_SCORE,
      limit: MAX_SAVED_PER_SEARCH * 3,
    });
    const jobs = createJobRepository(db);
    const existing = await jobs.existingUrls(
      userId,
      ranked.map((r) => r.job.url),
    );
    const fresh = ranked.filter((r) => !existing.has(r.job.url)).slice(0, MAX_SAVED_PER_SEARCH);
    const saved = await jobs.saveDiscovered(
      userId,
      fresh.map(({ job }) => ({
        url: job.url,
        title: clip(job.title, 200),
        company: clip(job.company, 200),
        location: job.location ? clip(job.location, 200) : null,
        description: clip(job.description, JOB_DESCRIPTION_LIMITS.max),
        source: job.sourceId,
      })),
      { taskId: options.taskId, sources: results.map((r) => r.id) },
    );

    return {
      found: all.length,
      relevant: ranked.length,
      saved,
      alreadySaved: ranked.length - ranked.filter((r) => !existing.has(r.job.url)).length,
      bestScore: fresh[0]?.score ?? null,
      sources: results.map((r) => ({ id: r.id, jobs: r.jobs.length, error: r.error })),
    };
  }

  return { suggest, run, sourceStatus };
}

export type JobSearchService = ReturnType<typeof createJobSearchService>;
