import { describe, expect, it } from 'vitest';
import { ConnectorError } from './connector';
import {
  createCompanyBoardSources,
  createJSearchSource,
  createRemotiveSource,
  DEFAULT_COMPANY_BOARDS,
  htmlToText,
  isInCountries,
  parseCompanyBoards,
} from './search';

const request = { keywords: ['Flutter developer'], countries: ['IN', 'AE'], remoteOk: true };

/** A fetch that answers from recorded bodies by URL substring and records what was asked. */
function fakeFetch(routes: Record<string, { status?: number; body: unknown }>) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return new Response('not found', { status: 404 });
    const { status = 200, body } = routes[key]!;
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const ctx = (impl: typeof fetch) => ({ signal: new AbortController().signal, fetch: impl });

describe('htmlToText', () => {
  it('reads entity-escaped HTML as Greenhouse sends it', () => {
    expect(
      htmlToText(
        '&lt;p&gt;Build apps in &lt;b&gt;Flutter&lt;/b&gt;&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Dart&lt;/li&gt;&lt;/ul&gt;',
      ),
    ).toBe('Build apps in Flutter\n- Dart');
  });
});

describe('parseCompanyBoards', () => {
  it('uses the default list when empty and skips invalid entries', () => {
    expect(parseCompanyBoards(undefined)).toEqual(DEFAULT_COMPANY_BOARDS);
    expect(parseCompanyBoards('greenhouse:stripe, workday:x, lever:../etc, ashby:deel')).toEqual([
      { vendor: 'greenhouse', board: 'stripe' },
      { vendor: 'ashby', board: 'deel' },
    ]);
  });
});

describe('isInCountries', () => {
  it('keeps jobs in the countries and remote jobs open to them', () => {
    expect(isInCountries({ location: 'Bengaluru, Karnataka', remote: false }, ['IN'], false)).toBe(
      true,
    );
    expect(isInCountries({ location: 'Dubai', remote: false }, ['IN'], true)).toBe(false);
    expect(isInCountries({ location: 'Remote', remote: true }, ['IN'], true)).toBe(true);
    expect(isInCountries({ location: 'Remote - US', remote: true }, ['IN'], true)).toBe(false);
    expect(isInCountries({ location: 'Remote', remote: true }, ['IN'], false)).toBe(false);
    expect(isInCountries({ location: 'US-Remote', remote: true }, ['IN'], true)).toBe(false);
    expect(isInCountries({ location: 'Remote - United Kingdom', remote: true }, ['IN'], true)).toBe(
      false,
    );
    expect(isInCountries({ location: 'Worldwide', remote: true }, ['IN'], true)).toBe(true);
  });
});

describe('company board sources', () => {
  it('normalises Greenhouse, Lever and Ashby listings and skips a missing board', async () => {
    const { impl } = fakeFetch({
      'boards/acme/jobs': {
        body: {
          jobs: [
            {
              id: 1,
              title: 'Flutter Developer',
              absolute_url: 'https://acme.example/jobs/1',
              location: { name: 'Pune, India' },
              content: '&lt;p&gt;Flutter&lt;/p&gt;',
              updated_at: '2026-10-01T00:00:00Z',
            },
          ],
        },
      },
      'postings/beta': {
        body: [
          {
            id: 'x',
            text: 'Mobile Engineer',
            hostedUrl: 'https://jobs.lever.co/beta/x',
            categories: { location: 'Dubai' },
            descriptionPlain: 'Dart and Flutter',
            workplaceType: 'onsite',
          },
        ],
      },
      'job-board/gamma': {
        body: {
          jobs: [
            {
              id: 'g',
              title: 'Android Developer',
              jobUrl: 'https://jobs.ashbyhq.com/gamma/g',
              location: 'Remote',
              isRemote: true,
              descriptionPlain: 'Kotlin',
            },
          ],
        },
      },
    });
    const sources = createCompanyBoardSources([
      { vendor: 'greenhouse', board: 'acme' },
      { vendor: 'greenhouse', board: 'gone' },
      { vendor: 'lever', board: 'beta' },
      { vendor: 'ashby', board: 'gamma' },
    ]);
    const jobs = (await Promise.all(sources.map((s) => s.search(request, ctx(impl))))).flat();
    expect(jobs.map((j) => [j.sourceId, j.title, j.company, j.location, j.remote])).toEqual([
      ['greenhouse', 'Flutter Developer', 'Acme', 'Pune, India', false],
      ['lever', 'Mobile Engineer', 'Beta', 'Dubai', false],
      ['ashby', 'Android Developer', 'Gamma', 'Remote', true],
    ]);
    expect(jobs[0]!.description).toBe('Flutter');
  });

  it('stops a vendor on a rate limit instead of trying harder', async () => {
    const { impl, calls } = fakeFetch({ 'boards/': { status: 429, body: {} } });
    const [source] = createCompanyBoardSources([
      { vendor: 'greenhouse', board: 'a' },
      { vendor: 'greenhouse', board: 'b' },
    ]);
    await expect(source!.search(request, ctx(impl))).rejects.toMatchObject({
      code: 'rate_limited',
    });
    expect(calls).toHaveLength(1);
  });
});

describe('JSearch', () => {
  it('sends the key as a header, makes at most 3 requests and maps listings', async () => {
    const { impl, calls } = fakeFetch({
      'jsearch.p.rapidapi.com': {
        body: {
          data: [
            {
              job_id: 'j1',
              job_title: 'Flutter Developer',
              employer_name: 'Example LLC',
              job_apply_link: 'https://example.com/apply',
              job_city: 'Dubai',
              job_country: 'AE',
              job_description: 'Flutter, Dart',
              job_is_remote: false,
            },
          ],
        },
      },
    });
    const jobs = await createJSearchSource('test-key-123456').search(
      {
        keywords: ['Flutter developer', 'Mobile developer'],
        countries: ['IN', 'AE'],
        remoteOk: true,
      },
      ctx(impl),
    );
    expect(calls).toHaveLength(3);
    expect(calls[0]!.headers['X-RapidAPI-Key']).toBe('test-key-123456');
    expect(calls[0]!.url).toContain('query=Flutter+developer+in+India');
    expect(calls[0]!.url).not.toContain('test-key');
    expect(jobs[0]).toMatchObject({ company: 'Example LLC', location: 'Dubai, AE' });
  });

  it('reports a refused key as auth_required', async () => {
    const { impl } = fakeFetch({ 'jsearch.p.rapidapi.com': { status: 401, body: {} } });
    const error = await createJSearchSource('bad-key-123456')
      .search(request, ctx(impl))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectorError);
    expect(error).toMatchObject({ code: 'auth_required' });
  });
});

describe('Remotive', () => {
  it('is skipped when remote jobs are off, and asks once otherwise', async () => {
    const { impl, calls } = fakeFetch({
      'remotive.com': {
        body: {
          jobs: [
            {
              id: 5,
              url: 'https://remotive.com/remote-jobs/x',
              title: 'Flutter Dev',
              company_name: 'R',
              candidate_required_location: 'Worldwide',
              description: '<p>Flutter</p>',
            },
          ],
        },
      },
    });
    const source = createRemotiveSource();
    expect(await source.search({ ...request, remoteOk: false }, ctx(impl))).toEqual([]);
    const jobs = await source.search(request, ctx(impl));
    expect(calls).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ remote: true, location: 'Worldwide' });
  });
});
