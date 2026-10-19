import { createHash, randomUUID } from 'node:crypto';
import {
  ConflictError,
  createAnswerRepository,
  createCandidateProfileRepository,
  createResumeRepository,
  type ResumeRecord,
} from '@job-agent/database';
import { DocumentRejectedError, inspectDocument, type DocumentKind } from '@job-agent/documents';
import type { Logger } from '@job-agent/observability';
import {
  RESUME_LIMITS,
  RESUME_MIME_TYPES,
  validateNewAnswer,
  type ResumeDetail,
  type TaskSummary,
  type UserId,
} from '@job-agent/shared';
import { ApiProblem } from './api';
import { getDatabase } from './db';
import { getServices } from './services';
import { getStorage } from './storage';
import { cvProcessingKey, getTaskService, toTaskSummary } from './tasks';

/**
 * CV pipeline (Phase 2B, text-only - decision 3b):
 *   upload -> validate content -> store encrypted -> [background task] extract text ->
 *   deterministic suggestions
 * The upload is checked and stored here; text extraction runs in the worker (Phase 3) through
 * @job-agent/services. Nothing reaches the profile or the answers until the user accepts a
 * suggestion.
 */

// Matching control characters is the point here: they are stripped from file names.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

/** Display-only file name: no path parts, no control characters, bounded length. */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? '';
  const cleaned = base.replace(CONTROL_CHARACTERS, '').replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, 200) || 'cv';
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function toProblem(error: DocumentRejectedError): ApiProblem {
  return error.reason === 'too_large'
    ? new ApiProblem('PAYLOAD_TOO_LARGE', error.message, 413, { reason: error.reason })
    : new ApiProblem('VALIDATION_FAILED', error.message, 400, { reason: error.reason });
}

/** Starts (or returns the running) text-extraction task for a CV version. */
export async function startCvProcessing(userId: UserId, resumeId: string): Promise<TaskSummary> {
  const { task } = await getTaskService().start(
    userId,
    'cv_processing',
    { resumeId },
    cvProcessingKey(resumeId),
  );
  return toTaskSummary(task);
}

export async function uploadResume(
  userId: UserId,
  file: File,
  logger: Logger,
): Promise<{ resume: ResumeDetail; task: TaskSummary }> {
  const resumes = createResumeRepository(getDatabase());
  const storage = getStorage();

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  if ((await resumes.countUploadsSince(userId, since)) >= RESUME_LIMITS.maxUploadsPerDay) {
    throw new ApiProblem(
      'RATE_LIMITED',
      `Upload limit reached (${RESUME_LIMITS.maxUploadsPerDay} per 24 hours). Try again later.`,
      429,
    );
  }

  if (file.size > RESUME_LIMITS.maxFileBytes) {
    throw toProblem(new DocumentRejectedError('too_large', 'The file is larger than 10 MB.'));
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  let kind: DocumentKind;
  try {
    kind = inspectDocument(bytes);
  } catch (error) {
    if (error instanceof DocumentRejectedError) throw toProblem(error);
    throw error;
  }

  const checksum = sha256(bytes);
  const existing = await resumes.findByChecksum(userId, checksum);
  if (existing) {
    throw new ConflictError('This exact file has already been uploaded.', {
      existingResumeId: existing.id,
      existingVersion: existing.version,
    });
  }

  const storageKey = `users/${userId}/resumes/${randomUUID()}`;
  await storage.put(storageKey, bytes);
  let record: ResumeRecord;
  try {
    record = await resumes.create(userId, {
      originalFilename: sanitizeFilename(file.name),
      storageKey,
      mimeType: RESUME_MIME_TYPES[kind],
      fileSizeBytes: bytes.length,
      checksum,
    });
  } catch (error) {
    await storage.delete(storageKey); // never leave an orphaned file behind
    throw error;
  }
  logger.info('resume.uploaded', { resumeId: record.id, version: record.version, kind });
  const task = await startCvProcessing(userId, record.id);
  return { resume: await getResumeDetail(userId, record.id), task };
}

export function getResumeDetail(userId: UserId, resumeId: string): Promise<ResumeDetail> {
  return getServices().resumes.detail(userId, resumeId);
}

/** The decrypted full text of the user's primary CV, or null when there is none with text. */
export function getPrimaryResumeText(
  userId: UserId,
): Promise<{ resumeId: string; version: number; text: string } | null> {
  return getServices().resumes.primaryText(userId);
}

export interface AppliedSuggestions {
  profileFields: string[];
  answers: string[];
}

/** Applies ONLY the suggestions the user selected. Answers are created as DRAFT (unverified). */
export async function applySuggestions(
  userId: UserId,
  resumeId: string,
  suggestionIds: string[],
): Promise<AppliedSuggestions> {
  const db = getDatabase();
  const resumes = createResumeRepository(db);
  const profiles = createCandidateProfileRepository(db);
  const answers = createAnswerRepository(db);
  const row = await resumes.requireForUser(userId, resumeId);
  const parsed = getServices().resumes.readParsed(row, userId);
  const chosen = (parsed?.suggestions ?? []).filter((s) => suggestionIds.includes(s.id));
  if (chosen.length !== new Set(suggestionIds).size) {
    throw new ApiProblem('VALIDATION_FAILED', 'Unknown suggestion id', 400);
  }

  const profilePatch: Record<string, string> = {};
  const applied: AppliedSuggestions = { profileFields: [], answers: [] };
  for (const s of chosen) {
    if (s.target.kind === 'profile') profilePatch[s.target.field] = s.value;
  }
  if (Object.keys(profilePatch).length > 0) {
    const result = await profiles.update(userId, profilePatch, {
      kind: 'resume_suggestion',
      resumeId,
    });
    applied.profileFields = result.changedFields;
  }

  for (const s of chosen) {
    if (s.target.kind !== 'answer') continue;
    const value = { url: s.value };
    const existing = await answers.findActiveByKey(userId, s.target.questionKey);
    if (existing) {
      await answers.update(userId, existing.id, { value });
    } else {
      const validated = validateNewAnswer({ questionKey: s.target.questionKey, value });
      if (!validated.ok)
        throw new ApiProblem('VALIDATION_FAILED', 'Suggestion is not valid', 400, validated.error);
      await answers.create(userId, validated.value, 'CV_SUGGESTION_CONFIRMED');
    }
    applied.answers.push(s.target.questionKey);
  }

  await resumes.markReviewed(userId, resumeId);
  return applied;
}

export async function deleteResume(userId: UserId, resumeId: string): Promise<void> {
  const { storageKey } = await createResumeRepository(getDatabase()).delete(userId, resumeId);
  await getStorage().delete(storageKey);
}

export async function readResumeFile(
  userId: UserId,
  resumeId: string,
): Promise<{ bytes: Uint8Array; mimeType: string; filename: string }> {
  const row = await createResumeRepository(getDatabase()).requireForUser(userId, resumeId);
  return {
    bytes: await getStorage().get(row.storageKey),
    mimeType: row.mimeType,
    filename: row.originalFilename,
  };
}
