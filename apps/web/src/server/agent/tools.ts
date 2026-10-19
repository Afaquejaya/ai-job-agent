import { ToolError, type AgentTool } from '@job-agent/agent-core';
import {
  ConflictError,
  createAnswerRepository,
  createCandidateProfileRepository,
  createJobRepository,
  NotFoundError,
} from '@job-agent/database';
import { jobPostingInputSchema, type UserId } from '@job-agent/shared';
import { z } from 'zod';
import type { AiLimits } from '../ai';
import { getDatabase } from '../db';
import { MatchAnalysisError, runMatchAnalysis } from '../matching';
import { getPrimaryResumeText } from '../resumes';

/**
 * The ONLY actions the agent can take (Phase 2C). All are scoped to the signed-in user by the
 * server; the model never supplies a user id. None reaches outside this system: no applying,
 * no sending, no browsing, no profile changes.
 */

const noInput = {
  input: z.object({}).strict(),
  inputJsonSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
};

function tool<I>(definition: AgentTool<I>): AgentTool<never> {
  return definition as unknown as AgentTool<never>;
}

export function buildAgentTools(
  userId: UserId,
  conversationId: string,
  limits: AiLimits,
): AgentTool<never>[] {
  const db = getDatabase();

  return [
    tool({
      name: 'get_my_profile',
      description:
        "Read the user's candidate profile. Returns the fields the user provided and lists the fields not provided (unknown).",
      ...noInput,
      timeoutMs: 10_000,
      async execute() {
        const profile = await createCandidateProfileRepository(db).getForUser(userId);
        const entries = Object.entries(profile).filter(([key]) => key !== 'updatedAt');
        const provided = Object.fromEntries(entries.filter(([, value]) => value !== null));
        const notProvided = entries.filter(([, value]) => value === null).map(([key]) => key);
        return {
          result: { provided, notProvided },
          summary: `${Object.keys(provided).length} fields provided, ${notProvided.length} not provided`,
        };
      },
    }),

    tool({
      name: 'get_my_verified_answers',
      description:
        "Read the user's VERIFIED reusable answers to common application questions (notice period, salary expectations, work authorization, ...). Draft answers are not included.",
      ...noInput,
      timeoutMs: 10_000,
      async execute() {
        const answers = (await createAnswerRepository(db).list(userId)).filter((a) => a.usable);
        return {
          result: answers.map((a) => ({
            question: a.questionText,
            key: a.questionKey,
            value: a.value,
          })),
          summary: `${answers.length} verified answers`,
        };
      },
    }),

    tool({
      name: 'get_primary_cv_text',
      description:
        "Read the full extracted text of the user's primary CV, with its version number.",
      ...noInput,
      timeoutMs: 10_000,
      async execute() {
        const cv = await getPrimaryResumeText(userId);
        if (!cv)
          throw new ToolError(
            'The user has no primary CV with readable text. Ask them to upload one on the CVs page.',
          );
        return {
          result: { version: cv.version, text: cv.text },
          summary: `CV version ${cv.version}, ${cv.text.length.toLocaleString('en')} characters`,
        };
      },
    }),

    tool({
      name: 'save_job_posting',
      description:
        "Save the job the user pasted in their CURRENT message. Give the title, company, location and link as written in the message (null if absent). The server stores the user's pasted text itself as the job description, exactly as pasted - do not include the description. Returns the jobId.",
      input: z
        .object({
          title: z.string().trim().min(1).max(200),
          company: z.string().trim().min(1).max(200),
          location: z.string().trim().min(1).max(200).nullable(),
          url: z.string().trim().max(2000).nullable(),
        })
        .strict(),
      inputJsonSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Job title as written in the posting' },
          company: { type: 'string', description: 'Hiring company as written in the posting' },
          location: { type: ['string', 'null'], description: 'Location as written, or null' },
          url: { type: ['string', 'null'], description: 'The job link the user gave, or null' },
        },
        required: ['title', 'company', 'location', 'url'],
        additionalProperties: false,
      },
      timeoutMs: 10_000,
      async execute(input, context) {
        const parsed = jobPostingInputSchema.safeParse({ ...input, description: context.userText });
        if (!parsed.success) {
          throw new ToolError(
            `The job could not be saved: ${parsed.error.issues.map((i) => i.message).join('; ')}. Ask the user to paste the full job description (at least 200 characters) and a valid http(s) link if they have one.`,
          );
        }
        try {
          const job = await createJobRepository(db).create(userId, parsed.data);
          return {
            result: { jobId: job.id, title: job.title, company: job.company, alreadySaved: false },
            summary: `Saved "${job.title}" at ${job.company}`,
          };
        } catch (error) {
          if (error instanceof ConflictError && error.details?.existingJobId) {
            return {
              result: { jobId: error.details.existingJobId, alreadySaved: true },
              summary: 'This job link was already saved',
            };
          }
          throw error;
        }
      },
    }),

    tool({
      name: 'list_saved_jobs',
      description:
        "List the user's saved jobs (newest first) with their latest match score, if any.",
      ...noInput,
      timeoutMs: 10_000,
      async execute() {
        const jobs = await createJobRepository(db).list(userId, 20);
        return {
          result: jobs.map((j) => ({
            jobId: j.id,
            title: j.title,
            company: j.company,
            location: j.location,
            savedAt: j.createdAt,
            latestScore: j.latestMatch?.score ?? null,
            latestRecommendation: j.latestMatch?.recommendation ?? null,
          })),
          summary: `${jobs.length} saved jobs`,
        };
      },
    }),

    tool({
      name: 'analyze_job_match',
      description:
        "Run the evidence-based match analysis of one saved job against the user's primary CV and profile. Every factor quotes the job and the CV; the server verifies the quotes and computes the score. Use the returned evidence when explaining the result.",
      input: z.object({ jobId: z.uuid() }).strict(),
      inputJsonSchema: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'jobId from save_job_posting or list_saved_jobs' },
        },
        required: ['jobId'],
        additionalProperties: false,
      },
      timeoutMs: limits.analysisTimeoutMs + 10_000,
      async execute(input, context) {
        try {
          const match = await runMatchAnalysis(userId, input.jobId, {
            signal: context.signal,
            conversationId,
          });
          return {
            result: {
              jobId: input.jobId,
              score: match.score,
              recommendation: match.recommendation,
              summary: match.summary,
              gaps: match.gaps,
              factors: match.factors.map((f) => ({
                factor: f.factor,
                assessment: f.assessment,
                jobEvidence: f.jobEvidence,
                cvEvidence: f.cvEvidence,
                explanation: f.explanation,
                note: f.note,
              })),
            },
            summary: `${match.score ?? 'n/a'}/100 · ${match.recommendation.replace(/_/g, ' ')}`,
          };
        } catch (error) {
          if (error instanceof MatchAnalysisError) throw new ToolError(error.message);
          if (error instanceof NotFoundError) throw new ToolError('No saved job with that id.');
          throw error;
        }
      },
    }),
  ];
}
