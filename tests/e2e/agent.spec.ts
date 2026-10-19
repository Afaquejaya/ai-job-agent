import { randomBytes, randomUUID } from 'node:crypto';
import { buildPdf, SYNTHETIC_CV_LINES } from '@job-agent/documents/testing';
import type {
  AgentStreamEvent,
  JobPostingDetail,
  ResumeDetail,
  TaskSummary,
} from '@job-agent/shared';
import { expect, test } from '@playwright/test';
import { waitForCv } from './helpers';

test.skip(!process.env.TEST_DATABASE_URL, 'Requires TEST_DATABASE_URL (run `pnpm db:up` first)');

const origin = 'http://localhost:3100';

const JOB_TEXT = `Junior Data Analyst
Example Company - Remote
Required skills: SQL, Python and Excel for reporting.
Experience: 2+ years in an analytics role.
You will build dashboards for the operations team, clean data, and present findings to
stakeholders every week. We offer flexible hours and a learning budget.`;

// Runs against the deterministic fake model (AI_PROVIDER=fake in playwright.config.ts).
test('consent, paste a job to the agent, and get an evidence-checked match', async ({
  request,
}) => {
  const signUp = await request.post('/api/auth/sign-up/email', {
    headers: { origin },
    data: {
      email: `${randomUUID()}@example.test`,
      password: randomBytes(18).toString('base64url'),
      name: 'E2E Agent',
    },
  });
  expect(signUp.status()).toBe(200);

  const pdf = buildPdf([SYNTHETIC_CV_LINES, ['x'.repeat(250)]]);
  const upload = await request.post('/api/resumes', {
    headers: { origin },
    multipart: { file: { name: 'cv.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf) } },
  });
  expect(upload.status()).toBe(201);
  // The agent needs the CV text: wait for the background extraction to finish.
  const cv = await waitForCv(
    request,
    (await upload.json()) as { resume: ResumeDetail; task: TaskSummary },
  );
  expect(cv.extractionStatus).toBe('EXTRACTED');

  // 1. Without consent nothing is sent to the model.
  const refused = await request.post('/api/agent/messages', {
    headers: { origin },
    data: { conversationId: null, message: JOB_TEXT },
  });
  expect(refused.status()).toBe(403);

  // 2. Allow AI processing.
  const consent = await request.patch('/api/settings', {
    headers: { origin },
    data: { aiProcessingConsent: true },
  });
  expect(consent.ok()).toBe(true);

  // 3. Paste the job: the turn streams back as NDJSON.
  const turn = await request.post('/api/agent/messages', {
    headers: { origin },
    data: { conversationId: null, message: JOB_TEXT },
    timeout: 60_000,
  });
  expect(turn.status()).toBe(200);
  const events = (await turn.text())
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as AgentStreamEvent);
  expect(
    events
      .filter((e) => e.type === 'tool_finished')
      .map((e) => e.type === 'tool_finished' && e.tool),
  ).toEqual(['save_job_posting', 'analyze_job_match']);
  const last = events.at(-1);
  expect(last?.type).toBe('turn_finished');

  // 4. The job and its match are saved; the invented quote was rejected.
  const jobs = (await (await request.get('/api/jobs')).json()) as { jobs: Array<{ id: string }> };
  expect(jobs.jobs).toHaveLength(1);
  const detail = (await (await request.get(`/api/jobs/${jobs.jobs[0]!.id}`)).json()) as {
    job: JobPostingDetail;
  };
  expect(detail.job.match).toMatchObject({ score: 50, recommendation: 'possible' });
  expect(detail.job.match!.factors.find((f) => f.factor === 'experience')!.assessment).toBe(
    'unknown',
  );

  // 5. The pages render.
  for (const path of ['/app/agent', '/app/jobs', '/app/settings', '/app']) {
    expect((await request.get(path)).status(), path).toBe(200);
  }
  expect(await (await request.get('/app/jobs')).text()).toContain('Junior Data Analyst');
});
