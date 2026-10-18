import { createHash, randomUUID } from 'node:crypto';
import { validateNewAnswer, type UserId, type ValidatedAnswer } from '@job-agent/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ConflictError,
  createAnswerRepository,
  createAuditLog,
  createCandidateProfileRepository,
  createDatabaseClient,
  createResumeRepository,
  DomainValidationError,
  NotFoundError,
  type Database,
} from './index';

let db: Database;

async function createTestUser(): Promise<UserId> {
  const user = await db.user.create({
    data: { name: 'Integration Test', email: `${randomUUID()}@example.test` },
  });
  return user.id as UserId;
}

const newResume = (userId: string, content: string = randomUUID()) => ({
  originalFilename: 'cv.pdf',
  storageKey: `users/${userId}/resumes/${randomUUID()}`,
  mimeType: 'application/pdf',
  fileSizeBytes: 1234,
  checksum: createHash('sha256').update(content).digest('hex'),
});

function answer(input: Parameters<typeof validateNewAnswer>[0]): ValidatedAnswer {
  const result = validateNewAnswer(input);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

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

describe('candidate profile repository', () => {
  it('returns an all-null profile until something is saved', async () => {
    const profile = await createCandidateProfileRepository(db).getForUser(await createTestUser());
    expect(profile).toMatchObject({
      fullName: null,
      skills: null,
      expectedSalary: null,
      updatedAt: null,
    });
  });

  it('saves structured fields, round-trips decimals and JSON, and audits field names only', async () => {
    const userId = await createTestUser();
    const repo = createCandidateProfileRepository(db);
    const { changedFields } = await repo.update(userId, {
      fullName: 'Test Candidate',
      expectedSalary: 1234567.89,
      salaryCurrency: 'INR',
      skills: [{ name: 'SQL', level: 'advanced', years: 4 }],
    });
    expect(changedFields.sort()).toEqual([
      'expectedSalary',
      'fullName',
      'salaryCurrency',
      'skills',
    ]);

    const profile = await repo.getForUser(userId);
    expect(profile).toMatchObject({
      fullName: 'Test Candidate',
      expectedSalary: 1234567.89,
      skills: [{ name: 'SQL', level: 'advanced', years: 4 }],
    });

    const [entry] = await createAuditLog(db).listForUser(userId);
    expect(entry?.action).toBe('profile.updated');
    expect(JSON.stringify(entry?.metadata)).not.toMatch(/Test Candidate|1234567/);
  });

  it('validates the merged profile (salary needs a currency) and stores JSON null as SQL NULL', async () => {
    const userId = await createTestUser();
    const repo = createCandidateProfileRepository(db);
    await expect(repo.update(userId, { expectedSalary: 100 })).rejects.toThrow(
      DomainValidationError,
    );

    await repo.update(userId, { skills: [{ name: 'Excel', level: null, years: null }] });
    await repo.update(userId, { skills: null });
    const rows = await db.$queryRaw<Array<{ skills_is_null: boolean }>>`
      SELECT skills IS NULL AS skills_is_null FROM candidate_profiles WHERE user_id = ${userId}::uuid`;
    expect(rows[0]?.skills_is_null).toBe(true);
  });

  it("keeps one user's profile invisible to another", async () => {
    const [alice, bob] = [await createTestUser(), await createTestUser()];
    const repo = createCandidateProfileRepository(db);
    await repo.update(alice, { currentRole: 'Analyst' });
    expect((await repo.getForUser(bob)).currentRole).toBeNull();
  });

  it('rejects invalid JSON shapes at the database level too', async () => {
    const userId = await createTestUser();
    await expect(
      db.candidateProfile.create({ data: { userId, skills: { not: 'an array' } } }),
    ).rejects.toThrow();
  });
});

describe('resume repository', () => {
  it('numbers versions per user and makes only the first one primary', async () => {
    const userId = await createTestUser();
    const repo = createResumeRepository(db);
    const first = await repo.create(userId, newResume(userId));
    const second = await repo.create(userId, newResume(userId));
    expect([first.version, second.version]).toEqual([1, 2]);
    expect([first.isPrimary, second.isPrimary]).toEqual([true, false]);

    await repo.setPrimary(userId, second.id);
    const list = await repo.listForUser(userId);
    expect(list.filter((r) => r.isPrimary).map((r) => r.id)).toEqual([second.id]);
  });

  it('rejects the same file twice for one user, but not for different users', async () => {
    const [alice, bob] = [await createTestUser(), await createTestUser()];
    const repo = createResumeRepository(db);
    const input = newResume(alice, 'same-bytes');
    await repo.create(alice, input);
    await expect(
      repo.create(alice, { ...input, storageKey: `users/${alice}/resumes/${randomUUID()}` }),
    ).rejects.toThrow(ConflictError);
    await expect(repo.create(bob, newResume(bob, 'same-bytes'))).resolves.toBeDefined();
  });

  it('enforces at most one primary resume per user in the database', async () => {
    const userId = await createTestUser();
    const repo = createResumeRepository(db);
    const a = await repo.create(userId, newResume(userId));
    const b = await repo.create(userId, newResume(userId));
    expect(a.isPrimary).toBe(true);
    await expect(
      db.resume.update({ where: { id: b.id }, data: { isPrimary: true } }),
    ).rejects.toThrow();
  });

  it('protects the only primary CV from deletion and promotes the newest when deleting primary', async () => {
    const userId = await createTestUser();
    const repo = createResumeRepository(db);
    const v1 = await repo.create(userId, newResume(userId));
    await expect(repo.delete(userId, v1.id)).rejects.toThrow(ConflictError);

    const v2 = await repo.create(userId, newResume(userId));
    const v3 = await repo.create(userId, newResume(userId));
    const { storageKey } = await repo.delete(userId, v1.id);
    expect(storageKey).toBe(v1.storageKey);
    const list = await repo.listForUser(userId);
    expect(list.map((r) => [r.version, r.isPrimary])).toEqual([
      [3, true],
      [2, false],
    ]);
    expect(v2.id).toBeTruthy();
    expect(v3.id).toBeTruthy();
  });

  it("treats another user's resume exactly like a missing one", async () => {
    const [alice, bob] = [await createTestUser(), await createTestUser()];
    const repo = createResumeRepository(db);
    const resume = await repo.create(alice, newResume(alice));
    expect(await repo.findForUser(bob, resume.id)).toBeNull();
    await expect(repo.setPrimary(bob, resume.id)).rejects.toThrow(NotFoundError);
    await expect(repo.delete(bob, resume.id)).rejects.toThrow(NotFoundError);
    await expect(repo.markProcessing(bob, resume.id)).rejects.toThrow(NotFoundError);
    expect(await repo.listForUser(bob)).toEqual([]);
  });

  it('counts uploads for the daily rate limit from the audit log', async () => {
    const userId = await createTestUser();
    const repo = createResumeRepository(db);
    await repo.create(userId, newResume(userId));
    await repo.create(userId, newResume(userId));
    expect(await repo.countUploadsSince(userId, new Date(Date.now() - 60_000))).toBe(2);
  });
});

describe('answer repository', () => {
  it('creates drafts, verifies them, and un-verifies on value change', async () => {
    const userId = await createTestUser();
    const repo = createAnswerRepository(db);
    const created = await repo.create(
      userId,
      answer({ questionKey: 'notice_period_days', value: { number: 30 } }),
    );
    expect(created).toMatchObject({ status: 'DRAFT', usable: false, verifiedAt: null });

    const verified = await repo.verify(userId, created.id);
    expect(verified).toMatchObject({ status: 'VERIFIED', usable: true });

    const sameValue = await repo.update(userId, created.id, { value: { number: 30 } });
    expect(sameValue.status).toBe('VERIFIED');

    const changed = await repo.update(userId, created.id, { value: { number: 60 } });
    expect(changed).toMatchObject({
      status: 'DRAFT',
      usable: false,
      verifiedAt: null,
      value: { number: 60 },
    });
  });

  it('allows one active answer per question, and a new one after archiving', async () => {
    const userId = await createTestUser();
    const repo = createAnswerRepository(db);
    const input = answer({ questionKey: 'willing_to_relocate', value: { value: true } });
    const first = await repo.create(userId, input);
    await expect(repo.create(userId, input)).rejects.toThrow(ConflictError);

    await repo.archive(userId, first.id);
    expect(await repo.list(userId)).toEqual([]);
    expect(await repo.list(userId, { includeArchived: true })).toHaveLength(1);
    await expect(repo.create(userId, input)).resolves.toMatchObject({ status: 'DRAFT' });
    await expect(repo.verify(userId, first.id)).rejects.toThrow(ConflictError);
  });

  it('isolates answers between users and never audits answer values', async () => {
    const [alice, bob] = [await createTestUser(), await createTestUser()];
    const repo = createAnswerRepository(db);
    const salary = await repo.create(
      alice,
      answer({
        questionKey: 'expected_salary',
        value: { amount: 987654, currency: 'INR', period: 'year' },
      }),
    );
    expect(await repo.list(bob)).toEqual([]);
    await expect(repo.verify(bob, salary.id)).rejects.toThrow(NotFoundError);
    await expect(repo.archive(bob, salary.id)).rejects.toThrow(NotFoundError);

    const audit = await createAuditLog(db).listForUser(alice);
    expect(audit.map((a) => a.action)).toContain('answer.created');
    expect(JSON.stringify(audit)).not.toContain('987654');
  });

  it('keeps status and verified_at consistent in the database', async () => {
    const userId = await createTestUser();
    const created = await createAnswerRepository(db).create(
      userId,
      answer({ questionKey: 'github_url', value: { url: 'https://github.com/example' } }),
    );
    await expect(
      db.profileAnswer.update({ where: { id: created.id }, data: { status: 'VERIFIED' } }),
    ).rejects.toThrow();
  });
});
