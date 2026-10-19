import { randomBytes, randomUUID } from 'node:crypto';
import { buildPdf, SYNTHETIC_CV_LINES } from '@job-agent/documents/testing';
import type { ProfileAnswer, ResumeDetail, TaskSummary } from '@job-agent/shared';
import { expect, test } from '@playwright/test';
import { waitForCv } from './helpers';

test.skip(!process.env.TEST_DATABASE_URL, 'Requires TEST_DATABASE_URL (run `pnpm db:up` first)');

const origin = 'http://localhost:3100';

test('upload a CV, accept a suggestion, complete the profile and verify an answer', async ({
  request,
}) => {
  const signUp = await request.post('/api/auth/sign-up/email', {
    headers: { origin },
    data: {
      email: `${randomUUID()}@example.test`,
      password: randomBytes(18).toString('base64url'),
      name: 'E2E CV',
    },
  });
  expect(signUp.status()).toBe(200);

  // 1. Upload a synthetic CV (no real personal data).
  const pdf = buildPdf([SYNTHETIC_CV_LINES, ['x'.repeat(250)]]);
  const upload = await request.post('/api/resumes', {
    headers: { origin },
    multipart: {
      file: { name: 'synthetic-cv.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf) },
    },
  });
  expect(upload.status()).toBe(201);
  const uploaded = (await upload.json()) as { resume: ResumeDetail; task: TaskSummary };
  expect(uploaded.task).toMatchObject({ kind: 'cv_processing', active: true });
  // Text extraction runs in the background worker (Phase 3).
  const resume = await waitForCv(request, uploaded);
  expect(resume.extractionStatus).toBe('EXTRACTED');
  expect(resume.suggestions.map((s) => s.id)).toContain('profile:phone');

  // 2. Accept only the phone suggestion.
  const apply = await request.post(`/api/resumes/${resume.id}/suggestions/apply`, {
    headers: { origin },
    data: { suggestionIds: ['profile:phone'] },
  });
  expect(apply.ok()).toBe(true);

  // 3. Fill in more of the profile by hand.
  const profile = await request.patch('/api/profile', {
    headers: { origin },
    data: { fullName: 'E2E Candidate', currentRole: 'Data Analyst', totalExperienceMonths: 60 },
  });
  expect(profile.ok()).toBe(true);
  expect(await profile.json()).toMatchObject({
    profile: { fullName: 'E2E Candidate', phone: '+919876543210', email: null },
  });

  // 4. Save and verify a reusable answer.
  const created = await request.post('/api/answers', {
    headers: { origin },
    data: { questionKey: 'notice_period_days', value: { number: 30 } },
  });
  expect(created.status()).toBe(201);
  const { answer } = (await created.json()) as { answer: ProfileAnswer };
  const verified = await request.post(`/api/answers/${answer.id}/verify`, { headers: { origin } });
  expect(((await verified.json()) as { answer: ProfileAnswer }).answer.usable).toBe(true);

  // 5. The pages render for the signed-in user.
  for (const path of ['/app/profile', '/app/resumes', '/app/answers']) {
    const page = await request.get(path);
    expect(page.status(), path).toBe(200);
  }
  expect(await (await request.get('/app/resumes')).text()).toContain('synthetic-cv.pdf');
});
