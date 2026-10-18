import { createHash, randomUUID } from 'node:crypto';
import {
  ConflictError,
  createAnswerRepository,
  createCandidateProfileRepository,
  createResumeRepository,
  toResumeSummary,
  type ExtractionOutcome,
  type ResumeRecord,
} from '@job-agent/database';
import {
  DocumentRejectedError,
  extractDocumentText,
  findContactSuggestions,
  inspectDocument,
  type DocumentKind,
  type SuggestionDraft,
} from '@job-agent/documents';
import type { Logger } from '@job-agent/observability';
import {
  RESUME_LIMITS,
  RESUME_MIME_TYPES,
  validateNewAnswer,
  type ResumeDetail,
  type ResumeSuggestion,
  type UserId,
} from '@job-agent/shared';
import { ApiProblem } from './api';
import { getDatabase } from './db';
import { getCipher, getStorage } from './storage';

/**
 * CV pipeline (Phase 2B, text-only - decision 3b):
 *   upload -> validate content -> store encrypted -> extract text -> deterministic suggestions
 * Nothing reaches the profile or the answers until the user accepts a suggestion.
 * Runs inside the request for now; it becomes a worker job when the task engine exists.
 */

interface ParsedResumeData {
  extractor: 'deterministic-contact-v1';
  suggestions: Array<SuggestionDraft & { id: string }>;
}

// Encryption contexts bind each ciphertext to its user, resume and purpose.
const textContext = (userId: string, resumeId: string) => `resume:${userId}:${resumeId}:text`;
const parsedContext = (userId: string, resumeId: string) => `resume:${userId}:${resumeId}:parsed`;

const NO_TEXT_MESSAGE =
  'Very little text could be read from this file. It may be a scanned image, and OCR is not supported yet. Upload a text-based PDF or Word file, or fill in your profile by hand.';

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

function services() {
  const db = getDatabase();
  return {
    resumes: createResumeRepository(db),
    profiles: createCandidateProfileRepository(db),
    answers: createAnswerRepository(db),
    storage: getStorage(),
    cipher: getCipher(),
  };
}

export async function uploadResume(
  userId: UserId,
  file: File,
  logger: Logger,
): Promise<ResumeDetail> {
  const { resumes, storage } = services();

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
  return processResume(userId, record.id, logger);
}

/** Extracts text and suggestions. Also used to retry FAILED / NEEDS_REVIEW resumes. */
export async function processResume(
  userId: UserId,
  resumeId: string,
  logger: Logger,
): Promise<ResumeDetail> {
  const { resumes, storage, cipher } = services();
  const row = await resumes.requireForUser(userId, resumeId);
  await resumes.markProcessing(userId, resumeId);

  let outcome: ExtractionOutcome;
  try {
    const bytes = await storage.get(row.storageKey);
    const extracted = await extractDocumentText(bytes, inspectDocument(bytes));
    const suggestions = findContactSuggestions(extracted.text).map((s) => ({
      ...s,
      id:
        s.target.kind === 'profile'
          ? `profile:${s.target.field}`
          : `answer:${s.target.questionKey}`,
    }));
    const parsed: ParsedResumeData = { extractor: 'deterministic-contact-v1', suggestions };
    const hasUsefulText = extracted.text.length >= RESUME_LIMITS.minUsefulTextChars;
    outcome = {
      status: hasUsefulText ? 'EXTRACTED' : 'NEEDS_REVIEW',
      extractedTextEncrypted: cipher.encryptText(extracted.text, textContext(userId, resumeId)),
      parsedProfileEncrypted: cipher.encryptText(
        JSON.stringify(parsed),
        parsedContext(userId, resumeId),
      ),
      extractionError: hasUsefulText ? null : NO_TEXT_MESSAGE,
      pageCount: extracted.pageCount,
      textCharCount: extracted.text.length,
      textTruncated: extracted.truncated,
    };
  } catch (error) {
    const message =
      error instanceof DocumentRejectedError
        ? error.message
        : 'Text extraction failed unexpectedly. Try again, or upload the CV in another format.';
    if (!(error instanceof DocumentRejectedError))
      logger.error('resume.extraction_error', { resumeId, error });
    outcome = {
      status: 'FAILED',
      extractedTextEncrypted: null,
      parsedProfileEncrypted: null,
      extractionError: message,
      pageCount: null,
      textCharCount: null,
      textTruncated: false,
    };
  }

  await resumes.saveExtraction(userId, resumeId, outcome);
  logger.info('resume.processed', { resumeId, status: outcome.status });
  return getResumeDetail(userId, resumeId);
}

function readParsed(row: ResumeRecord, userId: UserId): ParsedResumeData | null {
  if (!row.parsedProfileEncrypted) return null;
  const json = getCipher().decryptText(row.parsedProfileEncrypted, parsedContext(userId, row.id));
  return JSON.parse(json) as ParsedResumeData;
}

export async function getResumeDetail(userId: UserId, resumeId: string): Promise<ResumeDetail> {
  const { resumes, profiles, answers, cipher } = services();
  const row = await resumes.requireForUser(userId, resumeId);
  const text = row.extractedTextEncrypted
    ? cipher.decryptText(row.extractedTextEncrypted, textContext(userId, row.id))
    : null;

  const parsed = readParsed(row, userId);
  let suggestions: ResumeSuggestion[] = [];
  if (parsed && parsed.suggestions.length > 0) {
    const profile = await profiles.getForUser(userId);
    suggestions = await Promise.all(
      parsed.suggestions.map(async (s) => ({
        id: s.id,
        target: s.target,
        value: s.value,
        evidence: s.evidence,
        currentValue:
          s.target.kind === 'profile'
            ? profile[s.target.field]
            : ((
                (await answers.findActiveByKey(userId, s.target.questionKey))?.value as
                  { url?: string } | undefined
              )?.url ?? null),
      })),
    );
  }

  return {
    ...toResumeSummary(row),
    textPreview: text === null ? null : text.slice(0, RESUME_LIMITS.previewChars),
    textTruncated: text !== null && (row.textTruncated || text.length > RESUME_LIMITS.previewChars),
    suggestions,
  };
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
  const { resumes, profiles, answers } = services();
  const row = await resumes.requireForUser(userId, resumeId);
  const parsed = readParsed(row, userId);
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
  const { resumes, storage } = services();
  const { storageKey } = await resumes.delete(userId, resumeId);
  await storage.delete(storageKey);
}

export async function readResumeFile(
  userId: UserId,
  resumeId: string,
): Promise<{ bytes: Uint8Array; mimeType: string; filename: string }> {
  const { resumes, storage } = services();
  const row = await resumes.requireForUser(userId, resumeId);
  return {
    bytes: await storage.get(row.storageKey),
    mimeType: row.mimeType,
    filename: row.originalFilename,
  };
}
