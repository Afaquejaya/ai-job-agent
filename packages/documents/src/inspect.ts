import { RESUME_LIMITS, type RESUME_MIME_TYPES } from '@job-agent/shared';
import { strFromU8, unzipSync } from 'fflate';

export type DocumentKind = keyof typeof RESUME_MIME_TYPES;

export type RejectionReason =
  | 'empty'
  | 'too_large'
  | 'unsupported_type'
  | 'macro_enabled'
  | 'zip_bomb'
  | 'corrupt'
  | 'password_protected'
  | 'too_many_pages';

/** A file that must not be stored or processed. `message` is safe to show to the user. */
export class DocumentRejectedError extends Error {
  constructor(
    readonly reason: RejectionReason,
    message: string,
  ) {
    super(message);
    this.name = 'DocumentRejectedError';
  }
}

export interface DocumentLimits {
  maxFileBytes: number;
  maxDocxUncompressedBytes: number;
  maxDocxEntries: number;
}

const DEFAULT_LIMITS: DocumentLimits = {
  maxFileBytes: RESUME_LIMITS.maxFileBytes,
  maxDocxUncompressedBytes: RESUME_LIMITS.maxDocxUncompressedBytes,
  maxDocxEntries: RESUME_LIMITS.maxDocxEntries,
};

const WORD_MAIN =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const WORD_MACRO = 'application/vnd.ms-word.document.macroEnabled.main+xml';
const CONTENT_TYPES_ENTRY = '[Content_Types].xml';
const MAX_CONTENT_TYPES_BYTES = 1024 * 1024;

const startsWith = (bytes: Uint8Array, signature: number[]) =>
  signature.every((byte, i) => bytes[i] === byte);

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04]; // PK\x03\x04

/**
 * Decides the document type from the file's own bytes. The browser-reported MIME type and the
 * file extension are never trusted. DOCX files are inspected without decompressing their
 * content: entry sizes come from the ZIP directory (zip-bomb guard), and only the small
 * `[Content_Types].xml` entry is read.
 */
export function inspectDocument(
  bytes: Uint8Array,
  limits: DocumentLimits = DEFAULT_LIMITS,
): DocumentKind {
  if (bytes.length === 0) throw new DocumentRejectedError('empty', 'The file is empty.');
  if (bytes.length > limits.maxFileBytes) {
    throw new DocumentRejectedError(
      'too_large',
      `The file is larger than ${Math.round(limits.maxFileBytes / 1024 / 1024)} MB.`,
    );
  }

  if (startsWith(bytes, PDF_SIGNATURE)) return 'pdf';

  if (startsWith(bytes, ZIP_SIGNATURE)) {
    let entries = 0;
    let totalUncompressed = 0;
    let contentTypes: string | undefined;
    try {
      const files = unzipSync(bytes, {
        filter: (file) => {
          entries += 1;
          totalUncompressed += file.originalSize;
          return file.name === CONTENT_TYPES_ENTRY && file.originalSize <= MAX_CONTENT_TYPES_BYTES;
        },
      });
      const entry = files[CONTENT_TYPES_ENTRY];
      contentTypes = entry ? strFromU8(entry) : undefined;
    } catch {
      throw new DocumentRejectedError('corrupt', 'The file looks like a damaged ZIP/DOCX file.');
    }
    if (entries > limits.maxDocxEntries || totalUncompressed > limits.maxDocxUncompressedBytes) {
      throw new DocumentRejectedError(
        'zip_bomb',
        'The DOCX file expands to an unsafe size and was rejected.',
      );
    }
    if (contentTypes?.includes(WORD_MACRO)) {
      throw new DocumentRejectedError(
        'macro_enabled',
        'Macro-enabled Word files (.docm) are not accepted. Save the CV as a normal .docx or PDF.',
      );
    }
    if (contentTypes?.includes(WORD_MAIN)) return 'docx';
  }

  throw new DocumentRejectedError(
    'unsupported_type',
    'Only PDF and Word (.docx) files are supported. The file content is neither.',
  );
}
