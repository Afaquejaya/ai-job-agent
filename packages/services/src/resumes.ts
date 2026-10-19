import {
  createAnswerRepository,
  createCandidateProfileRepository,
  createResumeRepository,
  toResumeSummary,
  type Database,
  type ExtractionOutcome,
  type ResumeRecord,
} from '@job-agent/database';
import {
  DocumentRejectedError,
  extractDocumentText,
  findContactSuggestions,
  inspectDocument,
  type SuggestionDraft,
} from '@job-agent/documents';
import type { Logger } from '@job-agent/observability';
import type { DataCipher } from '@job-agent/security';
import {
  RESUME_LIMITS,
  type ResumeDetail,
  type ResumeSuggestion,
  type UserId,
} from '@job-agent/shared';
import type { ObjectStorage } from '@job-agent/storage';

/**
 * CV pipeline (Phase 2B, text-only - decision 3b), run by the worker since Phase 3:
 *   stored encrypted -> extract text -> deterministic suggestions
 * Nothing reaches the profile or the answers until the user accepts a suggestion.
 */

export interface ParsedResumeData {
  extractor: 'deterministic-contact-v1';
  suggestions: Array<SuggestionDraft & { id: string }>;
}

// Encryption contexts bind each ciphertext to its user, resume and purpose.
export const resumeTextContext = (userId: string, resumeId: string) =>
  `resume:${userId}:${resumeId}:text`;
export const resumeParsedContext = (userId: string, resumeId: string) =>
  `resume:${userId}:${resumeId}:parsed`;

const NO_TEXT_MESSAGE =
  'Very little text could be read from this file. It may be a scanned image, and OCR is not supported yet. Upload a text-based PDF or Word file, or fill in your profile by hand.';

export function createResumeService(deps: {
  db: Database;
  cipher: DataCipher;
  storage: ObjectStorage;
}) {
  const { db, cipher, storage } = deps;
  const resumes = createResumeRepository(db);

  function readParsed(row: ResumeRecord, userId: UserId): ParsedResumeData | null {
    if (!row.parsedProfileEncrypted) return null;
    const json = cipher.decryptText(
      row.parsedProfileEncrypted,
      resumeParsedContext(userId, row.id),
    );
    return JSON.parse(json) as ParsedResumeData;
  }

  async function detail(userId: UserId, resumeId: string): Promise<ResumeDetail> {
    const profiles = createCandidateProfileRepository(db);
    const answers = createAnswerRepository(db);
    const row = await resumes.requireForUser(userId, resumeId);
    const text = row.extractedTextEncrypted
      ? cipher.decryptText(row.extractedTextEncrypted, resumeTextContext(userId, row.id))
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
      textTruncated:
        text !== null && (row.textTruncated || text.length > RESUME_LIMITS.previewChars),
      suggestions,
    };
  }

  /** Extracts text and suggestions. Also used to retry FAILED / NEEDS_REVIEW resumes. */
  async function process(userId: UserId, resumeId: string, logger: Logger): Promise<ResumeDetail> {
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
        extractedTextEncrypted: cipher.encryptText(
          extracted.text,
          resumeTextContext(userId, resumeId),
        ),
        parsedProfileEncrypted: cipher.encryptText(
          JSON.stringify(parsed),
          resumeParsedContext(userId, resumeId),
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
    return detail(userId, resumeId);
  }

  /** The decrypted full text of the user's primary CV, or null when there is none with text. */
  async function primaryText(
    userId: UserId,
  ): Promise<{ resumeId: string; version: number; text: string } | null> {
    const primary = (await resumes.listForUser(userId)).find((r) => r.isPrimary);
    if (!primary) return null;
    const row = await resumes.requireForUser(userId, primary.id);
    if (!row.extractedTextEncrypted) return null;
    const text = cipher.decryptText(row.extractedTextEncrypted, resumeTextContext(userId, row.id));
    return text.trim() ? { resumeId: row.id, version: row.version, text } : null;
  }

  return { process, detail, primaryText, readParsed };
}

export type ResumeService = ReturnType<typeof createResumeService>;
