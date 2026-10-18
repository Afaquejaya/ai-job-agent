'use client';

import {
  ANSWER_CATALOG,
  ANSWER_TYPES,
  type AnswerCatalogEntry,
  type AnswerType,
  type ProfileAnswer,
} from '@job-agent/shared';
import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Alert, Badge, Button, Field, Select, TextArea, TextInput } from '@/components/ui/form';
import { apiRequest, describeFailure, jsonInit } from '@/lib/api-client';

type Draft = Record<string, unknown>;
const CURRENCIES = ['INR', 'AED', 'SAR', 'QAR', 'KWD', 'BHD', 'OMR', 'USD', 'EUR', 'GBP'];
const label = (value: string) => value.replace(/_/g, ' ');

function emptyValue(type: AnswerType): Draft {
  switch (type) {
    case 'text':
    case 'long_text':
      return { text: '' };
    case 'number':
      return { number: 0 };
    case 'boolean':
      return { value: true };
    case 'single_select':
      return { option: '' };
    case 'multi_select':
      return { options: [] };
    case 'date':
      return { date: '' };
    case 'money':
      return { amount: 0, currency: 'INR', period: 'year' };
    case 'url':
      return { url: '' };
  }
}

export function formatAnswerValue(type: AnswerType, value: Draft): string {
  switch (type) {
    case 'text':
    case 'long_text':
      return String(value.text ?? '');
    case 'number':
      return String(value.number ?? '');
    case 'boolean':
      return value.value ? 'Yes' : 'No';
    case 'single_select':
      return label(String(value.option ?? ''));
    case 'multi_select':
      return ((value.options as string[]) ?? []).map(label).join(', ');
    case 'date':
      return String(value.date ?? '');
    case 'money':
      return `${value.amount} ${value.currency} per ${value.period}`;
    case 'url':
      return String(value.url ?? '');
  }
}

function ValueEditor({
  type,
  value,
  options,
  onChange,
}: {
  type: AnswerType;
  value: Draft;
  options?: readonly string[];
  onChange: (value: Draft) => void;
}) {
  switch (type) {
    case 'text':
      return (
        <TextInput
          value={String(value.text ?? '')}
          onChange={(e) => onChange({ text: e.target.value })}
        />
      );
    case 'long_text':
      return (
        <TextArea
          value={String(value.text ?? '')}
          onChange={(e) => onChange({ text: e.target.value })}
        />
      );
    case 'number':
      return (
        <TextInput
          type="number"
          value={String(value.number ?? '')}
          onChange={(e) => onChange({ number: Number(e.target.value) })}
        />
      );
    case 'boolean':
      return (
        <Select
          value={String(value.value)}
          onChange={(e) => onChange({ value: e.target.value === 'true' })}
        >
          <option value="true">Yes</option>
          <option value="false">No</option>
        </Select>
      );
    case 'single_select':
      return options ? (
        <Select
          value={String(value.option ?? '')}
          onChange={(e) => onChange({ option: e.target.value })}
        >
          <option value="">Choose…</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {label(o)}
            </option>
          ))}
        </Select>
      ) : (
        <TextInput
          value={String(value.option ?? '')}
          onChange={(e) => onChange({ option: e.target.value })}
        />
      );
    case 'multi_select':
      return (
        <TextInput
          placeholder="Comma-separated"
          value={((value.options as string[]) ?? []).join(', ')}
          onChange={(e) =>
            onChange({
              options: e.target.value
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
        />
      );
    case 'date':
      return (
        <TextInput
          type="date"
          value={String(value.date ?? '')}
          onChange={(e) => onChange({ date: e.target.value })}
        />
      );
    case 'money':
      return (
        <div className="grid grid-cols-3 gap-2">
          <TextInput
            type="number"
            min={0}
            value={String(value.amount ?? '')}
            onChange={(e) => onChange({ ...value, amount: Number(e.target.value) })}
          />
          <Select
            value={String(value.currency)}
            onChange={(e) => onChange({ ...value, currency: e.target.value })}
          >
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
          <Select
            value={String(value.period)}
            onChange={(e) => onChange({ ...value, period: e.target.value })}
          >
            <option value="year">per year</option>
            <option value="month">per month</option>
          </Select>
        </div>
      );
    case 'url':
      return (
        <TextInput
          type="url"
          value={String(value.url ?? '')}
          onChange={(e) => onChange({ url: e.target.value })}
        />
      );
  }
}

function AnswerRow({
  title,
  entry,
  answer,
  onSaved,
}: {
  title: string;
  entry?: AnswerCatalogEntry;
  answer: ProfileAnswer | undefined;
  onSaved: (answer: ProfileAnswer | null, message: string) => void;
}) {
  const type = answer?.answerType ?? entry!.type;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(
    (answer?.value as Draft | undefined) ?? emptyValue(type),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function run<T>(path: string, init: RequestInit, done: (data: T) => void) {
    setPending(true);
    setError(null);
    const result = await apiRequest<T>(path, init);
    setPending(false);
    if (!result.ok) return setError(describeFailure(result.error));
    done(result.data);
  }

  const save = () =>
    answer
      ? run<{ answer: ProfileAnswer }>(
          `/api/answers/${answer.id}`,
          jsonInit('PATCH', { value: draft }),
          (d) => {
            setEditing(false);
            onSaved(
              d.answer,
              d.answer.status === 'DRAFT'
                ? 'Saved as draft. Verify it to make it usable.'
                : 'Saved.',
            );
          },
        )
      : run<{ answer: ProfileAnswer }>(
          '/api/answers',
          jsonInit('POST', { questionKey: entry!.key, value: draft }),
          (d) => {
            setEditing(false);
            onSaved(d.answer, 'Saved as draft. Verify it to make it usable.');
          },
        );

  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-zinc-900 dark:text-zinc-100">{title}</span>
        {answer?.isSensitive || entry?.sensitive ? <Badge tone="warning">Sensitive</Badge> : null}
        {answer ? (
          <Badge tone={answer.usable ? 'success' : 'neutral'}>
            {answer.usable ? 'Verified' : 'Draft'}
          </Badge>
        ) : null}
      </div>
      {!editing ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="break-all">
            {answer ? formatAnswerValue(answer.answerType, answer.value as Draft) : 'Not answered'}
          </span>
          <span className="ml-auto flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              {answer ? 'Edit' : 'Answer'}
            </Button>
            {answer && !answer.usable ? (
              <Button
                size="sm"
                disabled={pending}
                onClick={() =>
                  run<{ answer: ProfileAnswer }>(
                    `/api/answers/${answer.id}/verify`,
                    { method: 'POST' },
                    (d) => onSaved(d.answer, 'Verified. This answer can now be reused.'),
                  )
                }
              >
                Verify
              </Button>
            ) : null}
            {answer ? (
              <Button
                size="sm"
                variant="danger"
                disabled={pending}
                onClick={() =>
                  run<unknown>(`/api/answers/${answer.id}`, { method: 'DELETE' }, () =>
                    onSaved(null, 'Archived.'),
                  )
                }
              >
                Archive
              </Button>
            ) : null}
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <ValueEditor type={type} value={draft} options={entry?.options} onChange={setDraft} />
          <span className="flex gap-2">
            <Button size="sm" disabled={pending} onClick={save}>
              Save
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </span>
        </div>
      )}
      {error ? <Alert tone="error">{error}</Alert> : null}
    </li>
  );
}

function CustomQuestionForm({ onCreated }: { onCreated: (answer: ProfileAnswer) => void }) {
  const [questionText, setQuestionText] = useState('');
  const [answerType, setAnswerType] = useState<AnswerType>('text');
  const [value, setValue] = useState<Draft>(emptyValue('text'));
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setError(null);
    const slug = questionText
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
    const result = await apiRequest<{ answer: ProfileAnswer }>(
      '/api/answers',
      jsonInit('POST', {
        questionKey: `custom:${slug || 'question'}`,
        questionText,
        answerType,
        value,
      }),
    );
    if (!result.ok) return setError(describeFailure(result.error));
    setQuestionText('');
    setValue(emptyValue(answerType));
    onCreated(result.data.answer);
  }

  return (
    <div className="flex flex-col gap-3">
      <Field
        label="Question"
        hint="Questions about gender, ethnicity, religion, disability, age or marital status are not stored; answer those directly on each form."
      >
        <TextInput
          value={questionText}
          onChange={(e) => setQuestionText(e.target.value)}
          maxLength={300}
        />
      </Field>
      <Field label="Answer type">
        <Select
          value={answerType}
          onChange={(e) => {
            const type = e.target.value as AnswerType;
            setAnswerType(type);
            setValue(emptyValue(type));
          }}
        >
          {ANSWER_TYPES.map((t) => (
            <option key={t} value={t}>
              {label(t)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Answer">
        <ValueEditor type={answerType} value={value} onChange={setValue} />
      </Field>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button className="self-start" disabled={questionText.trim().length < 3} onClick={create}>
        Add custom answer
      </Button>
    </div>
  );
}

export function AnswersClient({ initial }: { initial: ProfileAnswer[] }) {
  const [answers, setAnswers] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);
  const byKey = new Map(answers.map((a) => [a.questionKey, a]));
  const custom = answers.filter((a) => a.questionKey.startsWith('custom:'));

  const upsert = (
    answer: ProfileAnswer | null,
    previous: ProfileAnswer | undefined,
    text: string,
  ) => {
    setAnswers((cur) => {
      const rest = cur.filter((a) => a.id !== previous?.id && a.id !== answer?.id);
      return answer ? [...rest, answer] : rest;
    });
    setMessage(text);
  };

  return (
    <div className="flex flex-col gap-5">
      {message ? <Alert tone="success">{message}</Alert> : null}
      <Card title="Common questions">
        <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
          {ANSWER_CATALOG.map((entry) => {
            const answer = byKey.get(entry.key);
            return (
              <AnswerRow
                key={`${entry.key}:${answer?.id ?? 'new'}`}
                title={entry.label}
                entry={entry}
                answer={answer}
                onSaved={(saved, text) => upsert(saved, answer, text)}
              />
            );
          })}
        </ul>
      </Card>
      <Card title="Your own questions">
        <div className="flex flex-col gap-4">
          {custom.length > 0 ? (
            <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
              {custom.map((answer) => (
                <AnswerRow
                  key={answer.id}
                  title={answer.questionText}
                  answer={answer}
                  onSaved={(saved, text) => upsert(saved, answer, text)}
                />
              ))}
            </ul>
          ) : null}
          <CustomQuestionForm
            onCreated={(answer) =>
              upsert(answer, undefined, 'Saved as draft. Verify it to make it usable.')
            }
          />
        </div>
      </Card>
    </div>
  );
}
