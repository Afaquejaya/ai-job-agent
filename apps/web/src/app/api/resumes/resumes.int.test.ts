import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildDocx, buildPdf, SYNTHETIC_CV_LINES } from '@job-agent/documents/testing';
import {
  apiErrorSchema,
  type CandidateProfile,
  type ProfileAnswer,
  type ResumeDetail,
  type ResumeSummary,
} from '@job-agent/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { GET as getAnswers, POST as postAnswer } from '@/app/api/answers/route';
import { DELETE as archiveAnswer, PATCH as patchAnswer } from '@/app/api/answers/[id]/route';
import { POST as verifyAnswer } from '@/app/api/answers/[id]/verify/route';
import { GET as getProfile, PATCH as patchProfile } from '@/app/api/profile/route';
import { GET as listResumes, POST as uploadResume } from '@/app/api/resumes/route';
import { DELETE as deleteResume, GET as getResume } from '@/app/api/resumes/[id]/route';
import { GET as downloadResume } from '@/app/api/resumes/[id]/file/route';
import { POST as setPrimary } from '@/app/api/resumes/[id]/primary/route';
import { POST as applySuggestions } from '@/app/api/resumes/[id]/suggestions/apply/route';
import {
  assertTestDatabase,
  call,
  multipartFile,
  signUp,
  type TestUser,
} from '@/testing/integration';

const PDF = buildPdf([
  SYNTHETIC_CV_LINES,
  ['Projects: dashboards for synthetic data', 'x'.repeat(250)],
]);

async function upload(user: TestUser, bytes: Uint8Array, filename: string): Promise<Response> {
  const { body, headers } = await multipartFile(bytes, filename);
  return call(uploadResume, { user, method: 'POST', path: '/api/resumes', body, headers });
}

async function errorCode(response: Response): Promise<string> {
  return apiErrorSchema.parse(await response.json()).error.code;
}

let alice: TestUser;
let bob: TestUser;

beforeAll(async () => {
  assertTestDatabase();
  alice = await signUp();
  bob = await signUp();
});

describe('CV upload and processing', () => {
  let resume: ResumeDetail;

  it('accepts a PDF, extracts its text and finds contact suggestions with evidence', async () => {
    const response = await upload(alice, PDF, 'My CV (final).pdf');
    expect(response.status).toBe(201);
    resume = ((await response.json()) as { resume: ResumeDetail }).resume;

    expect(resume).toMatchObject({
      version: 1,
      isPrimary: true,
      extractionStatus: 'EXTRACTED',
      mimeType: 'application/pdf',
      originalFilename: 'My CV (final).pdf',
      pageCount: 2,
    });
    expect(resume.textPreview).toContain('Skills: SQL, Python, Power BI, Excel');
    expect(resume.suggestions.map((s) => [s.id, s.value, s.currentValue])).toEqual([
      ['profile:email', 'test.candidate@example.test', null],
      ['profile:phone', '+919876543210', null],
      ['answer:linkedin_url', 'https://www.linkedin.com/in/test-candidate', null],
    ]);
  });

  it('stores the file encrypted in private storage under a generated key', async () => {
    const root = process.env.STORAGE_LOCAL_DIR!;
    const dir = path.join(root, 'users', alice.userId, 'resumes');
    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[0-9a-f-]{36}$/); // a UUID, never the uploaded file name
    const onDisk = await readFile(path.join(dir, files[0]!));
    expect(onDisk.subarray(0, 5).toString()).not.toBe('%PDF-');
    expect(onDisk.toString('latin1')).not.toContain('test.candidate@example.test');
  });

  it('stores extracted text encrypted in the database', async () => {
    const { getDatabase } = await import('@/server/db');
    const row = await getDatabase().resume.findFirstOrThrow({ where: { id: resume.id } });
    expect(row.extractedTextEncrypted).not.toBeNull();
    expect(Buffer.from(row.extractedTextEncrypted!).toString('latin1')).not.toContain(
      'Skills: SQL',
    );
  });

  it('downloads the original bytes to the owner only, as an attachment', async () => {
    const response = await call(downloadResume, { user: alice, params: { id: resume.id } });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toMatch(/^attachment;/);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await response.arrayBuffer()).equals(Buffer.from(PDF))).toBe(true);

    expect((await call(downloadResume, { user: bob, params: { id: resume.id } })).status).toBe(404);
  });

  it("hides one user's CVs from another user completely", async () => {
    expect((await call(getResume, { user: bob, params: { id: resume.id } })).status).toBe(404);
    expect(
      (await call(setPrimary, { user: bob, method: 'POST', params: { id: resume.id } })).status,
    ).toBe(404);
    expect(
      (await call(deleteResume, { user: bob, method: 'DELETE', params: { id: resume.id } })).status,
    ).toBe(404);
    const list = (await (await call(listResumes, { user: bob })).json()) as {
      resumes: ResumeSummary[];
    };
    expect(list.resumes).toEqual([]);
  });

  it('rejects the same file again (checksum) with a pointer to the existing version', async () => {
    const response = await upload(alice, PDF, 'renamed copy.pdf');
    expect(response.status).toBe(409);
    const body = apiErrorSchema.parse(await response.json());
    expect(body.error.details).toMatchObject({ existingResumeId: resume.id, existingVersion: 1 });
  });

  it.each([
    [
      'a text file renamed to .pdf',
      new TextEncoder().encode('not really a pdf'),
      'cv.pdf',
      'unsupported_type',
    ],
    [
      'a macro-enabled Word file',
      buildDocx(['x'], { macroEnabled: true }),
      'cv.docx',
      'macro_enabled',
    ],
    ['an empty file', new Uint8Array(), 'cv.pdf', 'empty'],
  ])('rejects %s', async (_label, bytes, name, reason) => {
    const response = await upload(alice, bytes, name);
    expect(response.status).toBe(400);
    expect(apiErrorSchema.parse(await response.json()).error.details).toMatchObject({ reason });
  });

  it('refuses oversized uploads from the declared length, before reading the body', async () => {
    const response = await call(uploadResume, {
      user: alice,
      method: 'POST',
      path: '/api/resumes',
      body: 'x',
      headers: {
        'content-type': 'multipart/form-data; boundary=x',
        'content-length': String(20 * 1024 * 1024),
      },
    });
    expect(response.status).toBe(413);
  });

  it('marks a file with almost no text as NEEDS_REVIEW (e.g. a scanned CV)', async () => {
    const response = await upload(alice, buildDocx(['Scanned page']), 'scan.docx');
    expect(response.status).toBe(201);
    const scan = ((await response.json()) as { resume: ResumeDetail }).resume;
    expect(scan).toMatchObject({ version: 2, isPrimary: false, extractionStatus: 'NEEDS_REVIEW' });
    expect(scan.extractionError).toMatch(/OCR is not supported/);
  });

  it('applies only the selected suggestions; answers are created as unverified drafts', async () => {
    const response = await call(applySuggestions, {
      user: alice,
      method: 'POST',
      params: { id: resume.id },
      json: { suggestionIds: ['profile:email', 'answer:linkedin_url'] },
    });
    expect(response.status).toBe(200);

    const { profile } = (await (await call(getProfile, { user: alice })).json()) as {
      profile: CandidateProfile;
    };
    expect(profile.email).toBe('test.candidate@example.test');
    expect(profile.phone).toBeNull(); // not selected, so not applied

    const { answers } = (await (await call(getAnswers, { user: alice })).json()) as {
      answers: ProfileAnswer[];
    };
    expect(answers).toEqual([
      expect.objectContaining({
        questionKey: 'linkedin_url',
        status: 'DRAFT',
        usable: false,
        source: 'CV_SUGGESTION_CONFIRMED',
      }),
    ]);

    const unknown = await call(applySuggestions, {
      user: alice,
      method: 'POST',
      params: { id: resume.id },
      json: { suggestionIds: ['profile:fullName'] },
    });
    expect(unknown.status).toBe(400);
  });

  it('keeps exactly one primary version and protects deleting the last one', async () => {
    const list = (await (await call(listResumes, { user: alice })).json()) as {
      resumes: ResumeSummary[];
    };
    const scan = list.resumes.find((r) => r.version === 2)!;
    expect(
      (await call(setPrimary, { user: alice, method: 'POST', params: { id: scan.id } })).status,
    ).toBe(204);

    expect(
      (await call(deleteResume, { user: alice, method: 'DELETE', params: { id: scan.id } })).status,
    ).toBe(204);
    const after = (await (await call(listResumes, { user: alice })).json()) as {
      resumes: ResumeSummary[];
    };
    expect(after.resumes.map((r) => [r.version, r.isPrimary])).toEqual([[1, true]]);

    const last = await call(deleteResume, {
      user: alice,
      method: 'DELETE',
      params: { id: resume.id },
    });
    expect(last.status).toBe(409);
  });

  it('rejects invalid ids and unauthenticated requests', async () => {
    expect((await call(getResume, { user: alice, params: { id: 'not-a-uuid' } })).status).toBe(404);
    expect((await call(listResumes)).status).toBe(401);
  });
});

describe('profile API', () => {
  it('saves a valid partial update and leaves other fields unknown', async () => {
    const response = await call(patchProfile, {
      user: bob,
      method: 'PATCH',
      json: { fullName: 'Bob Example', noticePeriod: { days: 30, negotiable: true } },
    });
    expect(response.status).toBe(200);
    const { profile } = (await response.json()) as { profile: CandidateProfile };
    expect(profile).toMatchObject({
      fullName: 'Bob Example',
      noticePeriod: { days: 30, negotiable: true },
      skills: null,
    });
  });

  it.each([
    ['salary without currency', { expectedSalary: 100000 }],
    ['unknown field', { headline: 'x' }],
    ['invalid phone', { phone: '12345' }],
    ['unknown skill level', { skills: [{ name: 'SQL', level: 'guru', years: null }] }],
  ])('rejects %s with VALIDATION_FAILED', async (_label, json) => {
    const response = await call(patchProfile, { user: bob, method: 'PATCH', json });
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe('VALIDATION_FAILED');
  });
});

describe('answers API', () => {
  it('creates a draft, verifies it, and un-verifies it when the value changes', async () => {
    const created = await call(postAnswer, {
      user: bob,
      method: 'POST',
      json: { questionKey: 'notice_period_days', value: { number: 30 } },
    });
    expect(created.status).toBe(201);
    const { answer } = (await created.json()) as { answer: ProfileAnswer };
    expect(answer.usable).toBe(false);

    const verified = await call(verifyAnswer, {
      user: bob,
      method: 'POST',
      params: { id: answer.id },
    });
    expect(((await verified.json()) as { answer: ProfileAnswer }).answer.usable).toBe(true);

    const edited = await call(patchAnswer, {
      user: bob,
      method: 'PATCH',
      params: { id: answer.id },
      json: { value: { number: 45 } },
    });
    expect(((await edited.json()) as { answer: ProfileAnswer }).answer).toMatchObject({
      status: 'DRAFT',
      usable: false,
    });

    const invalid = await call(patchAnswer, {
      user: bob,
      method: 'PATCH',
      params: { id: answer.id },
      json: { value: { number: 999 } },
    });
    expect(invalid.status).toBe(400);

    expect(
      (await call(verifyAnswer, { user: alice, method: 'POST', params: { id: answer.id } })).status,
    ).toBe(404);
    expect(
      (await call(archiveAnswer, { user: bob, method: 'DELETE', params: { id: answer.id } }))
        .status,
    ).toBe(204);
  });

  it('refuses custom questions about protected characteristics', async () => {
    const response = await call(postAnswer, {
      user: bob,
      method: 'POST',
      json: {
        questionKey: 'custom:my-gender',
        questionText: 'What is your gender?',
        answerType: 'text',
        value: { text: 'x' },
      },
    });
    expect(response.status).toBe(400);
  });

  it('reports a duplicate active answer as a conflict', async () => {
    const json = { questionKey: 'willing_to_relocate', value: { value: true } };
    expect((await call(postAnswer, { user: bob, method: 'POST', json })).status).toBe(201);
    const duplicate = await call(postAnswer, { user: bob, method: 'POST', json });
    expect(duplicate.status).toBe(409);
  });
});
