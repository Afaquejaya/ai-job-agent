import { RESUME_LIMITS } from '@job-agent/shared';
import mammoth from 'mammoth';
import { extractText, getDocumentProxy } from 'unpdf';
import { DocumentRejectedError, type DocumentKind } from './inspect';

export interface ExtractedText {
  text: string;
  /** PDF page count; null for DOCX (Word files have no fixed pages). */
  pageCount: number | null;
  /** True when the text was cut at `maxTextChars`. */
  truncated: boolean;
}

export interface ExtractionLimits {
  maxPages: number;
  maxTextChars: number;
}

const DEFAULT_LIMITS: ExtractionLimits = {
  maxPages: RESUME_LIMITS.maxPages,
  maxTextChars: RESUME_LIMITS.maxTextChars,
};

/** Tidies whitespace without changing words, so evidence quotes still match the CV. */
export function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractPdf(
  bytes: Uint8Array,
  limits: ExtractionLimits,
): Promise<{ raw: string; pages: number }> {
  let document: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    // pdf.js may take ownership of the buffer, so hand it a copy.
    document = await getDocumentProxy(new Uint8Array(bytes));
  } catch (error) {
    if ((error as Error).name === 'PasswordException') {
      throw new DocumentRejectedError(
        'password_protected',
        'The PDF is password-protected. Upload a version without a password.',
      );
    }
    throw new DocumentRejectedError('corrupt', 'The PDF could not be read. It may be damaged.');
  }
  try {
    if (document.numPages > limits.maxPages) {
      throw new DocumentRejectedError(
        'too_many_pages',
        `The PDF has ${document.numPages} pages; the limit is ${limits.maxPages}.`,
      );
    }
    const { text } = await extractText(document, { mergePages: true });
    return { raw: text, pages: document.numPages };
  } finally {
    // Releases pdf.js resources (the proxy itself has no destroy() in this pdf.js version).
    await document.loadingTask.destroy();
  }
}

async function extractDocx(bytes: Uint8Array): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return result.value;
  } catch {
    throw new DocumentRejectedError(
      'corrupt',
      'The Word file could not be read. It may be damaged.',
    );
  }
}

/**
 * Extracts plain text only. No macros, scripts or embedded objects are executed, and no OCR is
 * attempted (scanned CVs come back with little or no text).
 */
export async function extractDocumentText(
  bytes: Uint8Array,
  kind: DocumentKind,
  limits: ExtractionLimits = DEFAULT_LIMITS,
): Promise<ExtractedText> {
  let raw: string;
  let pageCount: number | null = null;
  if (kind === 'pdf') {
    const pdf = await extractPdf(bytes, limits);
    raw = pdf.raw;
    pageCount = pdf.pages;
  } else {
    raw = await extractDocx(bytes);
  }

  const text = normalizeText(raw);
  const truncated = text.length > limits.maxTextChars;
  return { text: truncated ? text.slice(0, limits.maxTextChars) : text, pageCount, truncated };
}
