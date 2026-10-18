import { describe, expect, it } from 'vitest';
import { userSettingsUpdateSchema } from './settings';

describe('userSettingsUpdateSchema', () => {
  it('accepts a valid partial update', () => {
    expect(
      userSettingsUpdateSchema.parse({
        timeZone: 'Asia/Kolkata',
        submissionMode: 'approve_each',
        dailyApplicationLimit: 0,
        targetCountries: ['IN', 'AE'],
      }),
    ).toMatchObject({ timeZone: 'Asia/Kolkata', dailyApplicationLimit: 0 });
  });

  it.each([
    ['an unknown time zone', { timeZone: 'Mars/Base' }],
    ['a limit above 50', { dailyApplicationLimit: 51 }],
    ['a negative limit', { dailyApplicationLimit: -1 }],
    ['a fractional limit', { dailyApplicationLimit: 2.5 }],
    ['an unknown submission mode', { submissionMode: 'yolo' }],
    ['a lower-case country code', { targetCountries: ['in'] }],
    ['duplicate countries', { targetCountries: ['IN', 'IN'] }],
    ['unknown fields', { isAdmin: true }],
    ['an empty update', {}],
  ])('rejects %s', (_label, input) => {
    expect(userSettingsUpdateSchema.safeParse(input).success).toBe(false);
  });
});
