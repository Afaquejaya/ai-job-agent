import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { createScriptedProvider } from '@job-agent/ai-providers/testing';
import { describe, expect, it } from 'vitest';
import {
  analyzeJobMatch,
  buildMatchPrompt,
  modelMatchOutputSchema,
  normalizeForMatch,
  verifyAndScore,
  type ModelMatchOutput,
} from './match-analysis';

const CV = `Jane Example
Senior Software Engineer
7 years building TypeScript and Node.js services.
BSc Computer Science, University of Somewhere.
Based in Berlin, Germany.`;

const JOB = `Senior Backend Engineer at Example GmbH
Required: strong TypeScript and Node.js experience.
5+ years of professional experience.
Must be based in Berlin.
Kubernetes is required.`;

const sources = { cvText: CV, profileText: 'city: Berlin', jobText: JOB };

type RawFactor = ModelMatchOutput['factors'][number];
const factor = (
  partial: Partial<RawFactor> & Pick<RawFactor, 'factor' | 'assessment'>,
): RawFactor => ({
  mandatory: false,
  jobEvidence: null,
  cvEvidence: null,
  explanation: 'because',
  ...partial,
});
const output = (factors: RawFactor[]): ModelMatchOutput => ({
  factors,
  gaps: [],
  summary: 'Summary.',
});

describe('normalizeForMatch', () => {
  it('ignores case, spacing, and typographic quotes and dashes', () => {
    expect(normalizeForMatch('  “Senior”\n  Engineer – Berlin ')).toBe(
      '"senior" engineer - berlin',
    );
  });
});

describe('verifyAndScore', () => {
  it('keeps factors whose quotes are found (case and whitespace insensitive) and scores them', () => {
    const result = verifyAndScore(
      output([
        factor({
          factor: 'skills',
          assessment: 'meets',
          jobEvidence: 'strong TypeScript and Node.js experience',
          cvEvidence: 'building typescript and   node.js services',
        }),
        factor({
          factor: 'experience',
          assessment: 'meets',
          jobEvidence: '5+ years of professional experience',
          cvEvidence: '7 years building TypeScript',
        }),
      ]),
      sources,
    );
    const skills = result.factors.find((f) => f.factor === 'skills')!;
    expect(skills).toMatchObject({
      assessment: 'meets',
      evidenceVerified: true,
      note: null,
      weight: 30,
    });
    expect(result.score).toBe(100);
    expect(result.recommendation).toBe('strong');
    expect(result.factors).toHaveLength(8); // every factor listed, unassessed ones as unknown
  });

  it('downgrades an invented CV quote to unknown, so it cannot raise the score', () => {
    const result = verifyAndScore(
      output([
        factor({
          factor: 'experience',
          assessment: 'meets',
          jobEvidence: '5+ years of professional experience',
          cvEvidence: '12 years leading teams at Imaginary Corp',
        }),
      ]),
      sources,
    );
    expect(result.factors.find((f) => f.factor === 'experience')).toMatchObject({
      assessment: 'unknown',
      cvEvidence: null,
      evidenceVerified: false,
    });
    expect(result.factors.find((f) => f.factor === 'experience')!.note).toMatch(
      /CV quote was not found/,
    );
    expect(result.score).toBeNull();
    expect(result.recommendation).toBe('insufficient_information');
  });

  it('downgrades a quote that is not in the job description', () => {
    const result = verifyAndScore(
      output([
        factor({
          factor: 'skills',
          assessment: 'meets',
          jobEvidence: 'Rust required',
          cvEvidence: 'TypeScript',
        }),
      ]),
      sources,
    );
    expect(result.factors[0]).toMatchObject({ assessment: 'unknown', jobEvidence: null });
    expect(result.factors[0]!.note).toMatch(/job quote was not found/);
  });

  it('accepts "missing" without a CV quote only for factors a CV would list', () => {
    const result = verifyAndScore(
      output([
        factor({ factor: 'skills', assessment: 'missing', jobEvidence: 'Kubernetes is required.' }),
        factor({
          factor: 'location',
          assessment: 'missing',
          jobEvidence: 'Must be based in Berlin.',
        }),
      ]),
      sources,
    );
    expect(result.factors.find((f) => f.factor === 'skills')).toMatchObject({
      assessment: 'missing',
      evidenceVerified: true,
      note: 'Your CV and profile do not mention this.',
    });
    // Silence about location is not evidence against the candidate.
    expect(result.factors.find((f) => f.factor === 'location')).toMatchObject({
      assessment: 'unknown',
    });
  });

  it('scores partial as half and applies the thresholds', () => {
    const at = (assessment: 'meets' | 'partial' | 'missing') =>
      factor({
        factor: 'skills',
        assessment,
        jobEvidence: 'strong TypeScript and Node.js experience',
        cvEvidence: 'TypeScript and Node.js services',
      });
    const withLocation = (skills: RawFactor) =>
      verifyAndScore(
        output([
          skills,
          factor({
            factor: 'location',
            assessment: 'meets',
            jobEvidence: 'based in Berlin',
            cvEvidence: 'Based in Berlin',
          }),
        ]),
        sources,
      );
    expect(withLocation(at('partial'))).toMatchObject({ score: 63, recommendation: 'possible' }); // (15+10)/40
    expect(withLocation(at('missing'))).toMatchObject({ score: 25, recommendation: 'weak' });
    expect(withLocation(at('meets'))).toMatchObject({ score: 100, recommendation: 'strong' });
  });

  it('marks a missing mandatory requirement as ineligible whatever the score', () => {
    const result = verifyAndScore(
      output([
        factor({
          factor: 'skills',
          assessment: 'meets',
          jobEvidence: 'strong TypeScript and Node.js experience',
          cvEvidence: 'TypeScript and Node.js',
        }),
        factor({
          factor: 'experience',
          assessment: 'meets',
          jobEvidence: '5+ years of professional experience',
          cvEvidence: '7 years',
        }),
        factor({
          factor: 'education',
          assessment: 'missing',
          mandatory: true,
          jobEvidence: 'Kubernetes is required.',
        }),
      ]),
      sources,
    );
    expect(result.score).toBe(83);
    expect(result.recommendation).toBe('ineligible');
  });

  it('ignores the mandatory flag when its job quote cannot be verified, and repeated factors', () => {
    const result = verifyAndScore(
      output([
        factor({
          factor: 'skills',
          assessment: 'missing',
          mandatory: true,
          jobEvidence: 'PhD mandatory',
        }),
        factor({
          factor: 'skills',
          assessment: 'meets',
          jobEvidence: 'TypeScript',
          cvEvidence: 'TypeScript',
        }),
      ]),
      sources,
    );
    expect(result.factors.filter((f) => f.factor === 'skills')).toHaveLength(1);
    expect(result.factors[0]).toMatchObject({ assessment: 'unknown', mandatory: false });
  });
});

describe('analyzeJobMatch', () => {
  const job = { title: 'Senior Backend Engineer', company: 'Example GmbH', description: JOB };

  it('sends the job, CV and profile as tagged data and verifies the answer', async () => {
    const provider = createScriptedProvider([], {
      factors: [
        {
          factor: 'skills',
          assessment: 'meets',
          mandatory: false,
          jobEvidence: 'TypeScript',
          cvEvidence: 'TypeScript',
          explanation: 'x',
        },
        {
          factor: 'experience',
          assessment: 'meets',
          mandatory: false,
          jobEvidence: '5+ years',
          cvEvidence: '7 years',
          explanation: 'x',
        },
      ],
      gaps: ['Kubernetes'],
      summary: 'Good fit.',
    });
    const result = await analyzeJobMatch(
      provider,
      { cvText: CV, profileText: '', job },
      { model: 'claude-opus-5-5', signal: new AbortController().signal, timeoutMs: 1000 },
    );
    expect(result.failure).toBeNull();
    expect(result.match).toMatchObject({
      score: 100,
      recommendation: 'strong',
      gaps: ['Kubernetes'],
    });
  });

  it('builds a prompt that keeps each source in its own tag', () => {
    const prompt = buildMatchPrompt({ cvText: 'CV TEXT', profileText: '', job });
    expect(prompt).toContain('<cv>\nCV TEXT\n</cv>');
    expect(prompt).toContain('<profile>\n(no profile details provided)\n</profile>');
    expect(prompt.indexOf('<job>')).toBeLessThan(prompt.indexOf('<cv>'));
  });

  it('uses a schema the Anthropic structured-output helper accepts', () => {
    expect(() => zodOutputFormat(modelMatchOutputSchema)).not.toThrow();
  });
});
