import { describe, expect, it } from 'vitest';
import { matchPromptInput, verifyAndScore } from './match-analysis';
import { findSkills, selectRelevantLines, skillsPreScore } from './relevance';

const CV = [
  'TEST CANDIDATE',
  'Senior Software Engineer | Mobile & Cross-Platform',
  'Flutter · React Native · Kotlin · Swift',
  'PROFESSIONAL SUMMARY',
  'Built mobile apps for fintech and logistics since 2019.',
  'Hobbies: chess, hiking and photography in the mountains.',
  'Senior Software Engineer Sep 2024 – Jul 2026',
  'Example Fintech DMCC Dubai, UAE',
  '• Built real-time chat with WebSocket and push notifications.',
  'Volunteer: organised local charity events and fundraisers.',
  'Software Engineer Sep 2022 – Sep 2024',
  'Example Logistics Doha, Qatar',
  '• Added Arabic (RTL) localization and payments.',
  'B.Tech, Computer Science & Engineering | Example University 2015 – 2019',
].join('\n');

const JOB = `Senior Mobile Engineer
Required: Flutter or React Native with native Kotlin and Swift.
Experience with WebSocket or XMPP messaging, push notifications and WebRTC calls.
6+ years of mobile development.`;

describe('findSkills and skillsPreScore', () => {
  it('recognises skills without confusing similar names', () => {
    expect(findSkills('React Native and Kotlin')).toEqual(['React Native', 'Kotlin']);
    expect(findSkills('React.js with Next.js')).toEqual(['React', 'Next.js']);
    expect(findSkills('JavaScript only')).toEqual(['JavaScript']);
    expect(findSkills('a C# / .NET backend')).toEqual(['C#', '.NET']);
  });

  it('scores the share of the job skills found in the CV', () => {
    const pre = skillsPreScore(CV, JOB)!;
    expect(pre.matched).toEqual(
      expect.arrayContaining(['Flutter', 'React Native', 'Kotlin', 'Swift', 'WebSocket']),
    );
    expect(pre.missing).toEqual(expect.arrayContaining(['XMPP', 'WebRTC']));
    expect(pre.score).toBe(
      Math.round((100 * pre.matched.length) / (pre.matched.length + pre.missing.length)),
    );
  });

  it('says nothing when the job names too few known skills', () => {
    expect(skillsPreScore(CV, 'A friendly team player wanted.')).toBeNull();
  });
});

describe('selectRelevantLines', () => {
  it('returns short texts unchanged', () => {
    expect(selectRelevantLines('one\ntwo', JOB, 1000)).toBe('one\ntwo');
  });

  it('keeps the header, role dates, company/location lines and degree; drops unrelated lines', () => {
    const excerpt = selectRelevantLines(CV, JOB, 520, 3);
    const lines = excerpt.split('\n');
    expect(lines.slice(0, 3)).toEqual(CV.split('\n').slice(0, 3));
    expect(lines).toContain('Senior Software Engineer Sep 2024 – Jul 2026');
    expect(lines).toContain('Example Fintech DMCC Dubai, UAE');
    expect(lines).toContain('Example Logistics Doha, Qatar');
    expect(lines.some((l) => l.startsWith('B.Tech'))).toBe(true);
    expect(excerpt).not.toContain('Hobbies');
    expect(excerpt).not.toContain('Volunteer');
    expect(excerpt.length).toBeLessThanOrEqual(520);
  });

  it('keeps lines verbatim and in their original order', () => {
    const excerpt = selectRelevantLines(CV, JOB, 400, 2);
    const cvLines = CV.split('\n');
    const indexes = excerpt.split('\n').map((l) => cvLines.indexOf(l));
    expect(indexes.every((i) => i >= 0)).toBe(true);
    expect([...indexes].sort((a, b) => a - b)).toEqual(indexes);
  });
});

describe('matchPromptInput', () => {
  const input = {
    cvText: CV,
    profileText: '',
    job: { title: 'Senior Mobile Engineer', company: 'X', description: JOB },
  };

  it('sends everything unless an excerpt is asked for', () => {
    expect(matchPromptInput(input)).toBe(input);
    const small = matchPromptInput(input, { excerpt: { cvChars: 400, jobChars: 2000 } });
    expect(small.cvText.length).toBeLessThanOrEqual(400);
    expect(small.job.description).toBe(JOB); // short enough to keep whole
  });
});

describe('verifyAndScore with an excerpt', () => {
  it('does not accept "missing" for a skill the full CV mentions', () => {
    const result = verifyAndScore(
      {
        factors: [
          {
            factor: 'skills',
            assessment: 'missing',
            mandatory: true,
            jobEvidence: 'Experience with WebSocket or XMPP messaging',
            cvEvidence: null,
            explanation: 'Not in the excerpt.',
          },
        ],
        gaps: [],
        summary: 's',
      },
      { cvText: CV, profileText: '', jobText: JOB },
    );
    expect(result.factors[0]).toMatchObject({ assessment: 'unknown', mandatory: true });
    expect(result.factors[0]!.note).toMatch(/Your CV mentions WebSocket/);
    expect(result.recommendation).not.toBe('ineligible');
  });
});
