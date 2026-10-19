import { randomBytes, randomUUID } from 'node:crypto';
import { buildPdf, SYNTHETIC_CV_LINES } from '@job-agent/documents/testing';
import type { JobPostingDetail, ResumeDetail, TaskSummary } from '@job-agent/shared';
import { expect, test } from '@playwright/test';
import { waitForCv, waitForTask } from './helpers';

test.skip(!process.env.TEST_DATABASE_URL, 'Requires TEST_DATABASE_URL (run `pnpm db:up` first)');

const origin = 'http://localhost:3100';

const JOB_TEXT = `Junior Data Analyst
Example Company - Remote
Required skills: SQL, Python and Excel for reporting.
Experience: 2+ years in an analytics role.
You will build dashboards for the operations team, clean data, and present findings to
stakeholders every week. We offer flexible hours and a learning budget.`;

// The web app queues the work; the real worker (started by playwright.config.ts) runs it,
// through Redis, with the deterministic fake model.
test('a match analysis runs in the background worker and leaves a timeline', async ({
  request,
}) => {
  const signUp = await request.post('/api/auth/sign-up/email', {
    headers: { origin },
    data: {
      email: `${randomUUID()}@example.test`,
      password: randomBytes(18).toString('base64url'),
      name: 'E2E Tasks',
    },
  });
  expect(signUp.status()).toBe(200);

  const pdf = buildPdf([SYNTHETIC_CV_LINES, ['x'.repeat(250)]]);
  const upload = await request.post('/api/resumes', {
    headers: { origin },
    multipart: { file: { name: 'cv.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf) } },
  });
  expect(upload.status()).toBe(201);
  const cv = await waitForCv(
    request,
    (await upload.json()) as { resume: ResumeDetail; task: TaskSummary },
  );
  expect(cv.extractionStatus).toBe('EXTRACTED');

  expect(
    (
      await request.patch('/api/settings', {
        headers: { origin },
        data: { aiProcessingConsent: true },
      })
    ).ok(),
  ).toBe(true);
  const created = await request.post('/api/jobs', {
    headers: { origin },
    data: {
      title: 'Junior Data Analyst',
      company: 'Example Company',
      location: null,
      url: null,
      description: JOB_TEXT,
    },
  });
  const { job } = (await created.json()) as { job: { id: string } };

  // 1. Start: answers at once with a queued task.
  const started = await request.post(`/api/jobs/${job.id}/analyze`, { headers: { origin } });
  expect(started.status()).toBe(202);
  const { task } = (await started.json()) as { task: TaskSummary };
  expect(task).toMatchObject({ kind: 'job_match_analysis', active: true });

  // 2. The worker runs it.
  const done = await waitForTask(request, task.id);
  expect(done).toMatchObject({
    state: 'COMPLETED',
    output: { score: 50, recommendation: 'possible' },
  });
  expect(done.events.map((e) => e.toState)).toEqual(['QUEUED', 'RUNNING', 'COMPLETED']);
  expect(done.attempts).toMatchObject([{ attempt: 1, outcome: 'succeeded' }]);

  // 3. The result is on the job, and the Activity page lists the task.
  const detail = (await (await request.get(`/api/jobs/${job.id}`)).json()) as {
    job: JobPostingDetail;
  };
  expect(detail.job.match?.score).toBe(50);
  const activity = await request.get('/app/activity');
  expect(activity.status()).toBe(200);
  expect(await activity.text()).toContain('Match analysis');
});
