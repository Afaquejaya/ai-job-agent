import { buildPdf, SYNTHETIC_CV_LINES } from '@job-agent/documents/testing';
import {
  apiErrorSchema,
  type AgentChatMessage,
  type AgentConversationSummary,
  type AgentStreamEvent,
  type AiUsageStatus,
  type JobPostingDetail,
  type JobPostingSummary,
  type ResumeDetail,
} from '@job-agent/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { GET as getUsage } from '@/app/api/ai/usage/route';
import { GET as listConversations } from '@/app/api/agent/conversations/route';
import {
  DELETE as deleteConversation,
  GET as getConversation,
} from '@/app/api/agent/conversations/[id]/route';
import { POST as sendMessage } from '@/app/api/agent/messages/route';
import { GET as listJobs, POST as createJob } from '@/app/api/jobs/route';
import { DELETE as deleteJob, GET as getJob } from '@/app/api/jobs/[id]/route';
import { POST as analyzeJob } from '@/app/api/jobs/[id]/analyze/route';
import { POST as uploadResume } from '@/app/api/resumes/route';
import { PATCH as patchSettings } from '@/app/api/settings/route';
import { getDatabase } from '@/server/db';
import { resetWebEnvForTests } from '@/server/env';
import {
  assertTestDatabase,
  call,
  multipartFile,
  signUp,
  type TestUser,
} from '@/testing/integration';

/**
 * The first agent end to end through the real route handlers, database and encryption, with
 * the deterministic fake model (AI_PROVIDER=fake in vitest.integration.config.ts). No data
 * leaves the machine.
 */

const JOB_TEXT = `Junior Data Analyst
Example Company - Remote
Required skills: SQL, Python and Excel for reporting.
Experience: 2+ years in an analytics role.
You will build dashboards for the operations team, clean data, and present findings to
stakeholders every week. We offer flexible hours and a learning budget.`;

const CV = buildPdf([
  SYNTHETIC_CV_LINES,
  ['Projects: dashboards for synthetic data', 'x'.repeat(250)],
]);

async function errorBody(response: Response) {
  return apiErrorSchema.parse(await response.json()).error;
}

async function readEvents(response: Response): Promise<AgentStreamEvent[]> {
  expect(response.headers.get('content-type')).toContain('application/x-ndjson');
  const text = await response.text();
  return text
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as AgentStreamEvent);
}

const send = (user: TestUser, message: string, conversationId: string | null = null) =>
  call(sendMessage, {
    user,
    method: 'POST',
    path: '/api/agent/messages',
    json: { conversationId, message },
  });

const consent = (user: TestUser, value = true) =>
  call(patchSettings, {
    user,
    method: 'PATCH',
    path: '/api/settings',
    json: { aiProcessingConsent: value },
  });

async function uploadCv(user: TestUser) {
  const { body, headers } = await multipartFile(CV, 'cv.pdf');
  const response = await call(uploadResume, {
    user,
    method: 'POST',
    path: '/api/resumes',
    body,
    headers,
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { resume: ResumeDetail }).resume;
}

const finished = (events: AgentStreamEvent[]) => {
  const last = events.at(-1);
  if (last?.type !== 'turn_finished')
    throw new Error(`turn did not finish: ${JSON.stringify(last)}`);
  return last;
};

let alice: TestUser;
let bob: TestUser;

beforeAll(async () => {
  assertTestDatabase();
  alice = await signUp();
  bob = await signUp();
  await uploadCv(alice);
});

describe('AI consent and configuration', () => {
  it('reports the fake provider, no consent and no spend for a new user', async () => {
    const response = await call(getUsage, { user: alice, path: '/api/ai/usage' });
    expect(response.status).toBe(200);
    const { usage } = (await response.json()) as { usage: AiUsageStatus };
    expect(usage).toMatchObject({
      configured: true,
      consentGiven: false,
      provider: 'fake',
      monthToDateUsd: 0,
    });
  });

  it('refuses to run the agent before the user allows AI processing, and stores nothing', async () => {
    const response = await send(alice, 'Hello');
    expect(response.status).toBe(403);
    expect(await errorBody(response)).toMatchObject({
      code: 'FORBIDDEN',
      details: { reason: 'consent_required' },
    });
    const list = await call(listConversations, { user: alice, path: '/api/agent/conversations' });
    expect(((await list.json()) as { conversations: unknown[] }).conversations).toEqual([]);
  });

  it('answers 503 when AI is not configured', async () => {
    const previous = process.env.AI_MONTHLY_BUDGET_USD;
    process.env.AI_MONTHLY_BUDGET_USD = '';
    resetWebEnvForTests();
    try {
      await consent(bob);
      const response = await send(bob, 'Hello');
      expect(response.status).toBe(503);
      expect(await errorBody(response)).toMatchObject({ code: 'AI_UNAVAILABLE' });
      const usage = (await (await call(getUsage, { user: bob, path: '/api/ai/usage' })).json()) as {
        usage: AiUsageStatus;
      };
      expect(usage.usage).toMatchObject({ configured: false, model: null });
      expect(usage.usage.unavailableReason).toMatch(/AI_MONTHLY_BUDGET_USD/);
    } finally {
      process.env.AI_MONTHLY_BUDGET_USD = previous;
      resetWebEnvForTests();
    }
  });
});

describe('agent chat', () => {
  let conversationId: string;
  let jobId: string;

  it('streams a simple turn and stores the conversation', async () => {
    expect((await consent(alice)).status).toBe(200);
    const response = await send(alice, 'Hello, what can you do?');
    expect(response.status).toBe(200);
    const events = await readEvents(response);
    expect(events[0]).toMatchObject({ type: 'turn_started' });
    conversationId = (events[0] as Extract<AgentStreamEvent, { type: 'turn_started' }>)
      .conversationId;
    expect(finished(events).message).toMatchObject({ role: 'assistant', stopReason: 'completed' });
    expect(finished(events).message.content).toMatch(/Paste a job description/);
  });

  it('saves a pasted job exactly, analyses it with checked evidence, and streams every step', async () => {
    const response = await send(alice, JOB_TEXT, conversationId);
    const events = await readEvents(response);

    expect(events.map((e) => e.type)).toEqual([
      'turn_started',
      'thinking',
      'tool_started',
      'tool_finished',
      'thinking',
      'tool_started',
      'tool_finished',
      'text_delta',
      'thinking',
      'turn_finished',
    ]);
    const tools = events.filter((e) => e.type === 'tool_finished');
    expect(tools.map((t) => [t.tool, t.ok])).toEqual([
      ['save_job_posting', true],
      ['analyze_job_match', true],
    ]);
    const done = finished(events);
    expect(done.message.content).toContain('Score: 50/100 (possible)');
    expect(done.usage).toMatchObject({ modelCalls: 3 });
    expect(done.usage.costUsd).toBeGreaterThan(0);

    const jobs = (await (await call(listJobs, { user: alice, path: '/api/jobs' })).json()) as {
      jobs: JobPostingSummary[];
    };
    expect(jobs.jobs).toHaveLength(1);
    expect(jobs.jobs[0]!.latestMatch).toMatchObject({ score: 50, recommendation: 'possible' });
    jobId = jobs.jobs[0]!.id;

    const detail = (await (
      await call(getJob, { user: alice, path: `/api/jobs/${jobId}`, params: { id: jobId } })
    ).json()) as {
      job: JobPostingDetail;
    };
    expect(detail.job.description).toBe(JOB_TEXT.trim()); // the pasted text, not a model rewrite
    const experience = detail.job.match!.factors.find((f) => f.factor === 'experience')!;
    // The fake model invented a CV quote for experience; the server caught it.
    expect(experience).toMatchObject({
      assessment: 'unknown',
      cvEvidence: null,
      evidenceVerified: false,
    });
    expect(detail.job.match!.factors.find((f) => f.factor === 'skills')).toMatchObject({
      assessment: 'partial',
      cvEvidence: 'Skills: SQL, Python, Power BI, Excel',
    });
  });

  it('keeps the full history with step traces, encrypted at rest', async () => {
    const response = await call(getConversation, {
      user: alice,
      path: `/api/agent/conversations/${conversationId}`,
      params: { id: conversationId },
    });
    const { messages } = (await response.json()) as { messages: AgentChatMessage[] };
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(messages[2]!.content).toBe(JOB_TEXT);
    expect(messages[3]!.trace.filter((t) => t.type === 'tool')).toHaveLength(2);
    expect(Number(messages[3]!.costUsd)).toBeGreaterThan(0);

    const list = (await (
      await call(listConversations, { user: alice, path: '/api/agent/conversations' })
    ).json()) as {
      conversations: AgentConversationSummary[];
    };
    expect(list.conversations[0]).toMatchObject({
      id: conversationId,
      title: 'Hello, what can you do?',
      messageCount: 4,
    });

    const rows = await getDatabase().agentMessage.findMany({ where: { conversationId } });
    for (const row of rows) {
      expect(Buffer.from(row.payloadEncrypted).toString('utf8')).not.toContain(
        'Junior Data Analyst',
      );
    }
    const match = await getDatabase().jobMatch.findFirstOrThrow({ where: { jobPostingId: jobId } });
    expect(Buffer.from(match.resultEncrypted).toString('utf8')).not.toContain('Power BI');

    // Audit entries record what happened, never the job, CV or message text.
    const audit = await getDatabase().auditLog.findMany({ where: { userId: alice.userId } });
    expect(audit.map((a) => a.action)).toContain('job.saved');
    const metadata = JSON.stringify(audit.map((a) => a.metadata));
    for (const secret of ['Junior Data Analyst', 'SQL', 'Power BI', 'Hello, what can you do?']) {
      expect(metadata).not.toContain(secret);
    }
  });

  it('records the cost of every model call against the monthly budget', async () => {
    const records = await getDatabase().aiUsageRecord.findMany({ where: { userId: alice.userId } });
    expect(records.filter((r) => r.purpose === 'chat')).toHaveLength(4);
    expect(records.filter((r) => r.purpose === 'job_matching')).toHaveLength(1);
    const { usage } = (await (
      await call(getUsage, { user: alice, path: '/api/ai/usage' })
    ).json()) as {
      usage: AiUsageStatus;
    };
    const total = records.reduce((sum, r) => sum + Number(r.estimatedCostUsd), 0);
    expect(usage.monthToDateUsd).toBeCloseTo(total, 6);
  });

  it("never lets another user read, continue, analyse or delete Alice's data", async () => {
    await consent(bob);
    const asBob = { user: bob, params: { id: conversationId } };
    expect(
      (await call(getConversation, { ...asBob, path: '/api/agent/conversations/x' })).status,
    ).toBe(404);
    expect((await call(deleteConversation, { ...asBob, method: 'DELETE' })).status).toBe(404);
    expect((await send(bob, 'Hello', conversationId)).status).toBe(404);

    const job = { user: bob, params: { id: jobId } };
    expect((await call(getJob, job)).status).toBe(404);
    expect((await call(analyzeJob, { ...job, method: 'POST' })).status).toBe(404);
    expect((await call(deleteJob, { ...job, method: 'DELETE' })).status).toBe(404);
    expect(
      ((await (await call(listJobs, { user: bob })).json()) as { jobs: unknown[] }).jobs,
    ).toEqual([]);
  });

  it('refuses a conversation that reached the turn limit', async () => {
    await getDatabase().agentConversation.update({
      where: { id: conversationId },
      data: { messageCount: 40 },
    });
    const response = await send(alice, 'One more?', conversationId);
    expect(response.status).toBe(409);
  });

  it('deletes a conversation but keeps the saved job', async () => {
    const response = await call(deleteConversation, {
      user: alice,
      method: 'DELETE',
      params: { id: conversationId },
    });
    expect(response.status).toBe(204);
    expect(await getDatabase().agentMessage.count({ where: { conversationId } })).toBe(0);
    expect((await call(getJob, { user: alice, params: { id: jobId } })).status).toBe(200);
  });
});

describe('jobs API', () => {
  it('validates pasted jobs and refuses a duplicate link', async () => {
    const base = {
      title: 'Analyst',
      company: 'Example',
      location: null,
      url: null,
      description: JOB_TEXT,
    };
    const post = (json: unknown) =>
      call(createJob, { user: bob, method: 'POST', path: '/api/jobs', json });

    expect((await post({ ...base, description: 'Too short' })).status).toBe(400);
    expect((await post({ ...base, url: 'javascript:alert(1)' })).status).toBe(400);
    expect((await post({ ...base, extra: true })).status).toBe(400);
    const url = 'https://jobs.example.test/analyst';
    expect((await post({ ...base, url })).status).toBe(201);
    const duplicate = await post({ ...base, url });
    expect(duplicate.status).toBe(409);
    expect((await errorBody(duplicate)).details).toMatchObject({
      existingJobId: expect.any(String),
    });
  });

  it('explains what is missing when there is no CV to compare against', async () => {
    const response = await call(createJob, {
      user: bob,
      method: 'POST',
      path: '/api/jobs',
      json: {
        title: 'Analyst',
        company: 'Example',
        location: null,
        url: null,
        description: JOB_TEXT,
      },
    });
    const { job } = (await response.json()) as { job: { id: string } };
    const analysis = await call(analyzeJob, { user: bob, method: 'POST', params: { id: job.id } });
    expect(analysis.status).toBe(422);
    expect(await errorBody(analysis)).toMatchObject({
      code: 'AI_FAILED',
      message: expect.stringMatching(/Upload a CV/),
    });
  });

  it('runs a standalone analysis and deletes a job with its results', async () => {
    const response = await call(createJob, {
      user: alice,
      method: 'POST',
      path: '/api/jobs',
      json: {
        title: 'Data Analyst',
        company: 'Example',
        location: null,
        url: null,
        description: JOB_TEXT,
      },
    });
    const { job } = (await response.json()) as { job: { id: string } };
    const analysis = await call(analyzeJob, {
      user: alice,
      method: 'POST',
      params: { id: job.id },
    });
    expect(analysis.status).toBe(200);
    expect(((await analysis.json()) as { match: { score: number } }).match.score).toBe(50);

    expect(
      (await call(deleteJob, { user: alice, method: 'DELETE', params: { id: job.id } })).status,
    ).toBe(204);
    expect(await getDatabase().jobMatch.count({ where: { jobPostingId: job.id } })).toBe(0);
  });
});

describe('monthly budget', () => {
  it('stops the agent and the analysis once the budget is used up', async () => {
    const carol = await signUp();
    await consent(carol);
    await uploadCv(carol);
    await getDatabase().aiUsageRecord.create({
      data: {
        userId: carol.userId,
        purpose: 'chat',
        provider: 'anthropic',
        model: 'claude-opus-5-5',
        inputTokens: 1,
        outputTokens: 1,
        estimatedCostUsd: 5,
        succeeded: true,
      },
    });

    const events = await readEvents(await send(carol, 'Hello'));
    expect(finished(events).message).toMatchObject({ stopReason: 'budget_exhausted' });
    expect(finished(events).message.content).toMatch(/budget/);

    const created = await call(createJob, {
      user: carol,
      method: 'POST',
      path: '/api/jobs',
      json: {
        title: 'Analyst',
        company: 'Example',
        location: null,
        url: null,
        description: JOB_TEXT,
      },
    });
    const { job } = (await created.json()) as { job: { id: string } };
    const analysis = await call(analyzeJob, {
      user: carol,
      method: 'POST',
      params: { id: job.id },
    });
    expect(analysis.status).toBe(422);
    expect((await errorBody(analysis)).message).toMatch(/budget/);
  });
});

describe('local model (Ollama) not running', () => {
  it('says so clearly in the chat and on the Analyse button, at no cost', async () => {
    const previous = { ...process.env };
    // Port 9 (discard): nothing listens there, so the connection is refused at once.
    process.env.AI_PROVIDER = 'ollama';
    process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:9';
    process.env.AI_MONTHLY_BUDGET_USD = '';
    resetWebEnvForTests();
    try {
      const dave = await signUp();
      await consent(dave);
      await uploadCv(dave);

      const status = (await (await call(getUsage, { user: dave })).json()) as {
        usage: AiUsageStatus;
      };
      expect(status.usage).toMatchObject({
        configured: true,
        provider: 'ollama',
        runsLocally: true,
        monthlyBudgetUsd: null,
      });

      const events = await readEvents(await send(dave, 'Hello'));
      const message = finished(events).message;
      expect(message.stopReason).toBe('error');
      expect(message.content).toMatch(/Ollama is not running/);

      const created = await call(createJob, {
        user: dave,
        method: 'POST',
        json: {
          title: 'Analyst',
          company: 'Example',
          location: null,
          url: null,
          description: JOB_TEXT,
        },
      });
      const { job } = (await created.json()) as { job: { id: string } };
      const analysis = await call(analyzeJob, {
        user: dave,
        method: 'POST',
        params: { id: job.id },
      });
      expect(analysis.status).toBe(422);
      expect((await errorBody(analysis)).message).toMatch(/Ollama is not running/);
    } finally {
      process.env = previous;
      resetWebEnvForTests();
    }
  });
});
