import { strToU8, zipSync } from 'fflate';

/**
 * Builders for SYNTHETIC test documents. Tests never use real CVs: every fixture is generated
 * here from plain strings, so no personal data ever enters the repository.
 */

function escapePdfText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** A valid, minimal PDF (Helvetica, ASCII text) with one page per entry in `pages`. */
export function buildPdf(pages: string[][]): Uint8Array {
  const objects: string[] = [];
  const pageCount = pages.length;
  const fontId = 3 + pageCount * 2;
  const kids = pages.map((_, i) => `${3 + i * 2} 0 R`).join(' ');

  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`);
  pages.forEach((lines, i) => {
    const contentId = 4 + i * 2;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R ` +
        `/Resources << /Font << /F1 ${fontId} 0 R >> >> >>`,
    );
    const ops = lines.map((line, n) => `${n === 0 ? '' : '0 -16 Td '}(${escapePdfText(line)}) Tj`);
    const stream = `BT /F1 12 Tf 72 720 Td ${ops.join(' ')} ET`;
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return strToU8(body);
}

const WORD_MAIN =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const WORD_MACRO_MAIN = 'application/vnd.ms-word.document.macroEnabled.main+xml';

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export interface DocxOptions {
  /** Build a macro-enabled (.docm-style) package, which must be rejected. */
  macroEnabled?: boolean;
  /** Extra entries added to the ZIP, e.g. to simulate a zip bomb. */
  extraEntries?: Record<string, Uint8Array>;
}

/** A valid, minimal DOCX with one paragraph per line. */
export function buildDocx(paragraphs: string[], options: DocxOptions = {}): Uint8Array {
  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    `<Override PartName="/word/document.xml" ContentType="${options.macroEnabled ? WORD_MACRO_MAIN : WORD_MAIN}"/>` +
    '</Types>';
  const rels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>';
  const body = paragraphs
    .map((p) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(p)}</w:t></w:r></w:p>`)
    .join('');
  const document =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body>${body}</w:body></w:document>`;

  return zipSync({
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rels),
    'word/document.xml': strToU8(document),
    ...options.extraEntries,
  });
}

/** Synthetic CV lines used across tests. Not a real person. */
export const SYNTHETIC_CV_LINES = [
  'Test Candidate',
  'Data Analyst',
  'Email: test.candidate@example.test',
  'Phone: +91 98765 43210',
  'LinkedIn: https://www.linkedin.com/in/test-candidate',
  'Experience: Example Analytics Pvt Ltd, 2019 - present',
  'Skills: SQL, Python, Power BI, Excel',
  'Education: B.Sc. Statistics, Example University, 2018',
];
