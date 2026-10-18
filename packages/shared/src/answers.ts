import { z } from 'zod';
import { currencyCodeSchema } from './profile';
import { err, ok, type Result } from './result';
import { TARGET_REGION_COUNTRIES } from './settings';

/**
 * Reusable application answers. Only answers with status VERIFIED may ever be used to fill a
 * form. Editing a verified answer's value sets it back to DRAFT until the user verifies again.
 */

export const ANSWER_TYPES = [
  'text',
  'long_text',
  'number',
  'boolean',
  'single_select',
  'multi_select',
  'date',
  'money',
  'url',
] as const;
export type AnswerType = (typeof ANSWER_TYPES)[number];

export const ANSWER_STATUSES = ['DRAFT', 'VERIFIED', 'ARCHIVED'] as const;
export type AnswerStatus = (typeof ANSWER_STATUSES)[number];

export const ANSWER_SOURCES = ['USER_ENTERED', 'PROFILE_FIELD', 'CV_SUGGESTION_CONFIRMED'] as const;
export type AnswerSource = (typeof ANSWER_SOURCES)[number];

const httpUrl = z
  .url()
  .max(500)
  .refine((url) => /^https?:\/\//i.test(url), 'Use an http(s) link');

export const answerValueSchemas = {
  text: z.object({ text: z.string().trim().min(1).max(500) }).strict(),
  long_text: z.object({ text: z.string().trim().min(1).max(5000) }).strict(),
  number: z.object({ number: z.number().min(-1_000_000_000).max(1_000_000_000) }).strict(),
  boolean: z.object({ value: z.boolean() }).strict(),
  single_select: z.object({ option: z.string().trim().min(1).max(200) }).strict(),
  multi_select: z
    .object({ options: z.array(z.string().trim().min(1).max(200)).min(1).max(50) })
    .strict(),
  date: z.object({ date: z.iso.date() }).strict(),
  money: z
    .object({
      amount: z.number().min(0).max(10_000_000_000),
      currency: currencyCodeSchema,
      period: z.enum(['year', 'month']),
    })
    .strict(),
  url: z.object({ url: httpUrl }).strict(),
} satisfies Record<AnswerType, z.ZodType>;

export type AnswerValue = z.infer<(typeof answerValueSchemas)[AnswerType]>;

export interface AnswerCatalogEntry {
  key: string;
  label: string;
  questionText: string;
  type: AnswerType;
  /** Highlighted in the UI and never logged (salary, visa status, ...). */
  sensitive: boolean;
  options?: readonly string[];
  min?: number;
  max?: number;
}

const WORK_AUTHORIZATION_OPTIONS = [
  'citizen',
  'permanent_resident',
  'work_visa',
  'needs_sponsorship',
] as const;

export const ANSWER_CATALOG: readonly AnswerCatalogEntry[] = [
  {
    key: 'notice_period_days',
    label: 'Notice period (days)',
    questionText: 'What is your notice period?',
    type: 'number',
    sensitive: false,
    min: 0,
    max: 365,
  },
  {
    key: 'earliest_start_date',
    label: 'Earliest start date',
    questionText: 'When can you start?',
    type: 'date',
    sensitive: false,
  },
  {
    key: 'expected_salary',
    label: 'Expected salary',
    questionText: 'What is your expected salary?',
    type: 'money',
    sensitive: true,
  },
  {
    key: 'current_salary',
    label: 'Current salary',
    questionText: 'What is your current salary?',
    type: 'money',
    sensitive: true,
  },
  {
    key: 'years_experience',
    label: 'Years of experience',
    questionText: 'How many years of relevant experience do you have?',
    type: 'number',
    sensitive: false,
    min: 0,
    max: 60,
  },
  {
    key: 'willing_to_relocate',
    label: 'Willing to relocate',
    questionText: 'Are you willing to relocate?',
    type: 'boolean',
    sensitive: false,
  },
  {
    key: 'requires_visa_sponsorship',
    label: 'Requires visa sponsorship',
    questionText: 'Will you now or in the future require visa sponsorship?',
    type: 'boolean',
    sensitive: true,
  },
  ...TARGET_REGION_COUNTRIES.map((country): AnswerCatalogEntry => ({
    key: `work_authorization_${country.code.toLowerCase()}`,
    label: `Work authorization: ${country.name}`,
    questionText: `What is your work authorization status in ${country.name}?`,
    type: 'single_select',
    sensitive: true,
    options: WORK_AUTHORIZATION_OPTIONS,
  })),
  {
    key: 'highest_education',
    label: 'Highest education',
    questionText: 'What is your highest level of education?',
    type: 'single_select',
    sensitive: false,
    options: ['high_school', 'diploma', 'bachelors', 'masters', 'doctorate', 'other'],
  },
  {
    key: 'linkedin_url',
    label: 'LinkedIn profile',
    questionText: 'LinkedIn profile URL',
    type: 'url',
    sensitive: false,
  },
  {
    key: 'portfolio_url',
    label: 'Portfolio / website',
    questionText: 'Portfolio or personal website URL',
    type: 'url',
    sensitive: false,
  },
  {
    key: 'github_url',
    label: 'GitHub profile',
    questionText: 'GitHub profile URL',
    type: 'url',
    sensitive: false,
  },
];

const CATALOG_BY_KEY = new Map(ANSWER_CATALOG.map((entry) => [entry.key, entry]));

export function findCatalogEntry(key: string): AnswerCatalogEntry | undefined {
  return CATALOG_BY_KEY.get(key);
}

/** `custom:<slug>` keys hold the user's own recurring questions. */
export const CUSTOM_KEY_PATTERN = /^custom:[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Questions about protected characteristics are never stored as reusable answers (decision
 * D-027): forms that ask them are always answered by the user directly.
 */
const PROTECTED_CHARACTERISTIC_PATTERN =
  /\b(gender|sex|sexual orientation|ethnic\w*|race|racial|religio\w*|caste|disab\w*|age|date of birth|birth ?date|dob|marital|pregnan\w*|veteran)\b/i;

export function mentionsProtectedCharacteristic(text: string): boolean {
  return PROTECTED_CHARACTERISTIC_PATTERN.test(text.replace(/[-_:]/g, ' '));
}

export const answerCreateSchema = z
  .object({
    questionKey: z.string().trim().min(1).max(80),
    /** Required for custom questions; optional override text for catalog questions. */
    questionText: z.string().trim().min(3).max(300).optional(),
    /** Required for custom questions; ignored for catalog questions. */
    answerType: z.enum(ANSWER_TYPES).optional(),
    value: z.unknown(),
  })
  .strict();
export type AnswerCreateInput = z.infer<typeof answerCreateSchema>;

export const answerUpdateSchema = z
  .object({
    questionText: z.string().trim().min(3).max(300).optional(),
    value: z.unknown().optional(),
  })
  .strict()
  .refine((v) => v.questionText !== undefined || v.value !== undefined, 'Nothing to change');
export type AnswerUpdateInput = z.infer<typeof answerUpdateSchema>;

export interface ValidatedAnswer {
  questionKey: string;
  questionText: string;
  answerType: AnswerType;
  value: AnswerValue;
  isSensitive: boolean;
}

export interface AnswerIssue {
  path: string;
  message: string;
}

/** Checks a value against the answer type and, for catalog questions, its options and range. */
export function validateAnswerValue(
  type: AnswerType,
  value: unknown,
  entry?: AnswerCatalogEntry,
): Result<AnswerValue, AnswerIssue[]> {
  const parsed = answerValueSchemas[type].safeParse(value);
  if (!parsed.success) {
    return err(
      parsed.error.issues.map((i) => ({
        path: ['value', ...i.path].join('.'),
        message: i.message,
      })),
    );
  }
  const answer = parsed.data as AnswerValue;
  if (entry?.options) {
    const chosen = 'option' in answer ? [answer.option] : 'options' in answer ? answer.options : [];
    const invalid = chosen.filter((option) => !entry.options!.includes(option));
    if (invalid.length > 0) {
      return err([{ path: 'value', message: `Choose from: ${entry.options.join(', ')}` }]);
    }
  }
  if ('number' in answer && entry) {
    if (
      (entry.min !== undefined && answer.number < entry.min) ||
      (entry.max !== undefined && answer.number > entry.max)
    ) {
      return err([
        { path: 'value.number', message: `Must be between ${entry.min} and ${entry.max}` },
      ]);
    }
  }
  return ok(answer);
}

/** Validates a new answer: known catalog key or a safe custom question, plus a valid value. */
export function validateNewAnswer(
  input: AnswerCreateInput,
): Result<ValidatedAnswer, AnswerIssue[]> {
  const entry = findCatalogEntry(input.questionKey);
  if (entry) {
    const value = validateAnswerValue(entry.type, input.value, entry);
    if (!value.ok) return value;
    return ok({
      questionKey: entry.key,
      questionText: input.questionText ?? entry.questionText,
      answerType: entry.type,
      value: value.value,
      isSensitive: entry.sensitive,
    });
  }

  if (!CUSTOM_KEY_PATTERN.test(input.questionKey)) {
    return err([
      { path: 'questionKey', message: 'Unknown question. Use a catalog key or custom:<your-slug>' },
    ]);
  }
  if (!input.questionText || !input.answerType) {
    return err([
      { path: 'questionText', message: 'Custom questions need questionText and answerType' },
    ]);
  }
  if (
    mentionsProtectedCharacteristic(input.questionKey) ||
    mentionsProtectedCharacteristic(input.questionText)
  ) {
    return err([
      {
        path: 'questionText',
        message:
          'Questions about protected characteristics (gender, ethnicity, religion, disability, age, marital status, ...) are not stored as reusable answers. Answer them directly on each form.',
      },
    ]);
  }
  const value = validateAnswerValue(input.answerType, input.value);
  if (!value.ok) return value;
  return ok({
    questionKey: input.questionKey,
    questionText: input.questionText,
    answerType: input.answerType,
    value: value.value,
    isSensitive: false,
  });
}

/** `GET /api/answers` item. `usable` is true only for VERIFIED answers. */
export interface ProfileAnswer {
  id: string;
  questionKey: string;
  questionText: string;
  answerType: AnswerType;
  value: AnswerValue;
  status: AnswerStatus;
  source: AnswerSource;
  isSensitive: boolean;
  usable: boolean;
  verifiedAt: string | null;
  updatedAt: string;
}
