import { strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  DocumentRejectedError,
  extractDocumentText,
  findContactSuggestions,
  inspectDocument,
  normalizeText,
  type RejectionReason,
} from './index';
import { buildDocx, buildPdf, SYNTHETIC_CV_LINES } from './testing/fixtures';

async function rejectionOf(fn: () => unknown): Promise<RejectionReason | 'not rejected'> {
  try {
    await fn();
    return 'not rejected';
  } catch (error) {
    if (error instanceof DocumentRejectedError) return error.reason;
    throw error;
  }
}

describe('inspectDocument', () => {
  it('recognises PDF and DOCX from their content', () => {
    expect(inspectDocument(buildPdf([SYNTHETIC_CV_LINES]))).toBe('pdf');
    expect(inspectDocument(buildDocx(SYNTHETIC_CV_LINES))).toBe('docx');
  });

  it('ignores the file name: a text file renamed to .pdf is rejected', async () => {
    expect(await rejectionOf(() => inspectDocument(strToU8('MZ fake executable')))).toBe(
      'unsupported_type',
    );
    expect(
      await rejectionOf(() => inspectDocument(strToU8('just text, pretending to be a CV'))),
    ).toBe('unsupported_type');
  });

  it('rejects empty and oversized files', async () => {
    expect(await rejectionOf(() => inspectDocument(new Uint8Array()))).toBe('empty');
    const limits = { maxFileBytes: 100, maxDocxUncompressedBytes: 1e6, maxDocxEntries: 100 };
    expect(await rejectionOf(() => inspectDocument(buildPdf([['x'.repeat(200)]]), limits))).toBe(
      'too_large',
    );
  });

  it('rejects macro-enabled Word files', async () => {
    expect(await rejectionOf(() => inspectDocument(buildDocx(['x'], { macroEnabled: true })))).toBe(
      'macro_enabled',
    );
  });

  it('rejects ZIPs that expand to an unsafe size (zip bomb) without inflating them', async () => {
    const bomb = buildDocx(['x'], {
      extraEntries: { 'word/media/big.bin': new Uint8Array(2_000_000) },
    });
    const limits = { maxFileBytes: 1e7, maxDocxUncompressedBytes: 1_000_000, maxDocxEntries: 100 };
    expect(bomb.length).toBeLessThan(100_000);
    expect(await rejectionOf(() => inspectDocument(bomb, limits))).toBe('zip_bomb');
  });

  it('rejects a ZIP that is not a Word document', async () => {
    const { zipSync } = await import('fflate');
    expect(await rejectionOf(() => inspectDocument(zipSync({ 'a.txt': strToU8('hi') })))).toBe(
      'unsupported_type',
    );
  });
});

describe('extractDocumentText', () => {
  it('extracts text from a multi-page PDF', async () => {
    const result = await extractDocumentText(buildPdf([SYNTHETIC_CV_LINES, ['Page two']]), 'pdf');
    expect(result.pageCount).toBe(2);
    expect(result.text).toContain('test.candidate@example.test');
    expect(result.text).toContain('Page two');
    expect(result.truncated).toBe(false);
  });

  it('extracts text from a DOCX', async () => {
    const result = await extractDocumentText(buildDocx(SYNTHETIC_CV_LINES), 'docx');
    expect(result.pageCount).toBeNull();
    expect(result.text).toContain('Skills: SQL, Python, Power BI, Excel');
  });

  it('enforces the page limit and truncates very long text', async () => {
    const pages = Array.from({ length: 3 }, (_, i) => [`Page ${i}`]);
    expect(
      await rejectionOf(() =>
        extractDocumentText(buildPdf(pages), 'pdf', { maxPages: 2, maxTextChars: 1000 }),
      ),
    ).toBe('too_many_pages');

    const long = await extractDocumentText(buildDocx(['word '.repeat(100)]), 'docx', {
      maxPages: 30,
      maxTextChars: 50,
    });
    expect(long.truncated).toBe(true);
    expect(long.text.length).toBe(50);
  });

  it('reports a damaged PDF as corrupt', async () => {
    expect(await rejectionOf(() => extractDocumentText(strToU8('%PDF-1.4 broken'), 'pdf'))).toBe(
      'corrupt',
    );
  });
});

describe('normalizeText', () => {
  it('tidies whitespace without changing words', () => {
    expect(normalizeText('  a\t\tb \r\n\r\n\r\n\r\nc  ')).toBe('a b\n\nc');
  });
});

describe('findContactSuggestions', () => {
  it('suggests email, international phone and LinkedIn, each with verbatim evidence', () => {
    const text = SYNTHETIC_CV_LINES.join('\n');
    const suggestions = findContactSuggestions(text);
    expect(suggestions).toEqual([
      {
        target: { kind: 'profile', field: 'email' },
        value: 'test.candidate@example.test',
        evidence: 'test.candidate@example.test',
      },
      {
        target: { kind: 'profile', field: 'phone' },
        value: '+919876543210',
        evidence: '+91 98765 43210',
      },
      {
        target: { kind: 'answer', questionKey: 'linkedin_url' },
        value: 'https://www.linkedin.com/in/test-candidate',
        evidence: 'https://www.linkedin.com/in/test-candidate',
      },
    ]);
    for (const s of suggestions) expect(text).toContain(s.evidence);
  });

  it('does not guess: a local number without a country code is not suggested', () => {
    expect(findContactSuggestions('Phone: 98765 43210')).toEqual([]);
  });

  it('returns nothing for text without contact details', () => {
    expect(findContactSuggestions('Experienced analyst. Skills: SQL.')).toEqual([]);
  });
});
