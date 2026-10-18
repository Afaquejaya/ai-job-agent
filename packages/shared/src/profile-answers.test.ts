import { describe, expect, it } from 'vitest';
import {
  candidateProfileFieldsSchema,
  candidateProfileUpdateSchema,
  EMPTY_PROFILE_FIELDS,
  mentionsProtectedCharacteristic,
  validateAnswerValue,
  validateNewAnswer,
} from './index';

describe('candidate profile schema', () => {
  it('accepts an empty (all unknown) profile', () => {
    expect(candidateProfileFieldsSchema.safeParse(EMPTY_PROFILE_FIELDS).success).toBe(true);
  });

  it('accepts structured data in the documented shapes', () => {
    const profile = {
      ...EMPTY_PROFILE_FIELDS,
      fullName: 'Test Candidate',
      phone: '+919876543210',
      currentLocation: { city: 'Pune', countryCode: 'IN' },
      workExperience: [
        {
          company: 'Example Ltd',
          title: 'Analyst',
          startDate: '2020-01',
          endDate: null,
          current: true,
          location: null,
          summary: null,
        },
      ],
      skills: [{ name: 'SQL', level: 'advanced', years: 4 }],
      workAuthorization: [{ countryCode: 'AE', status: 'needs_sponsorship', validUntil: null }],
      noticePeriod: { days: 30, negotiable: true },
      expectedSalary: 1500000,
      salaryCurrency: 'INR',
    };
    expect(candidateProfileFieldsSchema.safeParse(profile).success).toBe(true);
  });

  it.each([
    ['local phone number', { phone: '9876543210' }],
    ['lower-case country', { currentLocation: { city: null, countryCode: 'in' } }],
    ['experience over 60 years', { totalExperienceMonths: 721 }],
    [
      'current role with an end date',
      {
        workExperience: [
          {
            company: 'A',
            title: 'B',
            startDate: '2020-01',
            endDate: '2021-01',
            current: true,
            location: null,
            summary: null,
          },
        ],
      },
    ],
    [
      'end before start',
      {
        workExperience: [
          {
            company: 'A',
            title: 'B',
            startDate: '2021-01',
            endDate: '2020-01',
            current: false,
            location: null,
            summary: null,
          },
        ],
      },
    ],
    [
      'duplicate skills',
      {
        skills: [
          { name: 'SQL', level: null, years: null },
          { name: 'sql', level: null, years: null },
        ],
      },
    ],
    [
      'two entries for one country',
      {
        workAuthorization: [
          { countryCode: 'IN', status: 'citizen', validUntil: null },
          { countryCode: 'IN', status: 'work_visa', validUntil: null },
        ],
      },
    ],
    ['salary without currency', { expectedSalary: 100 }],
    ['salary with 3 decimals', { expectedSalary: 1.234, salaryCurrency: 'INR' }],
    ['salary with 3 decimals (large)', { expectedSalary: 1234567.891, salaryCurrency: 'INR' }],
    ['unknown nested field', { skills: [{ name: 'SQL', level: null, years: null, rating: 5 }] }],
  ])('rejects %s', (_label, changes) => {
    expect(
      candidateProfileFieldsSchema.safeParse({ ...EMPTY_PROFILE_FIELDS, ...changes }).success,
    ).toBe(false);
  });

  it('accepts 2-decimal salaries that are inexact in floating point', () => {
    for (const expectedSalary of [1234567.89, 0.1, 19.99, 1000000.01]) {
      expect(
        candidateProfileFieldsSchema.safeParse({
          ...EMPTY_PROFILE_FIELDS,
          expectedSalary,
          salaryCurrency: 'INR',
        }).success,
      ).toBe(true);
    }
  });

  it('update schema rejects unknown fields and empty updates', () => {
    expect(candidateProfileUpdateSchema.safeParse({ headline: 'x' }).success).toBe(false);
    expect(candidateProfileUpdateSchema.safeParse({}).success).toBe(false);
    expect(candidateProfileUpdateSchema.safeParse({ currentRole: null }).success).toBe(true);
  });
});

describe('reusable answers', () => {
  it('validates catalog answers against their type, options and range', () => {
    expect(validateNewAnswer({ questionKey: 'notice_period_days', value: { number: 30 } }).ok).toBe(
      true,
    );
    expect(
      validateNewAnswer({ questionKey: 'notice_period_days', value: { number: 400 } }).ok,
    ).toBe(false);
    expect(validateNewAnswer({ questionKey: 'notice_period_days', value: { text: '30' } }).ok).toBe(
      false,
    );
    expect(
      validateNewAnswer({ questionKey: 'work_authorization_ae', value: { option: 'citizen' } }).ok,
    ).toBe(true);
    expect(
      validateNewAnswer({ questionKey: 'work_authorization_ae', value: { option: 'maybe' } }).ok,
    ).toBe(false);
    expect(
      validateNewAnswer({
        questionKey: 'expected_salary',
        value: { amount: 10, currency: 'AED', period: 'month' },
      }),
    ).toMatchObject({
      ok: true,
      value: { isSensitive: true },
    });
  });

  it('rejects unknown keys and incomplete custom questions', () => {
    expect(validateNewAnswer({ questionKey: 'favourite_colour', value: { text: 'blue' } }).ok).toBe(
      false,
    );
    expect(validateNewAnswer({ questionKey: 'custom:why-us', value: { text: 'x' } }).ok).toBe(
      false,
    );
    expect(
      validateNewAnswer({
        questionKey: 'custom:why-us',
        questionText: 'Why do you want to join us?',
        answerType: 'long_text',
        value: { text: 'Because…' },
      }).ok,
    ).toBe(true);
  });

  it.each([
    'What is your gender?',
    'Ethnicity',
    'Religion',
    'Do you have a disability?',
    'What is your age?',
    'Date of birth',
    'Marital status',
  ])('refuses to store answers about protected characteristics: %s', (questionText) => {
    const result = validateNewAnswer({
      questionKey: 'custom:q',
      questionText,
      answerType: 'text',
      value: { text: 'x' },
    });
    expect(result.ok).toBe(false);
  });

  it('does not flag ordinary words that merely contain those letters', () => {
    expect(mentionsProtectedCharacteristic('Which languages do you speak?')).toBe(false);
    expect(mentionsProtectedCharacteristic('Which agency referred you?')).toBe(false);
    expect(mentionsProtectedCharacteristic('Average order value')).toBe(false);
  });

  it('only accepts http(s) URLs', () => {
    expect(validateAnswerValue('url', { url: 'https://www.linkedin.com/in/x' }).ok).toBe(true);
    expect(validateAnswerValue('url', { url: 'javascript:alert(1)' }).ok).toBe(false);
  });
});
