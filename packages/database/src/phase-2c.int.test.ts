import { randomUUID } from 'node:crypto';
import type { JobPostingInput, UserId } from '@job-agent/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ConflictError,
  createAgentRepository,
  createDatabaseClient,
  createJobRepository,
  createUsageRepository,
  createUserSettingsRepository,
  NotFoundError,
  startOfUtcMonth,
  type Database,
} from './index';

let db: Database;

async function createTestUser(): Promise<UserId> {
  const user = await db.user.create({
    data: { name: 'Integration Test', email: `${randomUUID()}@example.test` },
  });
  return user.id as UserId;
}

const DESCRIPTION = 'We are hiring a backend engineer to build TypeScript services. '.repeat(5);
const job = (overrides: Partial<JobPostingInput> = {}): JobPostingInput => ({
  url: null,
  title: 'Backend Engineer',
  company: 'Example GmbH',
  location: 'Berlin',
  description: DESCRIPTION,
  ...overrides,
});
const bytes = (text: string) => new Uint8Array(Buffer.from(text));

beforeAll(() => {
  const url = process.env.DATABASE_URL;
  if (!url || !new URL(url).pathname.endsWith('_test')) {
    throw new Error('Integration tests require TEST_DATABASE_URL pointing at a *_test database');
  }
  db = createDatabaseClient(url);
});

afterAll(async () => {
  await db?.$disconnect();
});

describe('job repository', () => {
  it('saves a job with an audit entry and lists it with its latest match', async () => {
    const userId = await createTestUser();
    const jobs = createJobRepository(db);
    const saved = await jobs.create(userId, job({ url: 'https://jobs.example.test/1' }));

    expect((await jobs.list(userId))[0]).toMatchObject({ id: saved.id, latestMatch: null });
    const audit = await db.auditLog.findFirst({ where: { userId, action: 'job.saved' } });
    expect(audit?.metadata).toEqual({ hasUrl: true });

    await jobs.saveMatch(userId, {
      jobPostingId: saved.id,
      resumeId: null,
      resumeVersion: null,
      model: 'claude-opus-5-5',
      score: 40,
      recommendation: 'weak',
      resultEncrypted: bytes('first'),
    });
    await jobs.saveMatch(userId, {
      jobPostingId: saved.id,
      resumeId: null,
      resumeVersion: null,
      model: 'claude-opus-5-5',
      score: 80,
      recommendation: 'strong',
      resultEncrypted: bytes('second'),
    });
    expect((await jobs.list(userId))[0]!.latestMatch).toMatchObject({
      score: 80,
      recommendation: 'strong',
    });
    expect((await jobs.require(userId, saved.id)).matches).toHaveLength(1);
  });

  it('refuses the same link twice for one user, but not for another user or without a link', async () => {
    const [a, b] = [await createTestUser(), await createTestUser()];
    const jobs = createJobRepository(db);
    const url = `https://jobs.example.test/${randomUUID()}`;
    const first = await jobs.create(a, job({ url }));

    const duplicate = await jobs.create(a, job({ url })).catch((e: unknown) => e);
    expect(duplicate).toBeInstanceOf(ConflictError);
    expect((duplicate as ConflictError).details).toEqual({ existingJobId: first.id });

    await expect(jobs.create(b, job({ url }))).resolves.toBeDefined();
    await jobs.create(a, job());
    await expect(jobs.create(a, job())).resolves.toBeDefined();
  });

  it("never exposes or changes another user's jobs", async () => {
    const [owner, other] = [await createTestUser(), await createTestUser()];
    const jobs = createJobRepository(db);
    const saved = await jobs.create(owner, job());

    expect(await jobs.find(other, saved.id)).toBeNull();
    expect(await jobs.list(other)).toEqual([]);
    await expect(jobs.require(other, saved.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(jobs.delete(other, saved.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      jobs.saveMatch(other, {
        jobPostingId: saved.id,
        resumeId: null,
        resumeVersion: null,
        model: 'm',
        score: 1,
        recommendation: 'weak',
        resultEncrypted: bytes('x'),
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await jobs.find(owner, saved.id)).not.toBeNull();
  });

  it('deletes a job with its matches and records the deletion', async () => {
    const userId = await createTestUser();
    const jobs = createJobRepository(db);
    const saved = await jobs.create(userId, job());
    await jobs.saveMatch(userId, {
      jobPostingId: saved.id,
      resumeId: null,
      resumeVersion: null,
      model: 'm',
      score: null,
      recommendation: 'insufficient_information',
      resultEncrypted: bytes('x'),
    });
    await jobs.delete(userId, saved.id);
    expect(await db.jobMatch.count({ where: { jobPostingId: saved.id } })).toBe(0);
    expect(
      await db.auditLog.count({ where: { userId, action: 'job.deleted', targetId: saved.id } }),
    ).toBe(1);
  });

  it('enforces the database checks even when the application is bypassed', async () => {
    const userId = await createTestUser();
    await expect(
      db.jobPosting.create({ data: { userId, ...job({ description: 'too short' }) } }),
    ).rejects.toThrow();
    await expect(
      db.jobPosting.create({ data: { userId, ...job({ url: 'javascript:alert(1)' }) } }),
    ).rejects.toThrow();
    const saved = await createJobRepository(db).create(userId, job());
    await expect(
      db.jobMatch.create({
        data: {
          userId,
          jobPostingId: saved.id,
          model: 'm',
          score: 101,
          recommendation: 'strong',
          resultEncrypted: bytes('x'),
        },
      }),
    ).rejects.toThrow();
    await expect(
      db.jobMatch.create({
        data: {
          userId,
          jobPostingId: saved.id,
          model: 'm',
          score: 50,
          recommendation: 'great',
          resultEncrypted: bytes('x'),
        },
      }),
    ).rejects.toThrow();
  });
});

describe('agent repository', () => {
  it('stores messages in order and counts them on the conversation', async () => {
    const userId = await createTestUser();
    const repo = createAgentRepository(db);
    const conversation = await repo.createConversation(userId, bytes('title'));
    await repo.addMessage(userId, conversation.id, { role: 'user', payloadEncrypted: bytes('q') });
    await repo.addMessage(userId, conversation.id, {
      role: 'assistant',
      payloadEncrypted: bytes('a'),
      model: 'claude-opus-5-5',
      stopReason: 'completed',
      stepCount: 3,
      costUsd: 0.012345,
    });

    const messages = await repo.listMessages(userId, conversation.id);
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(Number(messages[1]!.costUsd)).toBeCloseTo(0.012345, 6);
    expect((await repo.requireConversation(userId, conversation.id)).messageCount).toBe(2);
  });

  it('keeps conversations private and deletes their messages with them', async () => {
    const [owner, other] = [await createTestUser(), await createTestUser()];
    const repo = createAgentRepository(db);
    const conversation = await repo.createConversation(owner, bytes('title'));
    await repo.addMessage(owner, conversation.id, { role: 'user', payloadEncrypted: bytes('q') });

    expect(await repo.findConversation(other, conversation.id)).toBeNull();
    expect(await repo.listConversations(other)).toEqual([]);
    expect(await repo.listMessages(other, conversation.id)).toEqual([]);
    await expect(
      repo.addMessage(other, conversation.id, { role: 'user', payloadEncrypted: bytes('x') }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(repo.deleteConversation(other, conversation.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );

    await repo.deleteConversation(owner, conversation.id);
    expect(await db.agentMessage.count({ where: { conversationId: conversation.id } })).toBe(0);
  });
});

describe('usage repository', () => {
  it('sums only this calendar month (UTC) and only for the user', async () => {
    const [userId, other] = [await createTestUser(), await createTestUser()];
    const usage = createUsageRepository(db);
    const record = (estimatedCostUsd: number) => ({
      conversationId: null,
      purpose: 'chat',
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      inputTokens: 1000,
      outputTokens: 100,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      estimatedCostUsd,
      succeeded: true,
    });
    await usage.record(userId, record(0.25));
    await usage.record(userId, record(0.5));
    await usage.record(other, record(9));
    await db.aiUsageRecord.create({
      data: {
        userId,
        ...record(100),
        createdAt: new Date(startOfUtcMonth(new Date()).getTime() - 1000),
      },
    });

    expect(await usage.monthToDateCostUsd(userId)).toBeCloseTo(0.75, 6);
    expect(startOfUtcMonth(new Date('2026-10-19T23:30:00-05:00')).toISOString()).toBe(
      '2026-10-01T00:00:00.000Z',
    );
    await expect(usage.record(userId, record(-1))).rejects.toThrow();
  });
});

describe('AI processing consent', () => {
  it('is off by default, records when it was given, and can be withdrawn', async () => {
    const userId = await createTestUser();
    const settings = createUserSettingsRepository(db);
    expect(await settings.hasAiConsent(userId)).toBe(false);

    const given = await settings.update(userId, { aiProcessingConsent: true });
    expect(given.changedFields).toContain('aiProcessingConsent');
    expect(given.settings.aiProcessingConsentAt).not.toBeNull();
    expect(await settings.hasAiConsent(userId)).toBe(true);

    const withdrawn = await settings.update(userId, { aiProcessingConsent: false });
    expect(withdrawn.settings.aiProcessingConsentAt).toBeNull();
    expect(await settings.hasAiConsent(userId)).toBe(false);
  });
});
