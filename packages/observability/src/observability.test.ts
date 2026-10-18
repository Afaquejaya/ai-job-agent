import { describe, expect, it } from 'vitest';
import { createJsonLogger, isSensitiveKey, REDACTED, redact } from './index';

describe('isSensitiveKey', () => {
  it.each([
    'password',
    'apiKey',
    'OPENAI_API_KEY',
    'accessToken',
    'refresh_token',
    'Cookie',
    'otp',
  ])('redacts %s', (key) => expect(isSensitiveKey(key)).toBe(true));

  it.each(['inputTokens', 'tokenCount', 'userId', 'taskId', 'status'])('keeps %s', (key) =>
    expect(isSensitiveKey(key)).toBe(false),
  );
});

describe('redact', () => {
  it('redacts nested secrets and masks bearer tokens and emails', () => {
    expect(
      redact({
        provider: 'anthropic',
        headers: { authorization: 'Bearer abc.def' },
        note: 'sent with Bearer abc.def to jane@example.com',
        usage: { inputTokens: 120 },
      }),
    ).toEqual({
      provider: 'anthropic',
      headers: { authorization: REDACTED },
      note: `sent with Bearer ${REDACTED} to [EMAIL]`,
      usage: { inputTokens: 120 },
    });
  });
});

describe('createJsonLogger', () => {
  it('writes one redacted JSON line per event and respects the level', () => {
    const lines: string[] = [];
    const logger = createJsonLogger({
      service: 'test',
      level: 'info',
      sink: (line) => lines.push(line),
      now: () => new Date('2026-10-18T00:00:00.000Z'),
    }).child({ taskId: 't-1' });

    logger.debug('ignored');
    logger.info('task.transition', { from: 'QUEUED', to: 'PLANNING', apiKey: 'sk-live' });

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual({
      time: '2026-10-18T00:00:00.000Z',
      level: 'info',
      service: 'test',
      event: 'task.transition',
      taskId: 't-1',
      from: 'QUEUED',
      to: 'PLANNING',
      apiKey: REDACTED,
    });
  });
});
