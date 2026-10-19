import { ConnectorError } from './connector';
import type { SourceDeclaration, SourceId } from './declaration';
import { SOURCE_REGISTRY } from './registry';

/**
 * Job discovery through published job-search APIs (D-049). Each source fetches and normalises
 * its own listings; ranking against the CV happens later, in services. Sources only read:
 * they never sign in, apply or work around a block (a 401/403/429 stops that source).
 */

/** A listing in a common shape. Text is plain (HTML removed). */
export interface DiscoveredJob {
  sourceId: SourceId;
  externalId: string;
  url: string;
  title: string;
  company: string;
  location: string | null;
  description: string;
  remote: boolean;
  postedAt: Date | null;
}

export interface JobSearchRequest {
  /** Role or skill phrases, e.g. "Flutter developer". */
  keywords: string[];
  /** ISO 3166-1 alpha-2 codes, e.g. IN, AE. */
  countries: string[];
  /** Also keep remote jobs open to these countries. */
  remoteOk: boolean;
}

export interface SearchContext {
  signal: AbortSignal;
  fetch: typeof fetch;
}

export interface JobSearchSource {
  readonly declaration: SourceDeclaration;
  search(request: JobSearchRequest, context: SearchContext): Promise<DiscoveredJob[]>;
}

const USER_AGENT = 'ai-job-agent (personal job search; contact: repository owner)';

/** GET a JSON document; HTTP refusals become ConnectorErrors so the caller stops that source. */
export async function fetchJson(
  sourceId: SourceId,
  url: string,
  context: SearchContext,
  headers: Record<string, string> = {},
): Promise<unknown> {
  let response: Response;
  try {
    response = await context.fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT, ...headers },
      signal: context.signal,
    });
  } catch (error) {
    if (context.signal.aborted) throw error;
    throw new ConnectorError(sourceId, 'network', `Could not reach ${sourceId}`);
  }
  if (response.status === 401) {
    throw new ConnectorError(sourceId, 'auth_required', 'The API key was refused');
  }
  if (response.status === 403) {
    throw new ConnectorError(sourceId, 'blocked', 'Access was refused (403)');
  }
  if (response.status === 429) {
    const seconds = Number(response.headers.get('retry-after'));
    throw new ConnectorError(
      sourceId,
      'rate_limited',
      'Rate limit reached; try again later',
      Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined,
    );
  }
  if (response.status === 404) {
    throw new ConnectorError(sourceId, 'schema_changed', 'Not found (404)');
  }
  if (!response.ok) {
    throw new ConnectorError(sourceId, 'network', `HTTP ${response.status}`);
  }
  try {
    return await response.json();
  } catch {
    throw new ConnectorError(sourceId, 'parse_error', 'The response was not JSON');
  }
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code: string) => {
    const lower = code.toLowerCase();
    if (lower in ENTITIES) return ENTITIES[lower]!;
    if (lower.startsWith('#x')) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith('#')) return String.fromCodePoint(parseInt(lower.slice(1), 10));
    return whole;
  });
}

/** HTML (possibly entity-escaped, as Greenhouse sends it) to readable plain text. */
export function htmlToText(html: string): string {
  const unescaped = /&lt;\w/.test(html) ? decodeEntities(html) : html;
  return decodeEntities(
    unescaped
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<\s*(br|\/p|\/div|\/li|\/h\d|\/ul|\/ol|\/tr)\s*\/?>/gi, '\n')
      .replace(/<\s*li[^>]*>/gi, '- ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

const asDate = (value: unknown): Date | null => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const REMOTE = /\bremote\b|work from home|anywhere/i;

function list(sourceId: SourceId, value: unknown, key?: string): unknown[] {
  const items = key ? (value as Record<string, unknown> | null)?.[key] : value;
  if (!Array.isArray(items)) {
    throw new ConnectorError(sourceId, 'schema_changed', 'Unexpected response shape');
  }
  return items;
}

/** A company's board on an ATS, e.g. { vendor: 'greenhouse', board: 'stripe' }. */
export interface CompanyBoard {
  vendor: 'greenhouse' | 'lever' | 'ashby';
  board: string;
}

/** Companies with offices or hiring in India or the Gulf whose boards were checked to exist. */
export const DEFAULT_COMPANY_BOARDS: readonly CompanyBoard[] = [
  ...[
    'careem',
    'groww',
    'tamara',
    'cloudflare',
    'databricks',
    'twilio',
    'mongodb',
    'okta',
    'stripe',
    'gitlab',
  ].map((board) => ({ vendor: 'greenhouse' as const, board })),
  ...['cred', 'freshworks', 'zeta', 'paytm', 'meesho', 'kraken'].map((board) => ({
    vendor: 'lever' as const,
    board,
  })),
  ...['deel', 'sarvam'].map((board) => ({ vendor: 'ashby' as const, board })),
];

/** Parses "greenhouse:stripe,lever:cred" (JOB_SEARCH_BOARDS); invalid entries are skipped. */
export function parseCompanyBoards(value: string | undefined): CompanyBoard[] {
  if (!value?.trim()) return [...DEFAULT_COMPANY_BOARDS];
  const boards: CompanyBoard[] = [];
  for (const entry of value.split(',')) {
    const [vendor, board] = entry.trim().split(':');
    if (
      (vendor === 'greenhouse' || vendor === 'lever' || vendor === 'ashby') &&
      board &&
      /^[a-z0-9-]{1,80}$/i.test(board)
    ) {
      boards.push({ vendor, board });
    }
  }
  return boards;
}

const titleCase = (board: string) =>
  board.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function greenhouseJobs(board: string, body: unknown): DiscoveredJob[] {
  return list('greenhouse', body, 'jobs').flatMap((item) => {
    const job = item as Record<string, unknown>;
    const url = asString(job.absolute_url);
    const title = asString(job.title);
    if (!url || !title) return [];
    const location = asString((job.location as Record<string, unknown> | null)?.name);
    return [
      {
        sourceId: 'greenhouse' as const,
        externalId: `${board}:${String(job.id)}`,
        url,
        title,
        company: asString(job.company_name) ?? titleCase(board),
        location,
        description: htmlToText(asString(job.content) ?? ''),
        remote: REMOTE.test(location ?? ''),
        postedAt: asDate(job.first_published ?? job.updated_at),
      },
    ];
  });
}

function leverJobs(board: string, body: unknown): DiscoveredJob[] {
  return list('lever', body).flatMap((item) => {
    const job = item as Record<string, unknown>;
    const url = asString(job.hostedUrl);
    const title = asString(job.text);
    if (!url || !title) return [];
    const categories = (job.categories ?? {}) as Record<string, unknown>;
    const location =
      asString(categories.location) ??
      (Array.isArray(categories.allLocations) ? categories.allLocations.join(', ') : null);
    const sections = Array.isArray(job.lists)
      ? (job.lists as Array<Record<string, unknown>>)
          .map((l) => `${asString(l.text) ?? ''}\n${htmlToText(asString(l.content) ?? '')}`)
          .join('\n\n')
      : '';
    const description = [
      asString(job.descriptionPlain) ?? htmlToText(asString(job.description) ?? ''),
      sections,
      asString(job.additionalPlain) ?? '',
    ]
      .filter(Boolean)
      .join('\n\n');
    return [
      {
        sourceId: 'lever' as const,
        externalId: `${board}:${String(job.id)}`,
        url,
        title,
        company: titleCase(board),
        location,
        description,
        remote: job.workplaceType === 'remote' || REMOTE.test(location ?? ''),
        postedAt: asDate(job.createdAt),
      },
    ];
  });
}

function ashbyJobs(board: string, body: unknown): DiscoveredJob[] {
  return list('ashby', body, 'jobs').flatMap((item) => {
    const job = item as Record<string, unknown>;
    const url = asString(job.jobUrl);
    const title = asString(job.title);
    if (!url || !title || job.isListed === false) return [];
    const location = asString(job.location);
    return [
      {
        sourceId: 'ashby' as const,
        externalId: `${board}:${String(job.id)}`,
        url,
        title,
        company: titleCase(board),
        location,
        description:
          asString(job.descriptionPlain) ?? htmlToText(asString(job.descriptionHtml) ?? ''),
        remote: job.isRemote === true || REMOTE.test(location ?? ''),
        postedAt: asDate(job.publishedAt),
      },
    ];
  });
}

/** One source per ATS vendor; each reads the configured company boards of that vendor. */
export function createCompanyBoardSources(boards: readonly CompanyBoard[]): JobSearchSource[] {
  const vendors = [
    {
      id: 'greenhouse' as const,
      url: (b: string) => `https://boards-api.greenhouse.io/v1/boards/${b}/jobs?content=true`,
      parse: greenhouseJobs,
    },
    {
      id: 'lever' as const,
      url: (b: string) => `https://api.lever.co/v0/postings/${b}?mode=json`,
      parse: leverJobs,
    },
    {
      id: 'ashby' as const,
      url: (b: string) => `https://api.ashbyhq.com/posting-api/job-board/${b}`,
      parse: ashbyJobs,
    },
  ];
  return vendors
    .map((vendor) => ({ vendor, names: boards.filter((b) => b.vendor === vendor.id) }))
    .filter(({ names }) => names.length > 0)
    .map(({ vendor, names }) => ({
      declaration: SOURCE_REGISTRY[vendor.id],
      async search(_request, context) {
        // Boards are read one after another: polite, and well inside the declared limit.
        const jobs: DiscoveredJob[] = [];
        let failures = 0;
        let lastError: unknown = null;
        for (const { board } of names) {
          try {
            jobs.push(
              ...vendor.parse(board, await fetchJson(vendor.id, vendor.url(board), context)),
            );
          } catch (error) {
            if (context.signal.aborted) throw error;
            // A rate limit or block stops this vendor; a missing board only skips that board.
            if (
              error instanceof ConnectorError &&
              (error.code === 'rate_limited' || error.code === 'blocked')
            ) {
              throw error;
            }
            failures += 1;
            lastError = error;
          }
        }
        if (failures === names.length && lastError) throw lastError;
        return jobs;
      },
    }));
}

export function createRemotiveSource(): JobSearchSource {
  return {
    declaration: SOURCE_REGISTRY.remotive,
    async search(request, context) {
      if (!request.remoteOk) return [];
      // One request per search (Remotive asks for very few calls a day).
      const term = request.keywords[0] ?? '';
      const body = await fetchJson(
        'remotive',
        `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(term)}&limit=50`,
        context,
      );
      return list('remotive', body, 'jobs').flatMap((item) => {
        const job = item as Record<string, unknown>;
        const url = asString(job.url);
        const title = asString(job.title);
        if (!url || !title) return [];
        return [
          {
            sourceId: 'remotive' as const,
            externalId: String(job.id),
            url,
            title,
            company: asString(job.company_name) ?? 'Unknown company',
            location: asString(job.candidate_required_location) ?? 'Remote',
            description: htmlToText(asString(job.description) ?? ''),
            remote: true,
            postedAt: asDate(job.publication_date),
          },
        ];
      });
    },
  };
}

/** Country names JSearch understands and that appear in listings, by ISO code. */
export const COUNTRY_NAMES: Readonly<Record<string, string>> = {
  IN: 'India',
  AE: 'United Arab Emirates',
  SA: 'Saudi Arabia',
  QA: 'Qatar',
  KW: 'Kuwait',
  BH: 'Bahrain',
  OM: 'Oman',
};

/** JSearch (Google Jobs listings, including those posted on LinkedIn, Indeed and Naukri). */
export function createJSearchSource(apiKey: string): JobSearchSource {
  const MAX_REQUESTS = 3;
  return {
    declaration: SOURCE_REGISTRY.jsearch,
    async search(request, context) {
      const countries = request.countries.length > 0 ? request.countries : ['IN'];
      const queries = countries
        .flatMap((country) => request.keywords.slice(0, 2).map((keyword) => ({ keyword, country })))
        .slice(0, MAX_REQUESTS);
      const jobs: DiscoveredJob[] = [];
      for (const { keyword, country } of queries) {
        const params = new URLSearchParams({
          query: `${keyword} in ${COUNTRY_NAMES[country] ?? country}`,
          page: '1',
          num_pages: '1',
          country: country.toLowerCase(),
          date_posted: 'month',
        });
        const body = await fetchJson(
          'jsearch',
          `https://jsearch.p.rapidapi.com/search?${params}`,
          context,
          { 'X-RapidAPI-Key': apiKey, 'X-RapidAPI-Host': 'jsearch.p.rapidapi.com' },
        );
        for (const item of list('jsearch', body, 'data')) {
          const job = item as Record<string, unknown>;
          const url = asString(job.job_apply_link) ?? asString(job.job_google_link);
          const title = asString(job.job_title);
          if (!url || !title) continue;
          const location =
            [asString(job.job_city), asString(job.job_state), asString(job.job_country)]
              .filter(Boolean)
              .join(', ') || null;
          jobs.push({
            sourceId: 'jsearch',
            externalId: asString(job.job_id) ?? url,
            url,
            title,
            company: asString(job.employer_name) ?? 'Unknown company',
            location,
            description: htmlToText(asString(job.job_description) ?? ''),
            remote: job.job_is_remote === true,
            postedAt: asDate(job.job_posted_at_datetime_utc),
          });
        }
      }
      return jobs;
    },
  };
}

// Words that say where a job is, by country code. Used to keep listings in the user's countries.
const PLACE_WORDS: Readonly<Record<string, RegExp>> = {
  IN: /\bindia\b|bengaluru|bangalore|mumbai|pune|hyderabad|gurugram|gurgaon|noida|delhi|chennai|kolkata|ahmedabad|kochi|jaipur|chandigarh/i,
  AE: /\buae\b|united arab emirates|dubai|abu dhabi|sharjah/i,
  SA: /saudi|riyadh|jeddah|dammam|khobar|\bKSA\b/i,
  QA: /qatar|doha/i,
  KW: /kuwait/i,
  BH: /bahrain|manama/i,
  OM: /\boman\b|muscat/i,
};

// What is left of a remote job's location once the remote words are removed: nothing, or
// a worldwide/Asia scope, means it is open to the user's countries; anything else (US, UK,
// Europe...) means it is not.
const REMOTE_WORDS = /remote|work from home|wfh|hybrid|[-–—,;()/|:]/gi;
const OPEN_SCOPE = /^(worldwide|anywhere|global|globally|asia|apac|any location)?$/i;

/** Whether a listing is in one of the countries, or remote and open to them. */
export function isInCountries(
  job: Pick<DiscoveredJob, 'location' | 'remote'>,
  countries: readonly string[],
  remoteOk: boolean,
): boolean {
  const location = job.location ?? '';
  if (countries.some((code) => PLACE_WORDS[code]?.test(location))) return true;
  if (!remoteOk || !job.remote) return false;
  return OPEN_SCOPE.test(location.replace(REMOTE_WORDS, ' ').replace(/\s+/g, ' ').trim());
}
