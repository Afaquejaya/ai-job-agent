/**
 * Fast, deterministic helpers for job matching (no AI):
 * - a skills pre-score: which skills the job names that the CV also mentions (instant);
 * - relevant excerpts: the CV and job lines that matter for this job, so a slow local model
 *   reads far less text. Lines are kept verbatim and in order, so quotes from an excerpt are
 *   still quotes from the full text.
 */

interface SkillTerm {
  name: string;
  pattern: RegExp;
}

// Word-boundary aware patterns; names are what the user sees.
const term = (name: string, source: string): SkillTerm => ({
  name,
  pattern: new RegExp(`(^|[^a-z0-9+#.])(?:${source})(?=$|[^a-z0-9+#])`, 'i'),
});

export const SKILL_TERMS: readonly SkillTerm[] = [
  term('Flutter', 'flutter'),
  term('Dart', 'dart'),
  term('React Native', 'react[ -]native'),
  term('React', 'react(?:\\.js|js)?(?![ -]native)'),
  term('Next.js', 'next\\.?js'),
  term('Vue.js', 'vue(?:\\.js)?'),
  term('Angular', 'angular'),
  term('Kotlin', 'kotlin'),
  term('Kotlin Multiplatform', 'kotlin multiplatform|kmp'),
  term('Java', 'java(?!script)'),
  term('Swift', 'swift(?:ui)?'),
  term('iOS', 'ios'),
  term('Android', 'android'),
  term('Jetpack Compose', 'jetpack compose|compose'),
  term('TypeScript', 'typescript'),
  term('JavaScript', 'javascript'),
  term('Node.js', 'node\\.?js'),
  term('Python', 'python'),
  term('FastAPI', 'fastapi'),
  term('Django', 'django'),
  term('NestJS', 'nest\\.?js'),
  term('C#', 'c#'),
  term('.NET', '\\.net|dotnet'),
  term('PHP', 'php'),
  term('Go', 'golang'),
  term('SQL', 'sql'),
  term('PostgreSQL', 'postgres(?:ql)?'),
  term('MySQL', 'mysql'),
  term('MongoDB', 'mongo(?:db)?'),
  term('Firebase', 'firebase|firestore|crashlytics'),
  term('GraphQL', 'graphql'),
  term('REST APIs', 'rest(?:ful)?(?: apis?)?'),
  term('WebSocket', 'websockets?'),
  term('XMPP', 'xmpp'),
  term('MQTT', 'mqtt'),
  term('WebRTC', 'webrtc'),
  term('OAuth', 'oauth2?'),
  term('JWT', 'jwt'),
  term('CI/CD', 'ci/cd|ci ?cd|continuous integration'),
  term('Git', 'git(?:hub|lab)?'),
  term('Docker', 'docker'),
  term('Kubernetes', 'kubernetes|k8s'),
  term('AWS', 'aws|amazon web services'),
  term('Azure', 'azure'),
  term('GCP', 'gcp|google cloud'),
  term('Riverpod', 'riverpod'),
  term('BLoC', 'bloc'),
  term('Redux', 'redux'),
  term('Unit testing', 'unit test(?:s|ing)?|tdd'),
  term('Push notifications', 'push notifications?|fcm|apns'),
  term('Payments', 'payments?'),
  term('Arabic / RTL', 'rtl|arabic'),
  term('Agile/Scrum', 'agile|scrum'),
  term('Machine learning', 'machine learning|ml'),
  term('LLM / AI', 'llms?|generative ai|ai[- ]assisted|ai tools'),
  term('MCP', 'mcp|model context protocol'),
  term('Tailwind CSS', 'tailwind'),
  term('HTML/CSS', 'html5?|css3?'),
];

/** The known skills a text mentions. */
export function findSkills(text: string): string[] {
  return SKILL_TERMS.filter((t) => t.pattern.test(text)).map((t) => t.name);
}

export interface SkillsPreScore {
  /** Share of the job's recognised skills the CV mentions, 0-100. */
  score: number;
  matched: string[];
  missing: string[];
}

/**
 * Instant pre-score from skill names alone. A rough guide, not the analysis: it only knows
 * skills in its dictionary and cannot judge depth or experience. Null when the job names too
 * few recognisable skills to say anything.
 */
export function skillsPreScore(cvText: string, jobText: string): SkillsPreScore | null {
  const jobSkills = findSkills(jobText);
  if (jobSkills.length < 2) return null;
  const cvSkills = new Set(findSkills(cvText));
  const matched = jobSkills.filter((s) => cvSkills.has(s));
  const missing = jobSkills.filter((s) => !cvSkills.has(s));
  return { score: Math.round((100 * matched.length) / jobSkills.length), matched, missing };
}

const STOPWORDS = new Set(
  'about above across after again also and any are been being both but can could each etc for from have having into its more most must not our over own same should such than that the their them then there these they this those through under until very was were what when where which while who will with within would you your years year experience strong ability using work working team teams role skills knowledge including other well good plus'.split(
    ' ',
  ),
);

/** Lower-case content words (4+ letters) a text uses. */
function keywords(text: string): Set<string> {
  return new Set(
    (text.toLowerCase().match(/[a-z][a-z0-9+#.]{3,}/g) ?? []).filter((w) => !STOPWORDS.has(w)),
  );
}

// Lines that answer the non-skill factors (experience, education, location, language).
const FACTOR_HINT =
  /\b(19|20)\d{2}\b|\byears?\b|present|b\.?tech|b\.?sc|bachelor|master|degree|university|college|engg|engineering|based in|location|visa|languages?|english|arabic|hindi|senior|lead|principal|summary/i;

const DATE_RANGE =
  /\b(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+)?(19|20)\d{2}\s*[–—-]\s*(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+)?(?:(19|20)\d{2}|present|current|now)\b/i;
const DEGREE =
  /\b(b\.?\s?tech|b\.?\s?e\b|b\.?\s?sc|bachelor|m\.?\s?tech|master|mba|ph\.?d|degree)\b/i;

function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/**
 * Picks the lines of `text` most related to `against`, up to `budgetChars`, in their original
 * order. The first `keepFirst` lines (e.g. a CV's name and headline) are always kept.
 */
export function selectRelevantLines(
  text: string,
  against: string,
  budgetChars: number,
  keepFirst = 0,
): string {
  if (text.length <= budgetChars) return text;
  const lines = splitLines(text);
  const words = keywords(against);
  const skills = new Set(findSkills(against));

  const scored = lines.map((line, index) => {
    if (index < keepFirst) return { index, line, score: Number.POSITIVE_INFINITY };
    const lineWords = keywords(line);
    let score = 0;
    for (const w of lineWords) if (words.has(w)) score += 1;
    for (const s of findSkills(line)) if (skills.has(s)) score += 4;
    if (FACTOR_HINT.test(line)) score += 2;
    // Anchors for experience, location and education: role headers with dates, the
    // company/location line under them, and degrees. Without them those factors are unknown.
    if (DATE_RANGE.test(line) || DEGREE.test(line)) score += 8;
    if (index > 0 && DATE_RANGE.test(lines[index - 1]!)) score += 6;
    return { index, line, score };
  });

  const chosen = new Set<number>();
  let used = 0;
  for (const item of [...scored].sort((a, b) => b.score - a.score || a.index - b.index)) {
    if (item.score <= 0) break;
    if (used + item.line.length + 1 > budgetChars) continue;
    chosen.add(item.index);
    used += item.line.length + 1;
  }
  return lines.filter((_, i) => chosen.has(i)).join('\n');
}
