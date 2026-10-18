import { z } from 'zod';

/** Limits for uploaded CVs. Enforced server-side; the UI shows them. */
export const RESUME_LIMITS = {
  maxFileBytes: 10 * 1024 * 1024,
  maxPages: 30,
  maxTextChars: 200_000,
  /** Zip-bomb guard for DOCX: total uncompressed size of all entries. */
  maxDocxUncompressedBytes: 50 * 1024 * 1024,
  maxDocxEntries: 1_000,
  /** Below this, the file probably has no text layer (e.g. a scanned PDF). */
  minUsefulTextChars: 200,
  maxUploadsPerDay: 30,
  /** Characters of extracted text shown on the detail view. */
  previewChars: 3_000,
} as const;

export const RESUME_MIME_TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
} as const;

export const EXTRACTION_STATUSES = [
  'UPLOADED',
  'PROCESSING',
  'EXTRACTED',
  'NEEDS_REVIEW',
  'FAILED',
] as const;
export type ExtractionStatus = (typeof EXTRACTION_STATUSES)[number];

/** `GET /api/resumes` item. Never contains extracted text. */
export interface ResumeSummary {
  id: string;
  version: number;
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: number;
  extractionStatus: ExtractionStatus;
  extractionError: string | null;
  isPrimary: boolean;
  pageCount: number | null;
  textCharCount: number | null;
  createdAt: string;
  processedAt: string | null;
  reviewedAt: string | null;
}

/** Where an accepted suggestion is written. */
export type SuggestionTarget =
  { kind: 'profile'; field: 'email' | 'phone' } | { kind: 'answer'; questionKey: 'linkedin_url' };

/**
 * A value found in the CV by deterministic pattern matching. `evidence` is the exact text it
 * came from. Suggestions are never applied without the user's explicit acceptance.
 */
export interface ResumeSuggestion {
  id: string;
  target: SuggestionTarget;
  value: string;
  evidence: string;
  /** The value currently stored, so the user can compare before accepting. */
  currentValue: string | null;
}

/** `GET /api/resumes/:id` response body (`resume`). */
export interface ResumeDetail extends ResumeSummary {
  textPreview: string | null;
  textTruncated: boolean;
  suggestions: ResumeSuggestion[];
}

export const applySuggestionsSchema = z
  .object({ suggestionIds: z.array(z.string().min(1).max(50)).min(1).max(20) })
  .strict();
export type ApplySuggestionsInput = z.infer<typeof applySuggestionsSchema>;
