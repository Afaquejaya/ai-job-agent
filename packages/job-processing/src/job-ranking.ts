import { isInCountries, type DiscoveredJob, type JobSearchRequest } from '@job-agent/job-sources';
import { findSkills, skillsPreScore } from './relevance';
import { topSkills } from './search-plan';

/**
 * Ranks discovered listings against the CV without AI (D-049): keep listings in the user's
 * countries that are about the searched roles, then order them by the skills pre-score.
 */

export interface RankedJob {
  job: DiscoveredJob;
  /** Skills pre-score 0-100 (0 when the listing names too few known skills). */
  score: number;
  matched: string[];
  missing: string[];
}

const GENERIC = new Set(
  'developer developers engineer engineers senior junior lead staff principal software sr jr ii iii application applications app apps and the for with of in at to a an specialist consultant'.split(
    ' ',
  ),
);

/** The words of the search phrases that actually say what the job is, e.g. "flutter". */
export function distinctiveWords(keywords: readonly string[]): string[] {
  const words = keywords
    .flatMap((k) => k.toLowerCase().split(/[^a-z0-9+#.]+/))
    .filter((w) => w.length >= 2 && !GENERIC.has(w));
  return [...new Set(words)];
}

const SENIORITY = /\b(senior|junior|lead|staff|principal|sr\.?|jr\.?)(?=\s|$)/gi;

const containsWord = (text: string, word: string) =>
  new RegExp(`(^|[^a-z0-9])${word.replace(/[.+#]/g, '\\$&')}($|[^a-z0-9])`, 'i').test(text);

export const MIN_DESCRIPTION_CHARS = 200;

export function rankDiscoveredJobs(
  cvText: string,
  jobs: readonly DiscoveredJob[],
  request: JobSearchRequest,
  options: { minScore: number; limit: number },
): RankedJob[] {
  const words = distinctiveWords(request.keywords);
  // A listing is about the role when its title names a searched word ("flutter"), one of the
  // CV's main skills ("Android"), or a whole searched role ("software engineer").
  const mainSkills = new Set(topSkills(cvText, 4));
  const phrases = request.keywords
    .map((k) => k.replace(SENIORITY, ' ').replace(/\s+/g, ' ').trim().toLowerCase())
    .filter((p) => p.length >= 4);
  const seen = new Set<string>();
  const ranked: RankedJob[] = [];

  for (const job of jobs) {
    if (job.description.length < MIN_DESCRIPTION_CHARS) continue;
    if (!isInCountries(job, request.countries, request.remoteOk)) continue;
    const keys = [job.url, `${job.title}|${job.company}`.toLowerCase()];
    if (keys.some((k) => seen.has(k))) continue;

    const title = job.title.toLowerCase();
    const titleHit =
      words.some((w) => containsWord(title, w)) ||
      findSkills(job.title).some((s) => mainSkills.has(s)) ||
      phrases.some((p) => title.includes(p));
    if (!titleHit) continue;
    const pre = skillsPreScore(cvText, `${job.title}\n${job.description}`);
    const score = pre?.score ?? 0;
    if (score < options.minScore) continue;

    keys.forEach((k) => seen.add(k));
    ranked.push({ job, score, matched: pre?.matched ?? [], missing: pre?.missing ?? [] });
  }

  // Order by fit, not the raw score: a listing naming only 2 skills scores 100% too easily, so
  // the score counts in full only from 4 named skills; a title naming one of the CV's main
  // skills ranks higher. At most MAX_PER_COMPANY per company, so one employer cannot fill it.
  const fit = (r: RankedJob) =>
    r.score * Math.min(1, (r.matched.length + r.missing.length) / 4) +
    (findSkills(r.job.title).some((s) => mainSkills.has(s)) ? 25 : 0);
  const perCompany = new Map<string, number>();
  return ranked
    .sort(
      (a, b) =>
        fit(b) - fit(a) || (b.job.postedAt?.getTime() ?? 0) - (a.job.postedAt?.getTime() ?? 0),
    )
    .filter((r) => {
      const key = r.job.company.toLowerCase();
      const count = perCompany.get(key) ?? 0;
      perCompany.set(key, count + 1);
      return count < MAX_PER_COMPANY;
    })
    .slice(0, options.limit);
}

export const MAX_PER_COMPANY = 5;
