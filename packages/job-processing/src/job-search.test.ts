import type { DiscoveredJob } from '@job-agent/job-sources';
import { describe, expect, it } from 'vitest';
import { distinctiveWords, rankDiscoveredJobs } from './job-ranking';
import { suggestSearchPlan, topSkills } from './search-plan';

const CV = [
  'Asha Example',
  'Senior Flutter Developer | Mobile Apps',
  'Skills: Flutter, Dart, Firebase, REST APIs, Git, Riverpod',
  '2021 - Present  Flutter Developer at Example Ltd',
  'Built Flutter apps with Firebase and REST APIs.',
].join('\n');

const filler = ' We build products used by millions of people every day.'.repeat(5);

const job = (over: Partial<DiscoveredJob>): DiscoveredJob => ({
  sourceId: 'greenhouse',
  externalId: over.url ?? 'x',
  url: 'https://example.com/1',
  title: 'Flutter Developer',
  company: 'Acme',
  location: 'Pune, India',
  description: `Flutter, Dart and Firebase.${filler}`,
  remote: false,
  postedAt: null,
  ...over,
});

describe('suggestSearchPlan', () => {
  it('takes the role from the CV headline and countries from the profile', () => {
    // A labelled line is not taken as a role.
    const plan = suggestSearchPlan(
      `${CV}
Earlier: Android developer with Kotlin`,
      {
        currentRole: null,
        currentLocation: { countryCode: 'IN' },
        preferredLocations: [{ countryCode: 'AE', remoteOk: false }],
      },
    );
    expect(plan.keywords).toEqual(['Senior Flutter Developer']);
    expect(plan.countries).toEqual(['AE', 'IN']);
    expect(plan.remoteOk).toBe(false);
    expect(topSkills(CV)[0]).toBe('Flutter');
  });

  it('falls back to India and the top skill', () => {
    const plan = suggestSearchPlan('Flutter Dart Flutter', {
      currentRole: null,
      currentLocation: null,
      preferredLocations: null,
    });
    expect(plan).toMatchObject({ keywords: ['Flutter developer'], countries: ['IN'] });
  });
});

describe('rankDiscoveredJobs', () => {
  const request = { keywords: ['Senior Flutter Developer'], countries: ['IN'], remoteOk: true };

  it('ignores generic words', () => {
    expect(distinctiveWords(request.keywords)).toEqual(['flutter']);
  });

  it('keeps relevant jobs in the countries, best skills match first, without duplicates', () => {
    const ranked = rankDiscoveredJobs(
      CV,
      [
        job({ url: 'https://a/1', description: `Flutter and Kotlin and Swift.${filler}` }),
        job({ url: 'https://a/2', company: 'Best' }),
        job({ url: 'https://a/2', company: 'Best' }), // duplicate
        job({ url: 'https://a/3', location: 'London' }), // wrong country
        job({ url: 'https://a/4', title: 'Accountant', description: `Excel and SQL.${filler}` }),
        job({ url: 'https://a/5', description: 'Flutter' }), // too short to analyse
        job({ url: 'https://a/6', title: 'Associate Product Manager' }), // not the role
      ],
      request,
      { minScore: 0, limit: 10 },
    );
    expect(ranked.map((r) => [r.job.url, r.score])).toEqual([
      ['https://a/2', 100],
      ['https://a/1', 33],
    ]);
    expect(ranked[1]!.missing).toEqual(['Kotlin', 'Swift']);
  });

  it('accepts a whole searched role in the title, ignoring seniority', () => {
    const ranked = rankDiscoveredJobs(
      CV,
      [job({ title: 'Software Engineer II, Payments' })],
      { ...request, keywords: ['Senior Software Engineer'] },
      { minScore: 0, limit: 10 },
    );
    expect(ranked).toHaveLength(1);
  });

  it('drops jobs below the minimum score', () => {
    const ranked = rankDiscoveredJobs(
      CV,
      [job({ description: `Flutter, Kotlin, Swift, Java.${filler}` })],
      request,
      { minScore: 30, limit: 10 },
    );
    expect(ranked).toEqual([]);
  });
});
